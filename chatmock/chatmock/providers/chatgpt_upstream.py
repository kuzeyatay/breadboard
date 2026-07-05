from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from ..config import BASE_INSTRUCTIONS, GPT5_CODEX_INSTRUCTIONS
from ..limits import record_rate_limits_from_response
from ..model_registry import allowed_efforts_for_model, normalize_model_name, uses_codex_instructions
from ..reasoning import build_reasoning_param
from ..upstream import start_upstream_request
from ..utils import convert_chat_messages_to_responses_input
from .types import ModelCall, ProviderError


class ChatGptUpstreamProvider:
    """Council provider that reuses ChatMock's existing ChatGPT OAuth upstream.

    This keeps the council fully functional with zero extra configuration:
    Breadboard never calls a model provider directly, and every council seat is
    filled by the ChatGPT upstream through ChatMock.

    Mirrors the legacy /v1/chat/completions behavior: client system prompts
    are demoted to a leading user message and ChatMock's own base instructions
    are sent as `instructions` (the ChatGPT backend requires them).
    """

    def __init__(self, reasoning_effort: str | None = None, reasoning_summary: str | None = None) -> None:
        # Match the server's reasoning defaults (same env vars the CLI reads).
        self.reasoning_effort = (
            reasoning_effort
            or os.getenv("CHATGPT_LOCAL_REASONING_EFFORT", "medium").lower()
        )
        self.reasoning_summary = (
            reasoning_summary
            or os.getenv("CHATGPT_LOCAL_REASONING_SUMMARY", "auto").lower()
        )

    def call_model(self, call: ModelCall) -> str:
        model = normalize_model_name(call.model)

        messages: List[Dict[str, Any]] = []
        if isinstance(call.system, str) and call.system.strip():
            messages.append({"role": "user", "content": call.system})
        for msg in call.messages or []:
            if isinstance(msg, dict) and msg.get("role") == "system":
                messages.append({"role": "user", "content": msg.get("content")})
            else:
                messages.append(msg)

        input_items = convert_chat_messages_to_responses_input(messages)
        instructions = (
            GPT5_CODEX_INSTRUCTIONS
            if uses_codex_instructions(model) and isinstance(GPT5_CODEX_INSTRUCTIONS, str) and GPT5_CODEX_INSTRUCTIONS.strip()
            else BASE_INSTRUCTIONS
        )
        reasoning_param = build_reasoning_param(
            self.reasoning_effort,
            self.reasoning_summary,
            None,
            allowed_efforts=allowed_efforts_for_model(model),
        )

        upstream, error_resp = start_upstream_request(
            model,
            input_items,
            instructions=instructions,
            reasoning_param=reasoning_param,
        )
        if error_resp is not None or upstream is None:
            raise ProviderError(f"chatgpt upstream unavailable for {model}")
        record_rate_limits_from_response(upstream)
        if upstream.status_code >= 400:
            try:
                upstream.close()
            except Exception:
                pass
            raise ProviderError(f"chatgpt upstream returned HTTP {upstream.status_code} for {model}")

        full_text = ""
        reasoning_text = ""
        error_message: str | None = None
        try:
            for raw in upstream.iter_lines(decode_unicode=False):
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="ignore") if isinstance(raw, (bytes, bytearray)) else raw
                if not line.startswith("data: "):
                    continue
                data = line[len("data: "):].strip()
                if not data or data == "[DONE]":
                    if data == "[DONE]":
                        break
                    continue
                try:
                    evt = json.loads(data)
                except Exception:
                    continue
                kind = evt.get("type")
                if kind == "response.output_text.delta":
                    full_text += evt.get("delta") or ""
                elif kind in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
                    # The model's "thinking" trace, streamed alongside the answer.
                    reasoning_text += evt.get("delta") or ""
                elif kind == "response.failed":
                    error_message = (
                        (evt.get("response", {}) or {}).get("error", {}) or {}
                    ).get("message", "response.failed")
                elif kind == "response.completed":
                    break
        finally:
            try:
                upstream.close()
            except Exception:
                pass

        if error_message:
            raise ProviderError(f"chatgpt upstream failed for {model}: {error_message}")
        # Expose the reasoning trace to the caller via the out-param.
        if reasoning_text.strip():
            call.reasoning_out = reasoning_text.strip()
        return full_text
