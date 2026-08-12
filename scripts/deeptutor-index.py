"""Build or refresh one Deep Tutor knowledge base, reporting NDJSON.

A knowledge base is what turns Deep Tutor from a tutor that greps your notes
into one that retrieves from them: DeepTutor auto-mounts its `rag` tool the
moment a turn names a KB, and retrieval is over vectors rather than words, so
"what happens when I measure too infrequently" finds the note on sampling rate.

Indexing is a separate process from a tutoring turn on purpose. It is minutes
of CPU for a Garden of any size, and making a learner wait for it before their
first answer would be the wrong trade — Breadboard runs this in the background
and the turn uses the file tools until the index is ready.

Vectors come from ChatMock's `/v1/embeddings`, configured into the home before
we are called. Nothing here knows or cares which backend serves them.

Protocol: the job is one JSON object on stdin; every event is one JSON object
on stdout. stderr stays free for tracebacks. Event types:

    started    {kb, documents, rebuild}
    progress   {stage, message, percent}
    completed  {kb, documents, chunks, elapsedSec}
    failed     {error, detail}
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import time
import traceback
from pathlib import Path
from typing import Any

CLONE_ROOT = Path(os.environ.get("DEEPTUTOR_CLONE_ROOT", "")).resolve()
if str(CLONE_ROOT) not in sys.path:
    sys.path.insert(0, str(CLONE_ROOT))


def emit(event_type: str, **payload: Any) -> None:
    line = json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=str)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def read_job() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("no job was sent on stdin")
    job = json.loads(raw)
    if not isinstance(job, dict):
        raise ValueError("the job must be a JSON object")
    return job


def knowledge_root(home: Path) -> Path:
    """Where the CLI keeps knowledge bases, so `deeptutor kb list` sees ours."""
    return home / "data" / "knowledge_bases"


async def build(job: dict[str, Any]) -> int:
    from deeptutor.knowledge.initializer import initialize_knowledge_base
    from deeptutor.knowledge.manager import KnowledgeBaseManager
    from deeptutor.knowledge.naming import validate_knowledge_base_name
    from deeptutor.logging import configure_logging

    configure_logging()

    home = Path(str(job.get("home") or "")).resolve()
    name = validate_knowledge_base_name(str(job.get("kb") or ""))
    documents = [Path(str(item)) for item in (job.get("documents") or [])]
    documents = [item for item in documents if item.is_file()]
    if not documents:
        emit("failed", error="There is nothing to index in this scope yet.", detail="")
        return 1

    base_dir = knowledge_root(home)
    base_dir.mkdir(parents=True, exist_ok=True)
    manager = KnowledgeBaseManager(base_dir=str(base_dir))

    # Always a full rebuild. DeepTutor can add documents to a live KB, but it
    # cannot *remove* one, and a tutor citing a note the learner deleted is
    # worse than a slower index. Gardens are small enough that this is seconds
    # to a few minutes.
    rebuild = name in manager.list_knowledge_bases()
    if rebuild:
        try:
            manager.delete_knowledge_base(name, confirm=True)
        except Exception:
            # Falling back to the directory keeps a half-registered KB from
            # blocking every future build.
            shutil.rmtree(base_dir / name, ignore_errors=True)

    emit("started", kb=name, documents=len(documents), rebuild=rebuild)
    started = time.time()

    # Progress is polled from the manager's own status rather than invented:
    # the initializer writes stage/percent as it parses, chunks and embeds.
    stop = asyncio.Event()

    async def watch() -> None:
        last = ""
        while not stop.is_set():
            try:
                status = manager.get_kb_status(name) or {}
                progress = status.get("progress") or {}
                signature = f"{progress.get('stage')}|{progress.get('percent')}"
                if signature != last and progress:
                    last = signature
                    emit(
                        "progress",
                        stage=str(progress.get("stage") or ""),
                        message=str(progress.get("message") or ""),
                        percent=progress.get("percent") or 0,
                    )
            except Exception:
                pass
            try:
                await asyncio.wait_for(stop.wait(), timeout=1.5)
            except asyncio.TimeoutError:
                continue

    watcher = asyncio.create_task(watch())
    try:
        await initialize_knowledge_base(
            kb_name=name,
            source_files=[str(item) for item in documents],
            base_dir=str(base_dir),
        )
    finally:
        stop.set()
        await watcher

    info: dict[str, Any] = {}
    try:
        info = manager.get_info(name) or {}
    except Exception:
        info = {}
    statistics = info.get("statistics") or {}
    emit(
        "completed",
        kb=name,
        documents=int(statistics.get("raw_documents") or len(documents)),
        chunks=chunk_count(statistics),
        elapsedSec=round(time.time() - started, 1),
    )
    return 0


def chunk_count(statistics: dict[str, Any]) -> int:
    """How many passages the index actually holds.

    Upstream reports this as ``doc_count`` on an index *version* — which counts
    LlamaIndex nodes, not source documents, despite the name. Read from the
    version whose signature is the active one so a leftover failed build cannot
    inflate the number.
    """
    versions = statistics.get("index_versions")
    if not isinstance(versions, list):
        return 0
    active = str(statistics.get("active_signature") or "")
    ready = [entry for entry in versions if isinstance(entry, dict) and entry.get("ready")]
    for entry in ready:
        if active and str(entry.get("signature") or "") == active:
            return int(entry.get("doc_count") or 0)
    return int(ready[-1].get("doc_count") or 0) if ready else 0


def main() -> int:
    try:
        job = read_job()
    except Exception as exc:
        emit("failed", error=f"The indexing request could not be read: {exc}", detail="")
        return 2

    home = str(job.get("home") or "").strip()
    if home:
        # Set before any deeptutor import: the workspace root is resolved at
        # import time and every knowledge-base path hangs off it.
        os.environ["DEEPTUTOR_HOME"] = home

    try:
        return asyncio.run(build(job))
    except KeyboardInterrupt:
        emit("failed", error="Indexing was interrupted.", detail="")
        return 130
    except Exception as exc:
        emit(
            "failed",
            error=str(exc) or exc.__class__.__name__,
            detail=traceback.format_exc()[-4000:],
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
