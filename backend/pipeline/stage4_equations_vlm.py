import json
import re
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel
import sympy as sp
from pipeline.utils import setup_logger

logger = setup_logger("stage4_equations_vlm")

# ────────────────────────────────────────────────────────────────────
# 1. COMPREHENSIVE LaTeX → Canonical Variable Normalization Map
# ────────────────────────────────────────────────────────────────────
LATEX_TO_CANONICAL = {
    # Subscript variables → single tokens
    r"V_{th}": "Vth",
    r"V_{th0}": "Vth0",
    r"V_{gs}": "Vgs",
    r"V_{ds}": "Vds",
    r"V_{bs}": "Vbs",
    r"V_{fb}": "Vfb",
    r"V_{bi}": "Vbi",
    r"L_{eff}": "Leff",
    r"W_{eff}": "Weff",
    r"C_{ox}": "Cox",
    r"C_{it}": "Cit",
    r"N_{ch}": "Nch",
    r"N_{sub}": "Nsub",
    r"N_{it}": "Nit",
    r"N_A": "NA",
    r"t_{ox}": "tox",
    r"t_{oxe}": "toxe",
    r"nv_{tnom}": "nv_tnom",
    r"nv_t": "nv_t",
    r"v_t": "vt",
    # Greek symbols
    r"\Delta V_{th}": "DeltaVth",
    r"\Delta": "Delta",
    r"\delta": "delta",
    r"\gamma": "gamma_",
    r"\phi_f": "phi_f",
    r"\phi_s": "phi_s",
    r"\Phi_s": "Phi_s",
    r"\Phi_f": "Phi_f",
    r"\epsilon_{si}": "eps_si",
    r"\varepsilon_{si}": "eps_si",
    r"\mu_n": "mu_n",
    r"\mu_p": "mu_p",
    r"\mu_{eff}": "mu_eff",
    # BSIM-specific multi-character parameters (must come before shorter matches)
    r"DVTP0": "DVTP0",
    r"DVTP1": "DVTP1",
    r"DVTP2": "DVTP2",
    r"DVTP3": "DVTP3",
    r"DVTP4": "DVTP4",
    r"DVTP5": "DVTP5",
    r"DVTR0": "DVTR0",
    r"DITS": "DITS",
    r"DIBL": "DIBL",
    r"TNOM": "TNOM",
    # LaTeX commands → plain text for SymPy
    r"\approx": "=",
    r"\to": "_to_",
    r"\rightarrow": "_to_",
    r"\cdot": "*",
    r"\times": "*",
    r"\left": "",
    r"\right": "",
    r"\ln": "log",
    r"\tanh": "tanh",
    r"\exp": "exp",
    r"\sqrt": "sqrt",
}

# All known multi-character symbols for SymPy predeclaration
KNOWN_SYMBOLS = [
    "Vth", "Vth0", "Vgs", "Vds", "Vbs", "Vfb", "Vbi",
    "DeltaVth", "DeltaVth_DITS",
    "Leff", "Weff", "Cox", "Cit", "Nch", "Nsub", "Nit", "NA",
    "tox", "toxe", "nv_tnom", "nvtnom", "nv_t", "nvt", "vt",
    "Delta", "delta", "gamma_", "phi_f", "phi_s", "Phi_s", "Phi_f",
    "eps_si", "mu_n", "mu_p", "mu_eff",
    "DVTP0", "DVTP1", "DVTP2", "DVTP3", "DVTP4", "DVTP5", "DVTR0",
    "DITS", "DIBL", "TNOM",
    "n", "q", "k", "T", "E",
]

# Pre-build the SymPy symbol dict
SYMPY_LOCALS = {name: sp.Symbol(name) for name in KNOWN_SYMBOLS}


# ────────────────────────────────────────────────────────────────────
# 2. Pydantic Record
# ────────────────────────────────────────────────────────────────────
class EqRecord(BaseModel):
    id: str
    raw_latex: str
    normalized_text: str
    equation_number: Optional[str] = None
    equation_type: Optional[str] = None
    sympy_parsed: bool
    sympy_expr: str


