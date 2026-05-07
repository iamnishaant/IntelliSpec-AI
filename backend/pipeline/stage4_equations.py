"""
Stage 4 — Equation Detection & Parsing (v2 – Improved)

Detects equations in text using multi-signal heuristics, filters out
false positives (prose lines mentioning variables), normalizes symbols
to canonical forms, and parses into SymPy expressions.

Key improvements over v1:
  1. Added structural pre-filters to reject prose lines
  2. Equation pattern matching (LHS = RHS with math symbols)
  3. Multi-line equation assembly
  4. Better SymPy pre-processing (strip English, keep math)
  5. Store raw equation even when SymPy fails (still useful for RAG)
"""
import re
from pathlib import Path
from typing import Optional

import sympy
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)

from pipeline.config import (
    EQUATION_SCORE_THRESHOLD,
    PHYSICS_SYMBOLS,
    SUBSCRIPT_PATTERNS,
    MATH_OPERATORS,
    SYMBOL_NORMALIZATION,
    VARIABLE_DESCRIPTIONS,
    EQUATIONS_DIR,
)
from pipeline.utils import (
    save_json,
    load_json,
    setup_logger,
    CleanedPageRecord,
    EquationRecord,
)

logger = setup_logger("stage4_equations")

# SymPy parsing transformations
TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)


# ──────────────────────────── STRUCTURAL FILTERS ────────────────────────────

# These patterns indicate a line is likely PROSE, not an equation
PROSE_INDICATORS = [
    re.compile(r"^(The|A|In|For|This|It|When|Where|Note|If|Since|As|We|To)\b", re.IGNORECASE),
    re.compile(r"\b(is used|are used|was observed|can be|will be|has been|which results|becomes|shows|such as)\b", re.IGNORECASE),
    re.compile(r"\b(figure|table|chapter|section|reference|copyright|manual)\b", re.IGNORECASE),
    re.compile(r"\b(here|therefore|however|although|because|moreover|furthermore)\b", re.IGNORECASE),
    re.compile(r"^\d+\.\d+[\.\d]*\s+[A-Z]"),  # Section headings like "4.3.2 Gate-to-Channel..."
    re.compile(r"^Step\s+\d+", re.IGNORECASE),
    re.compile(r"^Fitting Target", re.IGNORECASE),
    re.compile(r"http[s]?://"),  # URLs
    re.compile(r"\.{3,}"),  # TOC dots: ..........
]

# These patterns indicate a line IS likely an equation
EQUATION_INDICATORS = [
    re.compile(r"[=]"),                                    # Has equals sign
    re.compile(r"[/\*\^√∫∂∑∏∆]"),                         # Math operators
    re.compile(r"\b[A-Z][a-z]*\s*[=<>≤≥≈]\s*"),          # Variable = ...
    re.compile(r"\([^)]*[+\-\*/=][^)]*\)"),               # Math in parentheses
    re.compile(r"[²³⁻¹ₙₛₜ₀₁₂₃₄]"),                     # Superscripts/subscripts
    re.compile(r"\bexp\s*\(|\bln\s*\(|\blog\s*\(|\bsqrt\s*\("),  # Math functions
    re.compile(r"\d+[eE][+-]?\d+"),                        # Scientific notation
]


def is_likely_equation(line: str) -> bool:
    """
    Structural pre-filter: is this line likely an equation?
    Returns False for obvious prose lines.
    """
    stripped = line.strip()
    if not stripped or len(stripped) < 3:
        return False
    
    # Count words — equations typically have fewer plain words
    words = stripped.split()
    
    # Very long lines are usually prose
    if len(words) > 25:
        return False
    
    # Check for prose indicators — if many prose words, reject
    prose_matches = sum(1 for p in PROSE_INDICATORS if p.search(stripped))
    if prose_matches >= 2:
        return False
    
    # Check for equation indicators — if has math structure, accept
    eq_matches = sum(1 for p in EQUATION_INDICATORS if p.search(stripped))
    
    # Compute the ratio of non-alphabetic chars (math density)
    alpha_chars = sum(1 for c in stripped if c.isalpha())
    total_chars = len(stripped.replace(" ", ""))
    math_density = 1.0 - (alpha_chars / total_chars) if total_chars > 0 else 0
    
    # Accept if: has equation indicators OR high math density
    if eq_matches >= 1 and math_density > 0.15:
        return True
    
    # Accept lines with "=" and math symbols but reject pure text references
    if "=" in stripped and eq_matches >= 2:
        return True
    
    # Accept lines with high symbol density
    symbol_count = sum(1 for c in stripped if c in PHYSICS_SYMBOLS or c in MATH_OPERATORS)
    if symbol_count >= 3 and len(words) < 12:
        return True
    
    return False


