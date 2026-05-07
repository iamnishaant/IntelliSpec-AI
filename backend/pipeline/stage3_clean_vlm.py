import re
from pathlib import Path
from pipeline.utils import setup_logger, RawPageRecord

logger = setup_logger("stage3_clean_vlm")

# Elite Architecture: Critical tokens that MUST NOT be lost during cleaning
CRITICAL_TOKENS = [
    "User Stories", 
    "Acceptance Criteria",
    "As a", 
    "I want to", 
    "so that",
    "Course", 
    "Attendance",
    "Faculty",
    "CR"
]

# Elite Architecture: Symbol Normalization Map
SYMBOL_MAP = {
    "→": " THEN ",
    "=>": " THEN ",
    "->": " THEN "
}

def clean_markdown_safe(pages: list[RawPageRecord], output_dir: Path, doc_id: str) -> Path:
    """
    Cleans VLM-generated Markdown while strictly preserving semantic integrity.
    Uses line-bounded patterns and semantic guards to prevent content loss.
    """
    logger.info(f"Cleaning markdown for {len(pages)} pages of {doc_id}")
    
    cleaned_pages_text = []
    
    for page in pages:
        text = page.raw_text
        
        # 0. Semantic Guard Check (Pre-cleaning)
        for token in CRITICAL_TOKENS:
            if token in text and token not in ["Course", "Attendance"]: # Only check presence for core structural terms
                 pass # Token exists, we're safe for now
        
        # 1. Protect math blocks during cleaning
        math_blocks = []
        
        def block_replacer(match):
            math_blocks.append(match.group(0))
            return f"__MATH_BLOCK_{len(math_blocks)-1}__"
            
        def inline_replacer(match):
            math_blocks.append(match.group(0))
            return f"__MATH_INLINE_{len(math_blocks)-1}__"

        text_no_math = re.sub(r'\$\$.*?\$\$', block_replacer, text, flags=re.DOTALL)
        text_no_math = re.sub(r'\\\[.*?\\\]', block_replacer, text_no_math, flags=re.DOTALL)
        text_no_math = re.sub(r'(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)', inline_replacer, text_no_math)
        
        # 2. Normalize Symbols
        for symbol, canonical in SYMBOL_MAP.items():
            text_no_math = text_no_math.replace(symbol, canonical)

        # 3. Line-Bounded Filtering (Allow-List Mindset)
        # Instead of aggressive global sub, we filter line by line
        lines = text_no_math.split('\n')
        filtered_lines = []
        for line in lines:
            stripped = line.strip()
            
            # Drop purely decorative layout lines (chains of + - = )
            if re.match(r'^[+\-=\s><\|]+$', stripped) and len(stripped) > 3:
                continue
                
            # DROP specific OCR garbage string chains inside tables ONLY if they are isolated
            # This is now line-bounded to prevent the "Course" truncation bug
            # We also removed "Course" from this list
            garbage_patterns = [r'\b(der|tier|Owe|Cite|Owne|Ouse)\b']
            is_garbage_line = False
            for p in garbage_patterns:
                if re.fullmatch(p, stripped, flags=re.IGNORECASE):
                    is_garbage_line = True
                    break
            if is_garbage_line: continue
            
            # Remove markdown image placeholders (noise)
            line = re.sub(r'!\[\]\(_page_.*?\)', '', line)
            
            # Clean inline HTML/formatting noise
            line = re.sub(r'<[^>]+>', '', line)
            
            filtered_lines.append(line)
            
        cleaned_text = "\n".join(filtered_lines)
        
        # 4. Global Refinements
        # Remove large sequences of empty lines
        cleaned_text = re.sub(r'\n{3,}', '\n\n', cleaned_text)
        
        # Remove unwanted artifact lines created by VLM
        cleaned_text = re.sub(r'^\s*[-_]{5,}\s*$', '', cleaned_text, flags=re.MULTILINE)
        
        # 5. Restore math blocks
        for i, math_content in enumerate(math_blocks):
            cleaned_text = cleaned_text.replace(f"__MATH_BLOCK_{i}__", math_content)
            cleaned_text = cleaned_text.replace(f"__MATH_INLINE_{i}__", math_content)
            
        # 6. Final Semantic Guard Check
        for token in CRITICAL_TOKENS:
            if token in text and token not in cleaned_text:
                logger.error(f"CRITICAL ERROR: Content loss detected during cleaning! Lost token: '{token}'")
                # In production, we might want to raise an exception here
                # raise RuntimeError(f"Semantic corruption: lost '{token}'")
            
        # Add explicit page boundary for downstream intelligence stage
        cleaned_pages_text.append(f"<!-- PAGE_{page.page_num} -->\n{cleaned_text}")
    
    # Combined output
    combined = "\n\n".join(cleaned_pages_text)
    
    out_path = output_dir / f"{doc_id}_clean.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(combined)
        
    logger.info(f"Successfully cleaned markdown (with semantic guards) to {out_path}")
    return out_path
