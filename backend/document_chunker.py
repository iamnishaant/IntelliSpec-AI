"""
document_chunker.py
Phase 1: Semantic Chunking of _clean.md files for the IntelliSpec Prompt Engine.

Splits _clean.md by Markdown headings (#, ##, ###) so that complex sections
(containing math, figures, constraints) are kept intact as semantic units.
Also extracts embedded math expressions ($$...$$, $...$) and Figure references.
"""
import re
import json
from pathlib import Path


# ─────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────

# Match headings: # Title, ## Title, ### Title  (with optional leading whitespace)
HEADING_RE  = re.compile(r'^(#{1,3})\s+(.+)', re.MULTILINE)

# Math expressions: block $$...$$, inline $...$, and \[ ... \] LaTeX
MATH_BLOCK_RE   = re.compile(r'\$\$(.+?)\$\$', re.DOTALL)
MATH_INLINE_RE  = re.compile(r'(?<!\$)\$([^\$\n]+?)\$(?!\$)')
MATH_LATEX_RE   = re.compile(r'\\\[(.+?)\\\]', re.DOTALL)

# Figure / Table references: "Figure 3.1", "Fig. 2", "Table 4"
FIGURE_RE = re.compile(r'(?:Figure|Fig\.?|Table)\s+[\dA-Za-z]+(?:\.\d+)*', re.IGNORECASE)

# Acceptance criteria block markers
AC_RE = re.compile(r'Acceptance Criteria.*?(?=\n\n|\Z)', re.DOTALL | re.IGNORECASE)

# User story identifier
US_RE = re.compile(r'\b(US\d{3}|INF-\d{3})\b')


# ─────────────────────────────────────────────────────────────
# CORE CHUNKER
# ─────────────────────────────────────────────────────────────

def extract_math(text: str) -> list[dict]:
    """Extract all math expressions from text."""
    maths = []
    for m in MATH_BLOCK_RE.finditer(text):
        maths.append({"type": "block", "expression": m.group(1).strip()})
    for m in MATH_INLINE_RE.finditer(text):
        maths.append({"type": "inline", "expression": m.group(1).strip()})
    for m in MATH_LATEX_RE.finditer(text):
        maths.append({"type": "latex_block", "expression": m.group(1).strip()})
    return maths


def extract_figures(text: str) -> list[str]:
    """Extract figure/table references from text."""
    return list(dict.fromkeys(FIGURE_RE.findall(text)))  # deduplicate, preserve order


def extract_user_story_ids(text: str) -> list[str]:
    """Extract story IDs (US001, INF-003) from text."""
    return list(dict.fromkeys(US_RE.findall(text)))


def classify_chunk(heading: str, body: str) -> str:
    """Classify a chunk by its heading and content."""
    h = heading.lower()
    if any(k in h for k in ["actor", "user", "role", "stakeholder"]):
        return "actors"
    if any(k in h for k in ["use case", "functional", "feature", "story"]):
        return "use_cases"
    if any(k in h for k in ["constraint", "performance", "non-functional", "security", "reliability"]):
        return "constraints"
    if any(k in h for k in ["architecture", "design", "component", "module", "system"]):
        return "architecture"
    if any(k in h for k in ["math", "formula", "equation", "algorithm", "calculation"]):
        return "math"
    if any(k in h for k in ["glossary", "definition", "term", "abbreviation"]):
        return "definitions"
    if extract_math(body):
        return "math"
    if any(k in h for k in ["introduction", "overview", "scope", "purpose"]):
        return "overview"
    return "general"


def chunk_markdown(content: str, doc_id: str) -> list[dict]:
    """
    Split a _clean.md string into semantic chunks.

    Each chunk:
    {
        "chunk_id":    "doc_id#section-0",
        "heading":     "3.1 Authentication Module",
        "level":       2,
        "category":    "architecture",
        "body":        "raw text of that section",
        "math":        [...],
        "figures":     [...],
        "story_ids":   ["US003", "US004"]
    }
    """
    chunks = []
    # Find all heading positions
    heading_matches = list(HEADING_RE.finditer(content))

    # If no headings, treat entire content as one chunk
    if not heading_matches:
        body = content.strip()
        chunks.append({
            "chunk_id":  f"{doc_id}#section-0",
            "heading":   doc_id,
            "level":     1,
            "category":  classify_chunk(doc_id, body),
            "body":      body,
            "math":      extract_math(body),
            "figures":   extract_figures(body),
            "story_ids": extract_user_story_ids(body),
        })
        return chunks

    # Preamble before first heading
    preamble = content[:heading_matches[0].start()].strip()
    if preamble:
        chunks.append({
            "chunk_id":  f"{doc_id}#preamble",
            "heading":   "Introduction",
            "level":     0,
            "category":  "overview",
            "body":      preamble,
            "math":      extract_math(preamble),
            "figures":   extract_figures(preamble),
            "story_ids": extract_user_story_ids(preamble),
        })

    # Process each heading section
    for i, m in enumerate(heading_matches):
        start = m.end()
        end   = heading_matches[i + 1].start() if i + 1 < len(heading_matches) else len(content)
        body  = content[start:end].strip()
        level = len(m.group(1))   # number of # chars
        heading_text = m.group(2).strip()

        chunk = {
            "chunk_id":  f"{doc_id}#section-{i}",
            "heading":   heading_text,
            "level":     level,
            "category":  classify_chunk(heading_text, body),
            "body":      body,
            "math":      extract_math(body),
            "figures":   extract_figures(body),
            "story_ids": extract_user_story_ids(body),
        }
        chunks.append(chunk)

    return chunks


