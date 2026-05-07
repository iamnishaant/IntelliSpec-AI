"""
Stage 3 — Cleaning & Noise Removal

Removes headers, footers, page numbers, reference lists, TOC entries,
and fixes hyphenation / Unicode artifacts.
"""
import re
import unicodedata
from pathlib import Path

import regex  # extended regex with better Unicode support
import ftfy

from pipeline.config import (
    HEADER_Y_THRESHOLD,
    FOOTER_Y_THRESHOLD,
    HEADER_FOOTER_MIN_REPEATS,
    CLEANED_PAGES_DIR,
)
from pipeline.utils import (
    save_json,
    load_json,
    setup_logger,
    RawPageRecord,
    CleanedPageRecord,
    FontBlock,
)

logger = setup_logger("stage3_clean")


# ──────────────────────────── REGEX PATTERNS ────────────────────────────

# Page numbers: standalone integers or patterns like "Page 3 of 44"
PAGE_NUMBER_PATTERNS = [
    re.compile(r"^\s*\d{1,4}\s*$"),                          # bare number
    re.compile(r"^\s*-\s*\d+\s*-\s*$"),                      # -5-
    re.compile(r"(?i)^\s*page\s+\d+\s*(of\s+\d+)?\s*$"),    # Page 3 of 44
    re.compile(r"^\s*\d+\s*/\s*\d+\s*$"),                    # 3/44
]

# Reference entries: [1] Author, A. or 1. Author, A.
REFERENCE_PATTERNS = [
    re.compile(r"^\s*\[\d+\]\s+\w"),               # [1] Sze S.M...
    re.compile(r"^\s*\d+\.\s+[A-Z][a-z]+"),        # 1. Streetman B.
]

# TOC lines: lines like "3.4 Threshold Voltage ........... 210"
TOC_PATTERN = re.compile(r"^.{5,60}\.{4,}\s*\d+\s*$")

# Header/footer patterns (chapter/section markers)
HEADER_FOOTER_TEXT_PATTERNS = [
    re.compile(r"(?i)^chapter\s+\d+"),
    re.compile(r"(?i)^\d+\.\d+\s+\w"),  # Not used for removal, just detection
    re.compile(r"©|copyright|all rights reserved", re.IGNORECASE),
]

# Ligature fixes
LIGATURE_MAP = {
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬀ": "ff",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
}


# ──────────────────────────── CLEANING FUNCTIONS ────────────────────────────

def fix_unicode(text: str) -> str:
    """Fix Unicode artifacts using ftfy and normalize to NFC."""
    text = ftfy.fix_text(text)
    text = unicodedata.normalize("NFC", text)
    # Fix common ligatures
    for lig, replacement in LIGATURE_MAP.items():
        text = text.replace(lig, replacement)
    return text


def dehyphenate(text: str) -> str:
    """Fix words split across lines with hyphens.
    
    Pattern: 'thresh-\\nvoltage' → 'threshold voltage'
    But preserve legitimate hyphens like 'gate-to-source'.
    """
    # Only dehyphenate where a word fragment ends with '-' at line end
    # and the next line starts with a lowercase letter
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    return text


def remove_page_numbers(text: str) -> tuple[str, bool]:
    """Remove isolated page numbers. Returns (cleaned_text, was_modified)."""
    lines = text.split("\n")
    cleaned = []
    removed = False
    
    for line in lines:
        is_page_num = any(p.match(line) for p in PAGE_NUMBER_PATTERNS)
        if is_page_num:
            removed = True
        else:
            cleaned.append(line)
    
    return "\n".join(cleaned), removed


def remove_references(text: str) -> tuple[str, bool]:
    """Remove reference list entries (stored separately as metadata)."""
    lines = text.split("\n")
    cleaned = []
    in_references = False
    removed = False
    
    for line in lines:
        # Detect start of references section
        if re.match(r"(?i)^\s*(references|bibliography)\s*$", line.strip()):
            in_references = True
            removed = True
            continue
        
        if in_references:
            # Stay in references until we hit a non-reference line
            if any(p.match(line) for p in REFERENCE_PATTERNS) or not line.strip():
                removed = True
                continue
            else:
                in_references = False
        
        cleaned.append(line)
    
    return "\n".join(cleaned), removed


def remove_toc_entries(text: str) -> tuple[str, bool]:
    """Remove table of contents entries (dotted leader lines)."""
    lines = text.split("\n")
    cleaned = []
    removed = False
    
    for line in lines:
        if TOC_PATTERN.match(line):
            removed = True
        else:
            cleaned.append(line)
    
    return "\n".join(cleaned), removed


def collapse_whitespace(text: str) -> str:
    """Collapse multiple blank lines and excessive spaces."""
    # Multiple blank lines → single blank line
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Multiple spaces → single space (but preserve newlines)
    text = re.sub(r"[^\S\n]+", " ", text)
    return text.strip()


