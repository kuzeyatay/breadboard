from __future__ import annotations

import json
import time
from typing import Any, Dict, List
from uuid import uuid4

from flask import Blueprint, Response, current_app, jsonify, make_response, request

from .config import BASE_INSTRUCTIONS, GPT5_CODEX_INSTRUCTIONS
from .council.gateway import (
    maybe_handle_responses_with_council,
    maybe_handle_with_council,
    recoverable_council_passthrough_guard,
)
from .council.unslop import maybe_unslop_instructions, maybe_unslop_messages
from .fast_mode import resolve_service_tier
from .external_responses import external_responses_response
from .limits import record_rate_limits_from_response
from .learn_strict_route import LearnStrictRouteError, consume_learn_strict_route
from .http import build_cors_headers
from .model_identity import with_resolved_model_identity
from .model_registry import list_public_models, uses_codex_instructions
from .model_telemetry import record_model_attempt
from .providers import dispatch as provider_dispatch
from .providers.registry import ResolvedModel, model_entries, resolve_model
from .providers.store import is_default_sentinel
from .responses_api import (
    ResponsesRequestError,
    aggregate_response_from_sse,
    extract_client_session_id,
    instructions_for_model,
    normalize_responses_payload,
    stream_upstream_bytes,
)
from .reasoning import (
    allowed_efforts_for_model,
    apply_reasoning_to_message,
    build_reasoning_param,
    request_reasoning_overrides,
)
from .session import (
    clear_responses_reuse_state,
    note_responses_final_response,
    note_responses_stream_event,
    prepare_responses_request_for_session,
)
from .upstream import normalize_model_name, start_upstream_raw_request, start_upstream_request
from .utils import (
    convert_chat_messages_to_responses_input,
    convert_tool_choice_chat_to_responses,
    convert_tools_chat_to_responses,
    sse_translate_chat,
    sse_translate_text,
    upstream_error_message,
)


openai_bp = Blueprint("openai", __name__)


def _log_json(prefix: str, payload: Any) -> None:
    try:
        print(f"{prefix}\n{json.dumps(payload, indent=2, ensure_ascii=False)}")
    except Exception:
        try:
            print(f"{prefix}\n{payload}")
        except Exception:
            pass


def _wrap_stream_logging(label: str, iterator, enabled: bool):
    if not enabled:
        return iterator

    def _gen():
        for chunk in iterator:
            try:
                text = (
                    chunk.decode("utf-8", errors="replace")
                    if isinstance(chunk, (bytes, bytearray))
                    else str(chunk)
                )
                print(f"{label}\n{text}")
            except Exception:
                pass
            yield chunk

    return _gen()


def _instructions_for_model(model: str) -> str:
    return instructions_for_model(current_app.config, model)


def _resolve_requested_model(
    requested_model: Any,
    *,
    strict_model_route: bool = False,
) -> tuple[ResolvedModel, Any, str]:
    """Map the client's model id onto a provider.

    Returns the resolution, the id to echo back to the client (a `default`
    sentinel is replaced by the model it expanded to, so responses never report
    a model nobody can look up), and the ChatGPT-normalized id for the legacy
    path. Resolution happens before `normalize_model_name` because that helper
    lowercases, which would corrupt case-sensitive third-party ids.
    """
    resolved = resolve_model(requested_model)
    echo_model = resolved.public_model if is_default_sentinel(requested_model) else requested_model
    chatgpt_model = normalize_model_name(
        resolved.upstream_model if resolved.is_chatgpt else requested_model,
        None if strict_model_route else current_app.config.get("DEBUG_MODEL"),
    )
    return resolved, echo_model, chatgpt_model


def _record_chatgpt_dispatch(
    *,
    endpoint: str,
    requested_model: str | None,
    resolved: ResolvedModel,
    upstream_model: str,
) -> str:
    """Persist the exact ChatGPT model before the upstream request starts."""
    request_id = f"mreq_{uuid4().hex}"
    record_model_attempt(
        request_id=request_id,
        endpoint=endpoint,
        requested_model=requested_model,
        resolved_model=resolved.public_model,
        upstream_model=upstream_model,
        provider=resolved.provider.id,
        outcome="dispatched",
        fallback=False,
    )
    return request_id


