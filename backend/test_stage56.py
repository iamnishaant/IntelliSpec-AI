from pipeline.stage5_intelligence_vlm import run_stage5_intelligence
from pipeline.stage6_ambiguity_vlm import run_stage6_ambiguity
from pathlib import Path
import json

base_dir = Path.cwd()
mock_in = base_dir / "pdf_raw_text.txt"
mock_clean = base_dir / "data" / "raw_SRS_processed" / "3_SRS_Grp6_SREERAM R_clean.md"
mock_clean.parent.mkdir(parents=True, exist_ok=True)
mock_clean.write_text(mock_in.read_text(encoding="utf-8"), encoding="utf-8")

out5 = base_dir / "data" / "raw_SRS_processed" / "stage5_intelligence"
out6 = base_dir / "data" / "raw_SRS_processed" / "stage6_issues"
out5.mkdir(parents=True, exist_ok=True)
out6.mkdir(parents=True, exist_ok=True)

print("Running Stage 5...")
p5 = run_stage5_intelligence(mock_clean, out5)
print(f"Stage 5 output: {p5}")

print("Running Stage 6...")
p6 = run_stage6_ambiguity(p5, out6)
print(f"Stage 6 output: {p6}")

with open(p5, "r", encoding="utf-8") as f:
    s5_data = json.load(f)
    print(f"\n=> Total user stories/requirements mapped: {s5_data.get('metadata', {}).get('total_stories')}")
    
with open(p6, "r", encoding="utf-8") as f:
    s6_data = json.load(f)
    print(f"=> Total Ambiguities: {s6_data.get('total_ambiguities')}")
    print(f"=> Total Conflicts: {s6_data.get('total_conflicts')}")
    print(f"=> Total Gaps: {s6_data.get('total_gaps')}")