# ──────────────────────────── EQUATION SCORING ────────────────────────────

def compute_equation_score(line: str, prev_line: str = "", next_line: str = "") -> int:
    """
    Compute an equation likelihood score for a line of text.
    
    Scoring rules:
    +2: each physics symbol (μ, ε, φ, etc.)
    +2: each subscript/superscript pattern (Vgs, Vth, etc.)
    +1: each math operator (=, +, -, *, /)
    +3: line matches equation number pattern (4.12)
    +2: line is isolated (surrounded by blank lines)
    +1: parentheses ratio > 0.1
    +3: contains "=" with math on both sides
    -5: starts with common prose words
    """
    score = 0
    stripped = line.strip()
    
    # Physics symbols
    for char in stripped:
        if char in PHYSICS_SYMBOLS:
            score += 2
    
    # Subscript/superscript patterns (limit to 3 to avoid over-scoring)
    sub_matches = sum(1 for p in SUBSCRIPT_PATTERNS if p in stripped)
    score += min(sub_matches, 3) * 2
    
    # Math operators
    math_ops = sum(1 for char in stripped if char in MATH_OPERATORS)
    score += min(math_ops, 5)  # cap at 5
    
    # Equation number pattern at end: (4.12) or (3-5)
    if re.search(r"\(\d+[\.\-]\d+\)\s*$", stripped):
        score += 3
    
    # Isolated line (surrounded by blank)
    if (not prev_line.strip()) and (not next_line.strip()):
        score += 2
    
    # Parentheses ratio
    paren_count = stripped.count("(") + stripped.count(")")
    if len(stripped) > 0 and paren_count / len(stripped) > 0.1:
        score += 1
    
    # Bonus: explicit equation pattern "X = expression"
    if re.match(r"^[A-Za-z_]\w*\s*=\s*\S", stripped):
        score += 3
    
    # Penalty: starts with common prose
    if re.match(r"^(The|A|In|For|This|It|When|Note|If|Since|We|To|was|has|are|is)\b", stripped, re.IGNORECASE):
        score -= 5
    
    # Penalty: contains many common English words
    common_words = {"the", "is", "are", "was", "were", "has", "have", "been", "will", "can", 
                    "that", "which", "this", "with", "from", "into", "such", "also", "more"}
    word_list = [w.lower() for w in stripped.split()]
    english_count = sum(1 for w in word_list if w in common_words)
    if english_count >= 3:
        score -= 3
    
    return max(score, 0)


# ──────────────────────────── SYMBOL NORMALIZATION ────────────────────────────

def normalize_symbols(text: str) -> str:
    """
    Replace all known symbol variants with their canonical forms.
    Uses word-boundary matching to avoid partial replacements.
    """
    result = text
    sorted_norms = sorted(SYMBOL_NORMALIZATION.items(), key=lambda x: -len(x[0]))
    
    for raw, canonical in sorted_norms:
        pattern = re.escape(raw)
        result = re.sub(r"\b" + pattern + r"\b", canonical, result)
    
    return result


def extract_variables(text: str) -> list[str]:
    """Extract recognized semiconductor variables from equation text."""
    found = set()
    canonical_values = set(SYMBOL_NORMALIZATION.values())
    
    for canonical in canonical_values:
        if re.search(r"\b" + re.escape(canonical) + r"\b", text):
            found.add(canonical)
    
    return sorted(found)


# ──────────────────────────── EQUATION PRE-PROCESSING ────────────────────────────

