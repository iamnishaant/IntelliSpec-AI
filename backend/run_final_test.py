import json
from pathlib import Path
from pipeline.stage5_intelligence_vlm import run_stage5_intelligence
from pipeline.stage6_ambiguity_vlm import run_stage6_ambiguity

base_dir = Path.cwd()
mock_in = base_dir / "pdf_raw_text.txt"
mock_clean = base_dir / "data" / "raw_SRS_processed" / "3_SRS_Grp6_SREERAM R_clean.md"

# Inject our exact targeted tests for all 4 categories!
injected_text = """
• FR-901: If role is guest, the system shall allow access.
• FR-902: If role is guest, the system shall restrict access.
• FR-903: If API fails, system shall enable fallback.
• FR-904: If API fails, system shall block fallback.
• FR-905: If user is deactivated, system shall permit login.
• FR-906: If user is deactivated, system shall detain login.
• FR-907: If event triggers, system shall authorize access.
• FR-908: If event triggers, system shall block access.
• FR-909: If test begins, system shall grant permission.
• FR-910: If test begins, system shall prohibit action.
• FR-911: If attendance < 75, the system shall detain.
• FR-912: If attendance < 60, the system shall allow.
"""

mock_clean.write_text(mock_in.read_text(encoding="utf-8") + "\n\n" + injected_text, encoding="utf-8")

out5 = base_dir / "data" / "raw_SRS_processed" / "stage5_intelligence"
out6 = base_dir / "data" / "raw_SRS_processed" / "stage6_issues"

print("Running pipeline...")
p5 = run_stage5_intelligence(mock_clean, out5)
p6 = run_stage6_ambiguity(p5, out6)
print("Pipeline complete.")
