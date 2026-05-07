"""
Stage 2 — Text Extraction

Extracts raw text from each page using the appropriate strategy:
- Digital Path: PyMuPDF blocks with font metadata and column reordering
- OCR Path: (placeholder — requires Tesseract + OpenCV)
"""
import re
import fitz  # PyMuPDF
from pathlib import Path
from typing import Optional

from pipeline.config import (
    HEADING_FONT_SIZE_MIN,
    FOOTNOTE_FONT_SIZE_MAX,
    COLUMN_GAP_THRESHOLD,
    RAW_PAGES_DIR,
)
from pipeline.utils import (
    save_json,
    load_json,
    setup_logger,
    DocumentManifest,
    RawPageRecord,
    FontBlock,
)

logger = setup_logger("stage2_extract")


# ──────────────────────────── COLUMN DETECTION ────────────────────────────

def detect_columns(blocks: list, page_width: float) -> str:
    """
    Detect if a page has multi-column layout by clustering text block
    x-coordinates.
    
    Strategy: Extract x0 of all text blocks. If there are two distinct
    clusters separated by > COLUMN_GAP_THRESHOLD of page width, it's two-column.
    """
    if not blocks:
        return "single_column"
    
    # Get x-positions of text blocks (exclude image blocks: type != 0)
    x_positions = sorted(set(
        round(b[0], 1) for b in blocks
        if len(b) >= 6 and isinstance(b[4], str) and b[4].strip()
    ))
    
    if len(x_positions) < 2:
        return "single_column"
    
    # Find the largest gap between consecutive x-positions
    max_gap = 0
    split_point = 0
    for i in range(len(x_positions) - 1):
        gap = x_positions[i + 1] - x_positions[i]
        if gap > max_gap:
            max_gap = gap
            split_point = (x_positions[i] + x_positions[i + 1]) / 2
    
    # If the gap is significant relative to page width, it's two-column
    if max_gap > page_width * COLUMN_GAP_THRESHOLD:
        return "two_column"
    
    return "single_column"


def reorder_columns(blocks: list, page_width: float) -> list:
    """
    Reorder text blocks for two-column pages:
    Left column (top→bottom) first, then right column (top→bottom).
    """
    if not blocks:
        return blocks
    
    midpoint = page_width / 2
    
    # Split into left and right columns
    left_blocks = [b for b in blocks if b[0] < midpoint]
    right_blocks = [b for b in blocks if b[0] >= midpoint]
    
    # Sort each column top to bottom (by y0)
    left_blocks.sort(key=lambda b: b[1])
    right_blocks.sort(key=lambda b: b[1])
    
    return left_blocks + right_blocks


# ──────────────────────────── FONT METADATA ────────────────────────────

def extract_font_metadata(page: fitz.Page) -> list[FontBlock]:
    """
    Extract text blocks with font metadata using PyMuPDF 'dict' mode.
    Flags headings (>= 13pt) and footnotes (<= 9pt).
    """
    font_blocks = []
    
    try:
        page_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    except Exception:
        return font_blocks
    
    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:  # text blocks only
            continue
        
        block_text_parts = []
        block_font_sizes = []
        
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if text:
                    block_text_parts.append(text)
                    block_font_sizes.append(span.get("size", 0.0))
        
        if not block_text_parts:
            continue
        
        full_text = " ".join(block_text_parts)
        avg_font_size = sum(block_font_sizes) / len(block_font_sizes) if block_font_sizes else 0
        
        bbox = block.get("bbox", (0, 0, 0, 0))
        
        font_blocks.append(FontBlock(
            text=full_text,
            font_size=round(avg_font_size, 1),
            is_heading=avg_font_size >= HEADING_FONT_SIZE_MIN,
            x0=bbox[0],
            y0=bbox[1],
            x1=bbox[2],
            y1=bbox[3],
        ))
    
    return font_blocks


# ──────────────────────────── DIGITAL EXTRACTION ────────────────────────────

def extract_page_digital(page: fitz.Page, page_width: float) -> tuple[str, str, list[FontBlock]]:
    """
    Extract text from a digital PDF page using PyMuPDF blocks.
    Handles multi-column reordering.
    
    Returns: (raw_text, layout_type, font_metadata)
    """
    # Get blocks: (x0, y0, x1, y1, text, block_no, block_type)
    blocks = page.get_text("blocks")
    
    # Filter to text blocks only (type == 0)
    text_blocks = [b for b in blocks if b[6] == 0]
    
    # Detect column layout
    layout_type = detect_columns(text_blocks, page_width)
    
    # Reorder if multi-column
    if layout_type == "two_column":
        text_blocks = reorder_columns(text_blocks, page_width)
    else:
        # Single column: sort top to bottom
        text_blocks.sort(key=lambda b: (b[1], b[0]))
    
    # Concatenate text
    raw_text = "\n".join(b[4].strip() for b in text_blocks if b[4].strip())
    
    # Extract font metadata
    font_metadata = extract_font_metadata(page)
    
    return raw_text, layout_type, font_metadata


# ──────────────────────────── MAIN STAGE FUNCTION ────────────────────────────

def run_stage2(manifest: DocumentManifest) -> list[RawPageRecord]:
    """
    Run Stage 2: Text Extraction on a single document.
    
    Returns list of RawPageRecord (one per page).
    """
    doc_id = manifest.doc_id
    pdf_path = Path(manifest.file_path)
    extraction_path = manifest.extraction_path
    
    logger.info(f"═══ Stage 2: Extracting {pdf_path.name} ({extraction_path}) ═══")
    
    doc = fitz.open(str(pdf_path))
    records = []
    
    for page_num in range(doc.page_count):
        page = doc[page_num]
        page_width = page.rect.width
        
        if extraction_path == "digital":
            raw_text, layout_type, font_metadata = extract_page_digital(page, page_width)
            extraction_method = "pymupdf_digital"
            ocr_confidence = None
        else:
            # OCR path placeholder — for now, try digital extraction anyway
            raw_text, layout_type, font_metadata = extract_page_digital(page, page_width)
            extraction_method = "pymupdf_fallback"
            ocr_confidence = None
            logger.warning(f"  Page {page_num}: OCR path not implemented, using digital fallback")
        
        record = RawPageRecord(
            doc_id=doc_id,
            page_num=page_num,
            raw_text=raw_text,
            extraction_method=extraction_method,
            ocr_confidence=ocr_confidence,
            layout_type=layout_type,
            font_metadata=font_metadata,
        )
        records.append(record)
    
    doc.close()
    
    # Save all page records for this document
    output_path = RAW_PAGES_DIR / f"{doc_id}_raw_pages.json"
    save_json([r.model_dump() for r in records], output_path)
    
    # Quality check: average chars per page
    total_chars = sum(len(r.raw_text) for r in records)
    avg_chars = total_chars / len(records) if records else 0
    
    logger.info(
        f"  ✓ {len(records)} pages extracted | avg {avg_chars:.0f} chars/page | "
        f"total {total_chars:,} chars"
    )
    
    if avg_chars < 200:
        logger.warning(f"  ⚠ Low text density ({avg_chars:.0f} chars/page) — may need OCR")
    
    return records


def run_stage2_from_manifest(manifest_path: Path) -> list[RawPageRecord]:
    """Run Stage 2 from a saved manifest JSON file."""
    data = load_json(manifest_path)
    manifest = DocumentManifest(**data)
    return run_stage2(manifest)