# ────────────────────────────────────────────────────────────────────
# 3. Core Functions
# ────────────────────────────────────────────────────────────────────
def normalize_latex_to_text(latex_str: str) -> str:
    """
    Convert raw LaTeX to a canonical text form suitable for SymPy.
    Replaces subscript variables, greek letters, and LaTeX commands.
    """
    norm = latex_str

    # Sort keys by length (longest first) to avoid partial replacements
    for k in sorted(LATEX_TO_CANONICAL.keys(), key=len, reverse=True):
        norm = norm.replace(k, LATEX_TO_CANONICAL[k])

    # Convert subscripts and superscripts before removing {}
    norm = re.sub(r'_\{([^}]+)\}', r'_\1', norm)
    norm = re.sub(r'\^\{([^}]+)\}', r'**(\1)', norm)

    # Remove remaining LaTeX formatting artifacts
    norm = re.sub(r"\\frac\{(.*?)\}\{(.*?)\}", r"(\1)/(\2)", norm)
    
    # Subscript commas cause issues, remove them
    norm = re.sub(r'_([a-zA-Z0-9]+),([a-zA-Z0-9]+)', r'_\1_\2', norm)

    norm = re.sub(r"\{", "(", norm)
    norm = re.sub(r"\}", ")", norm)
    norm = norm.replace('[', '(').replace(']', ')')
    norm = re.sub(r"\\", "", norm)  # Remove stray backslashes

    # Handle equation tags: strip \tag{...} or (5.23) at the end
    norm = re.sub(r'tag\(.*?\)', '', norm)
    norm = re.sub(r'\([0-9]+\.[0-9]+[a-zA-Z]*\)$', '', norm)

    # Convert e^(...) to exp(...)
    norm = re.sub(r'exp\^\(([^)]+)\)', r'exp(\1)', norm)
    norm = re.sub(r'exp\^([a-zA-Z0-9_]+)', r'exp(\1)', norm)
    norm = re.sub(r'e\^\(([^)]+)\)', r'exp(\1)', norm)
    norm = re.sub(r'e\^([a-zA-Z0-9_]+)', r'exp(\1)', norm)

    # Convert remaining ^ to ** 
    norm = norm.replace('^', '**')

    # Remove purely structural LaTeX commands
    norm = re.sub(r'\\begin\{(cases|aligned|array|equation)\}', '', norm)
    norm = re.sub(r'\\end\{(cases|aligned|array|equation)\}', '', norm)
    norm = re.sub(r'\\quad|\\qquad', ' ', norm)
    norm = re.sub(r'begin\(cases\)', '', norm)
    
    # Strip equation labels like (DITS) from LHS of equations
    norm = re.sub(r'DeltaVth\s*\(DITS\)', 'DeltaVth_DITS', norm)
    norm = re.sub(r'DeltaVth\(DITS\)', 'DeltaVth_DITS', norm)

    # Clean up LaTeX size macros that disrupt brackets
    norm = re.sub(r'\\?[bB]igg?[lrm]?', '', norm)
    norm = norm.replace('|', '')
    norm = norm.replace(' and ', ' ')

    # Fix subscripts on closing brackets (e.g. )_eff -> )*eff )
    norm = re.sub(r'\)_([a-zA-Z0-9]+)', r')*\1', norm)

    # Insert explicit multiplication operator where implied
    norm = re.sub(r'\)\s*\(', ')*(', norm)
    
    # Fix function notation: e.g. i_CH(v_OUT) -> i_CH_v_OUT
    norm = re.sub(r'([A-Za-z]+_[A-Za-z0-9]+)\((.*?)\)', r'\1_\2', norm)
    
    # Handle number directly followed by letter (e.g. 2eps_si -> 2*eps_si)
    # Be careful not to replace numbers inside identifiers like V_th0
    norm = re.sub(r'(^|[\(\s\+\-\*/=])(\d+)([a-zA-Z_]\w*)', r'\1\2*\3', norm)
    
    # Remove apostrophes (primes) which confuse sympify
    norm = norm.replace("'", "")

    # Collapse whitespace
    norm = re.sub(r"\s+", " ", norm).strip()

    return norm


def find_equation_number(text: str, eq_end_pos: int) -> Optional[str]:
    """
    Looks for an equation number like (2.21) right after a $$ block.
    """
    after_eq = text[eq_end_pos:eq_end_pos + 30]
    m = re.search(r'\((\d+\.\d+[a-z]?)\)', after_eq)
    if m:
        return m.group(1)
    return None


def merge_adjacent_math_blocks(text: str) -> str:
    """
    If two $$ blocks appear within 2 blank lines of each other
    (with no prose in between), merge them into one block.
    """
    # Pattern: $$ block1 $$ \n\n $$ block2 $$
    # Merge into: $$ block1 \n block2 $$
    merged = re.sub(
        r'\$\$(.*?)\$\$\s*\n\s*\$\$(.*?)\$\$',
        r'$$\1 \2$$',
        text,
        flags=re.DOTALL
    )
    return merged


def parse_equation_sympy(normalized_text: str) -> tuple:
    """
    Attempts to parse a normalized equation text with SymPy,
    using predeclared multi-character symbols.
    Returns (success: bool, result: str).
    """
    try:
        from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication
        transformations = standard_transformations + (implicit_multiplication,)
        
        expr_str = normalized_text

        # Handle "LHS = RHS" format
        if "=" in expr_str:
            # Handle piecewise / conditions (just take the first equation for simplicity in validation)
            if " qquad " in expr_str or " quad " in expr_str:
                expr_str = re.split(r'\s*q?quad\s*', expr_str)[0]

            parts = expr_str.split("=")
            if len(parts) > 2:
                # Multiple equations on one line (e.g. cases or tagged separately)
                # We'll just take the first LHS and try to aggressively strip the RHS up to the next equation
                lhs_str = parts[0].strip()
                # find where the second equation's LHS begins (usually the last word of parts[1])
                rhs_part = parts[1]
                match = re.search(r'\s+([A-Za-z0-9_]+)\s*$', rhs_part)
                if match:
                    rhs_str = rhs_part[:match.start()].strip()
                else:
                    rhs_str = rhs_part.strip()
            else:
                lhs_str = parts[0].strip()
                rhs_str = parts[1].strip()

            lhs = parse_expr(lhs_str, local_dict=SYMPY_LOCALS, transformations=transformations)
            rhs = parse_expr(rhs_str, local_dict=SYMPY_LOCALS, transformations=transformations)
            result = sp.Eq(lhs, rhs)
        else:
            result = parse_expr(expr_str, local_dict=SYMPY_LOCALS, transformations=transformations)

        return True, str(result)
    except Exception as e:
        return False, f"ParseError: {type(e).__name__}: {str(e)}"