def preprocess_for_sympy(text: str) -> str:
    """
    Clean equation text before SymPy parsing:
    - Remove equation numbers
    - Remove prose fragments
    - Replace Unicode math symbols with ASCII equivalents
    - Normalize whitespace around operators
    """
    result = text.strip()
    
    # Remove equation numbers like (2.13) or (4-5)
    result = re.sub(r"\(\d+[\.\-]\d+\)\s*$", "", result).strip()
    result = re.sub(r"^\(\d+[\.\-]\d+\)\s*", "", result).strip()
    
    # Remove common prefixes: "where", "and", "Here,", etc.
    result = re.sub(r"^(where|and|here|with|for|when)\b[,:]?\s*", "", result, flags=re.IGNORECASE).strip()
    
    # Remove trailing prose fragments after the equation
    # e.g., "Vth = KT/q ln(NA/ni)  where q is the electron charge"
    # Keep only the math part
    if "=" in result:
        # Check if there's a "where" or similar after the equation
        parts = re.split(r"\s+(where|and|with|for|in which)\s+", result, maxsplit=1, flags=re.IGNORECASE)
        if len(parts) > 1:
            result = parts[0].strip()
    
    # Unicode → ASCII math
    replacements = {
        "×": "*", "·": "*", "÷": "/",
        "−": "-", "–": "-", "—": "-",
        "²": "**2", "³": "**3",
        "½": "(1/2)", "¼": "(1/4)",
        "≈": "=", "≡": "=",
        "∝": "~",  # proportional
    }
    for old, new in replacements.items():
        result = result.replace(old, new)
    
    # Normalize whitespace
    result = re.sub(r"\s+", " ", result).strip()
    
    return result


# ──────────────────────────── SYMPY PARSING ────────────────────────────

def parse_to_sympy(equation_text: str) -> tuple[str, bool]:
    """
    Attempt to parse equation text into a SymPy expression string.
    
    Pre-processes the text, extracts the mathematical core, then parses.
    Returns: (sympy_expr_string, success)
    """
    preprocessed = preprocess_for_sympy(equation_text)
    
    if not preprocessed or len(preprocessed) < 2:
        return equation_text, False
    
    # Reject if still mostly prose (> 60% alphabetic and > 8 words)
    alpha_ratio = sum(1 for c in preprocessed if c.isalpha()) / max(len(preprocessed.replace(" ", "")), 1)
    word_count = len(preprocessed.split())
    if alpha_ratio > 0.7 and word_count > 8:
        return equation_text, False
    
    # Build local dictionary of known variables
    known_vars = extract_variables(preprocessed)
    local_dict = {v: sympy.Symbol(v) for v in known_vars}
    
    # Add common math functions
    math_funcs = {
        "sqrt": sympy.sqrt, "exp": sympy.exp,
        "ln": sympy.ln, "log": sympy.log,
        "pi": sympy.pi, "sin": sympy.sin,
        "cos": sympy.cos, "tan": sympy.tan,
        "tanh": sympy.tanh, "cosh": sympy.cosh,
        "sinh": sympy.sinh, "abs": sympy.Abs,
    }
    for name, func in math_funcs.items():
        if name in preprocessed:
            local_dict[name] = func
    
    # Handle LHS = RHS format
    if "=" in preprocessed:
        eq_parts = preprocessed.split("=", 1)
        if len(eq_parts) == 2:
            lhs_text = eq_parts[0].strip()
            rhs_text = eq_parts[1].strip()
            
            if lhs_text and rhs_text:
                try:
                    lhs_expr = parse_expr(lhs_text, local_dict=local_dict, transformations=TRANSFORMATIONS)
                    rhs_expr = parse_expr(rhs_text, local_dict=local_dict, transformations=TRANSFORMATIONS)
                    
                    # Sanity check: reject if result has too many single-letter symbols
                    # (indicates SymPy parsed English words as variable products)
                    lhs_str = str(lhs_expr)
                    rhs_str = str(rhs_expr)
                    
                    single_letter_count = sum(1 for c in lhs_str + rhs_str if c.isalpha() and c not in "xyzXYZ")
                    if single_letter_count > 15:
                        return equation_text, False
                    
                    return f"Eq({lhs_expr}, {rhs_expr})", True
                except Exception:
                    pass
    
    # Try direct parsing
    try:
        parsed = parse_expr(preprocessed, local_dict=local_dict, transformations=TRANSFORMATIONS)
        parsed_str = str(parsed)
        
        # Sanity check
        single_letter_count = sum(1 for c in parsed_str if c.isalpha() and c not in "xyzXYZ")
        if single_letter_count > 15:
            return equation_text, False
        
        return parsed_str, True
    except Exception:
        pass
    
    return equation_text, False


