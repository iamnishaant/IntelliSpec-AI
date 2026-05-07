import os
from pipeline.stage6_ambiguity_vlm import get_embedding, semantic_similarity, extract_primary_object

# Numeric false positive
# SEC-03 vs SEC-10
sec3 = "The system shall automatically terminate an active user session and force a logout after 15 minutes of uninterrupted input inactivity."
sec10 = "The system shall feature automated lockout mechanisms, disabling a user account for 30 minutes after five consecutive failed login attempts."

# Semantic false positive
# CON-005: REQ-SEC-10 vs REQ-SEC-11
sec11 = "User authentication credentials shall remain valid for 90 days before the system prompts for a mandatory reset."

# True numeric conflict
# SEC-05 vs SEC-11
sec5 = "For compliance with internal security policies, all user passwords must be changed every 30 days without exception."

def test_pair(name, a, b):
    obj_a = extract_primary_object(a)
    obj_b = extract_primary_object(b)
    sim = semantic_similarity(obj_a, obj_b)
    print(f"[{name}] {obj_a} VS {obj_b} => {sim:.3f}")

if __name__ == "__main__":
    print("--- Testing Semantic Object Similarities ---")
    test_pair("Fake Numeric (SEC-03 vs 10)", sec3, sec10)
    test_pair("Fake Semantic (SEC-10 vs 11)", sec10, sec11)
    test_pair("True Numeric (SEC-05 vs 11)", sec5, sec11)
    test_pair("True Semantic (SEC-01 vs 09)", 
              "The system shall enforce strict Role-Based Access Control (RBAC), ensuring users can only access modules and data strictly necessary for their defined job functions", 
              "Admin users shall have full, unrestricted read access to the system-wide audit logs to monitor platform usage and investigate security incidents")
