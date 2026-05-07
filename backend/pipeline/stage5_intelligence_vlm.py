import re
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from pipeline.utils import setup_logger

logger = setup_logger("stage5_intelligence")

# ────────────────────────────────────────────────────────────────────
# 1. ELITE SCHEMAS
# ────────────────────────────────────────────────────────────────────

class LogicBlock(BaseModel):
    type: str = "conditional"
    trigger: Optional[Dict[str, Any]] = None
    condition: Optional[str] = None
    action: Optional[Dict[str, Any]] = None
    result: Optional[str] = None
    confidence: float = 1.0

class ACNode(BaseModel):
    text: str
    type: str = "requirement" # group, condition, action, requirement
    level: int = 0
    synthetic: bool = False
    children: List['ACNode'] = Field(default_factory=list)
    logic: List[LogicBlock] = Field(default_factory=list)

class UserStory(BaseModel):
    id: str
    type: str = "unknown" # functional_requirement, user_story, non_functional_requirement, unknown
    role: str
    goal: str
    reason: Optional[str] = None
    confidence: float = 0.0
    acceptance_criteria: List[ACNode] = Field(default_factory=list)
    logic: List[LogicBlock] = Field(default_factory=list)
    raw_text: str

class RequirementsModel(BaseModel):
    document_name: str
    actors: List[str]
    user_stories: List[UserStory]
    metadata: Dict[str, Any] = Field(default_factory=dict)

# ────────────────────────────────────────────────────────────────────
# 2. ACTOR NORMALIZATION
# ────────────────────────────────────────────────────────────────────

ACTOR_MAP = {
    "CR": "Class Representative",
    "Class Representative": "Class Representative",
    "Faculty member": "Faculty",
    "Faculty": "Faculty",
    "Admin": "Admin",
    "Administrator": "Admin"
}

def normalize_actor(raw_role: str) -> str:
    raw_role = raw_role.strip().strip('*').strip()
    for pattern, canonical in ACTOR_MAP.items():
        if pattern.lower() in raw_role.lower():
            return canonical
    return raw_role

# ────────────────────────────────────────────────────────────────────
# 3. SEMANTIC PARSING (V2 FORMAT-AGNOSTIC)
# ────────────────────────────────────────────────────────────────────

REQUIREMENT_PATTERNS = [
    r"(US\d+[\s:].+?)(?=\n\s*[-*•\u2022]?\s*US\d+|\n\s*[-*•\u2022]?\s*FR[-\s]?\d+|\n\s*[-*•\u2022]?\s*NFR[-\s]?\d+|\n#|\Z)",                         
    r"(FR[-\s]?\d+[\s:].+?)(?=\n\s*[-*•\u2022]?\s*FR[-\s]?\d+|\n\s*[-*•\u2022]?\s*US\d+|\n\s*[-*•\u2022]?\s*NFR[-\s]?\d+|\n#|\Z)",     
    r"(NFR[-\s]?\d+[\s:].+?)(?=\n\s*[-*•\u2022]?\s*NFR[-\s]?\d+|\n\s*[-*•\u2022]?\s*FR[-\s]?\d+|\n\s*[-*•\u2022]?\s*US\d+|\n#|\Z)" 
]

def extract_logic(text: str) -> List[LogicBlock]:
    """Attempts to extract structured logic from AC text or Requirement text."""
    logic_list = []
    if_then_pattern = re.compile(r"(?:if|when|where|during)\s+(?P<cond>.*?)(?:,\s*|\s+then\s+|\s+shall\s+|\s+must\s+|\s+will\s+)(?P<res>.*?)(?:\.|$)", re.IGNORECASE)
    
    for match in if_then_pattern.finditer(text):
        cond = match.group("cond").strip()
        res = match.group("res").strip()
        
        logic_list.append(LogicBlock(
            type="conditional",
            trigger={"event": "status_change", "value": cond},
            condition=cond,
            action={"type": "outcome", "description": res},
            confidence=0.85
        ))
        
    return logic_list

def parse_ac_tree(lines: List[str]) -> List[ACNode]:
    if not lines: return []
    root_nodes = []
    stack = []
    
    for line in lines:
        match = re.match(r"^(\s*)([-*•]|\d+\.)\s+(.*)", line)
        if not match: continue
            
        indent_str, bullet, content = match.groups()
        indent = len(indent_str)
        content = content.replace("**", "").strip()
        
        node = ACNode(
            text=content,
            type="group" if content.endswith(":") else "requirement",
            level=indent,
            synthetic=False,
            logic=extract_logic(content)
        )
        
        while stack and stack[-1][0] >= indent:
            stack.pop()
            
        if not stack:
            root_nodes.append(node)
        else:
            stack[-1][1].children.append(node)
            
        stack.append((indent, node))
        
    return root_nodes

