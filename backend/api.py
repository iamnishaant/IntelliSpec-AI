"""
SRS Clarity — FastAPI Bridge
Minimal API connecting the Python pipeline to the React frontend.
4 endpoints. No over-engineering.
"""
import json
import shutil
import time
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from pipeline.utils import setup_logger

logger = setup_logger("api")

app = FastAPI(title="SRS Clarity API", version="1.0.0")

# CORS for Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080", "http://localhost:8081", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:8080", "http://127.0.0.1:8081"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
BASE_DIR = Path(__file__).resolve().parent
CORPUS_ROOT = BASE_DIR / "data" / "raw_SRS"
PROCESSED_ROOT = BASE_DIR / "data" / "raw_SRS_processed"

CORPUS_ROOT.mkdir(parents=True, exist_ok=True)
PROCESSED_ROOT.mkdir(parents=True, exist_ok=True)


# ────────────────────────────────────────────────────────────────────
# HELPERS
# ────────────────────────────────────────────────────────────────────

def get_doc_id(filename: str) -> str:
    """Derive doc_id from filename (strip extension)."""
    return Path(filename).stem


def find_processed_file(doc_id: str, stage_dir: str, suffix: str) -> Path | None:
    """Find a processed file by doc_id in a stage directory."""
    target_dir = PROCESSED_ROOT / stage_dir
    if not target_dir.exists():
        return None
    candidates = list(target_dir.glob(f"{doc_id}*{suffix}"))
    return candidates[0] if candidates else None


# ────────────────────────────────────────────────────────────────────
# PROGRESS STORE & 1. POST /api/upload
# ────────────────────────────────────────────────────────────────────

PROGRESS_STORE = {}

def cleanup_progress_store():
    current_time = time.time()
    to_delete = [
        doc_id for doc_id, data in PROGRESS_STORE.items()
        if current_time - data.get("updated_at", current_time) > 600
    ]
    for d in to_delete:
        del PROGRESS_STORE[d]

def run_pipeline_background(doc_id: str, pdf_path: Path):
    from run_corpus_processor import process_pdf
    
    def progress_callback(stage: str, message: str, percent: int):
        PROGRESS_STORE[doc_id] = {
            "status": "processing",
            "stage": stage,
            "message": message,
            "percent": percent,
            "updated_at": time.time()
        }
    
    try:
        process_pdf(pdf_path, max_stage=6, debug=False, progress_callback=progress_callback)
        if doc_id in PROGRESS_STORE:
            PROGRESS_STORE[doc_id]["status"] = "done"
            PROGRESS_STORE[doc_id]["updated_at"] = time.time()
    except Exception as e:
        logger.error(f"Pipeline failed for {doc_id}: {e}")
        PROGRESS_STORE[doc_id] = {
            "status": "error",
            "message": str(e),
            "updated_at": time.time()
        }

