"""
Stage 6: Requirements Issues Engine (v3 — Complete)
- Phase 1: Ambiguity Detection (vague terms + weak verbs)
- Phase 2: Conflict Detection (cross-story contradictions)
- Phase 3: Gap Detection (structural completeness checks)
"""
import re
import json
from pathlib import Path
from typing import List, Dict, Any, Optional, Set, Tuple
from pydantic import BaseModel, Field
from pipeline.utils import setup_logger

logger = setup_logger("stage6_issues")

# ────────────────────────────────────────────────────────────────────
# 1. SCHEMAS
# ────────────────────────────────────────────────────────────────────

class AmbiguityIssue(BaseModel):
    id: str
    story_id: str
    text: str
    term: str
    category: str       # "vague_term" | "missing_reason" | "weak_verb"
    severity: str       # "high" | "medium" | "low"
    explanation: str
    suggested_rewrite: str

class ConflictIssue(BaseModel):
    id: str
    stories: List[str]              # e.g. ["US003", "US006"]
    severity: str                   # "high" | "medium"
    category: str                   # "contradictory_state" | "overlapping_scope" | "inconsistent_actor"
    description: str                # plain language: what the conflict is
    details: List[str] = Field(default_factory=list)  # specific conflicting texts
    confidence: float = 0.0          # NEW: Layer confidence score
    source: str = "rule"             # NEW: "rule" | "embedding" | "llm"
    explanation: str = ""            # NEW: Why it triggered
    rule_a: Dict[str, Any] = Field(default_factory=dict)
    rule_b: Dict[str, Any] = Field(default_factory=dict)
    trace: List[Dict[str, Any]] = Field(default_factory=list)
    confidence_breakdown: Dict[str, float] = Field(default_factory=dict)

class GapIssue(BaseModel):
    id: str
    story_id: str
    severity: str                   # "medium" | "low"
    category: str                   # "no_testable_ac" | "missing_ac" | "orphan_actor" | "duplicate_ac" | "missing_error_handling"
    description: str
    recommendation: str

class IssuesReport(BaseModel):
    document_name: str
    total_ambiguities: int = 0
    total_conflicts: int = 0
    total_gaps: int = 0
    ambiguities: List[AmbiguityIssue] = Field(default_factory=list)
    conflicts: List[ConflictIssue] = Field(default_factory=list)
    gaps: List[GapIssue] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

# ────────────────────────────────────────────────────────────────────
# 2. VAGUE TERM DICTIONARY (Phase 1 — unchanged)
# ────────────────────────────────────────────────────────────────────

