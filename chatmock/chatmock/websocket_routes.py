from __future__ import annotations

import json
from typing import Any, Dict

from flask import current_app, request
from flask_sock import Sock
from websockets.exceptions import ConnectionClosed

from .council.gateway import recoverable_council_binding_values
from .learn_strict_route import LearnStrictRouteError, consume_learn_strict_route
from .responses_api import (
    ResponsesRequestError,
    extract_client_session_id,
    normalize_responses_payload,
)
from .session import (
    clear_responses_reuse_state,
    note_responses_stream_event,
    prepare_responses_request_for_session,
)
from .upstream import (
    build_upstream_headers,
    build_upstream_websocket_url,
    connect_upstream_websocket,
)
from .utils import get_effective_chatgpt_auth


def _log_json(prefix: str, payload: Any) -> None:
    try:
        print(f"{prefix}\n{json.dumps(payload, indent=2, ensure_ascii=False)}")
    except Exception:
        try:
            print(f"{prefix}\n{payload}")
        except Exception:
            pass


def _error_event(message: str, *, status_code: int = 400, code: str | None = None) -> Dict[str, Any]:
    error: Dict[str, Any] = {"message": message}
    if code:
        error["code"] = code
    return {"type": "error", "status_code": status_code, "error": error}


def _is_terminal_event(event: Any) -> bool:
    if not isinstance(event, dict):
        return False
    kind = event.get("type")
    return kind in (
        "response.completed",
        "response.incomplete",
        "response.failed",
        "error",
    )


