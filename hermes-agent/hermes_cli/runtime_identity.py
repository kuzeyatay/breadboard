"""Read-only identity of the source loaded by this runtime, frozen at startup."""

import hashlib
from pathlib import Path


def source_identity(root):
    root = Path(root).resolve()
    files = list(root.glob("*.py"))
    for directory in ("agent", "tools", "hermes_cli", "tui_gateway", "gateway", "plugins", "providers", "cron", "acp_adapter"):
        for candidate in (root / directory).rglob("*"):
            if candidate.suffix not in {".py", ".yaml"}:
                continue
            if any(part in {"__pycache__", "tests", "test", ".venv"} for part in candidate.relative_to(root).parts):
                continue
            if candidate.is_file():
                files.append(candidate)
    digest = hashlib.sha256()
    for candidate in sorted(files, key=lambda value: value.relative_to(root).as_posix()):
        digest.update(candidate.relative_to(root).as_posix().encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(candidate.read_bytes().replace(b"\r\n", b"\n")).digest())
    return {"sourceRoot": str(root), "sourceSha256": digest.hexdigest()}


# Do not re-hash on a health request: changing files does not update already
# imported Python modules. An old process must keep reporting its old identity.
RUNTIME_SOURCE = source_identity(Path(__file__).resolve().parent.parent)