VAGUE_TERMS: Dict[str, Dict[str, str]] = {
    "quickly": {"severity": "high", "explanation": "No measurable time constraint defined", "rewrite": "within [X] milliseconds/seconds"},
    "fast": {"severity": "high", "explanation": "No measurable performance target defined", "rewrite": "with response time under [X]ms at the 95th percentile"},
    "immediately": {"severity": "high", "explanation": "No specific time bound — 'immediately' is subjective", "rewrite": "within [X] seconds of the triggering event"},
    "real-time": {"severity": "high", "explanation": "No latency bound defined for 'real-time'", "rewrite": "with updates pushed within [X] seconds"},
    "large number": {"severity": "high", "explanation": "No specific quantity defined", "rewrite": "[specify exact count, e.g., 10,000 concurrent users]"},
    "scalable": {"severity": "high", "explanation": "No scaling dimensions or limits defined", "rewrite": "supporting [X] to [Y] concurrent users with horizontal scaling"},
    "user-friendly": {"severity": "high", "explanation": "Subjective usability claim without measurable criteria", "rewrite": "compliant with WCAG 2.1 AA, completable in [X] steps"},
    "intuitive": {"severity": "high", "explanation": "Subjective UX claim — not testable", "rewrite": "new users complete [task] without training within [X] minutes"},
    "appropriate": {"severity": "medium", "explanation": "No criteria defining what 'appropriate' means", "rewrite": "[define specific validation rules or criteria]"},
    "as needed": {"severity": "medium", "explanation": "Trigger condition is undefined", "rewrite": "when [specific trigger condition occurs]"},
    "if necessary": {"severity": "medium", "explanation": "Decision criteria for necessity undefined", "rewrite": "when [specific condition] is met"},
    "adequate": {"severity": "medium", "explanation": "No measurable threshold for adequacy", "rewrite": "meeting [specific threshold or standard]"},
    "sufficient": {"severity": "medium", "explanation": "No quantitative sufficiency criteria", "rewrite": "at least [X] [units]"},
    "reasonable": {"severity": "medium", "explanation": "Subjective term without defined bounds", "rewrite": "within [X] to [Y] [units]"},
    "easy to": {"severity": "medium", "explanation": "Subjective ease-of-use claim", "rewrite": "completable in [X] steps or [Y] seconds"},
    "easily": {"severity": "medium", "explanation": "Subjective ease-of-use claim", "rewrite": "in [X] steps or fewer"},
    "simple": {"severity": "medium", "explanation": "Subjective complexity claim — not testable", "rewrite": "using a single [action/screen/step]"},
    "flexible": {"severity": "medium", "explanation": "No specific flexibility dimensions defined", "rewrite": "supporting [list specific configuration options]"},
    "robust": {"severity": "medium", "explanation": "No specific reliability/resilience criteria", "rewrite": "with [X]% uptime and automatic recovery from [failure types]"},
    "seamless": {"severity": "medium", "explanation": "Subjective integration/UX claim", "rewrite": "without requiring user re-authentication or data re-entry"},
    "efficient": {"severity": "medium", "explanation": "No measurable efficiency target", "rewrite": "completing [task] in under [X] seconds using [Y] resources"},
    "etc.": {"severity": "low", "explanation": "Incomplete list — all items should be explicitly stated", "rewrite": "[list all remaining items explicitly]"},
    "e.g.": {"severity": "low", "explanation": "Example given but exhaustive list may be needed", "rewrite": "[confirm if this is exhaustive or provide complete list]"},
    "and/or": {"severity": "low", "explanation": "Ambiguous conjunction — unclear if both or either", "rewrite": "specify: 'A and B' or 'A or B' or 'A, B, or both'"},
    "some": {"severity": "low", "explanation": "Vague quantifier", "rewrite": "[specify exact count or percentage]"},
    "various": {"severity": "low", "explanation": "Vague quantifier — items not enumerated", "rewrite": "[list all specific items]"},
    "several": {"severity": "low", "explanation": "Vague quantifier", "rewrite": "[specify exact count]"},
    "many": {"severity": "low", "explanation": "Vague quantifier", "rewrite": "[specify exact count or range]"},
}

WEAK_VERBS: Dict[str, Dict[str, str]] = {
    "should": {"severity": "low", "explanation": "'Should' implies optional — use 'shall' for mandatory requirements", "rewrite": "Replace 'should' with 'shall' if this is mandatory"},
    "may": {"severity": "low", "explanation": "'May' implies optional permission — is this required?", "rewrite": "Replace 'may' with 'shall' if mandatory, or clarify as optional"},
    "could": {"severity": "low", "explanation": "'Could' implies possibility, not requirement", "rewrite": "Replace 'could' with 'shall' if this is a requirement"},
}

# ────────────────────────────────────────────────────────────────────
# 3. PHASE 1: AMBIGUITY DETECTION
# ────────────────────────────────────────────────────────────────────

def scan_text_for_ambiguities(text: str, story_id: str, counter: list) -> List[AmbiguityIssue]:
    issues = []
    text_lower = text.lower()

    for term, info in VAGUE_TERMS.items():
        if term.lower() in text_lower:
            counter[0] += 1
            issues.append(AmbiguityIssue(
                id=f"AMB-{counter[0]:03d}", story_id=story_id, text=text, term=term,
                category="vague_term", severity=info["severity"],
                explanation=info["explanation"], suggested_rewrite=info["rewrite"]
            ))

    for verb, info in WEAK_VERBS.items():
        pattern = re.compile(rf'\b{verb}\b', re.IGNORECASE)
        if pattern.search(text_lower) and '"' not in text[:max(0, text_lower.find(verb))]:
            counter[0] += 1
            issues.append(AmbiguityIssue(
                id=f"AMB-{counter[0]:03d}", story_id=story_id, text=text, term=verb,
                category="weak_verb", severity=info["severity"],
                explanation=info["explanation"], suggested_rewrite=info["rewrite"]
            ))
    return issues

