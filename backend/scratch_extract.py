import fitz
import sys

def extract_text(pdf_path):
    doc = fitz.open(pdf_path)
    text = ""
    for i, page in enumerate(doc):
        text += f"\n\n--- PAGE {i+1} ---\n\n"
        text += page.get_text()
    
    with open("pdf_raw_text.txt", "w", encoding="utf-8") as f:
        f.write(text)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        extract_text(sys.argv[1])
