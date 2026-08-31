"""Run the cloned OpenExecutive orchestrator as a bounded NDJSON worker."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any


def emit(event_type: str, **payload: Any) -> None:
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def configure(request: dict[str, Any]) -> tuple[Path, Path]:
    root = Path(str(request["root"])).resolve()
    state_root = Path(str(request["stateRoot"])).resolve()
    core = root / "packages" / "core"
    if not (core / "openexecutive" / "orchestrator" / "executive.py").is_file():
        raise RuntimeError("The OpenExecutive source closure is incomplete.")
    state_root.mkdir(parents=True, exist_ok=True)
    (state_root / "company").mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(core))

    model = str(request["model"])
    base_url = str(request["baseUrl"]).rstrip("/")
    effort = str(request.get("reasoningEffort") or "medium").lower()
    if effort == "none":
        effort = "low"
    fixed = {
        "LOCAL_MODELS_ENABLED": "true",
        "LOCAL_BASE_URL": base_url,
        "LOCAL_API_KEY": str(request["apiKey"]),
        "LOCAL_MODELS": model,
        "DEFAULT_MODEL": model,
        "DEEP_REASONING_MODEL": model,
        "ROUTING_MODEL": model,
        "RESEARCH_MODEL": model,
        "SPECIALIST_EFFORT": effort,
        "ENABLE_CACHING": "false",
        "ENABLE_WEB_SEARCH": "false",
        "MCP_ENABLED": "false",
        "SCHEDULER_ENABLED": "false",
        "HONCHO_ENABLED": "false",
        "OPENROUTER_ENABLED": "false",
        "VECTOR_STORE_PATH": str(state_root / "chroma"),
        "COMPANY_PROFILE_PATH": str(state_root / "company" / "profile.yaml"),
        "EPISODIC_DB_PATH": str(state_root / "openexecutive.db"),
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
        "NO_COLOR": "1",
    }
    os.environ.update(fixed)
    os.environ.pop("ANTHROPIC_API_KEY", None)
    return root, state_root


async def run(request: dict[str, Any]) -> None:
    root, _state_root = configure(request)
    os.chdir(root)

    from openexecutive.knowledge.retriever import retrieve
    from openexecutive.memory.episodic import format_for_prompt, initialize_db
    from openexecutive.onboarding.profile_builder import load_or_create_profile
    from openexecutive.orchestrator.executive import Executive
    from openexecutive.orchestrator.session import Session

    task = str(request.get("task") or "").strip()
    conversation_context = str(request.get("conversationContext") or "").strip()
    prompt = task
    if conversation_context:
        prompt = (
            "Conversation context (background only; the assignment follows):\n"
            f"{conversation_context}\n\nAssignment:\n{task}"
        )

    emit("progress", stage="context", summary="Loading company and decision context")
    initialize_db()
    profile = load_or_create_profile()
    session = Session(company_profile=profile if not profile.is_empty() else None)
    try:
        retrieved = retrieve(query=task)
    except Exception as exc:  # Retrieval is useful, never a launch precondition.
        retrieved = ""
        emit("progress", stage="knowledge", summary=f"Knowledge index unavailable: {exc}")
    try:
        episodic = format_for_prompt()
    except Exception:
        episodic = ""

    committee = bool(request.get("committeeReview"))
    emit(
        "progress",
        stage="routing",
        summary=(
            "Drafting with committee review"
            if committee
            else "Routing the brief to the executive team"
        ),
    )
    executive = Executive()
    method = (
        executive.stream_chat_with_committee
        if committee
        else executive.stream_chat
    )
    response = ""
    async for chunk in method(
        user_message=prompt,
        session=session,
        retrieved_context=retrieved,
        episodic_context=episodic,
        max_iterations=int(request.get("maxIterations") or 15),
    ):
        if isinstance(chunk, str):
            if chunk == Executive._THINKING:
                emit("progress", stage="specialists", summary="Consulting specialist executives")
                continue
            response += chunk
            emit("delta", text=chunk)
        elif isinstance(chunk, dict):
            label = str(chunk.get("type") or chunk.get("event") or "executive activity")
            emit("progress", stage="activity", summary=label.replace("_", " "))
    emit("completed", summary=response.strip())


def main() -> None:
    request = json.load(sys.stdin)
    asyncio.run(run(request))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"openexecutive bridge: {exc}", file=sys.stderr, flush=True)
        raise
