"""
Stage 1 — Document Ingest & Triage

Validates PDFs, detects digital vs scanned, classifies document type,
extracts metadata, and generates a deduplication hash.
"""
import fitz  # PyMuPDF
from pathlib import Path
from typing import Optional

from pipeline.config import (
    MIN_CHARS_PER_PAGE_DIGITAL,
    SAMPLE_PAGES_FOR_DETECTION,
    DOC_TYPE_KEYWORDS,
    MANIFESTS_DIR,
)
from pipeline.utils import (
    hash_file,
    generate_doc_id,
    save_json,
    setup_logger,
    DocumentManifest,
)

logger = setup_logger("stage1_ingest")


# ──────────────────────────── HASH REGISTRY ────────────────────────────

_seen_hashes: set[str] = set()


def load_hash_registry(registry_path: Optional[Path] = None):
    """Load previously seen hashes to detect duplicates."""
    global _seen_hashes
    path = registry_path or (MANIFESTS_DIR / "_hash_registry.txt")
    if path.exists():
        _seen_hashes = set(path.read_text().strip().splitlines())
        logger.info(f"Loaded {len(_seen_hashes)} hashes from registry")


def save_hash_registry(registry_path: Optional[Path] = None):
    """Persist the hash registry."""
    path = registry_path or (MANIFESTS_DIR / "_hash_registry.txt")
    path.write_text("\n".join(sorted(_seen_hashes)))


# ──────────────────────────── CORE FUNCTIONS ────────────────────────────

def validate_pdf(pdf_path: Path) -> bool:
    """Check if the PDF is readable and not corrupted/password-protected."""
    try:
        doc = fitz.open(str(pdf_path))
        if doc.is_encrypted:
            logger.warning(f"SKIP: {pdf_path.name} is password-protected")
            doc.close()
            return False
        if doc.page_count == 0:
            logger.warning(f"SKIP: {pdf_path.name} has 0 pages")
            doc.close()
            return False
        doc.close()
        return True
    except Exception as e:
        logger.error(f"SKIP: {pdf_path.name} failed to open — {e}")
        return False


def detect_extraction_path(pdf_path: Path) -> str:
    """Determine if the PDF is native digital or scanned (needs OCR).
    
    Strategy: Extract text from the first N pages. If average text length
    per page > MIN_CHARS_PER_PAGE_DIGITAL, it is digital.
    """
    doc = fitz.open(str(pdf_path))
    sample_count = min(SAMPLE_PAGES_FOR_DETECTION, doc.page_count)
    
    total_chars = 0
    for i in range(sample_count):
        page = doc[i]
        text = page.get_text("text")
        total_chars += len(text.strip())
    
    doc.close()
    avg_chars = total_chars / sample_count if sample_count > 0 else 0
    
    if avg_chars >= MIN_CHARS_PER_PAGE_DIGITAL:
        return "digital"
    else:
        logger.info(f"{pdf_path.name}: avg {avg_chars:.0f} chars/page → OCR path")
        return "ocr"


def classify_document_type(pdf_path: Path, metadata: dict) -> str:
    """Classify the document type using keyword scanning.
    
    Scans the title, filename, and first 5 pages for classification keywords.
    """
    search_text = pdf_path.stem.lower()
    
    # Add metadata title if available
    if metadata.get("title"):
        search_text += " " + metadata["title"].lower()
    
    # Read first 5 pages for keywords
    try:
        doc = fitz.open(str(pdf_path))
        for i in range(min(5, doc.page_count)):
            search_text += " " + doc[i].get_text("text").lower()
        doc.close()
    except Exception:
        pass
    
    # Check each doc type's keywords
    for doc_type, keywords in DOC_TYPE_KEYWORDS.items():
        if not keywords:  # skip empty (textbook fallback)
            continue
        for keyword in keywords:
            if keyword.lower() in search_text:
                return doc_type
    
    return "textbook"  # default fallback


