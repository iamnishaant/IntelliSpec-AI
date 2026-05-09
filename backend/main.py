"""
edituml Backend — Document Parse API
=====================================
Endpoints:
  POST /api/parse   — Accept PDF or Markdown, return clean extracted text
  GET  /api/health  — Healthcheck

Heartbeat logger runs every 5 seconds in the background.
"""

import asyncio
import io
import logging
import time
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ─── Logging setup ────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("edituml-backend")

# ─── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(title="EditUML Document Parser", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Heartbeat ────────────────────────────────────────────────────────────────
START_TIME = time.time()
request_count = 0

async def heartbeat():
    """Log system status every 5 seconds."""
    while True:
        await asyncio.sleep(5)
        uptime = int(time.time() - START_TIME)
        logger.info(
            f"[HEARTBEAT] Uptime={uptime}s | Requests handled={request_count} | Status=ONLINE"
        )

@app.on_event("startup")
async def startup_event():
    logger.info("=" * 60)
    logger.info("  EditUML Backend starting up...")
    logger.info("  Document parse API ready on port 8001")
    logger.info("  Heartbeat logging every 5 seconds")
    logger.info("=" * 60)
    asyncio.create_task(heartbeat())

# ─── PDF text extraction ──────────────────────────────────────────────────────
def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text from a PDF using PyMuPDF (fitz)."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = []
        for i, page in enumerate(doc):
            text = page.get_text("text")
            if text.strip():
                pages.append(f"=== Page {i+1} ===\n{text.strip()}")
        doc.close()
        logger.info(f"[PDF] Extracted {len(pages)} pages of text via PyMuPDF")
        return "\n\n".join(pages)
    except ImportError:
        logger.warning("[PDF] PyMuPDF not available — trying pdfplumber fallback")
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                pages = []
                for i, page in enumerate(pdf.pages):
                    text = page.extract_text() or ""
                    if text.strip():
                        pages.append(f"=== Page {i+1} ===\n{text.strip()}")
            logger.info(f"[PDF] Extracted {len(pages)} pages via pdfplumber")
            return "\n\n".join(pages)
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="No PDF library found. Install: pip install pymupdf"
            )

# ─── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "online", "uptime_seconds": int(time.time() - START_TIME)}

@app.post("/api/parse")
async def parse_document(file: UploadFile = File(...)):
    """
    Accept a PDF or Markdown file, extract clean text, return it for AI analysis.
    The AI extraction itself runs on the frontend (Groq) — this endpoint only
    handles the file → text pipeline.
    """
    global request_count
    request_count += 1

    filename = file.filename or ""
    content  = await file.read()

    logger.info(f"[PARSE] Received file: {filename} ({len(content)} bytes)")

    if filename.lower().endswith(".pdf"):
        logger.info(f"[PARSE] Processing PDF: {filename}")
        t0 = time.time()
        text = extract_text_from_pdf(content)
        elapsed = round(time.time() - t0, 2)
        logger.info(f"[PARSE] PDF extraction done in {elapsed}s — {len(text)} chars")

    elif filename.lower().endswith((".md", ".txt")):
        logger.info(f"[PARSE] Processing Markdown/Text: {filename}")
        text = content.decode("utf-8", errors="replace")
        logger.info(f"[PARSE] Text loaded — {len(text)} chars")

    else:
        logger.warning(f"[PARSE] Unsupported file type: {filename}")
        raise HTTPException(status_code=400, detail="Only PDF, .md, and .txt files are supported.")

    word_count = len(text.split())
    logger.info(f"[PARSE] Complete — {word_count} words ready for AI analysis")

    return JSONResponse({
        "filename": filename,
        "word_count": word_count,
        "char_count": len(text),
        "text": text,
    })