def _service_tier_from_payload(
    model: str,
    payload: Dict[str, Any],
    *,
    verbose: bool = False,
) -> tuple[str | None, Response | None]:
    resolution = resolve_service_tier(
        model,
        request_fast_mode=payload.get("fast_mode"),
        request_service_tier=payload.get("service_tier"),
        server_fast_mode=bool(current_app.config.get("FAST_MODE")),
    )
    if resolution.warning_message and verbose:
        print(f"[FastMode] {resolution.warning_message}")
    if resolution.error_message:
        err = {"error": {"message": resolution.error_message}}
        if verbose:
            _log_json("OUT POST service_tier resolution", err)
        resp = make_response(jsonify(err), 400)
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return None, resp
    return resolution.service_tier, None


def _take_learn_strict_route(payload: Dict[str, Any]) -> tuple[bool, Response | None]:
    """Consume Learn's internal single-provider dispatch policy.

    The flag is deliberately removed before any passthrough payload is built.
    Conflicting aliases or non-boolean values fail before Council/provider
    selection so no downstream request can observe a weaker interpretation.
    """
    try:
        value = consume_learn_strict_route(payload)
    except LearnStrictRouteError as exc:
        return False, make_response(
            jsonify({"error": {"message": str(exc)}}),
            400,
        )
    return value is True, None


def _force_strict_direct_council(payload: Dict[str, Any]) -> Response | None:
    camel_present = "councilModeOverride" in payload
    snake_present = "council_mode_override" in payload
    camel = payload.get("councilModeOverride")
    snake = payload.get("council_mode_override")
    if camel_present and snake_present and (
        type(camel) is not type(snake) or camel != snake
    ):
        return make_response(
            jsonify({"error": {"message": "Conflicting Council mode aliases for strict Learn routing."}}),
            400,
        )
    requested = camel if camel_present else snake if snake_present else None
    if requested is not None and requested != "direct_council":
        return make_response(
            jsonify({"error": {"message": "Strict Learn routing requires direct_council mode."}}),
            409,
        )
    payload.pop("council_mode_override", None)
    payload["councilModeOverride"] = "direct_council"
    return None


