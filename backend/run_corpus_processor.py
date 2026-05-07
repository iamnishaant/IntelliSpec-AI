import os
import json
import argparse
import logging
from pathlib import Path
from pipeline.utils import setup_logger, save_json
from pipeline.stage2_extract_vlm import extract_pdf_vlm
from pipeline.stage3_clean_vlm import clean_markdown_safe
from pipeline.stage4_equations_vlm import extract_equations_and_tables
from pipeline.stage5_intelligence_vlm import run_stage5_intelligence
from pipeline.stage6_ambiguity_vlm import run_stage6_ambiguity

# Configure directories relative to this script
BASE_DIR = Path(__file__).resolve().parent
CORPUS_ROOT = BASE_DIR / "data" / "raw_SRS"
PROCESSED_ROOT = BASE_DIR / "data" / "raw_SRS_processed"
CHECKPOINT_ROOT = BASE_DIR / "data" / "checkpoints"

logger = setup_logger("corpus_processor")

def save_checkpoint(doc_id: str, stage: int, data: any):
    """Saves intermediate stage data for auditability."""
    cp_dir = CHECKPOINT_ROOT / doc_id
    cp_dir.mkdir(parents=True, exist_ok=True)
    out_path = cp_dir / f"stage{stage}_output.json"
    
    if isinstance(data, Path):
        save_json({"path": str(data)}, out_path)
    elif hasattr(data, "model_dump"):
        save_json(data.model_dump(), out_path)
    else:
        save_json(data, out_path)
    logger.info(f"Checkpoint saved: Stage {stage} -> {out_path}")

def process_pdf(pdf_path: Path, max_stage: int = 5, debug: bool = False, progress_callback=None):
    if not pdf_path.exists():
        logger.error(f"Cannot find PDF: {pdf_path}")
        return

    if debug:
        logger.setLevel(logging.DEBUG)
        
    # Dynamically resolve topic folder from the parent directory relative to raw_SRS
    try:
        rel_path = pdf_path.parent.relative_to(CORPUS_ROOT)
    except ValueError:
        rel_path = Path(pdf_path.parent.name)

    logger.info(f"═══ Processing: {pdf_path.name} ═══")
    
    # Set up mirrored output directories
    topic_out_dir = PROCESSED_ROOT / rel_path
    raw_dir = topic_out_dir / "stage2_raw_md"
    clean_dir = topic_out_dir / "stage3_cleaned_md"
    math_dir = topic_out_dir / "stage4_math"
    intel_dir = topic_out_dir / "stage5_intelligence"
    issues_dir = topic_out_dir / "stage6_issues"
    
    for d in [raw_dir, clean_dir, math_dir, intel_dir, issues_dir]:
        d.mkdir(parents=True, exist_ok=True)
        
    doc_id = pdf_path.stem
    
    # --- STAGE 2: EXTRACTION ---
    logger.info("--- Stage 2: VLM Extraction ---")
    if progress_callback:
        progress_callback("Parsing Document", "Starting VLM Extraction", 5)
    pages_records = extract_pdf_vlm(pdf_path, raw_dir, progress_callback)
    save_checkpoint(doc_id, 2, {"page_count": len(pages_records)})
    if max_stage == 2: return

    # --- STAGE 3: CLEANING ---
    logger.info("--- Stage 3: Cleaning & Hardening ---")
    if progress_callback:
        progress_callback("Parsing Document", "Cleaning and structuring markdown", 25)
    clean_md = clean_markdown_safe(pages_records, clean_dir, doc_id)
    save_checkpoint(doc_id, 3, clean_md)
    if max_stage == 3: return
            
    # --- STAGE 4: EQUATIONS ---
    logger.info("--- Stage 4: Equation Extraction ---")
    if progress_callback:
        progress_callback("Equation Processing", "Extracting equations and tables", 35)
    math_json_path = extract_equations_and_tables(clean_md, math_dir)
    save_checkpoint(doc_id, 4, math_json_path)
    if max_stage == 4: return

    # --- STAGE 5: INTELLIGENCE ---
    logger.info("--- Stage 5: Semantic Intelligence Layer ---")
    if progress_callback:
        progress_callback("Requirement Intelligence", "Building knowledge chunks...", 45)
    intel_json_path = None
    try:
        intel_json_path = run_stage5_intelligence(clean_md, intel_dir)
        save_checkpoint(doc_id, 5, intel_json_path)
        
        with open(intel_json_path, "r", encoding="utf-8") as f:
            intel_data = json.load(f)
            logger.info(f"Intelligence: {intel_data['metadata']['total_stories']} User Stories mapped.")
            logger.info(f"Actors: {', '.join(intel_data['actors'])}")
    except Exception as e:
        logger.error(f"Stage 5 failed for {doc_id}: {e}")
        if debug: raise e
    if max_stage == 5 or not intel_json_path: return

    # --- STAGE 6: ISSUES ENGINE ---
    logger.info("--- Stage 6: Issues Engine (Ambiguity + Conflict + Gap) ---")
    if progress_callback:
        progress_callback("Conflict & Ambiguity Detection", "Running issues engine...", 75)
    try:
        issues_json_path = run_stage6_ambiguity(intel_json_path, issues_dir)
        save_checkpoint(doc_id, 6, issues_json_path)
        
        with open(issues_json_path, "r", encoding="utf-8") as f:
            issues_data = json.load(f)
            a = issues_data.get('total_ambiguities', 0)
            c = issues_data.get('total_conflicts', 0)
            g = issues_data.get('total_gaps', 0)
            logger.info(f"\n🔍 ISSUES: {a+c+g} total ({a} ambiguities, {c} conflicts, {g} gaps)")
    except Exception as e:
        logger.error(f"Stage 6 failed for {doc_id}: {e}")
        if debug: raise e
        
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="SRS Clarity Requirements Intelligence Engine")
    parser.add_argument("--pdf", type=str, help="Specific PDF filename")
    parser.add_argument("--stage", type=int, default=6, help="Stop at specific stage (2-6)")
    parser.add_argument("--debug", action="store_true", help="Enable story-level debug logging")
    args = parser.parse_args()

    if args.pdf:
        target_pdf = CORPUS_ROOT / args.pdf
        if not target_pdf.exists():
            found = list(CORPUS_ROOT.rglob(args.pdf))
            if found: target_pdf = found[0]
            else:
                logger.error(f"Could not find {args.pdf}")
                exit(1)
        process_pdf(target_pdf, max_stage=args.stage, debug=args.debug)
    else:
        pdf_files = list(CORPUS_ROOT.rglob("*.pdf"))
        if pdf_files:
            process_pdf(pdf_files[0], max_stage=args.stage, debug=args.debug)
        else:
            logger.error("No PDFs found")