def detect_ambiguities(stories: list) -> List[AmbiguityIssue]:
    all_issues: List[AmbiguityIssue] = []
    counter = [0]

    for story in stories:
        story_id = story.get("id", "UNKNOWN")

        for field in ["goal", "reason"]:
            text = story.get(field)
            if text:
                all_issues.extend(scan_text_for_ambiguities(text, story_id, counter))

        def scan_ac_tree(nodes: list):
            for node in nodes:
                text = node.get("text", "")
                if text:
                    all_issues.extend(scan_text_for_ambiguities(text, story_id, counter))
                if node.get("children"):
                    scan_ac_tree(node["children"])
        scan_ac_tree(story.get("acceptance_criteria", []))

        def should_check_reason(req_type):
            return req_type == "user_story"

        if should_check_reason(story.get("type")) and not story.get("reason"):
            counter[0] += 1
            all_issues.append(AmbiguityIssue(
                id=f"AMB-{counter[0]:03d}", story_id=story_id,
                text=f"{story_id}: {story.get('goal', 'N/A')}", term="(missing)",
                category="missing_reason", severity="low",
                explanation="No 'so that' clause — business justification is missing",
                suggested_rewrite="Add: 'so that [stakeholder] can [measurable benefit]'"
            ))

    # Deduplicate
    seen: Set[Tuple] = set()
    deduped = []
    for issue in all_issues:
        key = (issue.story_id, issue.term, issue.category)
        if key not in seen:
            seen.add(key)
            deduped.append(issue)
    for i, issue in enumerate(deduped):
        issue.id = f"AMB-{i+1:03d}"
    return deduped

# ────────────────────────────────────────────────────────────────────
# 4. PHASE 2: CONFLICT DETECTION
# ────────────────────────────────────────────────────────────────────

from difflib import SequenceMatcher
try:
    import numpy as np
    import faiss
    from sentence_transformers import SentenceTransformer
    from sklearn.metrics.pairwise import cosine_similarity as _cosine_similarity
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    np = None
    faiss = None
    SentenceTransformer = None

def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()

_model = None
_embedding_cache = {}

def get_model():
    if not ML_AVAILABLE:
        return None
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model

def build_faiss_index(requirements):
    if not ML_AVAILABLE:
        return None, None
    model = get_model()
    texts = [
        (req.get("raw_text") or "") + " " + (req.get("action") or "")
        for req in requirements
    ]
    embeddings = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    return index, embeddings

def get_candidate_pairs(requirements, index, embeddings, top_k=10):
    candidate_pairs = set()

    for i, emb in enumerate(embeddings):
        emb = np.expand_dims(emb, axis=0)

        scores, neighbors = index.search(emb, top_k + 1)  # +1 because it includes itself

        for j in neighbors[0]:
            if i == j or j == -1:
                continue

            pair = tuple(sorted((i, int(j))))
            candidate_pairs.add(pair)

    return list(candidate_pairs)

# sklearn imported above in ML_AVAILABLE block

def get_embedding(text: str):
    if not ML_AVAILABLE:
        return None
    global _embedding_cache
    if text not in _embedding_cache:
        model = get_model()
        _embedding_cache[text] = model.encode([text])[0]
    return _embedding_cache[text]

def semantic_similarity(a: str, b: str) -> float:
    if not ML_AVAILABLE:
        # Fallback: simple string overlap ratio
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()
    vec_a = get_embedding(a)
    vec_b = get_embedding(b)
    return float(_cosine_similarity([vec_a], [vec_b])[0][0])

def extract_context(text: str) -> str:
    words = text.lower().split()
    STOP = {"shall", "must", "will", "should", "system", "user", "permit", "allow", "authorize", "grant", "prohibit", "detain", "block", "deny", "reject", "restrict", "prevent"}
    return " ".join([w for w in words if w not in STOP])

CONCEPT_GROUPS = [
    {"permission", "access", "action", "operation", "request", "override"},
    {"login", "authentication", "sign-in"},
    {"attendance", "presence", "absence", "leave"}
]

def normalize_context(context: str) -> str:
    words = set(context.lower().split())
    for group in CONCEPT_GROUPS:
        if words & group:
            return list(group)[0]
    return context

NEGATION_WORDS = {"not", "no", "never", "deny", "reject", "block", "restrict", "detain", "prohibit", "prevent", "absent", "fail", "cannot", "unauthorized", "prohibited", "restricted"}

def get_polarity(text: str) -> str:
    text = text.lower()
    for word in NEGATION_WORDS:
        if word in text:
            return "negative"
    return "positive"


ACTION_MAP = {
    "allow": "permit",
    "approve": "permit",
    "enable": "permit",
    "grant": "permit",

    "restrict": "deny",
    "reject": "deny",
    "block": "deny",
    "deny": "deny",
    "detain": "deny",

    "present": "permit",
    "absent": "deny"
}