@openai_bp.route("/v1/chat/completions", methods=["POST"])
def chat_completions() -> Response:
    verbose = bool(current_app.config.get("VERBOSE"))
    verbose_obfuscation = bool(current_app.config.get("VERBOSE_OBFUSCATION"))
    reasoning_effort = current_app.config.get("REASONING_EFFORT", "medium")
    reasoning_summary = current_app.config.get("REASONING_SUMMARY", "auto")
    reasoning_compat = current_app.config.get("REASONING_COMPAT", "think-tags")

    raw = request.get_data(cache=True, as_text=True) or ""
    if verbose:
        try:
            print("IN POST /v1/chat/completions\n" + raw)
        except Exception:
            pass
    try:
        payload = json.loads(raw) if raw else {}
    except Exception:
        try:
            payload = json.loads(raw.replace("\r", "").replace("\n", ""))
        except Exception:
            err = {"error": {"message": "Invalid JSON body"}}
            if verbose:
                _log_json("OUT POST /v1/chat/completions", err)
            return jsonify(err), 400
    if not isinstance(payload, dict):
        return jsonify({"error": {"message": "Request body must be a JSON object"}}), 400
    learn_strict_route, strict_error = _take_learn_strict_route(payload)
    if strict_error is not None:
        return strict_error
    if learn_strict_route:
        direct_error = _force_strict_direct_council(payload)
        if direct_error is not None:
            return direct_error

    requested_model_alias = (
        payload.get("model") if isinstance(payload.get("model"), str) else None
    )
    if learn_strict_route and (
        requested_model_alias is None or is_default_sentinel(requested_model_alias)
    ):
        return jsonify({"error": {"message": "Strict Learn routing requires an explicit model."}}), 409
    resolved_model, requested_model, model = _resolve_requested_model(
        requested_model_alias,
        strict_model_route=learn_strict_route,
    )
    if learn_strict_route and resolved_model.is_unknown_external:
        return jsonify({"error": {"message": "Strict Learn routing requires a configured exact model route."}}), 409
    messages = payload.get("messages")
    if messages is None and isinstance(payload.get("prompt"), str):
        messages = [{"role": "user", "content": payload.get("prompt") or ""}]
    if messages is None and isinstance(payload.get("input"), str):
        messages = [{"role": "user", "content": payload.get("input") or ""}]
    if messages is None:
        messages = []
    if not isinstance(messages, list):
        err = {"error": {"message": "Request must include messages: []"}}
        if verbose:
            _log_json("OUT POST /v1/chat/completions", err)
        return jsonify(err), 400

    # Breadboard Council kernel: every normal chat request is council-mediated
    # (chatmock_ask -> CouncilRuntime). Tool-calling requests and explicit
    # opt-outs fall through to the legacy passthrough below.
    resolved_messages = with_resolved_model_identity(
        messages,
        model=resolved_model.public_model,
        provider=resolved_model.provider.id,
    )
    council_response = maybe_handle_with_council(
        payload,
        resolved_messages,
        requested_model=requested_model,
        model=model,
        requested_model_alias=requested_model_alias,
        strict_model_route=learn_strict_route,
        verbose=verbose,
    )
    if council_response is not None:
        return council_response

    # The council attaches the unslop writing skill to the answers it produces,
    # but it declines every tool-carrying request — which is every Hermes turn,
    # and therefore every Terminal/Garden/Quartz answer. Attach it here so the
    # product's most-read prose is written under the same rules.
    unslopped = maybe_unslop_messages(messages, payload)
    if unslopped is not messages:
        messages = unslopped
        resolved_messages = with_resolved_model_identity(
            messages,
            model=resolved_model.public_model,
            provider=resolved_model.provider.id,
        )

    # Council-bypassed requests (tool calls, explicit opt-outs) still have to
    # reach the provider that owns the model. Everything below this point is
    # ChatGPT Responses API translation, which only the ChatGPT upstream speaks.
    if not resolved_model.is_chatgpt:
        payload["messages"] = messages
        return provider_dispatch.chat_completion_response(
            resolved_model,
            payload,
            verbose=verbose,
            requested_model=requested_model_alias,
            endpoint="chat.completions",
            strict_route=learn_strict_route,
        )

    messages = resolved_messages

    if isinstance(messages, list):
        sys_idx = next((i for i, m in enumerate(messages) if isinstance(m, dict) and m.get("role") == "system"), None)
        if isinstance(sys_idx, int):
            sys_msg = messages.pop(sys_idx)
            content = sys_msg.get("content") if isinstance(sys_msg, dict) else ""
            messages.insert(0, {"role": "user", "content": content})
    is_stream = bool(payload.get("stream"))
    stream_options = payload.get("stream_options") if isinstance(payload.get("stream_options"), dict) else {}
    include_usage = bool(stream_options.get("include_usage", False))

    tools_responses = convert_tools_chat_to_responses(payload.get("tools"))
    has_function_web_search = any(
        isinstance(tool, dict)
        and tool.get("type") == "function"
        and tool.get("name") == "web_search"
        for tool in tools_responses
    )
    tool_choice = convert_tool_choice_chat_to_responses(payload.get("tool_choice", "auto"))
    parallel_tool_calls = bool(payload.get("parallel_tool_calls", False))
    responses_tools_payload = payload.get("responses_tools") if isinstance(payload.get("responses_tools"), list) else []
    extra_tools: List[Dict[str, Any]] = []
    had_responses_tools = False
    if isinstance(responses_tools_payload, list):
        for _t in responses_tools_payload:
            if not (isinstance(_t, dict) and isinstance(_t.get("type"), str)):
                continue
            if _t.get("type") not in ("web_search", "web_search_preview"):
                err = {
                    "error": {
                        "message": "Only web_search/web_search_preview are supported in responses_tools",
                        "code": "RESPONSES_TOOL_UNSUPPORTED",
                    }
                }
                if verbose:
                    _log_json("OUT POST /v1/chat/completions", err)
                return jsonify(err), 400
            extra_tools.append(_t)

        if (
            not extra_tools
            and not has_function_web_search
            and bool(current_app.config.get("DEFAULT_WEB_SEARCH"))
        ):
            responses_tool_choice = payload.get("responses_tool_choice")
            if not (isinstance(responses_tool_choice, str) and responses_tool_choice == "none"):
                extra_tools = [{"type": "web_search"}]

        if extra_tools:
            import json as _json
            MAX_TOOLS_BYTES = 32768
            try:
                size = len(_json.dumps(extra_tools))
            except Exception:
                size = 0
            if size > MAX_TOOLS_BYTES:
                err = {"error": {"message": "responses_tools too large", "code": "RESPONSES_TOOLS_TOO_LARGE"}}
                if verbose:
                    _log_json("OUT POST /v1/chat/completions", err)
                return jsonify(err), 400
            had_responses_tools = True
            tools_responses = (tools_responses or []) + extra_tools

    responses_tool_choice = payload.get("responses_tool_choice")
    if isinstance(responses_tool_choice, str) and responses_tool_choice in ("auto", "none"):
        tool_choice = responses_tool_choice

    input_items = convert_chat_messages_to_responses_input(messages)
    if not input_items and isinstance(payload.get("prompt"), str) and payload.get("prompt").strip():
        input_items = [
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": payload.get("prompt")}]}
        ]

    reasoning_param = build_reasoning_param(
        reasoning_effort,
        reasoning_summary,
        request_reasoning_overrides(payload, requested_model),
        allowed_efforts=allowed_efforts_for_model(model),
    )
    service_tier, tier_error = _service_tier_from_payload(model, payload, verbose=verbose)
    if tier_error is not None:
        return tier_error

    _record_chatgpt_dispatch(
        endpoint="chat.completions",
        requested_model=requested_model_alias,
        resolved=resolved_model,
        upstream_model=model,
    )

    upstream, error_resp = start_upstream_request(
        model,
        input_items,
        instructions=_instructions_for_model(model),
        tools=tools_responses,
        tool_choice=tool_choice,
        parallel_tool_calls=parallel_tool_calls,
        reasoning_param=reasoning_param,
        service_tier=service_tier,
        strict_single_attempt=learn_strict_route,
    )
    if error_resp is not None:
        if verbose:
            try:
                body = error_resp.get_data(as_text=True)
                if body:
                    try:
                        parsed = json.loads(body)
                    except Exception:
                        parsed = body
                    _log_json("OUT POST /v1/chat/completions", parsed)
            except Exception:
                pass
        return error_resp

    record_rate_limits_from_response(upstream)

    created = int(time.time())
    if upstream.status_code >= 400:
        try:
            raw = upstream.content
            err_body = json.loads(raw.decode("utf-8", errors="ignore")) if raw else {"raw": upstream.text}
        except Exception:
            err_body = {"raw": upstream.text}
        if had_responses_tools and upstream.status_code in (400, 422) and not learn_strict_route:
            if verbose:
                print("[Passthrough] Upstream rejected tools; retrying without extra tools (args redacted)")
            base_tools_only = convert_tools_chat_to_responses(payload.get("tools"))
            safe_choice = convert_tool_choice_chat_to_responses(payload.get("tool_choice", "auto"))
            upstream2, err2 = start_upstream_request(
                model,
                input_items,
                instructions=BASE_INSTRUCTIONS,
                tools=base_tools_only,
                tool_choice=safe_choice,
                parallel_tool_calls=parallel_tool_calls,
                reasoning_param=reasoning_param,
                service_tier=service_tier,
            )
            record_rate_limits_from_response(upstream2)
            if err2 is not None:
                # The repaired POST may have been accepted even though its
                # response was lost. Preserve that ambiguous transport failure
                # verbatim; returning the first request's deterministic 400/422
                # would invite a caller to submit the logical request again.
                return err2
            if upstream2 is not None and upstream2.status_code < 400:
                upstream = upstream2
            else:
                err = {
                    "error": {
                        "message": upstream_error_message(err_body),
                        "code": "RESPONSES_TOOLS_REJECTED",
                    }
                }
                if verbose:
                    _log_json("OUT POST /v1/chat/completions", err)
                return jsonify(err), (upstream2.status_code if upstream2 is not None else upstream.status_code)
        else:
            if verbose:
                print("Upstream error status=", upstream.status_code)
            err = {"error": {"message": upstream_error_message(err_body)}}
            if verbose:
                _log_json("OUT POST /v1/chat/completions", err)
            return jsonify(err), upstream.status_code

    if is_stream:
        if verbose:
            print("OUT POST /v1/chat/completions (streaming response)")
        stream_iter = sse_translate_chat(
            upstream,
            requested_model or model,
            created,
            verbose=verbose_obfuscation,
            vlog=print if verbose_obfuscation else None,
            reasoning_compat=reasoning_compat,
            include_usage=include_usage,
        )
        stream_iter = _wrap_stream_logging("STREAM OUT /v1/chat/completions", stream_iter, verbose)
        resp = Response(
            stream_iter,
            status=upstream.status_code,
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    full_text = ""
    reasoning_summary_text = ""
    reasoning_full_text = ""
    response_id = "chatcmpl"
    tool_calls: List[Dict[str, Any]] = []
    error_message: str | None = None
    usage_obj: Dict[str, int] | None = None

    def _extract_usage(evt: Dict[str, Any]) -> Dict[str, int] | None:
        try:
            usage = (evt.get("response") or {}).get("usage")
            if not isinstance(usage, dict):
                return None
            pt = int(usage.get("input_tokens") or 0)
            ct = int(usage.get("output_tokens") or 0)
            tt = int(usage.get("total_tokens") or (pt + ct))
            return {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt}
        except Exception:
            return None
    try:
        for raw in upstream.iter_lines(decode_unicode=False):
            if not raw:
                continue
            line = raw.decode("utf-8", errors="ignore") if isinstance(raw, (bytes, bytearray)) else raw
            if not line.startswith("data: "):
                continue
            data = line[len("data: "):].strip()
            if not data:
                continue
            if data == "[DONE]":
                break
            try:
                evt = json.loads(data)
            except Exception:
                continue
            kind = evt.get("type")
            mu = _extract_usage(evt)
            if mu:
                usage_obj = mu
            if isinstance(evt.get("response"), dict) and isinstance(evt["response"].get("id"), str):
                response_id = evt["response"].get("id") or response_id
            if kind == "response.output_text.delta":
                full_text += evt.get("delta") or ""
            elif kind == "response.reasoning_summary_text.delta":
                reasoning_summary_text += evt.get("delta") or ""
            elif kind == "response.reasoning_text.delta":
                reasoning_full_text += evt.get("delta") or ""
            elif kind == "response.output_item.done":
                item = evt.get("item") or {}
                if isinstance(item, dict) and item.get("type") == "function_call":
                    call_id = item.get("call_id") or item.get("id") or ""
                    name = item.get("name") or ""
                    args = item.get("arguments") or ""
                    if isinstance(call_id, str) and isinstance(name, str) and isinstance(args, str):
                        tool_calls.append(
                            {
                                "id": call_id,
                                "type": "function",
                                "function": {"name": name, "arguments": args},
                            }
                        )
            elif kind == "response.failed":
                error_message = evt.get("response", {}).get("error", {}).get("message", "response.failed")
            elif kind == "response.completed":
                break
    finally:
        upstream.close()

    if error_message:
        resp = make_response(jsonify({"error": {"message": error_message}}), 502)
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    message: Dict[str, Any] = {"role": "assistant", "content": full_text if full_text else None}
    if tool_calls:
        message["tool_calls"] = tool_calls
    message = apply_reasoning_to_message(message, reasoning_summary_text, reasoning_full_text, reasoning_compat)
    completion = {
        "id": response_id or "chatcmpl",
        "object": "chat.completion",
        "created": created,
        "model": requested_model or model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "stop",
            }
        ],
        **({"usage": usage_obj} if usage_obj else {}),
    }
    if verbose:
        _log_json("OUT POST /v1/chat/completions", completion)
    resp = make_response(jsonify(completion), upstream.status_code)
    for k, v in build_cors_headers().items():
        resp.headers.setdefault(k, v)
    return resp


