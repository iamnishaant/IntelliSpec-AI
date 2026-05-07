import re
from difflib import SequenceMatcher
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

_model = SentenceTransformer("all-MiniLM-L6-v2")

def semantic_similarity(a, b):
    vecs = _model.encode([a, b])
    return float(cosine_similarity([vecs[0]], [vecs[1]])[0][0])

def extract_context(text: str) -> str:
    words = text.lower().split()
    STOP = {"shall", "must", "will", "should", "system", "user", "permit", "allow", "authorize", "grant", "prohibit", "detain", "block", "deny", "reject", "restrict", "prevent"}
    return " ".join([w for w in words if w not in STOP])

def normalize_context(context: str) -> str:
    return context # simplified for debug

# REQ-SEC-05
action_5 = "user passwords must be changed every 30 days without exception"

# REQ-SEC-11
action_11 = "User authentication credentials shall remain valid for 90 days before the system prompts for a mandatory reset"

ctx_5 = normalize_context(extract_context(action_5))
ctx_11 = normalize_context(extract_context(action_11))

sim_ctx = semantic_similarity(ctx_5, ctx_11)
sim_act = semantic_similarity(action_5, action_11)

print(f"Ctx 5: '{ctx_5}'")
print(f"Ctx 11: '{ctx_11}'")
print(f"Sim Context: {sim_ctx:.4f}")
print(f"Sim Action: {sim_act:.4f}")
print(f"Gated (ctx < 0.35 and act < 0.45): {sim_ctx < 0.35 and sim_act < 0.45}")