OPPOSITES = {
    "permit": "deny",
    "deny": "permit"
}

def extract_primary_object(text: str) -> str:
    """Extracts the core subject/object of the requirement to prevent cross-domain false positives."""
    text = text.lower()
    # Strip requirement IDs (e.g., "req-sec-10:", "req-perf-03:")
    text = re.sub(r"\b[a-z]{2,5}(?:-[a-z]+)?-\d{1,3}\s*:?\s*", "", text)
    # Strip common boilerplate
    text = re.sub(r"\b(shall|must|will|should|system|user|automatically|force|ensure|provide|manage|handle|track|support|interface|allow|permit|prohibit|restrict|be|can|remain|valid|for|the|and|all|with|from|after|before|upon|during|that|this|have|has|its|are|not|only)\b", "", text)
    
    # Heuristic: Take the first 5 significant nouns/adjectives
    words = [w for w in text.split() if len(w) > 2]
    return " ".join(words[:5])

def is_same_domain(rule_a: dict, rule_b: dict) -> bool:
    """Gates conflict detection by functional module and primary object similarity."""
    id_a, id_b = rule_a.get("story_id", ""), rule_b.get("story_id", "")
    
    # 1. Extract Module Prefix (e.g., REQ-SEC-01 -> SEC)
    parts_a = id_a.split('-')
    parts_b = id_b.split('-')
    prefix_a = parts_a[1] if len(parts_a) > 1 else ""
    prefix_b = parts_b[1] if len(parts_b) > 1 else ""
    
    # Use raw text if action is too generic
    text_a = rule_a.get("raw_text") if len(rule_a.get("action", "")) < 15 else rule_a.get("action", "")
    text_b = rule_b.get("raw_text") if len(rule_b.get("action", "")) < 15 else rule_b.get("action", "")
    
    obj_a = extract_primary_object(text_a or "")
    obj_b = extract_primary_object(text_b or "")
    
    # 2. Similarity of the objects
    obj_sim = semantic_similarity(obj_a, obj_b)
    
    # 3. Decision Logic
    # If same module (e.g., SEC vs SEC), allow potential conflict by default
    if prefix_a and prefix_b and prefix_a == prefix_b:
        return True
    
    # If different modules (e.g., SEC vs PAT), they must have a high object match
    return obj_sim > 0.78

def normalize_condition(cond: str) -> str:
    cond = cond.lower()
    cond = cond.replace("%", " percent")
    return cond.strip()

def extract_condition_logic(text: str):
    # Enhanced pattern for numeric ranges (30 days, 1.5 seconds, 2500 users)
    match = re.search(r"(\d+(?:\.\d+)?)\s*(days|seconds|minutes|users|percent|ms|hours|transactions)", text.lower())
    if match:
        return {
            "variable": match.group(2),
            "operator": "==", # base value
            "value": float(match.group(1))
        }
    
    match = re.search(r"(attendance|marks|score|users|cpu|memory|storage|age|time|count|latency|delay|threshold|capacity)\s*(<|>|<=|>=|==|within|under|exceeding)\s*(\d+(?:\.\d+)?)", text.lower())
    if match:
        op = match.group(2)
        if op == "under": op = "<"
        elif op == "exceeding": op = ">"
        elif op == "within": op = "<="
        
        return {
            "variable": match.group(1),
            "operator": op,
            "value": float(match.group(3))
        }
    return None

def numeric_conflict(logic_a, logic_b):
    if logic_a["variable"] != logic_b["variable"]:
        return False
    
    val_a, val_b = logic_a["value"], logic_b["value"]
    op_a, op_b = logic_a["operator"], logic_b["operator"]
    
    # Simple direct contradiction (30 days vs 90 days)
    if op_a == "==" and op_b == "==" and val_a != val_b:
        return True
    
    # Overlap check
    if op_a == "<" and val_a < val_b and op_b == ">": return False # No overlap
    if op_a == ">" and val_a > val_b and op_b == "<": return False # No overlap
    
    return True # Potential intersection

def conditions_overlap(logic_a, logic_b):
    if logic_a["variable"] != logic_b["variable"]:
        return False
    op_a, op_b = logic_a["operator"], logic_b["operator"]
    if op_a in ["<", "<="] and op_b in ["<", "<="]: return True
    if op_a in [">", ">="] and op_b in [">", ">="]: return True
    return False

