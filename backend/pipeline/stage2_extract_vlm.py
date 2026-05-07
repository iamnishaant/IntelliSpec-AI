import os
import json
import fitz
from pathlib import Path
from pipeline.utils import setup_logger, RawPageRecord, save_json, load_json

try:
    import torch
    import fitz
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered
    MARKER_AVAILABLE = True
except ImportError:
    MARKER_AVAILABLE = False
    torch = None

logger = setup_logger("stage2_extract_vlm")

def extract_pdf_vlm(pdf_path: Path, output_dir: Path, progress_callback=None) -> list[RawPageRecord]:
    """
    State-of-the-Art (SOTA) Vision-Language Model extraction using Marker.
    Enforces GPU, extracts page-by-page implicitly preventing merged page errors.
    """
    if not MARKER_AVAILABLE:
        logger.warning("marker-pdf and torch are not installed. Falling back to basic PyMuPDF extraction.")
        
        doc = fitz.open(pdf_path)
        doc_id = pdf_path.stem
        total_pages = len(doc)
        extracted_pages = []
        
        for i in range(total_pages):
            if progress_callback:
                percent = 5 + int((i / total_pages) * 20)
                progress_callback("Parsing Document", f"PyMuPDF processing page {i+1}/{total_pages}", percent)
            
            page = doc[i]
            text = page.get_text()
            
            record = RawPageRecord(
                doc_id=doc_id,
                page_num=i,
                raw_text=text,
                extraction_method="pymupdf_fallback"
            )
            extracted_pages.append(record)
            
        doc.close()
        return extracted_pages

    logger.info(f"Starting VLM extraction on {pdf_path.name}")
    
    # 1. Check GPU Usage (Warn instead of crash for local CPU runs)
    if not torch.cuda.is_available():
        logger.warning("CUDA is not available. VLM extraction will run on CPU, which may take ~40 seconds per page. Grab a coffee!")
    
    PIPELINE_VERSION = "vlm_v3_pagewise"
    
    # Check if we already extracted to save time during iterative development
    json_output_path = output_dir / f"{pdf_path.stem}_{PIPELINE_VERSION}.json"
    if json_output_path.exists():
        logger.info(f"VLM Output already exists at {json_output_path}, loading from cache.")
        data = load_json(json_output_path)
        
        # Sanity check page count loaded
        extracted_pages = [RawPageRecord(**page) for page in data["pages"]]
        if len(extracted_pages) == 0:
             raise RuntimeError("❌ Suspicious extraction: Cached extraction has 0 pages! Please delete cache.")
             
        return extracted_pages
        
    try:
        logger.info("Initializing Vision & OCR Models... (This takes a moment)")
        
        # Load heavy arrays into memory ONCE
        artifact_dict = create_model_dict()
        converter = PdfConverter(artifact_dict=artifact_dict)
        
        doc = fitz.open(pdf_path)
        doc_id = pdf_path.stem
        total_pages = len(doc)
        
        extracted_pages = []
        
        output_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Processing {total_pages} pages sequentially for exact page separation...")
        for i in range(total_pages):
            logger.info(f"VLM processing page {i+1}/{total_pages}")
            if progress_callback:
                percent = 5 + int((i / total_pages) * 20)  # Pages take up 5%→25% range
                progress_callback("Parsing Document", f"VLM processing page {i+1}/{total_pages}", percent)
            
            # Temporary single-page PDF for Marker
            tmp_pdf_path = output_dir / f"tmp_{doc_id}_page_{i}.pdf"
            doc_single = fitz.open()
            doc_single.insert_pdf(doc, from_page=i, to_page=i)
            doc_single.save(tmp_pdf_path)
            doc_single.close()
            
            try:
                # Run Marker on the slice
                rendered = converter(str(tmp_pdf_path))
                text, _, _ = text_from_rendered(rendered)
                
                # Create correct record
                record = RawPageRecord(
                    doc_id=doc_id,
                    page_num=i,
                    raw_text=text,
                    extraction_method="marker_vlm_strict"
                )
                extracted_pages.append(record)
                
            finally:
                if tmp_pdf_path.exists():
                    tmp_pdf_path.unlink()
                    
        doc.close()
        
        # 3. Post-Extraction Sanity Check
        if len(extracted_pages) == 0 or len(extracted_pages) < (total_pages * 0.7):
            raise RuntimeError(f"❌ Suspicious extraction: PDF has {total_pages} pages but only {len(extracted_pages)} were successfully extracted.")
        
        # Cache to json
        out_data = {
            "doc_id": doc_id,
            "total_pages": total_pages,
            "method": "marker_vlm_strict",
            "pipeline_version": PIPELINE_VERSION,
            "pages": [p.model_dump() for p in extracted_pages]
        }
        save_json(out_data, json_output_path)
        logger.info(f"Successfully extracted {total_pages} pages securely to {json_output_path}")
        
        return extracted_pages
        
    except Exception as e:
        logger.error(f"VLM Extraction failed: {e}")
        raise e
