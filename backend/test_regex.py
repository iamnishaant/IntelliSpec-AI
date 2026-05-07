import re

text = """
• FR-1: System shall provide secure login.
• FR-2: System shall enforce role-based access.
"""

lookahead = r"(?=\n\s*[-*•\u2022]?\s*FR[-\s]?\d+|\n\s*[-*•\u2022]?\s*US\d+|\n\s*[-*•\u2022]?\s*NFR[-\s]?\d+|\n#|\Z)"
pattern = r"(FR[-\s]?\d+[\s:].+?)" + lookahead

matches = re.findall(pattern, text, re.DOTALL | re.IGNORECASE)
print("Matches:", len(matches))
for m in matches:
    print("---", m)
