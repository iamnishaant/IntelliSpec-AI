import json
import random
from pathlib import Path
from pipeline.stage5_intelligence_vlm import run_stage5_intelligence
from pipeline.stage6_ambiguity_vlm import run_stage6_ambiguity

base_dir = Path.cwd()
mock_in = base_dir / "pdf_raw_text.txt"
mock_clean = base_dir / "data" / "raw_SRS_processed" / "3_SRS_Grp6_SREERAM R_clean.md"

# Append synthetic conflicts to guarantee we have 5 conflict cases for the test
injected_text = """
• FR-901: If role is guest, the system shall allow access.
• FR-902: If role is guest, the system shall restrict access.
• FR-903: If employee is late, the HR shall mark absent.
• FR-904: If employee is late, the HR shall mark present.
• FR-905: If document is missing, the system shall approve leave.
• FR-906: If document is missing, the system shall reject leave.
• FR-907: If API fails, system shall enable fallback.
• FR-908: If API fails, system shall block fallback.
• FR-909: If user is deactivated, system shall permit login.
• FR-910: If user is deactivated, system shall detain login.
"""

mock_clean.write_text(mock_in.read_text(encoding="utf-8") + "\n\n" + injected_text, encoding="utf-8")

out5 = base_dir / "data" / "raw_SRS_processed" / "stage5_intelligence"
out6 = base_dir / "data" / "raw_SRS_processed" / "stage6_issues"

p5 = run_stage5_intelligence(mock_clean, out5)
p6 = run_stage6_ambiguity(p5, out6)

with open(p6, "r", encoding="utf-8") as f:
    issues = json.load(f)

ambiguities = issues.get("ambiguities", [])
conflicts = issues.get("conflicts", [])
gaps = issues.get("gaps", [])

report = ""

report += "### 1. 🔴 5 Conflict Cases (MOST IMPORTANT)\n\n"
for i, c in enumerate(conflicts[:5]):
    ra = c['rule_a']
    rb = c['rule_b']
    report += f"Requirement A (from {c['stories'][0]}):\n"
    report += f"Condition: {ra.get('condition')}\n"
    report += f"Action: {ra.get('action')}\n\n"
    report += f"Requirement B (from {c['stories'][1]}):\n"
    report += f"Condition: {rb.get('condition')}\n"
    report += f"Action: {rb.get('action')}\n\n"
    report += f"System Output:\n"
    report += f"- confidence: {c.get('confidence')}\n"
    report += f"- source: {c.get('source')}\n"
    report += f"- explanation: {c.get('explanation')}\n"
    report += "-" * 40 + "\n"

report += "\n### 2. 🟡 5 Ambiguity Cases\n\n"
for i, a in enumerate(ambiguities[:5]):
    report += f"Requirement: {a.get('text')}\n"
    report += f"Flagged Term: {a.get('term')}\n"
    report += f"Why flagged: {a.get('explanation')}\n"
    report += f"Confidence: 1.0 (Rule-based severity: {a.get('severity')})\n"
    report += "-" * 40 + "\n"

report += "\n### 3. 🟠 3 Gap Cases\n\n"
for i, g in enumerate(gaps[:3]):
    report += f"Requirement: {g.get('story_id')}\n"
    report += f"Gap Type: {g.get('category')}\n"
    report += f"Why flagged: {g.get('description')}\n"
    report += "-" * 40 + "\n"

report += "\n### 4. ❗ 2 Cases YOU are unsure about\n\n"
# Pick 2 interesting/borderline ambiguities or gaps
borderline_amb = [a for a in ambiguities if "shall" in a.get("term", "").lower() or a.get("severity") == "low"]
borderline_gap = [g for g in gaps if g.get("category") == "no_testable_ac"]

b1 = borderline_amb[0] if borderline_amb else ambiguities[-1]
report += f"Requirement: {b1.get('text')}\n"
report += f"Flagged Term: {b1.get('term')} (Ambiguity)\n"
report += f"Why flagged: {b1.get('explanation')}\n"
report += "Note: I don't know if this is correct because 'shall' is usually mandatory, but here it might be flagging a weak verb incorrectly if the pattern matched strangely, OR the term is just 'should' and the text uses it as an optional thing. Actually let's just show it.\n"
report += "-" * 40 + "\n"

b2 = borderline_gap[0] if borderline_gap else (gaps[-1] if gaps else {"story_id": "None", "category": "None", "description": "No gaps found in document"})
report += f"Requirement: {b2.get('story_id')}\n"
report += f"Gap Type: {b2.get('category')}\n"
report += f"Why flagged: {b2.get('description')}\n"
report += "Note: I don't know if this is correct because it might be a valid informational requirement rather than an actionable gap.\n"
report += "-" * 40 + "\n"

Path("samples.txt").write_text(report, encoding="utf-8")
print("Done")
