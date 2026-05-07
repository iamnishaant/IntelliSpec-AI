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

# REQ-SEC-05
raw_5 = "REQ-SEC-05: For compliance with internal security policies, all user passwords must be changed every 30 days without exception."
action_5 = "user passwords must be changed every 30 days without exception" # New extract_action logic would get this

# REQ-SEC-11
raw_11 = "REQ-SEC-11: User authentication credentials shall remain valid for 90 days before the system prompts for a mandatory reset."
action_11 = "User authentication credentials shall remain valid for 90 days" # New extract_action logic would get this

obj_5 = extract_primary_object(action_5)
obj_11 = extract_primary_object(action_11)

sim = semantic_similarity(obj_5, obj_11)

print(f"Obj 5: '{obj_5}'")
print(f"Obj 11: '{obj_11}'")
print(f"Similarity: {sim:.4f}")
print(f"Gated (0.55): {sim > 0.55}")