def same_condition(cond_a: str, cond_b: str, threshold: float = 0.85):
    logic_a = extract_condition_logic(cond_a)
    logic_b = extract_condition_logic(cond_b)

    if logic_a and logic_b:
        if conditions_overlap(logic_a, logic_b):
            relation = "subset" if logic_a["value"] != logic_b["value"] else "exact"
            return {"overlap": True, "type": "numeric", "relation": relation}
        return {"overlap": False}

    a = normalize_condition(cond_a or "")
    b = normalize_condition(cond_b or "")
    
    # 🔹 Industry Fix: None != Same Condition (Audit Fix)
    # If either is None, they are distinct contexts and should not trigger a conflict comparison
    # unless they are explicitly mapped to the same domain (handled in parent gate)
    if not a or not b:
        return {"overlap": False}

    # Use semantic similarity for conditions to catch "lost connection" vs "network outage"
    sim_score = semantic_similarity(a, b)
    if sim_score >= threshold:
        return {"overlap": True, "type": "semantic", "relation": "exact", "similarity": sim_score}
    
    return {"overlap": False}

def normalize_action(action: str):
    action = action.lower()
    action = re.sub(r"\b(shall|must|will|should|system|user)\b", "", action)
    return action.strip()

def extract_core_action(action: str):
    action = normalize_action(action)
    for word in action.split():
        if word in ACTION_MAP:
            return ACTION_MAP[word]
    return action

def is_conflicting_action(a: str, b: str):
    if not a or not b:
        return False
    a_core = extract_core_action(a)
    b_core = extract_core_action(b)

    if a_core == b_core:
        return False

    return OPPOSITES.get(a_core) == b_core

def explain_conflict(a: dict, b: dict) -> str:
    return f"Condition '{a['condition']}' leads to conflicting actions: '{a['action']}' vs '{b['action']}'"

def is_valid_rule(rule: dict, threshold: float = 0.6) -> bool:
    if not rule: return False
    if rule.get("confidence", 0.85) < threshold: return False
    if not rule.get("action"): return False
    if rule["action"] in ["", None]: return False
    return True

ACTOR_PRIORITY = {
    "Class Representative": 1,
    "Student": 1,
    "Faculty": 2,
    "Admin": 3
}

def is_sequential_workflow(rule_a: dict, rule_b: dict) -> bool:
    actor_a = rule_a.get("actor")
    actor_b = rule_b.get("actor")
    if actor_a not in ACTOR_PRIORITY or actor_b not in ACTOR_PRIORITY: return False
    if not same_condition(rule_a["condition"], rule_b["condition"]): return False
    if ACTOR_PRIORITY[actor_a] != ACTOR_PRIORITY[actor_b]: return True
    return False

