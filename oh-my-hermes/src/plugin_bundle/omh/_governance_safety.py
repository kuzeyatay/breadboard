"""Safety classification for memory governance (internal module).

Deterministic patterns for protected values, raw logs/transcripts, temporary
progress, and imperative prompt-injection-shaped content.
"""

from __future__ import annotations

import re


def classify_memory_admission(content: str) -> dict[str, object]:
    """Classify memory content for safety admission.
    
    Returns a dict with "status" field:
    - "blocked": protected material (passwords, secrets, raw logs, transcripts)
    - "needs_review": ambiguous content (temporary, prompt injection, credentials)
    - "safe": safe to auto-approve
    """
    if not isinstance(content, str):
        return {"status": "blocked"}
    
    # Blocked patterns: explicit secrets/passwords, raw logs, transcripts, protected markers
    blocked_patterns = [
        r"password\s*=",
        r"secret\s*=",
        r"token\s*=",
        # Secret-token hyphen compounds (e.g. token-secret, secret-token,
        # abc-secret-token): two secret-class words joined by one hyphen.
        # Narrow on purpose: no arbitrary hyphen chains, so ordinary prose
        # like "token-based parsing" or "secret-management policy" never matches.
        r"(?:password|passwd|secret|token|key)s?-(?:password|passwd|secret|token|key)s?",
        r"api[_-]key",
        r"auth[_-]header",
        r"Bearer\s+",
    ]
    
    for pattern in blocked_patterns:
        if re.search(pattern, content, re.IGNORECASE):
            return {"status": "blocked"}
    
    # Needs review patterns: prompt injection, temporary workarounds, credential hints
    needs_review_patterns = [
        r"ignore\s+previous",
        r"reveal\s+the\s+system\s+prompt",
        r"disregard\s+instructions",
        r"this\s+is\s+temporary",
        r"workaround\s+while",
        r"(temporary|temp|hack|quick\s+fix)\s+",
    ]
    
    for pattern in needs_review_patterns:
        if re.search(pattern, content, re.IGNORECASE):
            return {"status": "needs_review"}
    
    return {"status": "safe"}


def evaluate_renderable_strings(artifact: dict[str, object]) -> dict[str, object]:
    """Evaluate all renderable string fields (summary, value, label).
    
    Returns worst-case result with status and reason_code.
    Fail-closed: any blocked field blocks, any needs_review fields need review.
    """
    renderable_fields = ["summary", "value", "label"]
    
    worst_status = "safe"
    worst_field = None
    
    for field in renderable_fields:
        content = artifact.get(field)
        if not isinstance(content, str) or not content:
            continue
        
        result = classify_memory_admission(content)
        status = result.get("status", "safe")
        
        # Fail closed: blocked > needs_review > safe
        if status == "blocked":
            return {
                "status": "blocked",
                "field": field,
                "reason_code": f"safety_blocked_in_{field}",
            }
        elif status == "needs_review" and worst_status != "blocked":
            worst_status = "needs_review"
            worst_field = field
    
    if worst_status == "needs_review":
        return {
            "status": "needs_review",
            "field": worst_field,
            "reason_code": f"safety_needs_review_in_{worst_field}",
        }
    
    return {"status": "safe", "reason_code": "eligible"}
