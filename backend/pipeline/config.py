"""
Pipeline Configuration — Central constants, paths, and thresholds
"""
import os
from pathlib import Path

# ──────────────────────────── PATHS ────────────────────────────
import os
from pathlib import Path

# Detect Kaggle environment
IS_KAGGLE = os.path.exists("/kaggle")

if IS_KAGGLE:
    PROJECT_ROOT = Path("/kaggle/working")
    RAW_PDF_DIR = Path("/kaggle/input/nlp-project/raw_pdfs_corpus/raw_pdfs_corpus")
    OUTPUT_DIR = PROJECT_ROOT / "outputs"
else:
    PROJECT_ROOT = Path(__file__).resolve().parent.parent
    RAW_PDF_DIR = PROJECT_ROOT / "data" / "raw_SRS"
    OUTPUT_DIR = PROJECT_ROOT / "data" / "raw_SRS_processed"

# Stage-specific output directories (Nested inside PROCESSED_ROOT/data)
# Note: run_corpus_processor.py handles much of this per-document, 
# but we keep these for global manifests and datasets.
MANIFESTS_DIR = OUTPUT_DIR / "manifests"
EQUATION_LIB_DIR = OUTPUT_DIR / "equation_library"

# Create all output dirs on import
for d in [MANIFESTS_DIR, EQUATION_LIB_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ──────────────────────────── STAGE 1: INGEST ────────────────────────────
# ... (rest of the file until Stage 4) ...

# ──────────────────────────── STAGE 1: INGEST ────────────────────────────

# Minimum characters per page to classify as digital (vs scanned)
MIN_CHARS_PER_PAGE_DIGITAL = 100

# Number of sample pages to check for digital vs scan detection
SAMPLE_PAGES_FOR_DETECTION = 3

# Document classification keywords → document type
DOC_TYPE_KEYWORDS = {
    "manual": ["BSIM", "compact model", "BSIMSOI", "user manual", "users manual"],
    "thesis": ["thesis", "PhD", "dissertation", "acknowledgements"],
    "roadmap": ["IRDS", "roadmap", "technology generation", "scaling"],
    "lecture_notes": ["lecture", "MIT", "course", "homework", "class"],
    "textbook": [],  # default fallback
}

# ──────────────────────────── STAGE 2: EXTRACTION ────────────────────────────

# Font size thresholds for heading/footnote detection
HEADING_FONT_SIZE_MIN = 13.0      # >= this → likely heading
FOOTNOTE_FONT_SIZE_MAX = 9.0      # <= this → likely footnote/caption

# Column detection: if x-gap between block clusters > this fraction of page width
COLUMN_GAP_THRESHOLD = 0.15

# ──────────────────────────── STAGE 3: CLEANING ────────────────────────────

# Header/footer bounding box thresholds (fraction of page height)
HEADER_Y_THRESHOLD = 0.08    # top 8% of page
FOOTER_Y_THRESHOLD = 0.92    # bottom 8% of page

# Minimum repetition count to classify as running header/footer
HEADER_FOOTER_MIN_REPEATS = 3

# ──────────────────────────── STAGE 4: EQUATIONS ────────────────────────────

# Equation detection score threshold
EQUATION_SCORE_THRESHOLD = 5

# Physics symbols that boost equation score
PHYSICS_SYMBOLS = set("μεφηλρστα붐")

# Subscript/superscript patterns that boost equation score
SUBSCRIPT_PATTERNS = [
    "Vgs", "VGS", "V_GS", "Vth", "VT", "V_th", "Vt",
    "Id", "I_D", "IDS", "I_d", "Cox", "C_ox", "C_OX",
    "mueff", "mu_eff", "Vfb", "V_fb", "Vds", "VDS",
    "Vbs", "VBS", "gm", "gds", "Cgs", "Cgd", "NA", "ND",
]

# Math operators that contribute to equation score
MATH_OPERATORS = set("=+-·*/^√")

# Symbol normalization: raw variant → canonical form
SYMBOL_NORMALIZATION = {
    # Gate-to-source voltage
    "Vgs": "Vgs", "V_GS": "Vgs", "VGS": "Vgs", "V_gs": "Vgs",
    # Threshold voltage
    "Vth": "Vth", "V th": "Vth", "VT": "Vth", "Vt": "Vth",
    "V_th": "Vth", "Vthr": "Vth",
    # Drain current
    "Id": "Id", "I_D": "Id", "IDS": "Id", "I_d": "Id", "I_ds": "Id",
    # Oxide capacitance
    "Cox": "Cox", "C_ox": "Cox", "C_OX": "Cox",
    # Effective carrier mobility
    "mueff": "mu_eff", "μeff": "mu_eff", "mu_eff": "mu_eff", "u_eff": "mu_eff",
    # Fermi potential
    "phi_f": "phi_f", "φf": "phi_f", "2φF": "phi_f",
    # Silicon permittivity
    "epsilon_si": "eps_si", "εsi": "eps_si", "eps_si": "eps_si",
    # Doping concentration
    "NA": "NA", "N_A": "NA", "p-type doping": "NA",
    # DIBL
    "DIBL": "DIBL", "delta_Vth": "DIBL",
    # Flat-band voltage
    "Vfb": "Vfb", "V_fb": "Vfb", "VFB": "Vfb",
    # Drain-source voltage
    "Vds": "Vds", "V_DS": "Vds", "VDS": "Vds",
    # Transconductance
    "gm": "gm", "g_m": "gm",
}

# Variable descriptions for the equation library
VARIABLE_DESCRIPTIONS = {
    "Vgs": "gate-to-source voltage [V]",
    "Vth": "threshold voltage [V]",
    "Id": "drain current [A]",
    "Cox": "oxide capacitance per unit area [F/m^2]",
    "mu_eff": "effective carrier mobility [cm^2/(V·s)]",
    "phi_f": "Fermi potential [V]",
    "eps_si": "silicon permittivity [F/m]",
    "NA": "acceptor doping concentration [cm^-3]",
    "DIBL": "drain-induced barrier lowering [V/V]",
    "Vfb": "flat-band voltage [V]",
    "Vds": "drain-to-source voltage [V]",
    "gm": "transconductance [S]",
    "q": "elementary charge 1.6e-19 [C]",
}

# ──────────────────────────── LOGGING ────────────────────────────

LOG_FILE = OUTPUT_DIR / "pipeline.log"