def fallback_split(content: str) -> List[str]:
    # Split by paragraphs or bullet blocks. Only keep substantial blocks.
    blocks = re.split(r"\n\s*\n", content)
    return [b.strip() for b in blocks if len(b.strip()) > 15 and re.search(r"[a-zA-Z]", b)]

def extract_requirements_blocks(content: str) -> List[str]:
    # Use a more aggressive splitting strategy for format-agnostic detection
    # Instead of specific regex matching for the whole block, we split by common delimiters
    # and then classify each chunk in the next layer.
    
    # 1. Primary: Split by detected IDs (including bolded variants like **REQ-XXX-NN**)
    # 2. Fallback: Split by newline paragraphs
    
    blocks = re.split(r"\n(?=\s*(?:[-*•]|\*\*|__)?\s*[A-Z]{2,5}(?:-[A-Z]+)?-\d{1,3})|\n\s*\n", content)
    clean_blocks = [b.strip() for b in blocks if len(b.strip()) > 15]
    
    if len(clean_blocks) < 5: # If too few blocks, use a simpler paragraph split
        clean_blocks = fallback_split(content)
        
    return clean_blocks

def get_req_type(req_id: str) -> str:
    if "FR" in req_id.upper() and "NFR" not in req_id.upper(): return "functional_requirement"
    if "NFR" in req_id.upper(): return "non_functional_requirement"
    if "US" in req_id.upper(): return "user_story"
    return "unknown"

def extract_id(text: str) -> str:
    # LAYER 1: UNIVERSAL ID DETECTION
    # Captures: REQ-PAT-01, FR-1, US001, SEC-09, etc.
    match = re.search(r"\b([A-Z]{2,5}(?:-[A-Z]+)?-\d{1,3})\b", text, re.IGNORECASE)
    if match: return match.group(1).upper()
    
    # Legacy fallback
    match = re.search(r"(US\d+|FR[-\s]?\d+|NFR[-\s]?\d+)", text, re.IGNORECASE)
    return match.group(1).upper() if match else "UNKNOWN"

def extract_condition(text: str) -> Optional[str]:
    match = re.search(r"(?:if|when|where)\s+(.*?)(?:,|then|\bsystem\b|\bshall\b)", text, re.IGNORECASE)
    return match.group(1).strip() if match else None

def extract_action(text: str) -> str:
    # Capture up to 5 words before the normative verb to ensure we get the subject (e.g., "Passwords must be...")
    match = re.search(r"((?:\b\w+\b\s+){0,5})\b(shall|must|will|should|needs to)\b([^\.]*)", text, re.IGNORECASE)
    if match: 
        return match.group(0).strip()
    return text.split("\n")[0].strip()

def extract_actor(text: str) -> str:
    role_match = re.search(r"As (?:a|the)\s+(.*?)(?:,|\s+I want to)", text, re.IGNORECASE | re.DOTALL)
    if role_match: return normalize_actor(role_match.group(1).strip())
    
    sys_match = re.search(r"\b(system|admin|user|employee|manager)\b", text, re.IGNORECASE)
    if sys_match: return normalize_actor(sys_match.group(1).strip().capitalize())
    
    return "System"

def estimate_confidence(text: str) -> float:
    score = 0.5
    if "if" in text.lower(): score += 0.2
    if len(text) > 50: score += 0.1
    if re.search(r"\b(shall|must|will)\b", text.lower()): score += 0.2
    return min(score, 0.95)