def register_websocket_routes(sock: Sock) -> None:
    @sock.route("/v1/responses")
    def responses_websocket(ws) -> None:
        verbose = bool(current_app.config.get("VERBOSE"))
        upstream_ws = None
        upstream_session_id: str | None = None
        active_session_id: str | None = None

        def _send_error(message: str, *, status_code: int = 400, code: str | None = None) -> None:
            evt = _error_event(message, status_code=status_code, code=code)
            if verbose:
                _log_json("STREAM OUT WS /v1/responses (error)", evt)
            try:
                ws.send(json.dumps(evt))
            except Exception:
                pass

        try:
            while True:
                incoming = ws.receive()
                if incoming is None:
                    break

                if isinstance(incoming, bytes):
                    incoming_text = incoming.decode("utf-8", errors="ignore")
                else:
                    incoming_text = str(incoming)
                if verbose:
                    print("IN WS /v1/responses\n" + incoming_text)

                try:
                    payload = json.loads(incoming_text)
                except Exception:
                    _send_error("Websocket frames must be valid JSON objects.", status_code=400)
                    break

                if not isinstance(payload, dict):
                    _send_error("Websocket frames must be JSON objects.", status_code=400)
                    break

                try:
                    strict_value = consume_learn_strict_route(payload)
                except LearnStrictRouteError as exc:
                    _send_error(str(exc), status_code=400, code="learn_strict_route_invalid")
                    return
                if strict_value is not None:
                    _send_error(
                        "Learn strict routing is unsupported over websocket transport.",
                        status_code=409,
                        code="learn_strict_route_unsupported",
                    )
                    return

                # The websocket proxy has no durable receipt/finalization
                # boundary. Parse the same strict aliases as both HTTP Council
                # entrypoints before auth, upstream connect, or send so a
                # recoverable request can never silently cross this transport.
                recoverable_binding, binding_error = recoverable_council_binding_values(
                    payload
                )
                if binding_error is not None:
                    body = binding_error.get_json(silent=True) or {}
                    detail = body.get("error") if isinstance(body, dict) else None
                    message = (
                        detail.get("message")
                        if isinstance(detail, dict)
                        and isinstance(detail.get("message"), str)
                        else "Invalid recoverable Council request binding."
                    )
                    code = (
                        detail.get("code")
                        if isinstance(detail, dict)
                        and isinstance(detail.get("code"), str)
                        else None
                    )
                    _send_error(
                        message,
                        status_code=binding_error.status_code,
                        code=code,
                    )
                    return
                if recoverable_binding is not None:
                    _send_error(
                        "Recoverable Council requests are not supported over websocket transport.",
                        status_code=409,
                        code="recoverable_transport_unsupported",
                    )
                    return

                client_session_id = extract_client_session_id(request.headers)
                outbound_text = incoming_text
                session_id = upstream_session_id

                if payload.get("type") == "response.create":
                    try:
                        normalized = normalize_responses_payload(
                            payload,
                            config=current_app.config,
                            client_session_id=client_session_id,
                        )
                    except ResponsesRequestError as exc:
                        _send_error(str(exc), status_code=exc.status_code, code=exc.code)
                        continue

                    if normalized.service_tier_resolution.warning_message and verbose:
                        print(f"[FastMode] {normalized.service_tier_resolution.warning_message}")
                    prepared = prepare_responses_request_for_session(
                        normalized.session_id,
                        normalized.payload,
                        allow_previous_response_id=True,
                    )
                    outbound_text = json.dumps(prepared.payload)
                    session_id = normalized.session_id
                    active_session_id = normalized.session_id
                    if verbose:
                        _log_json("OUTBOUND >> ChatGPT Responses WS payload", prepared.payload)
                elif upstream_ws is None:
                    _send_error(
                        "The first websocket message must be a response.create request.",
                        status_code=400,
                    )
                    break

                if upstream_ws is None or (session_id and session_id != upstream_session_id):
                    access_token, account_id = get_effective_chatgpt_auth()
                    if not access_token or not account_id:
                        if session_id:
                            clear_responses_reuse_state(session_id)
                        _send_error(
                            "Missing ChatGPT credentials. Run 'python3 chatmock.py login' first.",
                            status_code=401,
                        )
                        break

                    if upstream_ws is not None:
                        try:
                            upstream_ws.close()
                        except Exception:
                            pass

                    effective_session_id = session_id or client_session_id or ""
                    try:
                        upstream_ws = connect_upstream_websocket(
                            build_upstream_websocket_url(),
                            build_upstream_headers(
                                access_token,
                                account_id,
                                effective_session_id,
                                accept="application/json",
                            ),
                        )
                    except Exception as exc:
                        if session_id:
                            clear_responses_reuse_state(session_id)
                        _send_error(
                            f"Upstream websocket connection failed: {exc}",
                            status_code=502,
                        )
                        break
                    upstream_session_id = effective_session_id

                upstream_ws.send(outbound_text)

                while True:
                    try:
                        upstream_message = upstream_ws.recv()
                    except ConnectionClosed:
                        if active_session_id:
                            clear_responses_reuse_state(active_session_id)
                        _send_error("Upstream websocket closed unexpectedly.", status_code=502)
                        return
                    if upstream_message is None:
                        if active_session_id:
                            clear_responses_reuse_state(active_session_id)
                        _send_error("Upstream websocket closed unexpectedly.", status_code=502)
                        return
                    if verbose:
                        try:
                            print("STREAM OUT WS /v1/responses\n" + str(upstream_message))
                        except Exception:
                            pass
                    ws.send(upstream_message)

                    try:
                        parsed = json.loads(upstream_message)
                    except Exception:
                        parsed = None
                    if isinstance(parsed, dict) and active_session_id:
                        note_responses_stream_event(active_session_id, parsed)
                    if _is_terminal_event(parsed):
                        if isinstance(parsed, dict) and parsed.get("type") in ("response.failed", "error"):
                            if upstream_ws is not None:
                                try:
                                    upstream_ws.close()
                                except Exception:
                                    pass
                            upstream_ws = None
                            upstream_session_id = None
                        break
        finally:
            if upstream_ws is not None:
                try:
                    upstream_ws.close()
                except Exception:
                    pass
