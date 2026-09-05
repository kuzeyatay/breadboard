from __future__ import annotations

"""OpenAI chat-completions facade backed by the official Claude Code CLI.

Claude Pro/Max credentials are deliberately owned and refreshed by Claude
Code.  This module does not open ``~/.claude/.credentials.json`` and does not
reimplement Anthropic OAuth.  It asks the signed-in CLI for one constrained
model decision, then translates that decision to the OpenAI-shaped response
Hermes already consumes.

Only ``cliproxy/claude-*`` models are routed here by ``providers.dispatch``.
Every other subscription continues through CLIProxyAPI unchanged.
"""

import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterator, List

import requests

from . import pxpipe
from .store import ResolvedCredentials
from .types import ModelCall, ProviderError

# One Claude Code call has to cover everything Breadboard asks a model for, so
# the budget is set by the slowest legitimate turn rather than the common one.
# The in-chat visualizer is that turn: it asks for a complete three-file mini-app
# as a single structured tool argument. Replaying one end to end took 265s and
# 25.7k output tokens for a short conversation at default effort, and real turns
# are heavier still — tens of thousands of input tokens and ``--effort high``.
#
# The previous 240s ceiling stopped that generation roughly twenty seconds from
# done. Nothing downstream can tell a cut-off answer from a broken one, so Hermes
# spent all three of its retries re-running the same doomed call: one visualizer
# request became thirteen minutes of silence and then the timeout as the answer.
#
# The ceiling stays below the OpenAI client's own ten-minute default — Hermes
# configures no provider timeout — so a CLI that really is stuck still comes back
# as the explanation below instead of the client's bare read timeout.
_DEFAULT_REQUEST_TIMEOUT_SECONDS = 540
_MIN_REQUEST_TIMEOUT_SECONDS = 30
_MAX_REQUEST_TIMEOUT_SECONDS = 570
_MAX_TOOL_CALLS = 16


def _request_timeout_seconds() -> int:
    """The wall-clock budget for one CLI call, overridable for slower machines."""
    try:
        value = int(os.environ.get("CHATMOCK_CLAUDE_CODE_TIMEOUT_SECONDS", ""))
    except (TypeError, ValueError):
        return _DEFAULT_REQUEST_TIMEOUT_SECONDS
    return max(_MIN_REQUEST_TIMEOUT_SECONDS, min(_MAX_REQUEST_TIMEOUT_SECONDS, value))


def is_claude_model(model: object) -> bool:
    normalized = str(model or "").strip().lower()
    if normalized.startswith("cliproxy/"):
        normalized = normalized.split("/", 1)[1]
    return normalized.startswith("claude-")


def claude_executable_candidates(env: Dict[str, str] | None = None) -> List[Path]:
    """Every fixed location the official CLI installs to, most specific first.

    This list mirrors ``fixedClaudeCommand`` in the dashboard's Claude account
    worker, which is what decides that Claude Code is "installed". The two must
    agree: the worker once found the CLI under a managed home
    (``%APPDATA%\\SPB_Data\\.local\\bin``) that this probe never looked at, so the
    dashboard offered Claude models the gateway then refused with "not
    installed". ChatMock runs on a closed PATH under the runtime, so ``which``
    alone cannot be relied on.
    """
    env = os.environ if env is None else env
    name = "claude.exe" if os.name == "nt" else "claude"
    candidates: List[Path] = []
    configured = (env.get("CLAUDE_CLI_PATH") or "").strip()
    if configured:
        candidates.append(Path(configured))
    homes: List[Path] = []
    for variable in ("USERPROFILE", "HOME"):
        value = (env.get(variable) or "").strip()
        if value and Path(value) not in homes:
            homes.append(Path(value))
    try:
        if Path.home() not in homes:
            homes.append(Path.home())
    except (RuntimeError, OSError):
        pass
    for home in homes:
        candidates.append(home / ".local" / "bin" / name)
        if os.name != "nt":
            candidates.append(home / ".claude" / "local" / "claude")
    if os.name == "nt":
        app_data = (env.get("APPDATA") or "").strip()
        local_app_data = (env.get("LOCALAPPDATA") or "").strip()
        if app_data:
            # Managed Windows profiles relocate HOME under APPDATA.
            candidates.append(Path(app_data) / "SPB_Data" / ".local" / "bin" / name)
            candidates.append(Path(app_data) / "npm" / "claude.cmd")
        if local_app_data:
            candidates.append(Path(local_app_data) / "Programs" / "claude" / name)
    elif os.sys.platform == "darwin":
        candidates.extend([Path("/opt/homebrew/bin/claude"), Path("/usr/local/bin/claude")])
    else:
        candidates.append(Path("/usr/local/bin/claude"))
    seen: set[str] = set()
    unique: List[Path] = []
    for candidate in candidates:
        key = str(candidate).lower() if os.name == "nt" else str(candidate)
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    return unique