@openai_bp.route("/v1/completions", methods=["POST"])
def completions() -> Response:
    verbose = bool(current_app.config.get("VERBOSE"))
    verbose_obfuscation = bool(current_app.config.get("VERBOSE_OBFUSCATION"))
    reasoning_effort = current_app.config.get("REASONING_EFFORT", "medium")
    reasoning_summary = current_app.config.get("REASONING_SUMMARY", "auto")

    raw = request.get_data(cache=True, as_text=True) or ""
    if verbose:
        try:
            print("IN POST /v1/completions\n" + raw)
        except Exception:
            pass
    try:
        payload = json.loads(raw) if raw else {}
    except Exception:
        err = {"error": {"message": "Invalid JSON body"}}
        if verbose:
            _log_json("OUT POST /v1/completions", err)
        return jsonify(err), 400

    if not isinstance(payload, dict):
        err = {"error": {"message": "Request body must be a JSON object"}}
        if verbose:
            _log_json("OUT POST /v1/completions", err)
        return jsonify(err), 400
    try:
        strict_value = consume_learn_strict_route(payload)
    except LearnStrictRouteError as exc:
        return jsonify({"error": {"message": str(exc)}}), 400
    if strict_value is not None:
        return jsonify({"error": {"message": "Learn strict routing is unsupported on /v1/completions."}}), 409
    recovery_guard = recoverable_council_passthrough_guard(payload)
    if recovery_guard is not None:
        return recovery_guard

    requested_model_alias = (
        payload.get("model") if isinstance(payload.get("model"), str) else None
    )
    resolved_model, requested_model, model = _resolve_requested_model(requested_model_alias)
    prompt = payload.get("prompt")
    if isinstance(prompt, list):
        prompt = "".join([p if isinstance(p, str) else "" for p in prompt])
    if not isinstance(prompt, str):
        prompt = payload.get("suffix") or ""
    stream_req = bool(payload.get("stream", False))
    stream_options = payload.get("stream_options") if isinstance(payload.get("stream_options"), dict) else {}
    include_usage = bool(stream_options.get("include_usage", False))

    messages = [{"role": "user", "content": prompt or ""}]

    # External providers serve the legacy text endpoint through their chat API;
    # the response is chat-shaped, which every current caller of this route
    # (OpenAI SDK compatibility shims) accepts.
    if not resolved_model.is_chatgpt:
        chat_payload = dict(payload)
        chat_payload["messages"] = messages
        chat_payload.pop("prompt", None)
        chat_payload.pop("suffix", None)
        return provider_dispatch.chat_completion_response(
            resolved_model,
            chat_payload,
            verbose=verbose,
            requested_model=requested_model_alias,
            endpoint="completions",
        )

    input_items = convert_chat_messages_to_responses_input(messages)

    reasoning_param = build_reasoning_param(
        reasoning_effort,
        reasoning_summary,
        request_reasoning_overrides(payload, requested_model),
        allowed_efforts=allowed_efforts_for_model(model),
    )
    service_tier, tier_error = _service_tier_from_payload(model, payload, verbose=verbose)
    if tier_error is not None:
        return tier_error
    _record_chatgpt_dispatch(
        endpoint="completions",
        requested_model=requested_model_alias,
        resolved=resolved_model,
        upstream_model=model,
    )
    upstream, error_resp = start_upstream_request(
        model,
        input_items,
        instructions=_instructions_for_model(model),
        reasoning_param=reasoning_param,
        service_tier=service_tier,
    )
    if error_resp is not None:
        if verbose:
            try:
                body = error_resp.get_data(as_text=True)
                if body:
                    try:
                        parsed = json.loads(body)
                    except Exception:
                        parsed = body
                    _log_json("OUT POST /v1/completions", parsed)
            except Exception:
                pass
        return error_resp

    record_rate_limits_from_response(upstream)

    created = int(time.time())
    if upstream.status_code >= 400:
        try:
            err_body = json.loads(upstream.content.decode("utf-8", errors="ignore")) if upstream.content else {"raw": upstream.text}
        except Exception:
            err_body = {"raw": upstream.text}
        err = {"error": {"message": upstream_error_message(err_body)}}
        if verbose:
            _log_json("OUT POST /v1/completions", err)
        return jsonify(err), upstream.status_code

    if stream_req:
        if verbose:
            print("OUT POST /v1/completions (streaming response)")
        stream_iter = sse_translate_text(
            upstream,
            requested_model or model,
            created,
            verbose=verbose_obfuscation,
            vlog=(print if verbose_obfuscation else None),
            include_usage=include_usage,
        )
        stream_iter = _wrap_stream_logging("STREAM OUT /v1/completions", stream_iter, verbose)
        resp = Response(
            stream_iter,
            status=upstream.status_code,
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    full_text = ""
    response_id = "cmpl"
    usage_obj: Dict[str, int] | None = None
    def _extract_usage(evt: Dict[str, Any]) -> Dict[str, int] | None:
        try:
            usage = (evt.get("response") or {}).get("usage")
            if not isinstance(usage, dict):
                return None
            pt = int(usage.get("input_tokens") or 0)
            ct = int(usage.get("output_tokens") or 0)
            tt = int(usage.get("total_tokens") or (pt + ct))
            return {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt}
        except Exception:
            return None
    try:
        for raw_line in upstream.iter_lines(decode_unicode=False):
            if not raw_line:
                continue
            line = raw_line.decode("utf-8", errors="ignore") if isinstance(raw_line, (bytes, bytearray)) else raw_line
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
            if isinstance(evt.get("response"), dict) and isinstance(evt["response"].get("id"), str):
                response_id = evt["response"].get("id") or response_id
            mu = _extract_usage(evt)
            if mu:
                usage_obj = mu
            kind = evt.get("type")
            if kind == "response.output_text.delta":
                full_text += evt.get("delta") or ""
            elif kind == "response.completed":
                break
    finally:
        upstream.close()

    completion = {
        "id": response_id or "cmpl",
        "object": "text_completion",
        "created": created,
        "model": requested_model or model,
        "choices": [
            {"index": 0, "text": full_text, "finish_reason": "stop", "logprobs": None}
        ],
        **({"usage": usage_obj} if usage_obj else {}),
    }
    if verbose:
        _log_json("OUT POST /v1/completions", completion)
    resp = make_response(jsonify(completion), upstream.status_code)
    for k, v in build_cors_headers().items():
        resp.headers.setdefault(k, v)
    return resp


@openai_bp.route("/v1/responses", methods=["POST"])
def responses_create() -> Response:
    verbose = bool(current_app.config.get("VERBOSE"))
    raw = request.get_data(cache=True, as_text=True) or ""
    if verbose:
        try:
            print("IN POST /v1/responses\n" + raw)
        except Exception:
            pass

    try:
        payload = json.loads(raw) if raw else {}
    except Exception:
        err = {"error": {"message": "Invalid JSON body"}}
        if verbose:
            _log_json("OUT POST /v1/responses", err)
        return jsonify(err), 400

    if not isinstance(payload, dict):
        err = {"error": {"message": "Request body must be a JSON object"}}
        if verbose:
            _log_json("OUT POST /v1/responses", err)
        return jsonify(err), 400
    try:
        strict_value = consume_learn_strict_route(payload)
    except LearnStrictRouteError as exc:
        return jsonify({"error": {"message": str(exc)}}), 400
    if strict_value is not None:
        return jsonify({"error": {"message": "Learn strict routing is unsupported on /v1/responses."}}), 409

    responses_model = resolve_model(payload.get("model"))
    if not responses_model.is_chatgpt:
        recovery_guard = recoverable_council_passthrough_guard(payload)
        if recovery_guard is not None:
            return recovery_guard
        return external_responses_response(responses_model, payload, verbose=verbose)

    payload = with_resolved_model_identity(
        payload,
        model=responses_model.public_model,
        provider=responses_model.provider.id,
    )

    # Breadboard Council kernel: text-only requests are council-mediated.
    # Tool/image/multimodal/session-bound requests keep the raw passthrough.
    # This call also strips council routing fields (taskType, gardenId, ...)
    # from the payload so the legacy path never forwards them upstream.
    council_response = maybe_handle_responses_with_council(payload, verbose=verbose)
    if council_response is not None:
        return council_response

    # Same reason as the chat-completions path: a bypassed Breadboard UI turn
    # (tools, a server-default web search, a continued session) still writes
    # prose a person reads, so it keeps the writing skill.
    unslopped_instructions = maybe_unslop_instructions(
        payload.get("instructions"), payload
    )
    if unslopped_instructions is not payload.get("instructions"):
        payload["instructions"] = unslopped_instructions

    try:
        normalization_payload = dict(payload)
        # Preserve the client's reasoning suffix, but never forward the
        # `default` sentinel to ChatGPT. The upstream must receive the model
        # ChatMock resolved at request time so telemetry and execution agree.
        # Resolved here rather than downstream because a `gpt-5.6-sol:high`
        # style suffix is only readable while the client's own model id is
        # still in place.
        reasoning_overrides = request_reasoning_overrides(
            payload,
            payload.get("model") if isinstance(payload.get("model"), str) else None,
        )
        normalization_payload["model"] = responses_model.upstream_model
        if reasoning_overrides is not None:
            normalization_payload["reasoning"] = reasoning_overrides
        normalized = normalize_responses_payload(
            normalization_payload,
            config=current_app.config,
            client_session_id=extract_client_session_id(request.headers),
        )
    except ResponsesRequestError as exc:
        err: Dict[str, Any] = {"error": {"message": str(exc)}}
        if exc.code:
            err["error"]["code"] = exc.code
        if verbose:
            _log_json("OUT POST /v1/responses", err)
        return jsonify(err), exc.status_code

    if normalized.service_tier_resolution.warning_message and verbose:
        print(f"[FastMode] {normalized.service_tier_resolution.warning_message}")

    prepared = prepare_responses_request_for_session(
        normalized.session_id,
        normalized.payload,
        allow_previous_response_id=False,
    )
    stream_req = bool(prepared.payload.get("stream", False))
    upstream_payload = dict(prepared.payload)
    upstream_payload["stream"] = True
    actual_upstream_model = upstream_payload.get("model")
    if not isinstance(actual_upstream_model, str) or not actual_upstream_model.strip():
        actual_upstream_model = responses_model.upstream_model
    _record_chatgpt_dispatch(
        endpoint="responses",
        requested_model=(
            payload.get("model") if isinstance(payload.get("model"), str) else None
        ),
        resolved=responses_model,
        upstream_model=actual_upstream_model,
    )
    upstream, error_resp = start_upstream_raw_request(
        upstream_payload,
        session_id=normalized.session_id,
        stream=True,
    )
    if error_resp is not None:
        clear_responses_reuse_state(normalized.session_id)
        if verbose:
            try:
                body = error_resp.get_data(as_text=True)
                if body:
                    try:
                        parsed = json.loads(body)
                    except Exception:
                        parsed = body
                    _log_json("OUT POST /v1/responses", parsed)
            except Exception:
                pass
        return error_resp

    record_rate_limits_from_response(upstream)

    if upstream.status_code >= 400:
        try:
            err_body = json.loads(upstream.content.decode("utf-8", errors="ignore")) if upstream.content else {"error": {"message": upstream.text}}
        except Exception:
            err_body = {"error": {"message": upstream.text or "Upstream error"}}
        finally:
            upstream.close()
        clear_responses_reuse_state(normalized.session_id)
        if verbose:
            _log_json("OUT POST /v1/responses", err_body)
        resp = make_response(jsonify(err_body), upstream.status_code)
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    if stream_req:
        if verbose:
            print("OUT POST /v1/responses (streaming response)")
        stream_iter = _wrap_stream_logging(
            "STREAM OUT /v1/responses",
            stream_upstream_bytes(
                upstream,
                on_event=lambda evt: note_responses_stream_event(normalized.session_id, evt),
            ),
            verbose,
        )
        resp = Response(
            stream_iter,
            status=upstream.status_code,
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    content_type = upstream.headers.get("Content-Type", "")
    if "application/json" in content_type.lower():
        try:
            body = upstream.json()
        except Exception:
            body = None
        finally:
            upstream.close()
        if isinstance(body, dict):
            note_responses_final_response(normalized.session_id, body)
            if verbose:
                _log_json("OUT POST /v1/responses", body)
            resp = make_response(jsonify(body), upstream.status_code)
            for k, v in build_cors_headers().items():
                resp.headers.setdefault(k, v)
            return resp

    response_obj, error_obj = aggregate_response_from_sse(
        upstream,
        on_event=lambda evt: note_responses_stream_event(normalized.session_id, evt),
    )
    if error_obj is not None:
        clear_responses_reuse_state(normalized.session_id)
        if verbose:
            _log_json("OUT POST /v1/responses", error_obj)
        resp = make_response(jsonify(error_obj), 502)
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    if response_obj is None:
        clear_responses_reuse_state(normalized.session_id)
        err = {"error": {"message": "Upstream response stream did not contain a completed response object"}}
        if verbose:
            _log_json("OUT POST /v1/responses", err)
        resp = make_response(jsonify(err), 502)
        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    if verbose:
        _log_json("OUT POST /v1/responses", response_obj)
    resp = make_response(jsonify(response_obj), upstream.status_code)
    for k, v in build_cors_headers().items():
        resp.headers.setdefault(k, v)
    return resp


@openai_bp.route("/v1/models", methods=["GET"])
def list_models() -> Response:
    expose_variants = bool(current_app.config.get("EXPOSE_REASONING_MODELS"))
    model_ids = list_public_models(expose_reasoning_models=expose_variants)
    # ChatGPT ids first (unchanged for existing clients), then one prefixed id
    # per model of every configured external provider.
    models = {"object": "list", "data": model_entries(model_ids)}
    resp = make_response(jsonify(models), 200)
    for k, v in build_cors_headers().items():
        resp.headers.setdefault(k, v)
    return resp