def detect_repeated_headers(pages: list[RawPageRecord], page_height: float = 792.0) -> set[str]:
    """
    Detect running headers/footers by finding text that repeats across
    multiple pages at the top or bottom of the page.
    """
    top_texts = {}
    bottom_texts = {}
    
    for record in pages:
        for block in record.font_metadata:
            # Normalize for comparison
            text_key = block.text.strip().lower()
            if len(text_key) < 3 or len(text_key) > 100:
                continue
            
            # Check position
            if block.y0 < page_height * HEADER_Y_THRESHOLD:
                top_texts[text_key] = top_texts.get(text_key, 0) + 1
            elif block.y1 > page_height * FOOTER_Y_THRESHOLD:
                bottom_texts[text_key] = bottom_texts.get(text_key, 0) + 1
    
    # Text that repeats across many pages is a running header/footer
    repeated = set()
    for text, count in {**top_texts, **bottom_texts}.items():
        if count >= HEADER_FOOTER_MIN_REPEATS:
            repeated.add(text)
    
    return repeated


def count_tables(text: str) -> int:
    """Heuristic: count likely table structures in text."""
    # Look for lines with multiple tab/pipe separators
    table_lines = 0
    for line in text.split("\n"):
        if line.count("|") >= 2 or line.count("\t") >= 2:
            table_lines += 1
    return max(0, table_lines // 3)  # rough table count


def count_figures(text: str) -> int:
    """Count figure references in text."""
    return len(re.findall(r"(?i)fig(ure|\.)\s*\d+", text))


# ──────────────────────────── MAIN STAGE FUNCTION ────────────────────────────

def run_stage3(doc_id: str, raw_pages: list[RawPageRecord]) -> list[CleanedPageRecord]:
    """
    Run Stage 3: Cleaning & Noise Removal on extracted pages.
    
    Returns list of CleanedPageRecord.
    """
    logger.info(f"═══ Stage 3: Cleaning {doc_id} ({len(raw_pages)} pages) ═══")
    
    # First pass: detect repeated headers/footers across all pages
    repeated_headers = detect_repeated_headers(raw_pages)
    if repeated_headers:
        logger.info(f"  Detected {len(repeated_headers)} repeated header/footer patterns")
    
    cleaned_records = []
    total_removed = {"page_number": 0, "header": 0, "reference": 0, "toc": 0}
    
    for record in raw_pages:
        text = record.raw_text
        removed_elements = []
        
        # 1. Fix Unicode
        text = fix_unicode(text)
        
        # 2. Remove page numbers
        text, modified = remove_page_numbers(text)
        if modified:
            removed_elements.append("page_number")
            total_removed["page_number"] += 1
        
        # 3. Remove repeated headers/footers
        if repeated_headers:
            lines = text.split("\n")
            cleaned_lines = []
            for line in lines:
                if line.strip().lower() in repeated_headers:
                    removed_elements.append("header")
                    total_removed["header"] += 1
                else:
                    cleaned_lines.append(line)
            text = "\n".join(cleaned_lines)
        
        # 4. Remove reference entries
        text, modified = remove_references(text)
        if modified:
            removed_elements.append("reference")
            total_removed["reference"] += 1
        
        # 5. Remove TOC entries
        text, modified = remove_toc_entries(text)
        if modified:
            removed_elements.append("toc")
            total_removed["toc"] += 1
        
        # 6. Dehyphenation
        text = dehyphenate(text)
        
        # 7. Collapse whitespace
        text = collapse_whitespace(text)
        
        # Count tables and figures
        tables = count_tables(text)
        figures = count_figures(text)
        
        cleaned = CleanedPageRecord(
            doc_id=doc_id,
            page_num=record.page_num,
            cleaned_text=text,
            removed_elements=list(set(removed_elements)),
            tables_detected=tables,
            figures_detected=figures,
        )
        cleaned_records.append(cleaned)
    
    # Save to disk
    output_path = CLEANED_PAGES_DIR / f"{doc_id}_cleaned_pages.json"
    save_json([r.model_dump() for r in cleaned_records], output_path)
    
    logger.info(
        f"  ✓ Cleaned {len(cleaned_records)} pages | "
        f"Removed: {total_removed}"
    )
    
    return cleaned_records


def run_stage3_from_file(raw_pages_path: Path) -> list[CleanedPageRecord]:
    """Run Stage 3 from a saved raw pages JSON file."""
    data = load_json(raw_pages_path)
    raw_pages = [RawPageRecord(**p) for p in data]
    if raw_pages:
        doc_id = raw_pages[0].doc_id
        return run_stage3(doc_id, raw_pages)
    return []