def classify_equation(norm_text: str) -> str:
    """Provides a basic semantic classification based on equation variables."""
    if "tau" in norm_text or "dt" in norm_text or "dq" in norm_text:
        return "transient_equation"
    elif "V_DD" in norm_text and "C_L" in norm_text and not "dt" in norm_text:
        return "power_equation"
    elif "i_" in norm_text or "v_" in norm_text or "V_" in norm_text or "Vth" in norm_text:
        return "transfer_equation"
    return "general_equation"

# ────────────────────────────────────────────────────────────────────
# 4. Main Extraction Function
# ────────────────────────────────────────────────────────────────────
def extract_equations_and_tables(md_file: Path, output_dir: Path) -> Path:
    """
    Extracts display equations and Markdown tables from cleaned Markdown.

    Improvements over v1:
    - Merges adjacent $$ blocks that belong to one equation
    - Extracts equation numbers like (2.21)
    - Pre-declares multi-character symbols before SymPy parsing
    - Comprehensive LaTeX → canonical normalization
    """
    logger.info(f"Extracting Equations and Tables from {md_file.name}")

    with open(md_file, "r", encoding="utf-8") as f:
        text = f.read()

    # Step 1: Merge adjacent math blocks
    merged_text = merge_adjacent_math_blocks(text)

    # Step 2: Find all display equations with their positions
    records = []
    eq_idx = 0

    for m in re.finditer(r'\$\$(.*?)\$\$', merged_text, flags=re.DOTALL):
        raw_latex = m.group(1).strip()
        if not raw_latex:
            continue

        # Extract equation number from text after the block
        eq_num = find_equation_number(merged_text, m.end())

        # Normalize LaTeX to canonical text
        norm_text = normalize_latex_to_text(raw_latex)

        # Parse with SymPy using predeclared symbols
        parsed, sympy_str = parse_equation_sympy(norm_text)

        eq_id = f"{md_file.stem}_eq_{eq_idx}"
        if eq_num:
            eq_id = f"{md_file.stem}_eq_{eq_num}"

        rec = EqRecord(
            id=eq_id,
            raw_latex=raw_latex,
            normalized_text=norm_text,
            equation_number=eq_num,
            equation_type=classify_equation(norm_text),
            sympy_parsed=parsed,
            sympy_expr=sympy_str,
        )
        records.append(rec.model_dump())
        eq_idx += 1

    logger.info(f"Found {len(records)} display equations.")
    parsed_count = sum(1 for r in records if r["sympy_parsed"])
    logger.info(f"Successfully parsed {parsed_count}/{len(records)} equations with SymPy.")

    # Find inline math and group by page using <!-- PAGE_X --> tags
    inline_grouped = {}
    current_page = "PAGE_UNKNOWN"
    for line in text.splitlines():
        page_match = re.search(r'<!-- (PAGE_\d+) -->', line)
        if page_match:
            current_page = page_match.group(1)
            
        # Extract inline math for the line
        matches = re.findall(r'(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)', line)
        for m in matches:
            v_clean = m.strip()
            if not v_clean: 
                continue
            if v_clean not in inline_grouped:
                inline_grouped[v_clean] = []
            if current_page not in inline_grouped[v_clean]:
                inline_grouped[v_clean].append(current_page)
                
    logger.info(f"Found {len(inline_grouped)} unique inline math expressions mapped to pages.")

    # Extract Markdown tables
    tables = [t.strip() for t in re.findall(
        r'(\n\|.*\|\n\|[-:| ]+\|\n(?:\|.*\|\n)+)', text
    )]
    logger.info(f"Found {len(tables)} Markdown tables.")

    # Write output
    out_path = output_dir / f"{md_file.stem}_math.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "equations": records,
            "inline_variables": inline_grouped,
            "tables": tables,
            "stats": {
                "total_equations": len(records),
                "parsed_successfully": parsed_count,
                "parse_rate": f"{parsed_count / len(records) * 100:.1f}%" if records else "N/A",
                "unique_inline_vars": len(inline_grouped),
                "table_count": len(tables),
            }
        }, f, indent=2)

    return out_path


if __name__ == "__main__":
    test_in = Path("outputs/single_page_test/cleaned_md/bsim_page21.md")
    test_out = Path("outputs/single_page_test/math")
    if test_in.exists():
        extract_equations_and_tables(test_in, test_out)
    else:
        print(f"File not found: {test_in}")