def _claude_executable() -> str:
    configured = os.environ.get("CLAUDE_CLI_PATH", "").strip()
    executable = shutil.which(configured) if configured else None
    if not executable:
        executable = next(
            (str(path) for path in claude_executable_candidates() if path.is_file()),
            None,
        )
    if not executable:
        executable = shutil.which("claude")
    if executable:
        return executable
    raise ProviderError(
        "Claude Code is not installed or is not on Breadboard's PATH. "
        "Install the official Claude Code CLI and run `claude auth login`, "
        "or set CLAUDE_CLI_PATH to the claude executable."
    )


_IMAGE_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _image_part_url(part: Any) -> str | None:
    """Return the URL when ``part`` is an image content part, else None."""
    if not isinstance(part, dict):
        return None
    kind = part.get("type")
    if kind == "image_url":
        image_url = part.get("image_url")
        if isinstance(image_url, dict):
            return str(image_url.get("url") or "")
        if isinstance(image_url, str):
            return image_url
    if kind == "input_image":
        image_url = part.get("image_url")
        if isinstance(image_url, str):
            return image_url
    return None


def _extract_image_files(
    messages: List[Any], temp_dir: str
) -> tuple[List[Any], int]:
    """Replace image content parts with files the CLI's Read tool can view.

    The conversation reaches the CLI as stdin prompt text, so a data URL kept
    inline arrives as tens of thousands of tokens of base64 the model can only
    describe, never see. Claude Code's Read tool renders image files natively,
    so the bytes are written into the CLI's cwd and the part becomes a pointer.
    Copy-on-write: the caller's payload is shared with dispatch's failover
    chain, which must keep the original image parts for non-CLI substitutes.
    """
    extracted = 0
    out: List[Any] = []
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list) or all(
            _image_part_url(part) is None for part in content
        ):
            out.append(message)
            continue
        parts: List[Any] = []
        for part in content:
            url = _image_part_url(part)
            if url is None:
                parts.append(part)
                continue
            replacement = "[image attachment unavailable]"
            if url.startswith("data:"):
                header, _, encoded = url.partition(",")
                media_type = header[5:].split(";", 1)[0].strip().lower()
                try:
                    data = base64.b64decode(encoded)
                except ValueError:
                    data = b""
                if data:
                    extracted += 1
                    suffix = _IMAGE_EXTENSIONS.get(media_type, ".png")
                    path = Path(temp_dir) / f"attachment-{extracted}{suffix}"
                    path.write_bytes(data)
                    replacement = (
                        f"[Attached image {extracted}: view it with the Read tool at {path}]"
                    )
            elif url:
                replacement = f"[image at {url} — remote fetch is unavailable]"
            parts.append({"type": "text", "text": replacement})
        out.append({**message, "content": parts})
    return out, extracted