@app.post("/api/upload")
async def upload_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Upload a PDF and run the full pipeline (Stages 2-6) asynchronously."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    
    cleanup_progress_store()
    
    doc_id = get_doc_id(file.filename)

    # Guard: reject if pipeline already running for this doc
    if PROGRESS_STORE.get(doc_id, {}).get("status") == "processing":
        logger.warning(f"Pipeline already running for {doc_id}, ignoring duplicate request.")
        return JSONResponse({"doc_id": doc_id, "filename": file.filename, "status": "processing"})
    
    # Save uploaded PDF
    pdf_path = CORPUS_ROOT / file.filename
    with open(pdf_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    logger.info(f"Uploaded: {file.filename} → queuing pipeline...")

    # ⚡ Initialize PROGRESS_STORE synchronously so the first poll never misses it
    PROGRESS_STORE[doc_id] = {
        "status": "processing",
        "stage": "Parsing Document",
        "message": "Queued — initializing pipeline...",
        "percent": 0,
        "updated_at": time.time()
    }

    background_tasks.add_task(run_pipeline_background, doc_id, pdf_path)
    
    return JSONResponse({
        "doc_id": doc_id,
        "filename": file.filename,
        "status": "processing"
    })


@app.get("/api/document/{doc_id}/status")
async def get_document_status(doc_id: str):
    """Get real-time pipeline status."""
    if doc_id not in PROGRESS_STORE:
        # Check if output exists.
        issues_file = find_processed_file(doc_id, "stage6_issues", "_issues.json")
        if issues_file:
            return {"status": "done"}
        else:
            return {"status": "error", "message": "Document not found in active queue."}
    
    return PROGRESS_STORE[doc_id]


# ────────────────────────────────────────────────────────────────────
# 2. GET /api/documents — List all processed documents
# ────────────────────────────────────────────────────────────────────

@app.get("/api/documents")
async def list_documents():
    """List all documents that have been processed through the pipeline."""
    documents = []
    
    intel_dir = PROCESSED_ROOT / "stage5_intelligence"
    issues_dir = PROCESSED_ROOT / "stage6_issues"
    
    if intel_dir.exists():
        for intel_file in intel_dir.glob("*_intelligence.json"):
            doc_id = intel_file.stem.replace("_intelligence", "")
            
            # Count issues if available
            ambiguity_count = 0
            conflict_count = 0
            gap_count = 0
            issue_file = issues_dir / f"{doc_id}_issues.json"
            if issue_file.exists():
                with open(issue_file, "r", encoding="utf-8") as f:
                    issue_data = json.load(f)
                    ambiguity_count = issue_data.get("total_ambiguities", 0)
                    conflict_count = issue_data.get("total_conflicts", 0)
                    gap_count = issue_data.get("total_gaps", 0)
            
            # Get story count
            with open(intel_file, "r", encoding="utf-8") as f:
                intel_data = json.load(f)
                story_count = intel_data.get("metadata", {}).get("total_stories", 0)
                actors = intel_data.get("actors", [])
            
            documents.append({
                "doc_id": doc_id,
                "stories": story_count,
                "actors": actors,
                "issues": ambiguity_count + conflict_count + gap_count,
                "ambiguities": ambiguity_count,
                "conflicts": conflict_count,
                "gaps": gap_count,
                "has_intelligence": True,
                "has_issues": issue_file.exists()
            })
    
    return {"documents": documents}


# ────────────────────────────────────────────────────────────────────
# 3. GET /api/document/{doc_id}/intelligence — Stage 5 JSON
# ────────────────────────────────────────────────────────────────────

@app.get("/api/document/{doc_id}/intelligence")
async def get_intelligence(doc_id: str):
    """Return the Stage 5 intelligence model for a document."""
    intel_file = find_processed_file(doc_id, "stage5_intelligence", "_intelligence.json")
    
    if not intel_file:
        raise HTTPException(status_code=404, detail=f"No intelligence data for '{doc_id}'")
    
    with open(intel_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    return data


# ────────────────────────────────────────────────────────────────────
# 4. GET /api/document/{doc_id}/issues — Stage 6 JSON
# ────────────────────────────────────────────────────────────────────

@app.get("/api/document/{doc_id}/issues")
async def get_issues(doc_id: str):
    """Return the Stage 6 issues report for a document."""
    issues_file = find_processed_file(doc_id, "stage6_issues", "_issues.json")
    
    if not issues_file:
        raise HTTPException(status_code=404, detail=f"No issues data for '{doc_id}'")
    
    with open(issues_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    return data


# ────────────────────────────────────────────────────────────────────
# 5. GET /api/document/{doc_id}/markdown — Cleaned markdown
# ────────────────────────────────────────────────────────────────────

@app.get("/api/document/{doc_id}/markdown")
async def get_markdown(doc_id: str):
    """Return the cleaned markdown for a document."""
    md_file = find_processed_file(doc_id, "stage3_cleaned_md", "_clean.md")
    
    if not md_file:
        raise HTTPException(status_code=404, detail=f"No markdown for '{doc_id}'")
    
    with open(md_file, "r", encoding="utf-8") as f:
        content = f.read()
    
    return PlainTextResponse(content)


# ────────────────────────────────────────────────────────────────────
# 6. DELETE /api/document/{doc_id} — Remove document + all artifacts
# ────────────────────────────────────────────────────────────────────

@app.delete("/api/document/{doc_id}")
async def delete_document(doc_id: str):
    """Delete processed pipeline artifacts only. Raw PDF in raw_SRS/ is preserved."""
    deleted_files = []
    
    # Delete from all stage directories (processed artifacts only)
    if PROCESSED_ROOT.exists():
        for stage_dir in PROCESSED_ROOT.iterdir():
            if stage_dir.is_dir():
                for artifact in stage_dir.glob(f"{doc_id}*"):
                    if artifact.is_file():
                        artifact.unlink()
                        deleted_files.append(str(artifact))
                    elif artifact.is_dir():
                        shutil.rmtree(artifact)
                        deleted_files.append(str(artifact))
    
    if not deleted_files:
        raise HTTPException(status_code=404, detail=f"No processed artifacts found for '{doc_id}'")
    
    logger.info(f"Deleted {len(deleted_files)} files for doc_id={doc_id}")
    # Clear any stale progress state so re-uploads start cleanly
    PROGRESS_STORE.pop(doc_id, None)
    return {"doc_id": doc_id, "deleted": len(deleted_files)}

