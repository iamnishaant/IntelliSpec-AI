"""
Shared utility functions for the pipeline.
Hashing, logging, regex helpers, and Pydantic models for intermediate records.
"""
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field


# ──────────────────────────── LOGGING ────────────────────────────

def setup_logger(name: str, log_file: Optional[Path] = None, level=logging.INFO) -> logging.Logger:
    """Create a logger with console + optional file handler."""
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    formatter = logging.Formatter(
        "[%(asctime)s] %(name)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Console handler
    ch = logging.StreamHandler()
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    
    # File handler
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(formatter)
        logger.addHandler(fh)
    
    return logger


# ──────────────────────────── HASHING ────────────────────────────

def hash_file(file_path: Path, algorithm: str = "sha256") -> str:
    """Compute hash of a file for deduplication."""
    h = hashlib.new(algorithm)
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def generate_doc_id(file_path: Path) -> str:
    """Generate a clean document ID from the filename."""
    stem = file_path.stem
    # Remove hash prefixes (like MIT lecture files: 09f3656e11af75e5..._MIT6_012F09_lec20)
    if len(stem) > 32 and "_" in stem:
        parts = stem.split("_", 1)
        if len(parts[0]) == 32 and all(c in "0123456789abcdef" for c in parts[0]):
            stem = parts[1]
    # Clean up: lowercase, replace spaces/special chars with underscores
    clean = re.sub(r"[^a-zA-Z0-9]", "_", stem)
    clean = re.sub(r"_+", "_", clean).strip("_").lower()
    return clean


# ──────────────────────────── JSON I/O ────────────────────────────

def save_json(data, output_path: Path):
    """Save data to a JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)


def load_json(input_path: Path):
    """Load data from a JSON file."""
    with open(input_path, "r", encoding="utf-8") as f:
        return json.load(f)


# ──────────────────────────── PYDANTIC MODELS ────────────────────────────

class DocumentManifest(BaseModel):
    """Stage 1 output: Document Manifest Record"""
    doc_id: str
    file_path: str
    doc_type: str
    extraction_path: str = "digital"   # "digital" or "ocr"
    page_count: int = 0
    metadata: dict = Field(default_factory=dict)
    hash: str = ""
    processing_flags: list[str] = Field(default_factory=list)


class FontBlock(BaseModel):
    """A text block with font metadata from Stage 2."""
    text: str
    font_size: float = 0.0
    is_heading: bool = False
    x0: float = 0.0
    y0: float = 0.0
    x1: float = 0.0
    y1: float = 0.0


class RawPageRecord(BaseModel):
    """Stage 2 output: Raw Page Record"""
    doc_id: str
    page_num: int
    raw_text: str = ""
    extraction_method: str = "pymupdf_digital"
    ocr_confidence: Optional[float] = None
    layout_type: str = "single_column"   # "single_column" or "two_column"
    font_metadata: list[FontBlock] = Field(default_factory=list)


class CleanedPageRecord(BaseModel):
    """Stage 3 output: Cleaned Page Record"""
    doc_id: str
    page_num: int
    cleaned_text: str = ""
    removed_elements: list[str] = Field(default_factory=list)
    tables_detected: int = 0
    figures_detected: int = 0


class EquationRecord(BaseModel):
    """Stage 4 output: Equation Record"""
    eq_id: str
    doc_id: str
    page: int
    section: str = ""
    raw_text: str = ""
    latex: str = ""
    sympy_expr: str = ""
    variables: list[str] = Field(default_factory=list)
    equation_type: str = ""
    surrounding_context: str = ""
    parse_success: bool = False


class KnowledgeChunk(BaseModel):
    """Stage 5 output: Knowledge Chunk"""
    chunk_id: str
    doc_id: str
    source_label: str = ""
    page_start: int = 0
    page_end: int = 0
    section_path: str = ""
    chunk_type: str = "text"            # "text", "equation", "mixed_text_equation"
    text: str = ""
    equations: list[str] = Field(default_factory=list)
    variables_mentioned: list[str] = Field(default_factory=list)
    token_count: int = 0
    overlap_with_prev: bool = False


class EmbeddedChunkRecord(BaseModel):
    """Stage 6 output: Embedded Chunk Record"""
    chunk_id: str
    dense_vector: list[float] = Field(default_factory=list)
    vector_dim: int = 768
    embedding_model: str = ""
    bm25_tokens: list[str] = Field(default_factory=list)
    text: str = ""