# ─────────────────────────────────────────────────────────────
# PAGE-BASED FALLBACK (for flat user-story docs without headings)
# ─────────────────────────────────────────────────────────────

def chunk_by_pages(content: str, doc_id: str) -> list[dict]:
    """
    Fallback: split by <!-- PAGE_N --> markers common in pyMuPDF-extracted files.
    Groups pages into semantic blocks (e.g., consecutive actor sections).
    """
    pages = re.split(r'<!--\s*PAGE_\d+\s*-->', content)
    chunks = []
    buffer_text = ""
    buffer_start = 0
    current_heading = "Section"

    for i, page in enumerate(pages):
        page = page.strip()
        if not page:
            continue

        # Try to detect a new "section" heading on this page
        first_line = page.split('\n')[0].strip()
        is_new_section = (
            len(first_line) < 80          # not a sentence
            and not first_line.endswith('.') # not prose
            and i > 0
        )

        if is_new_section and buffer_text:
            # Flush previous buffer
            chunks.append({
                "chunk_id":  f"{doc_id}#page-chunk-{buffer_start}",
                "heading":   current_heading,
                "level":     2,
                "category":  classify_chunk(current_heading, buffer_text),
                "body":      buffer_text,
                "math":      extract_math(buffer_text),
                "figures":   extract_figures(buffer_text),
                "story_ids": extract_user_story_ids(buffer_text),
            })
            current_heading = first_line
            buffer_text = page
            buffer_start = i
        else:
            buffer_text += "\n\n" + page

    # Flush remaining buffer
    if buffer_text.strip():
        chunks.append({
            "chunk_id":  f"{doc_id}#page-chunk-{buffer_start}",
            "heading":   current_heading,
            "level":     2,
            "category":  classify_chunk(current_heading, buffer_text),
            "body":      buffer_text,
            "math":      extract_math(buffer_text),
            "figures":   extract_figures(buffer_text),
            "story_ids": extract_user_story_ids(buffer_text),
        })

    return chunks


# ─────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────

def get_chunks(doc_id: str, processed_root: Path) -> list[dict]:
    """
    Main entry point: given a doc_id, find its _clean.md and return chunks.
    Falls back to page-based chunking if no Markdown headings are found.
    """
    stage3_dir = processed_root / "stage3_cleaned_md"
    candidates = list(stage3_dir.glob(f"{doc_id}*_clean.md"))
    if not candidates:
        # Try without numeric prefix
        candidates = list(stage3_dir.glob(f"*{doc_id}*_clean.md"))
    if not candidates:
        return []

    md_path = candidates[0]
    content = md_path.read_text(encoding="utf-8")

    # Choose chunking strategy
    heading_count = len(HEADING_RE.findall(content))
    if heading_count >= 2:
        chunks = chunk_markdown(content, doc_id)
    else:
        chunks = chunk_by_pages(content, doc_id)

    return chunks


def get_relevant_chunks(doc_id: str, query: str, processed_root: Path, top_k: int = 4) -> list[dict]:
    """
    Lightweight keyword relevance search over chunks.
    Returns the top_k most relevant chunks for a given user query.
    No embeddings needed — uses simple term overlap.
    """
    chunks = get_chunks(doc_id, processed_root)
    if not chunks:
        return []

    query_terms = set(re.findall(r'\w+', query.lower()))

    def score(chunk: dict) -> int:
        text = (chunk["heading"] + " " + chunk["body"] + " " + chunk["category"]).lower()
        chunk_terms = set(re.findall(r'\w+', text))
        # Boost chunks that have math or figures (higher semantic value)
        math_boost   = 3 * len(chunk.get("math", []))
        figure_boost = 2 * len(chunk.get("figures", []))
        return len(query_terms & chunk_terms) + math_boost + figure_boost

    ranked = sorted(chunks, key=score, reverse=True)
    return ranked[:top_k]