def is_valid_requirement(text: str) -> bool:
    # LAYER 2: SEMANTIC DETECTION
    text_lower = text.lower()
    normative_verbs = ["shall", "must", "should", "will", "needs to", "required to"]
    conditional_triggers = ["if", "when", "where", "whenever"]
    
    # Noise Filter: Exclude structural fragments and informational headers
    noise_keywords = ["introduction", "table of contents", "scope", "purpose", "overview", "page_", "document history", "copyright", "confidential", "preface", "appendix", "glossary", "analysis models"]
    if any(k in text_lower for k in noise_keywords):
        return False
        
    # Standard exclusions
    if text.startswith("<!--") or text.startswith("#") or len(text.strip()) < 25:
        return False
        
    # Exclusion for common non-requirement table/list headers
    if text_lower.strip().endswith(":") and len(text.strip()) < 50:
        return False

    # Layer 3: Soft Requirement Detection
    # Must have a normative verb OR be a substantial paragraph with an ID
    has_trigger = any(v in text_lower for v in normative_verbs) or any(c in text_lower for c in conditional_triggers)
    is_substantial = len(text.split()) > 15 and any(c.isalpha() for c in text)
    
    return has_trigger or is_substantial

def parse_requirement(block: str) -> Optional[UserStory]:
    clean_body = block.replace("**", "").strip()
    if not clean_body or not is_valid_requirement(clean_body): return None
    
    req_id = extract_id(clean_body)
    req_type = get_req_type(req_id)
    actor = extract_actor(clean_body)
    cond = extract_condition(clean_body)
    action = extract_action(clean_body)
    confidence = estimate_confidence(clean_body)
    
    lines = clean_body.split('\n')
    ac_lines = []
    in_ac = False
    
    for line in lines:
        if "Acceptance Criteria" in line:
            in_ac = True
            continue
        if in_ac and (line.strip().startswith("-") or line.strip().startswith("*") or re.match(r"^\d+\.", line.strip())):
            ac_lines.append(line)

    ac_tree = parse_ac_tree(ac_lines)
    
    logic_list = extract_logic(clean_body)
    
    if not ac_tree and (cond or logic_list or req_type != "unknown"):
        if not logic_list and cond and action:
            logic_list.append(LogicBlock(
                type="conditional",
                trigger={"event": "status_change", "value": cond},
                condition=cond,
                action={"type": "outcome", "description": action},
                confidence=confidence
            ))
            
        ac_tree.append(ACNode(
            text=clean_body,
            type="requirement",
            level=0,
            synthetic=True,
            logic=logic_list
        ))

    goal = action if req_type != "user_story" else clean_body
    if req_type == "user_story":
        goal_match = re.search(r"I want to\s+(.*?)(?:,|\s+so that|$)", clean_body, re.IGNORECASE | re.DOTALL)
        if goal_match: goal = goal_match.group(1).strip().replace("\n", " ")

    reason_match = re.search(r"so that\s+(.*?)(?:\.|\n|$)", clean_body, re.IGNORECASE | re.DOTALL)
    reason = reason_match.group(1).strip().replace("\n", " ") if reason_match else None

    return UserStory(
        id=req_id,
        type=req_type,
        role=actor,
        goal=goal[:250],
        reason=reason,
        confidence=confidence,
        acceptance_criteria=ac_tree,
        logic=logic_list,
        raw_text=clean_body
    )

# ────────────────────────────────────────────────────────────────────
# 4. MAIN STAGE FUNCTION
# ────────────────────────────────────────────────────────────────────

def run_stage5_intelligence(md_path: Path, output_dir: Path) -> Path:
    logger.info(f"Starting Stage 5 Intelligence on {md_path.name}")
    
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    doc_name = md_path.stem.replace("_clean", "")
    
    blocks = extract_requirements_blocks(content)
    
    user_stories = []
    actors = set()
    
    for block in blocks:
        try:
            req_obj = parse_requirement(block)
            if req_obj:
                # Assign a synthetic ID if UNKNOWN to ensure reasoning engine can link it
                if req_obj.id == "UNKNOWN":
                    req_obj.id = f"INF-{len(user_stories) + 1:03d}"
                    req_obj.type = "contextual_information"
                
                user_stories.append(req_obj)
                actors.add(req_obj.role)
        except Exception as e:
            logger.error(f"Error processing block: {e}")
            
    if len(user_stories) == 0:
        logger.warning("⚠️ WARNING: No structured requirements found — check if document is purely informational.")

    model = RequirementsModel(
        document_name=doc_name,
        actors=sorted(list(actors)),
        user_stories=user_stories,
        metadata={
            "total_stories": len(user_stories),
            "source_file": str(md_path),
            "extraction_method": "v2_format_agnostic"
        }
    )
    
    out_path = output_dir / f"{doc_name}_intelligence.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(model.model_dump_json(indent=2))
        
    logger.info(f"Successfully exported {len(user_stories)} generic requirements to {out_path}")
    return out_path