# ──────────────────────────── EQUATION EXTRACTION PATTERNS ────────────────────────────

# Direct equation patterns (regex-based detection for common BSIM/MOSFET forms)
DIRECT_EQUATION_PATTERNS = [
    # Standard assignment: Vth = expr
    re.compile(r"^([A-Za-z_]\w+)\s*=\s*(.+)$"),
    # Parenthesized equation number: expr (3.14)
    re.compile(r"^(.+?)\s*\(\d+[\.\-]\d+\)$"),
    # Fraction pattern: expr / expr
    re.compile(r"\w+\s*/\s*\w+"),
]


def extract_equation_text_from_line(line: str) -> str:
    """Extract the mathematical core from a line, stripping surrounding prose."""
    stripped = line.strip()
    
    # Remove equation numbers
    stripped = re.sub(r"\(\d+[\.\-]\d+\)\s*$", "", stripped).strip()
    
    # If line starts with known variable = expression, extract just that
    match = re.match(r"^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=\s*(.+)$", stripped)
    if match:
        return stripped
    
    # If line contains "= " with expression, extract equation portion
    if "=" in stripped:
        # Find the equation within possible surrounding text
        eq_match = re.search(r"([A-Za-z_]\w*(?:\([^)]*\))?)\s*=\s*([^,\.;]+)", stripped)
        if eq_match:
            return eq_match.group(0).strip()
    
    return stripped


# ──────────────────────────── LaTeX DETECTION ────────────────────────────

def detect_latex_equations(text: str) -> list[str]:
    """Detect LaTeX-embedded equations: \\( ... \\) and $ ... $ patterns."""
    equations = []
    
    # \( ... \) patterns
    equations.extend(re.findall(r"\\\((.+?)\\\)", text, re.DOTALL))
    
    # $...$ patterns (not $$)
    equations.extend(re.findall(r"(?<!\$)\$([^$]+?)\$(?!\$)", text))
    
    # $$...$$ display math
    equations.extend(re.findall(r"\$\$(.+?)\$\$", text, re.DOTALL))
    
    return equations


# ──────────────────────────── MULTI-LINE EQUATION ASSEMBLY ────────────────────────────

def assemble_multiline_equations(lines: list[str]) -> list[tuple[int, str]]:
    """
    Detect and merge multi-line equations.
    
    Returns list of (start_line_index, merged_equation_text).
    
    Heuristic: if a line ends with an operator (+, -, *, /) or starts
    with one, it continues from the previous line.
    """
    assembled = []
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        
        # Check if this line looks like an equation start
        if not is_likely_equation(line):
            i += 1
            continue
        
        # Try to merge with following lines
        merged = line
        start_idx = i
        j = i + 1
        
        while j < len(lines):
            next_line = lines[j].strip()
            if not next_line:
                break
            
            # Continue if current ends with operator or next starts with operator
            if (merged.rstrip()[-1:] in "+-*/=(" or
                next_line.lstrip()[:1] in "+-*/=)" or
                next_line.startswith("+")):
                merged = merged.rstrip() + " " + next_line.lstrip()
                j += 1
            else:
                break
        
        assembled.append((start_idx, merged))
        i = j
    
    return assembled


# ──────────────────────────── MAIN STAGE FUNCTION ────────────────────────────