def extract_metadata(pdf_path: Path) -> dict:
    """Extract document-level metadata from the PDF."""
    doc = fitz.open(str(pdf_path))
    meta = doc.metadata or {}
    
    result = {
        "title": meta.get("title", "").strip() or pdf_path.stem,
        "author": meta.get("author", "").strip(),
        "subject": meta.get("subject", "").strip(),
        "creator": meta.get("creator", "").strip(),
        "creation_date": meta.get("creationDate", ""),
    }
    
    doc.close()
    return result


def detect_processing_flags(pdf_path: Path) -> list[str]:
    """Detect special processing flags for the document."""
    flags = []
    doc = fitz.open(str(pdf_path))
    
    # Check for high equation density (many math-like symbols in first pages)
    equation_indicators = 0
    for i in range(min(10, doc.page_count)):
        text = doc[i].get_text("text")
        # Count equation-like patterns
        for char in "=∫∑∂√±×÷∝∞≈≠≤≥":
            equation_indicators += text.count(char)
    
    if equation_indicators > 50:
        flags.append("high_equation_density")
    
    # Check for multi-column layout by examining text blocks
    if doc.page_count > 0:
        page = doc[0]
        blocks = page.get_text("blocks")
        if blocks:
            x_positions = [b[0] for b in blocks if b[4].strip()]
            if x_positions:
                x_range = max(x_positions) - min(x_positions)
                page_width = page.rect.width
                if x_range > page_width * 0.4:
                    flags.append("multi_column")
    
    doc.close()
    return flags


# ──────────────────────────── MAIN STAGE FUNCTION ────────────────────────────

def run_stage1(pdf_path: Path) -> Optional[DocumentManifest]:
    """
    Run Stage 1: Ingest & Triage on a single PDF.
    
    Returns a DocumentManifest or None if the PDF should be skipped.
    """
    pdf_path = Path(pdf_path)
    logger.info(f"═══ Stage 1: Processing {pdf_path.name} ═══")
    
    # 1. Validate
    if not validate_pdf(pdf_path):
        return None
    
    # 2. Deduplication hash
    file_hash = hash_file(pdf_path)
    if file_hash in _seen_hashes:
        logger.warning(f"SKIP: {pdf_path.name} is a duplicate (hash already seen)")
        return None
    _seen_hashes.add(file_hash)
    
    # 3. Extract metadata
    metadata = extract_metadata(pdf_path)
    
    # 4. Detect extraction path
    extraction_path = detect_extraction_path(pdf_path)
    
    # 5. Classify document type
    doc_type = classify_document_type(pdf_path, metadata)
    
    # 6. Get page count
    doc = fitz.open(str(pdf_path))
    page_count = doc.page_count
    doc.close()
    
    # 7. Detect processing flags
    flags = detect_processing_flags(pdf_path)
    
    # 8. Generate doc ID
    doc_id = generate_doc_id(pdf_path)
    
    # Build the manifest
    manifest = DocumentManifest(
        doc_id=doc_id,
        file_path=str(pdf_path),
        doc_type=doc_type,
        extraction_path=extraction_path,
        page_count=page_count,
        metadata=metadata,
        hash=file_hash,
        processing_flags=flags,
    )
    
    # Save to disk
    output_path = MANIFESTS_DIR / f"{doc_id}_manifest.json"
    save_json(manifest.model_dump(), output_path)
    
    logger.info(
        f"  ✓ doc_id={doc_id} | type={doc_type} | path={extraction_path} | "
        f"pages={page_count} | flags={flags}"
    )
    
    return manifest


def run_stage1_batch(pdf_dir: Path) -> list[DocumentManifest]:
    """Run Stage 1 on all PDFs in a directory (recursive)."""
    load_hash_registry()
    
    manifests = []
    pdf_files = sorted(pdf_dir.rglob("*.pdf"))
    logger.info(f"Found {len(pdf_files)} PDFs in {pdf_dir}")
    
    for pdf_path in pdf_files:
        result = run_stage1(pdf_path)
        if result:
            manifests.append(result)
    
    save_hash_registry()
    logger.info(f"Stage 1 complete: {len(manifests)} documents processed")
    return manifests


if __name__ == "__main__":
    from pipeline.config import RAW_PDF_DIR
    run_stage1_batch(RAW_PDF_DIR)
