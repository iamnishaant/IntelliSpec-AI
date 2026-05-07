import re
from difflib import SequenceMatcher
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

_model = SentenceTransformer("all-MiniLM-L6-v2")

def semantic_similarity(a, b):
    vecs = _model.encode([a, b])
    return float(cosine_similarity([vecs[0]], [vecs[1]])[0][0])

def extract_primary_object(text: str) -> str:
    text = text.lower()
    text = re.sub(r"\b(shall|must|will|should|system|user|automatically|force|ensure|provide|manage|handle|track|support|interface|allow|permit|prohibit|restrict|be|can|remain|valid|for)\b", "", text)
    words = [w for w in text.split() if len(w) > 2]
    return " ".join(words[:5])

# REQ-REL-04
act_4 = "local workstation caching shall support up to 50 concurrent transactions before requiring a hard lock on further data entry"
# REQ-REL-06
act_6 = "the system must seamlessly cache up to 100 concurrent transactions locally to maintain operational continuity in the emergency department"

obj_4 = extract_primary_object(act_4)
obj_6 = extract_primary_object(act_6)

sim = semantic_similarity(obj_4, obj_6)

print(f"Obj 4: '{obj_4}'")
print(f"Obj 6: '{obj_6}'")
print(f"Similarity: {sim:.4f}")
print(f"Gated (0.55): {sim > 0.55}")