def detect_conflict(rule_a: dict, rule_b: dict):
    if not is_valid_rule(rule_a) or not is_valid_rule(rule_b): return None
    if is_sequential_workflow(rule_a, rule_b): return None
    
    # 🔹 Domain Alignment Gate (Critical FP Filter)
    if not is_same_domain(rule_a, rule_b):
        return None
    
    # 🔹 Condition Gate: None ≠ Same Condition (Industry Fix)
    cond_status = same_condition(rule_a["condition"] or "", rule_b["condition"] or "")
    is_global_global = not rule_a["condition"] and not rule_b["condition"]
    
    if not is_global_global and not cond_status["overlap"]:
        # Different specific conditions, no conflict
        return None

    a_action = rule_a["action"]
    b_action = rule_b["action"]
    
    # 🔹 Layer 1 — Rule-based (Deterministic)
    if is_conflicting_action(a_action, b_action):
        # FOR GLOBAL: Only allow Rule-based if we have high confidence (Rule matches are usually high)
        # However, to satisfy "None != Same Condition", we reject generic rules for Global vs Global
        if is_global_global:
            # Skip generic Rule-based for Global vs Global (wait for Numeric or Semantic layers)
            pass
        else:
            exp = explain_conflict(rule_a, rule_b)
            return {
                "type": "semantic_contradiction",
                "rule_a": rule_a,
                "rule_b": rule_b,
                "decision": True,
                "confidence": 0.95,
                "source": "rule",
                "explanation": exp,
                "confidence_breakdown": {"rule": 0.95, "embedding": 0.0, "llm": 0.0},
                "trace": [
                    {"layer": "rule", "decision": True, "confidence": 0.95, "note": exp},
                    {"layer": "embedding", "skipped": True},
                    {"layer": "llm", "skipped": True}
                ]
            }
    
    # 🔹 Layer 2 — Semantic Context
    context_a = normalize_context(extract_context(a_action))
    context_b = normalize_context(extract_context(b_action))
    sim_context = semantic_similarity(context_a, context_b)

    # 🔹 Layer 3 — Semantic Action
    sim_action = semantic_similarity(a_action, b_action)

    polarity_a = get_polarity(a_action)
    polarity_b = get_polarity(b_action)

    # Prevent false positives early - moderate thresholds
    if sim_context < 0.25 and sim_action < 0.35:
        return None

    # 🔹 Layer 3 — Polarity Conflict
    if polarity_a != polarity_b:
        # 🔹 Industry Fix: Strict AND logic + High Precision Thresholds
        threshold_ctx = 0.75  # Raised from 0.70
        threshold_act = 0.70  # Fixed at 0.70 as requested
        
        # Adaptive Threshold: If context is near-identical, allow more varied action phrasing
        if sim_context > 0.92:
            threshold_act = 0.45
        
        if sim_context >= threshold_ctx and sim_action >= threshold_act:
            reason = "strong_semantic_contradiction"
            confidence = (sim_context + sim_action) / 2
        else:
            reason = None

        if reason:
            # 🔹 Object-Level Alignment Gate (Audit Fix #2)
            # Even within the same module, the primary objects must be related.
            # This prevents "lockout mechanism" vs "credential validity" false positives.
            obj_a = extract_primary_object(rule_a.get("raw_text") or a_action)
            obj_b = extract_primary_object(rule_b.get("raw_text") or b_action)
            obj_sim = semantic_similarity(obj_a, obj_b)
            if obj_sim < 0.30:
                reason = None  # Objects are clearly disjoint — not a real conflict

        if reason:
            exp = f"Semantic contradiction inferred: {reason} with opposite polarity ({polarity_a} vs {polarity_b})"
            return {
                "type": "semantic_contradiction",
                "rule_a": rule_a,
                "rule_b": rule_b,
                "decision": True,
                "confidence": round(confidence, 3),
                "source": "embedding",
                "explanation": exp,
                "confidence_breakdown": {"rule": 0.0, "embedding": round(confidence, 3), "llm": 0.0},
                "trace": [
                    {"layer": "rule", "decision": False, "confidence": 0.0, "note": "Rule match failed"},
                    {"layer": "embedding", "decision": True, "confidence": round(confidence, 3), "note": f"reason={reason}, ctx_sim={sim_context:.2f}, act_sim={sim_action:.2f}, pol_a={polarity_a}, pol_b={polarity_b}"},
                    {"layer": "llm", "skipped": True}
                ]
            }

    # 🔹 Layer 4 — Numeric Contradiction in Base Text
    logic_a = extract_condition_logic(a_action)
    logic_b = extract_condition_logic(b_action)
    if logic_a and logic_b and numeric_conflict(logic_a, logic_b):
        # 🔹 Semantic Action Gate (Audit Fix #1)
        # Numbers alone are not enough — the ACTIONS must be about the same thing.
        # e.g., "logout after 15 mins inactivity" vs "lockout for 30 mins after failed logins"
        # both have "minutes" but are fundamentally different events.
        action_sim = semantic_similarity(a_action, b_action)
        if action_sim < 0.58:
            # Actions are semantically disjoint — numeric match is coincidental
            return None
        
        exp = f"Numeric contradiction detected: {logic_a['value']} {logic_a['variable']} vs {logic_b['value']} {logic_b['variable']}"
        return {
            "type": "numeric_contradiction",
            "rule_a": rule_a,
            "rule_b": rule_b,
            "decision": True,
            "confidence": 0.95,
            "source": "rule",
            "explanation": exp,
            "confidence_breakdown": {"rule": 0.95, "embedding": 0.0, "llm": 0.0},
            "trace": [
                {"layer": "rule", "decision": True, "confidence": 0.95, "note": exp}
            ]
        }

    return None