def run_stage4(doc_id: str, cleaned_pages: list[CleanedPageRecord], 
               current_section: str = "") -> list[EquationRecord]:
    """
    Run Stage 4: Equation Detection & Parsing (v2 – Improved).
    
    Returns list of EquationRecord.
    """
    logger.info(f"═══ Stage 4: Equation Detection for {doc_id} ═══")
    
    all_equations = []
    eq_counter = 0
    seen_raw_texts = set()  # dedup
    
    for page_record in cleaned_pages:
        text = page_record.cleaned_text
        lines = text.split("\n")
        
        # Track current section from headings
        for i, line in enumerate(lines):
            if re.match(r"^\d+[\.\d]*\s+[A-Z]", line.strip()):
                current_section = line.strip()
        
        # Method 1: LaTeX equation detection
        latex_eqs = detect_latex_equations(text)
        for latex in latex_eqs:
            latex_clean = latex.strip()
            if latex_clean in seen_raw_texts:
                continue
            seen_raw_texts.add(latex_clean)
            
            eq_counter += 1
            eq_id = f"{doc_id}_p{page_record.page_num}_eq{eq_counter}"
            
            normalized = normalize_symbols(latex_clean)
            variables = extract_variables(normalized)
            sympy_expr, success = parse_to_sympy(normalized)
            context = _get_surrounding_context(text, latex)
            
            record = EquationRecord(
                eq_id=eq_id,
                doc_id=doc_id,
                page=page_record.page_num,
                section=current_section,
                raw_text=latex_clean,
                latex=latex_clean,
                sympy_expr=sympy_expr if success else "",
                variables=variables,
                equation_type="latex_embedded",
                surrounding_context=context,
                parse_success=success,
            )
            all_equations.append(record)
        
        # Method 2: Heuristic text-based equation detection (improved)
        for i, line in enumerate(lines):
            stripped = line.strip()
            if not stripped:
                continue
            
            # Pre-filter: reject obvious non-equations
            if not is_likely_equation(stripped):
                continue
            
            prev_line = lines[i - 1] if i > 0 else ""
            next_line = lines[i + 1] if i < len(lines) - 1 else ""
            
            score = compute_equation_score(stripped, prev_line, next_line)
            
            if score >= EQUATION_SCORE_THRESHOLD:
                # Extract the actual equation text
                eq_text = extract_equation_text_from_line(stripped)
                
                if eq_text in seen_raw_texts or len(eq_text) < 3:
                    continue
                seen_raw_texts.add(eq_text)
                
                eq_counter += 1
                eq_id = f"{doc_id}_p{page_record.page_num}_eq{eq_counter}"
                
                normalized = normalize_symbols(eq_text)
                variables = extract_variables(normalized)
                sympy_expr, success = parse_to_sympy(normalized)
                
                # Get surrounding context
                context_lines = []
                for j in range(max(0, i - 2), min(len(lines), i + 3)):
                    if j != i:
                        context_lines.append(lines[j])
                context = " ".join(context_lines).strip()
                
                record = EquationRecord(
                    eq_id=eq_id,
                    doc_id=doc_id,
                    page=page_record.page_num,
                    section=current_section,
                    raw_text=eq_text,
                    latex="",
                    sympy_expr=sympy_expr if success else "",
                    variables=variables,
                    equation_type="text_heuristic",
                    surrounding_context=context[:500],
                    parse_success=success,
                )
                all_equations.append(record)
    
    # Save to disk
    output_path = EQUATIONS_DIR / f"{doc_id}_equations.json"
    save_json([eq.model_dump() for eq in all_equations], output_path)
    
    # Stats
    total = len(all_equations)
    successful = sum(1 for eq in all_equations if eq.parse_success)
    with_vars = sum(1 for eq in all_equations if eq.variables)
    pct = (successful / total * 100) if total > 0 else 0
    
    logger.info(
        f"  ✓ Detected {total} equations | "
        f"{successful}/{total} ({pct:.0f}%) parsed | "
        f"{with_vars} have variables"
    )
    
    return all_equations


def _get_surrounding_context(text: str, target: str, sentences: int = 2) -> str:
    """Get surrounding sentences around a target string in text."""
    pos = text.find(target)
    if pos < 0:
        return ""
    
    start = max(0, pos - 300)
    end = min(len(text), pos + len(target) + 300)
    
    context = text[start:end].strip()
    sentences_list = re.split(r"(?<=[.!?])\s+", context)
    return " ".join(sentences_list[:sentences * 2 + 1])[:500]


def run_stage4_from_file(cleaned_pages_path: Path) -> list[EquationRecord]:
    """Run Stage 4 from a saved cleaned pages JSON file."""
    data = load_json(cleaned_pages_path)
    pages = [CleanedPageRecord(**p) for p in data]
    if pages:
        doc_id = pages[0].doc_id
        return run_stage4(doc_id, pages)
    return []