def _function_tools(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    tools = payload.get("tools")
    if not isinstance(tools, list):
        return out
    for tool in tools:
        function = tool.get("function") if isinstance(tool, dict) else None
        name = function.get("name") if isinstance(function, dict) else None
        if not isinstance(name, str) or not name.strip():
            continue
        parameters = function.get("parameters")
        out.append(
            {
                "name": name.strip(),
                "description": str(function.get("description") or ""),
                "parameters": (
                    parameters
                    if isinstance(parameters, dict)
                    else {"type": "object", "properties": {}}
                ),
            }
        )
    return out


def _tool_choice(payload: Dict[str, Any], available: List[str]) -> tuple[List[str], bool, bool]:
    """Return (allowed names, tools required, tools forbidden)."""
    choice = payload.get("tool_choice", "auto")
    if choice == "none" or not available:
        return available, False, True
    if choice == "required":
        return available, True, False
    if isinstance(choice, dict):
        function = choice.get("function")
        name = function.get("name") if isinstance(function, dict) else None
        if isinstance(name, str) and name in available:
            return [name], True, False
    return available, False, False


def _output_schema(payload: Dict[str, Any], tools: List[Dict[str, Any]]) -> Dict[str, Any]:
    names = [tool["name"] for tool in tools]
    allowed, required, forbidden = _tool_choice(payload, names)
    name_schema: Dict[str, Any] = {"type": "string"}
    if allowed:
        name_schema["enum"] = allowed

    tool_calls: Dict[str, Any] = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "name": name_schema,
                "arguments": {"type": "object"},
            },
            "required": ["name", "arguments"],
            "additionalProperties": False,
        },
        "maxItems": 0 if forbidden else _MAX_TOOL_CALLS,
    }
    if required:
        tool_calls["minItems"] = 1

    return {
        "type": "object",
        "properties": {
            "content": {"type": "string"},
            "tool_calls": tool_calls,
        },
        "required": ["content", "tool_calls"],
        "additionalProperties": False,
    }


def _system_prompt(
    payload: Dict[str, Any], tools: List[Dict[str, Any]], image_count: int = 0
) -> str:
    choice = payload.get("tool_choice", "auto")
    return "\n".join(
        [
            "You are the inference model for Bread, the Breadboard assistant, inside the Hermes agent loop.",
            "The user-facing assistant's name is Bread. Hermes, ChatMock, Claude Code, the provider, and the model are runtime details, not the assistant's name.",
            "The JSON document supplied on stdin is the complete chronological conversation.",
            "Honor its system, developer, user, assistant, and tool-result roles exactly.",
            # The CLI receives the whole conversation as prompt text, so the
            # envelope is visible to the model as if the user had typed it.
            # Without these rules it answers the scaffolding: a plain greeting
            # came back with an unrequested lecture about routing aliases.
            "The envelope itself — JSON syntax, brackets, role labels, ids, model and provider fields — is transport scaffolding. Read it, never describe, quote, correct, or remark on it.",
            "System and developer content are directives to follow silently. They are not user speech, so never reply to them, fact-check them, or push back on them.",
            "Answer only what the newest user message actually asks, and nothing beside it. Never append unrequested notes about the conversation format, the runtime, the model, the provider, or routing aliases; mention those only when that message asks about them.",
            (
                "Attached images are saved as files; when a message points at an attached image file, view it with the Read tool before answering about it. Do not use Claude Code's other filesystem, shell, web, plugins, skills, or MCP tools."
                if image_count
                else "Do not use Claude Code's filesystem, shell, web, plugins, skills, or MCP tools; they are disabled."
            ),
            "Select Breadboard functions only from AVAILABLE_FUNCTIONS when they are needed.",
            "Return requested functions in tool_calls and never claim a function result before its tool-result message exists.",
            "When no function is needed, return the user-facing answer in content and an empty tool_calls array.",
            "When functions are needed, content may be empty or contain a short lead-in.",
            f"TOOL_CHOICE={json.dumps(choice, ensure_ascii=False, separators=(',', ':'))}",
            "AVAILABLE_FUNCTIONS="
            + json.dumps(tools, ensure_ascii=False, separators=(",", ":")),
        ]
    )