def detect_conflicts(stories: list) -> List[ConflictIssue]:
    conflicts: List[ConflictIssue] = []
    
    # 1. Logic Ledger Extraction
    all_rules = []
    for story in stories:
        sid = story.get("id", "UNKNOWN")
        
        # 🔹 HARD FILTER: Skip Contextual Information to prevent false positive conflicts
        if story.get("type", "").lower() == "contextual_information" or sid.startswith("INF-"):
            continue
            
        actor = str(story.get("role", "Unknown")).strip()
        
        def collect_from_ac(nodes: list):
            for node in nodes:
                for logic in node.get("logic", []):
                    if logic.get("type", "conditional") == "conditional":
                        all_rules.append({
                            "story_id": sid,
                            "actor": actor,
                            "condition": logic.get("condition"),
                            "action": (logic.get("action") or {}).get("description"),
                            "raw_text": story.get("raw_text"),
                            "confidence": logic.get("confidence", 0.85)
                        })
                if node.get("children"):
                    collect_from_ac(node["children"])
                    
        logic_sources = []
        if story.get("acceptance_criteria"):
            logic_sources.extend(story.get("acceptance_criteria"))
        if story.get("logic"):
            logic_sources.append({"logic": story.get("logic"), "children": []})
            
        collect_from_ac(logic_sources)
        
        # Add base requirement as a "rule" if it has no logic
        if not story.get("logic") and not story.get("acceptance_criteria"):
            all_rules.append({
                "story_id": sid,
                "actor": actor,
                "condition": None,
                "action": story.get("goal"),
                "raw_text": story.get("raw_text"),
                "confidence": story.get("confidence", 0.8)
            })

    # 2. Deterministic Rule Matching
    counter = 0
    
    use_full_pairwise = len(all_rules) < 50 or not ML_AVAILABLE
    if use_full_pairwise:
        pairs = []
        for i in range(len(all_rules)):
            for j in range(i + 1, len(all_rules)):
                pairs.append((i, j))
    else:
        index, embeddings = build_faiss_index(all_rules)
        pairs = get_candidate_pairs(all_rules, index, embeddings, top_k=15)
        
    for i, j in pairs:
        ra, rb = all_rules[i], all_rules[j]
        # Don't conflict a story against itself
        if ra["story_id"] == rb["story_id"]: continue
        
        res = detect_conflict(ra, rb)
        if res:
            counter += 1
            conflicts.append(ConflictIssue(
                id=f"CON-{counter:03d}",
                stories=[ra["story_id"], rb["story_id"]],
                severity="high",
                category="contradictory_state",
                description=f"Logically incompatible actions triggered by similar condition '{ra['condition']}'",
                details=[
                    f"{ra['story_id']} ({ra['actor']}): IF {ra['condition']} → {ra['action']}",
                    f"{rb['story_id']} ({rb['actor']}): IF {rb['condition']} → {rb['action']}"
                ],
                confidence=res.get("confidence", 0.95),
                source=res.get("source", "rule"),
                explanation=res.get("explanation", ""),
                rule_a=ra,
                rule_b=rb,
                trace=res.get("trace", []),
                confidence_breakdown=res.get("confidence_breakdown", {})
            ))

    # Deduplicate conflicts (same pair of stories, same category)
    seen: Set[Tuple] = set()
    deduped = []
    for c in conflicts:
        key = (tuple(sorted(c.stories)), c.category, c.description[:50])
        if key not in seen:
            seen.add(key)
            deduped.append(c)
    for i, c in enumerate(deduped):
        c.id = f"CON-{i+1:03d}"
    return deduped

# ────────────────────────────────────────────────────────────────────
# 5. PHASE 3: GAP DETECTION
# ────────────────────────────────────────────────────────────────────

def is_conditional(text: str) -> bool:
    return bool(re.search(r"\b(if|when|where)\b", text.lower()))

