import re
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

_model = SentenceTransformer("all-MiniLM-L6-v2")

def semantic_similarity(a, b):
    vecs = _model.encode([a, b])
    return float(cosine_similarity([vecs[0]], [vecs[1]])[0][0])

c1 = "the central server connection is lost"
c2 = "network disconnection events or wide-area network outages"

sim = semantic_similarity(c1, c2)
print(f"Sim: {sim:.4f}")
print(f"Threshold 0.85: {sim >= 0.85}")
print(f"Threshold 0.75: {sim >= 0.75}")