def _parse_cli_result(stdout: str, stderr: str, returncode: int) -> Dict[str, Any]:
    body: Any = None
    try:
        body = json.loads(stdout)
    except (TypeError, json.JSONDecodeError):
        # Be tolerant of a launcher warning before the JSON result while never
        # scraping or exposing Claude's credential store.
        for line in reversed((stdout or "").splitlines()):
            try:
                body = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

    if isinstance(body, dict) and returncode == 0 and body.get("is_error") is not True:
        structured = body.get("structured_output")
        if not isinstance(structured, dict):
            result = body.get("result")
            if isinstance(result, str):
                try:
                    structured = json.loads(result)
                except json.JSONDecodeError:
                    structured = None
        if isinstance(structured, dict):
            body["structured_output"] = structured
            return body

    details: List[str] = []
    if isinstance(body, dict):
        errors = body.get("errors")
        if isinstance(errors, list):
            details.extend(str(item) for item in errors if str(item).strip())
        result = body.get("result")
        if isinstance(result, str) and result.strip():
            details.append(result.strip())
    if stderr.strip():
        details.append(stderr.strip())
    message = " ".join(details).strip()
    if not message:
        message = "Claude Code returned no structured response."
    if "not logged" in message.lower() or "auth login" in message.lower():
        message = "Claude Code is not signed in. Run `claude auth login`, then refresh Breadboard."
    raise ProviderError(message[:2000])


def _run_cli(payload: Dict[str, Any], model: str) -> Dict[str, Any]:
    executable = _claude_executable()
    tools = _function_tools(payload)
    schema = _output_schema(payload, tools)
    messages = payload.get("messages")
    if not isinstance(messages, list):
        messages = []

    with tempfile.TemporaryDirectory(prefix="breadboard-claude-") as temp_dir:
        messages, image_count = _extract_image_files(messages, temp_dir)
        prompt_path = Path(temp_dir) / "system-prompt.txt"
        prompt_path.write_text(
            _system_prompt(payload, tools, image_count), encoding="utf-8"
        )
        try:
            prompt_path.chmod(0o600)
        except OSError:
            pass

        command = [
            executable,
            "-p",
            "--model",
            # `claude-fable-5-efficient` names a Breadboard route, not a model
            # the CLI could ask for; it is served by plain Fable through the
            # pxpipe proxy configured below.
            pxpipe.upstream_model(model),
            "--output-format",
            "json",
            # Structured output is implemented as an SDK tool round-trip. Give
            # it room to validate/retry without enabling an autonomous tool
            # loop; each attached image costs one more Read round-trip.
            "--max-turns",
            "6" if image_count else "3",
            # Read is the one tool the CLI may use, and only when images were
            # extracted above: it is how the model gets pixels instead of
            # base64 prompt text. cwd is the throwaway temp_dir.
            "--tools",
            "Read" if image_count else "",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--system-prompt-file",
            str(prompt_path),
            "--json-schema",
            json.dumps(schema, ensure_ascii=False, separators=(",", ":")),
            "Return the next assistant decision for the JSON conversation supplied on stdin.",
        ]
        effort = str(payload.get("reasoning_effort") or "").strip().lower()
        if effort in {"low", "medium", "high", "xhigh", "max"}:
            command[4:4] = ["--effort", effort]
        env = os.environ.copy()
        env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
        env["NO_COLOR"] = "1"
        if pxpipe.is_efficient_model(model):
            # The whole of the efficient route: the CLI sends its request to a
            # loopback proxy that images the bulky parts before forwarding them
            # to Anthropic. The subscription credential still belongs to Claude
            # Code and travels untouched — pxpipe passes its OAuth bearer
            # through rather than holding a key of its own.
            env["ANTHROPIC_BASE_URL"] = pxpipe.base_url()
        budget = _request_timeout_seconds()
        try:
            completed = subprocess.run(
                command,
                input=json.dumps(messages, ensure_ascii=False, separators=(",", ":")),
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                cwd=temp_dir,
                env=env,
                timeout=budget,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            # This sentence becomes the assistant's answer, so it names the limit
            # that was actually hit: a reader who sees only "timed out" cannot
            # tell a request that needs more room from one that will never finish.
            raise ProviderError(
                f"Claude Code was still working after {budget} seconds and had to be "
                "stopped. Ask for a smaller piece of work, or allow more time with "
                "CHATMOCK_CLAUDE_CODE_TIMEOUT_SECONDS."
            ) from exc
        except OSError as exc:
            raise ProviderError(f"Claude Code could not be started: {exc}") from exc

    return _parse_cli_result(completed.stdout, completed.stderr, completed.returncode)


def _usage(body: Dict[str, Any]) -> Dict[str, Any]:
    raw = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    input_tokens = int(raw.get("input_tokens") or 0)
    cache_read = int(raw.get("cache_read_input_tokens") or 0)
    cache_write = int(raw.get("cache_creation_input_tokens") or 0)
    output_tokens = int(raw.get("output_tokens") or 0)
    prompt_tokens = input_tokens + cache_read + cache_write
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": prompt_tokens + output_tokens,
        "prompt_tokens_details": {"cached_tokens": cache_read},
    }