def detect_gaps(stories: list, actors: list) -> List[GapIssue]:
    gaps: List[GapIssue] = []
    counter = 0

    all_ac_texts: List[str] = []

    for story in stories:
        sid = story.get("id", "UNKNOWN")
        acs = story.get("acceptance_criteria", [])
        raw_text = story.get("raw_text", "")

        # Collect all AC texts for this story
        story_ac_texts = []
        def collect_ac(nodes: list):
            for node in nodes:
                text = node.get("text", "").strip()
                if text:
                    story_ac_texts.append(text)
                    all_ac_texts.append(text)
                if node.get("children"):
                    collect_ac(node["children"])
        collect_ac(acs)

        # Gap enforcement logic based on conditional nature
        if is_conditional(raw_text):
            has_logic = False
            has_conditional = False
            def check_logic(nodes: list):
                nonlocal has_logic, has_conditional
                for node in nodes:
                    if node.get("logic") and len(node["logic"]) > 0:
                        has_logic = True
                    text = node.get("text", "").lower()
                    if any(kw in text for kw in ["if ", "when ", "then ", "must ", "shall "]):
                        has_conditional = True
                    if node.get("children"):
                        check_logic(node["children"])
            check_logic(acs)
            
            # Additional root-level logic check
            if story.get("logic"):
                has_logic = True

            if not has_logic and not has_conditional:
                counter += 1
                gaps.append(GapIssue(
                    id=f"GAP-{counter:03d}", story_id=sid, severity="low",
                    category="no_testable_ac",
                    description=f"{sid} is conditional but lacks explicit logic mapping.",
                    recommendation="Ensure conditional logic (e.g., 'If X, then the system shall Y') is properly extracted or stated."
                ))

        # Gap: Missing error/edge case handling
        ac_combined = " ".join(story_ac_texts).lower()
        error_keywords = ["error", "fail", "invalid", "timeout", "exception", "retry", "fallback", "decline"]
        has_error_handling = any(kw in ac_combined for kw in error_keywords)
        if not has_error_handling and len(story_ac_texts) >= 3:
            counter += 1
            gaps.append(GapIssue(
                id=f"GAP-{counter:03d}", story_id=sid, severity="low",
                category="missing_error_handling",
                description=f"{sid} has no ACs covering error/failure scenarios",
                recommendation="Add ACs for edge cases: What happens on network failure? Invalid input? Timeout?"
            ))

    # Gap: Duplicate/near-duplicate ACs across stories
    seen_ac: Dict[str, str] = {}  # normalized text -> story_id
    for story in stories:
        sid = story.get("id", "UNKNOWN")
        def check_dupes(nodes: list):
            for node in nodes:
                text = node.get("text", "").strip().lower()
                normalized = re.sub(r'[^a-z0-9 ]', '', text)
                if len(normalized) > 20:  # only check meaningful ACs
                    if normalized in seen_ac and seen_ac[normalized] != sid:
                        nonlocal counter
                        counter += 1
                        gaps.append(GapIssue(
                            id=f"GAP-{counter:03d}", story_id=sid, severity="low",
                            category="duplicate_ac",
                            description=f"AC in {sid} is duplicate/near-duplicate of AC in {seen_ac[normalized]}: '{text[:60]}...'",
                            recommendation="Consolidate duplicate ACs or extract into a shared requirement"
                        ))
                    else:
                        seen_ac[normalized] = sid
                if node.get("children"):
                    check_dupes(node["children"])
        check_dupes(story.get("acceptance_criteria", []))

    # Deduplicate gaps
    seen_gaps: Set[Tuple] = set()
    deduped = []
    for g in gaps:
        key = (g.story_id, g.category)
        if key not in seen_gaps:
            seen_gaps.add(key)
            deduped.append(g)
    for i, g in enumerate(deduped):
        g.id = f"GAP-{i+1:03d}"
    return deduped

# ────────────────────────────────────────────────────────────────────
# 6. MAIN STAGE FUNCTION
# ────────────────────────────────────────────────────────────────────

def run_stage6_ambiguity(intelligence_path: Path, output_dir: Path) -> Path:
    """Complete Issues Engine: Ambiguity + Conflict + Gap detection."""
    logger.info(f"Starting Stage 6 Issues Engine on {intelligence_path.name}")

    with open(intelligence_path, "r", encoding="utf-8") as f:
        intel_data = json.load(f)

    doc_name = intel_data.get("document_name", intelligence_path.stem)
    stories = intel_data.get("user_stories", [])
    actors = intel_data.get("actors", [])

    # Phase 1: Ambiguities
    ambiguities = detect_ambiguities(stories)
    logger.info(f"  Phase 1: {len(ambiguities)} ambiguities")

    # Phase 2: Conflicts
    conflicts = detect_conflicts(stories)
    logger.info(f"  Phase 2: {len(conflicts)} conflicts")

    # Phase 3: Gaps
    gaps = detect_gaps(stories, actors)
    logger.info(f"  Phase 3: {len(gaps)} gaps")

    report = IssuesReport(
        document_name=doc_name,
        total_ambiguities=len(ambiguities),
        total_conflicts=len(conflicts),
        total_gaps=len(gaps),
        ambiguities=ambiguities,
        conflicts=conflicts,
        gaps=gaps,
        metadata={
            "stories_scanned": len(stories),
            "actors": actors,
            "source_file": str(intelligence_path)
        }
    )

    out_path = output_dir / f"{doc_name}_issues.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report.model_dump_json(indent=2))

    total = len(ambiguities) + len(conflicts) + len(gaps)
    logger.info(f"Total: {total} issues ({len(ambiguities)}A + {len(conflicts)}C + {len(gaps)}G) → {out_path}")
    return out_path