def _completion(body: Dict[str, Any], public_model: str) -> Dict[str, Any]:
    structured = body["structured_output"]
    content = structured.get("content")
    if not isinstance(content, str):
        content = ""
    raw_calls = structured.get("tool_calls")
    tool_calls: List[Dict[str, Any]] = []
    if isinstance(raw_calls, list):
        for raw in raw_calls:
            if not isinstance(raw, dict):
                continue
            name = raw.get("name")
            arguments = raw.get("arguments")
            if not isinstance(name, str) or not isinstance(arguments, dict):
                continue
            tool_calls.append(
                {
                    "id": f"call_{uuid.uuid4().hex}",
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(
                            arguments, ensure_ascii=False, separators=(",", ":")
                        ),
                    },
                }
            )

    message: Dict[str, Any] = {
        "role": "assistant",
        "content": content or None,
    }
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": public_model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if tool_calls else "stop",
            }
        ],
        "usage": _usage(body),
    }


def _stream(completion: Dict[str, Any], include_usage: bool) -> Iterator[bytes]:
    base = {
        "id": completion["id"],
        "object": "chat.completion.chunk",
        "created": completion["created"],
        "model": completion["model"],
    }
    message = completion["choices"][0]["message"]
    frames: List[Dict[str, Any]] = [
        {**base, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}
    ]
    if message.get("content"):
        frames.append(
            {
                **base,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": message["content"]},
                        "finish_reason": None,
                    }
                ],
            }
        )
    for index, call in enumerate(message.get("tool_calls") or []):
        frames.append(
            {
                **base,
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": index,
                                    "id": call["id"],
                                    "type": "function",
                                    "function": call["function"],
                                }
                            ]
                        },
                        "finish_reason": None,
                    }
                ],
            }
        )
    frames.append(
        {
            **base,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": completion["choices"][0]["finish_reason"],
                }
            ],
        }
    )
    if include_usage:
        frames.append({**base, "choices": [], "usage": completion["usage"]})
    for frame in frames:
        yield f"data: {json.dumps(frame, ensure_ascii=False, separators=(',', ':'))}\n\n".encode(
            "utf-8"
        )
    yield b"data: [DONE]\n\n"


def _response(content: bytes, content_type: str) -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    response.headers["Content-Type"] = content_type
    response.encoding = "utf-8"
    response._content = content
    # This response was produced locally rather than read from urllib3. Mark
    # the byte buffer consumed so requests.iter_lines() slices it instead of
    # trying to read a nonexistent raw network stream.
    response._content_consumed = True
    response.url = "claude-code://local"
    return response


def request_chat(
    _credentials: ResolvedCredentials,
    payload: Dict[str, Any],
    upstream_model: str,
    *,
    stream: bool,
    allow_preconnect_retry: bool = True,
) -> requests.Response:
    body = _run_cli(payload, upstream_model)
    completion = _completion(body, upstream_model)
    if stream:
        stream_options = payload.get("stream_options")
        include_usage = bool(
            isinstance(stream_options, dict) and stream_options.get("include_usage")
        )
        content = b"".join(_stream(completion, include_usage))
        return _response(content, "text/event-stream")
    return _response(
        json.dumps(completion, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        "application/json",
    )


def call_model(
    call: ModelCall,
    credentials: ResolvedCredentials,
    upstream_model: str,
) -> str:
    messages: List[Dict[str, Any]] = []
    if isinstance(call.system, str) and call.system.strip():
        messages.append({"role": "system", "content": call.system})
    messages.extend(call.messages or [])
    payload: Dict[str, Any] = {"messages": messages}
    response = request_chat(credentials, payload, upstream_model, stream=False)
    body = response.json()
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderError("Claude Code returned an unexpected response.") from exc
    if not isinstance(content, str):
        raise ProviderError("Claude Code returned no text.")
    return content
