"""Breadboard's bridge into the Harvey LAB harness.

Harvey LAB (`harvey-labs/`) is a legal-agent benchmark: a task corpus plus an
execution harness — a system prompt, six closed-workspace tools, and skill
manuals for producing .docx / .xlsx / .pptx. The harness is the valuable half
for us; Breadboard supplies the assignment and the documents instead of a
benchmark task, and keeps whatever the run produces as artifacts of the chat.

Three things this bridge has to reconcile, none of them obvious:

**No Podman.** The clone runs every tool inside a per-task rootless container,
which is right for grading an untrusted model against adversarial fixtures. Here
the documents are the user's own and the machine is theirs, so `HostSandbox`
re-implements the same interface over a per-run directory tree. It subclasses
the clone's `Sandbox`, so the path discipline that actually matters —
`assert_sandbox_path`, `is_writable`, the mount-escape check in `_to_host` — is
inherited rather than reimplemented: the `write` and `edit` tools still cannot
touch `documents/`, and no tool can address anything outside the run directory.

**`parse-doc` is a container entry point.** Reading a .docx/.pdf/.pptx/.xlsx
goes through `sandbox.exec("parse-doc …")`, which only resolves inside the
image. `HostSandbox.exec` intercepts that command and calls the clone's own
parser functions in-process, with one substitution: `.docx` falls back to
MarkItDown when pandoc is missing, because a legal agent that cannot read a Word
file is not an agent at all.

**The clone's loop has no hooks.** `run_agent` reports only when it is finished.
Rather than fork the loop, the adapter and the tool executor are subclassed to
emit NDJSON as they go, so the clone's own loop stays the authority on control
flow and the card still streams.

Protocol: one JSON job on stdin, NDJSON events on stdout. Every event has a
`type`; `completed` and `failed` are terminal. Kept in Breadboard's scripts/ so
the clone stays pristine and a `git pull` there never conflicts.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# ── Event stream ──────────────────────────────────────────────────────
#
# Written before anything else so an import failure below still reports as a
# `failed` event rather than a silent non-zero exit.

# Windows pipes inherit the locale encoding, and cp1252 happens to *have* an em
# dash — so a legal memo's punctuation goes out as a byte Node then reads as
# broken UTF-8, silently, with no error anywhere. Set here rather than trusted
# to the caller's environment: this is the process that owns the protocol.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover - already UTF-8
        pass


def emit(event_type: str, **payload: object) -> None:
    """Write one NDJSON event. Flushed so the card streams rather than jumps."""
    line = json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=str)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def fail(error: str, detail: str = "") -> None:
    emit("failed", error=error, detail=detail[-4000:])
    sys.exit(1)


def main() -> int:
    raw = sys.stdin.readline()
    if not raw.strip():
        fail("No job was sent to the legal bridge.")
    try:
        job = json.loads(raw)
    except json.JSONDecodeError as error:
        fail("The legal bridge could not read its job.", str(error))

    clone_root = Path(job["cloneRoot"]).resolve()
    sys.path.insert(0, str(clone_root))

    try:
        run(job, clone_root)
    except SystemExit:
        raise
    except BaseException as error:  # noqa: BLE001 - the last line of defence
        import traceback

        fail(f"{type(error).__name__}: {error}", traceback.format_exc())
    return 0


# ── Host-mode sandbox ─────────────────────────────────────────────────


def _build_host_sandbox(clone_root: Path):
    """Define HostSandbox against the clone's Sandbox, imported at call time."""
    from sandbox.sandbox import (  # noqa: PLC0415 - sys.path is set by main()
        DOCUMENTS_PATH,
        OUTPUT_PATH,
        WORKSPACE_PATH,
        ExecResult,
        Sandbox,
    )

    parsers_dir = clone_root / "sandbox" / "parsers"

    class HostSandbox(Sandbox):
        """The clone's Sandbox with the container swapped for the host.

        Everything that enforces the workspace boundary — `_to_host`,
        `assert_sandbox_path`, `is_writable`, `read_file`, `write_file`,
        `list_files`, `exists` — is inherited untouched and keeps working,
        because it was always host-path arithmetic. Only the three methods
        that actually speak to Podman are replaced.
        """

        def __init__(self, *args, shell: str | None = None, **kwargs):
            super().__init__(*args, **kwargs)
            self._shell = shell

        def start(self) -> None:
            self.documents_dir.mkdir(parents=True, exist_ok=True)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self.workspace_dir.mkdir(parents=True, exist_ok=True)
            self.container_name = None
            self._started = True

        def stop(self) -> None:
            self._started = False

        # ── Shell ─────────────────────────────────────────────────────

        def _env(self) -> dict[str, str]:
            env = dict(os.environ)
            for key, value in self.extra_env.items():
                env[key] = value
            # The agent is told to use these; in host mode they are real paths.
            env["WORKSPACE_DIR"] = _posix(self.workspace_dir)
            env["DOCUMENTS_DIR"] = _posix(self.documents_dir)
            env["OUTPUT_DIR"] = _posix(self.output_dir)
            env["PYTHONIOENCODING"] = "utf-8"
            env["PYTHONUTF8"] = "1"
            return env

        def _rewrite_paths(self, command: str) -> str:
            """Map the sandbox's canonical paths onto the real directories.

            The system prompt is written around `/workspace`, and a model that
            has seen this harness will reach for those paths out of habit. They
            are not directories here, so a literal command would fail for a
            reason the agent cannot see. Longest mount first — `/workspace`
            is a prefix of the other two.
            """
            for mount, host in (
                (DOCUMENTS_PATH, self.documents_dir),
                (OUTPUT_PATH, self.output_dir),
                (WORKSPACE_PATH, self.workspace_dir),
            ):
                command = command.replace(mount, _posix(host))
            return command

        def exec(self, command, *, cwd=WORKSPACE_PATH, timeout=None, env=None) -> ExecResult:
            self.assert_sandbox_path(cwd)
            timeout = timeout if timeout is not None else self.default_timeout

            parsed = _parse_doc_request(command)
            if parsed is not None:
                return self._parse_document(*parsed)

            if not self._shell:
                return ExecResult(
                    stdout="",
                    stderr=(
                        "No bash shell is available on this machine, so the `bash` tool "
                        "cannot run. Use read/write/edit/glob/grep instead."
                    ),
                    returncode=127,
                )

            merged = self._env()
            for key, value in (env or {}).items():
                merged[key] = value

            try:
                completed = subprocess.run(
                    [self._shell, "-c", self._rewrite_paths(command)],
                    cwd=str(self._to_host(cwd)),
                    env=merged,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired as expired:
                return ExecResult(
                    stdout=_text(expired.stdout),
                    stderr=_text(expired.stderr),
                    returncode=None,
                    timed_out=True,
                )
            except OSError as error:
                return ExecResult(stdout="", stderr=f"{type(error).__name__}: {error}", returncode=127)
            return ExecResult(
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
                returncode=completed.returncode,
            )

        # ── Document parsing ──────────────────────────────────────────

        def _parse_document(self, extension: str, sandbox_path: str) -> ExecResult:
            """Stand in for the image's `parse-doc` entry point.

            The clone's parser module is imported and used as-is for pdf, pptx
            and xlsx. Only .docx is special: the clone shells out to pandoc, and
            a machine without pandoc would then be unable to read the single
            most important file type in legal work, so MarkItDown covers it.
            """
            try:
                host = self._to_host(sandbox_path)
            except (ValueError, PermissionError) as error:
                return ExecResult(stdout="", stderr=str(error), returncode=1)
            if not host.exists():
                return ExecResult(stdout="", stderr=f"no such file: {sandbox_path}", returncode=1)

            try:
                sys.path.insert(0, str(parsers_dir))
                import parse_doc  # noqa: PLC0415 - resolved from the clone

                if extension == "docx":
                    return ExecResult(stdout=_parse_docx(parse_doc, host), stderr="", returncode=0)
                return ExecResult(
                    stdout=parse_doc.PARSERS[extension](str(host)), stderr="", returncode=0
                )
            except Exception as error:  # noqa: BLE001 - reported to the agent, not fatal
                return ExecResult(
                    stdout="", stderr=f"{type(error).__name__}: {error}", returncode=1
                )
            finally:
                if sys.path and sys.path[0] == str(parsers_dir):
                    sys.path.pop(0)

    return HostSandbox


_PARSE_DOC = re.compile(r"^\s*parse-doc\s+(docx|pdf|pptx|xlsx)\s+(?:'([^']*)'|\"([^\"]*)\"|(\S+))\s*$")


def _parse_doc_request(command: str) -> tuple[str, str] | None:
    """`parse-doc <fmt> <path>` — the one command that is not a real shell call."""
    match = _PARSE_DOC.match(command)
    if not match:
        return None
    return match.group(1), match.group(2) or match.group(3) or match.group(4)


def _parse_docx(parse_doc, host: Path) -> str:
    """Pandoc when it is there, MarkItDown when it is not."""
    if shutil.which("pandoc"):
        try:
            return parse_doc.parse_docx(str(host))
        except Exception:  # noqa: BLE001 - fall through to the reader that has no CLI
            pass
    from markitdown import MarkItDown  # noqa: PLC0415

    return MarkItDown().convert(str(host)).text_content


def _posix(path: Path) -> str:
    return str(path).replace("\\", "/")


def _text(value) -> str:
    if value is None:
        return ""
    return value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value)


# ── Streaming wrappers ────────────────────────────────────────────────


def _build_wrappers(clone_root: Path):
    from harness.adapters.openai import OpenAIAdapter  # noqa: PLC0415
    from harness.tools import ToolExecutor  # noqa: PLC0415

    class StreamingAdapter(OpenAIAdapter):
        """The clone's adapter, narrating each turn as it completes."""

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.turn = 0
            self.input_tokens = 0
            self.output_tokens = 0
            self.last_text = ""

        def chat(self, messages, tools):
            self.turn += 1
            emit("turn", turn=self.turn)
            response = super().chat(messages, tools)
            self.input_tokens += response.input_tokens
            self.output_tokens += response.output_tokens
            text = (response.text or "").strip()
            if text:
                self.last_text = text
                emit("text", turn=self.turn, text=text[:20_000])
            emit(
                "usage",
                inputTokens=self.input_tokens,
                outputTokens=self.output_tokens,
                turns=self.turn,
            )
            return response

    class StreamingToolExecutor(ToolExecutor):
        """The clone's executor, announcing each call and its outcome."""

        def execute(self, tool_name, arguments):
            call = f"{tool_name}-{self.bash_command_count}-{len(self.files_read)}-{time.monotonic_ns()}"
            emit("tool", phase="start", callId=call, name=tool_name, detail=_tool_detail(tool_name, arguments))
            result = super().execute(tool_name, arguments)
            failed = isinstance(result, str) and result.lstrip().startswith("Error")
            emit(
                "tool",
                phase="end",
                callId=call,
                name=tool_name,
                status="error" if failed else "ok",
                detail=_result_detail(result),
            )
            return result

    return StreamingAdapter, StreamingToolExecutor


def _arguments(arguments) -> dict:
    if isinstance(arguments, dict):
        return arguments
    try:
        parsed = json.loads(arguments)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _tool_detail(tool_name: str, arguments) -> str:
    """One line describing the call, for the run card's step list."""
    args = _arguments(arguments)
    if tool_name == "bash":
        return str(args.get("command", ""))[:300]
    if tool_name in ("read", "write", "edit"):
        return str(args.get("file_path") or args.get("path", ""))[:300]
    if tool_name == "glob":
        return str(args.get("pattern", ""))[:300]
    if tool_name == "grep":
        pattern = str(args.get("pattern", ""))
        where = str(args.get("path", "") or "")
        return (f"{pattern} · {where}" if where else pattern)[:300]
    return ""


def _result_detail(result) -> str:
    text = result if isinstance(result, str) else str(result)
    first = next((line for line in text.splitlines() if line.strip()), "")
    return first[:300]


# ── The run ───────────────────────────────────────────────────────────

# The clone's preamble describes a benchmark task and forbids reading the
# grading rubric. There is no rubric here, so that paragraph is dropped rather
# than left to describe a file the agent will never find.
_TASK_CONFIG_BLOCK = re.compile(
    r"\n- \*\*Task configuration\*\*.*?(?=\n\n|\n## )", re.DOTALL
)

_LEGAL_PREAMBLE = """You are a legal work agent operating inside Breadboard, working directly for
the person who gave you this assignment. This is real work product, not a
benchmark exercise.

How to work:

- Read the documents before drawing conclusions, and read all of them unless
  the assignment scopes you to some. `glob` first if you do not know what is
  there.
- Ground every substantive statement in the source: cite the document, and the
  clause, section, or page, so each conclusion can be checked.
- Where the documents do not settle a question, say so plainly and state the
  assumption you proceeded under. Do not invent facts, parties, dates, figures,
  or authorities, and do not cite a case, statute, or rule you have not read in
  the documents — you have no access to anything outside this workspace.
- When you are asked to mark up, redline, amend, or comment on a document you
  have been given, work from the original file rather than retyping it. Copy it
  into the output directory first and change the copy: the docx skill's
  `redline.py`, `comments_add.py`, `accept_changes.py` and `template_fill.py`
  all take a source document, and a marked-up copy of the real agreement is
  worth more than a clean re-draft that has quietly lost its formatting,
  numbering, defined terms and schedules.
- Produce the deliverable the assignment asks for, in the format it asks for.
  When no format is given, write `response.md`. Always finish with a
  `response.md` that states what you did, what you found, and what is open.
- Flag anything that looks like a genuine risk, an unusual term, or a drafting
  error, even when nobody asked about it.
- Your output is a draft prepared for a professional to review. It is not legal
  advice and should not be presented as a substitute for a qualified lawyer's
  judgement.

"""

_HOST_WORKSPACE_NOTE = """
## This machine

`bash` runs directly on the user's machine, not in a container: `$WORKSPACE_DIR`,
`$DOCUMENTS_DIR` and `$OUTPUT_DIR` are the real directories to use in shell
commands. There is no network access to rely on. `read`, `write`, `edit`,
`glob` and `grep` take paths relative to the workspace and resolve them for you,
which is the shortest path to everything below.
"""

_NO_SHELL_NOTE = """
## This machine

You have no `bash` tool on this run — the user has not granted it — so there is
no way to execute scripts, and the document skills are unavailable. Work with
`read`, `write`, `edit`, `glob` and `grep`, which take paths relative to the
workspace. Write your deliverables as markdown. If the assignment genuinely
requires producing a .docx, .xlsx or .pptx file, write the content as markdown
anyway and say in `response.md` that the binary format needed shell access.
"""


def run(job: dict, clone_root: Path) -> None:
    from harness.agent_loop import run_agent  # noqa: PLC0415
    from harness.tools import get_all_tool_definitions  # noqa: PLC0415

    host_sandbox_class = _build_host_sandbox(clone_root)
    adapter_class, executor_class = _build_wrappers(clone_root)

    workspace_dir = Path(job["workspaceDir"]).resolve()
    documents_dir = Path(job["documentsDir"]).resolve()
    output_dir = Path(job["outputDir"]).resolve()
    for directory in (workspace_dir, documents_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    # Applied to this process, not just the shell's: `parse-doc` looks for
    # pandoc through the bridge's own PATH, and the agent's `bash` inherits it.
    # The shim directory goes first, ahead of anything the machine already has.
    prefix = [str(_install_python_shims(workspace_dir)), *_path_prefix()]
    os.environ["PATH"] = os.pathsep.join([*prefix, os.environ.get("PATH", "")])

    skills = [name for name in job.get("skills") or [] if _is_skill(clone_root, name)]
    _install_skill_scripts(clone_root, skills, workspace_dir)

    allow_shell = bool(job.get("allowShell", True))
    system_prompt = _system_prompt(
        clone_root,
        skills,
        allow_shell=allow_shell,
        user_context=str(job.get("userContext") or ""),
    )
    documents = sorted(
        str(path.relative_to(documents_dir)).replace("\\", "/")
        for path in documents_dir.rglob("*")
        if path.is_file()
    )

    os.environ["OPENAI_BASE_URL"] = job["baseUrl"].rstrip("/")
    os.environ["OPENAI_API_KEY"] = job.get("apiKey") or "breadboard"

    sandbox = host_sandbox_class(
        documents_dir=documents_dir,
        output_dir=output_dir,
        workspace_dir=workspace_dir,
        default_timeout=int(job.get("shellTimeout") or 120),
        shell=_find_shell(),
    )
    sandbox.start()

    adapter = adapter_class(
        model=job["model"],
        temperature=float(job.get("temperature") or 0.0),
        reasoning_effort=job.get("reasoningEffort") or None,
    )
    executor = executor_class(sandbox=sandbox, shell_timeout=int(job.get("shellTimeout") or 120))

    # Withholding `bash` is the switch that stands in for the container the
    # benchmark runs in. It is withheld by not offering the tool at all rather
    # than by refusing the call, so the model never plans around a tool it
    # cannot use — and the skill scripts, which are invoked through bash, are
    # the visible cost of turning it off.
    tools = [
        tool for tool in get_all_tool_definitions() if allow_shell or tool["name"] != "bash"
    ]

    emit(
        "started",
        model=job["model"],
        documents=documents[:500],
        documentCount=len(documents),
        skills=skills,
        pandoc=bool(shutil.which("pandoc")),
        shell=allow_shell and bool(_find_shell()),
        tools=[tool["name"] for tool in tools],
    )

    started = time.time()
    try:
        result = run_agent(
            adapter=adapter,
            system_prompt=system_prompt,
            user_prompt=_assignment(job, documents),
            tool_executor=executor,
            tools=tools,
            max_turns=int(job.get("maxTurns") or 60),
            transcript_path=str(workspace_dir / "transcript.jsonl"),
        )
    except Exception as error:  # noqa: BLE001 - reported as a run failure
        import traceback

        sandbox.stop()
        fail(f"{type(error).__name__}: {error}", traceback.format_exc())
        return
    finally:
        sandbox.stop()

    files = _produced_files(output_dir)
    emit(
        "completed",
        answer=_answer(output_dir, adapter.last_text),
        files=files,
        turns=result["turn_count"],
        inputTokens=result["input_tokens"],
        outputTokens=result["output_tokens"],
        finishedCleanly=result["finished_cleanly"],
        contextOverflow=result.get("context_overflow", False),
        elapsedSec=round(time.time() - started, 2),
        metrics=result.get("tool_metrics", {}),
    )


def _assignment(job: dict, documents: list[str]) -> str:
    """The first user message: the assignment, then what is on the shelf.

    The shelf is described rather than listed. A bare filename does not say that
    a .docx is the *original* and can be rewritten, that the .extracted.md
    beside it holds the equations pandoc will not give back, or that the figures
    are real files that can be opened — and an agent that is not told those
    things reasonably assumes the opposite and writes a new document instead of
    marking up the one it was given.
    """
    parts = [job["task"].strip()]
    staged = job.get("documents") or []

    if staged:
        lines = []
        for entry in staged[:200]:
            name = entry.get("filename", "")
            if not name:
                continue
            notes = []
            if entry.get("description"):
                notes.append(entry["description"])
            if entry.get("editable"):
                notes.append("original file — edit this one in place to mark it up")
            line = f"- `{name}`" + (f" — {'; '.join(notes)}" if notes else "")
            if entry.get("extracted"):
                line += (
                    f"\n  - `{entry['extracted']}` — structured reading of the same "
                    "document: tables kept as tables, equations as LaTeX, tracked "
                    "changes marked `~~struck~~`, comments and footnotes gathered."
                )
            figures = entry.get("figures") or []
            if figures:
                shown = ", ".join(f"`{name}`" for name in figures[:8])
                more = "" if len(figures) <= 8 else f", and {len(figures) - 8} more"
                line += f"\n  - Figures: {shown}{more}"
            lines.append(line)
        listing = "\n".join(lines)
        parts.append(
            "## Documents provided\n\n"
            f"{listing}\n\n"
            "Read the original for what the document says. Read the `.extracted.md` "
            "for anything the original's plain-text reading loses — equations, table "
            "structure, and which passages are struck out rather than operative."
        )
    elif documents:
        listing = "\n".join(f"- {name}" for name in documents[:200])
        more = "" if len(documents) <= 200 else f"\n- …and {len(documents) - 200} more"
        parts.append(f"## Documents provided\n\n{listing}{more}")
    else:
        parts.append(
            "## Documents provided\n\nNone. Work from the assignment alone, and say so "
            "in your response if a document would have been needed."
        )
    return "\n\n".join(parts)


def _system_prompt(
    clone_root: Path,
    skills: list[str],
    *,
    allow_shell: bool,
    user_context: str = "",
) -> str:
    preamble = (clone_root / "harness" / "system_prompt.md").read_text(encoding="utf-8")
    preamble = _TASK_CONFIG_BLOCK.sub("", preamble)
    sections = [
        _LEGAL_PREAMBLE,
        preamble,
        _HOST_WORKSPACE_NOTE if allow_shell else _NO_SHELL_NOTE,
    ]
    # Background about the user, selected by Breadboard. It belongs here rather
    # than in the assignment: the assignment is the brief the agent must carry
    # out, and a memory that arrived there would read as part of the request.
    if user_context.strip():
        sections.append(f"\n\n{user_context.strip()}")
    # The skill manuals are written around scripts invoked through bash. With no
    # shell they would describe work the agent cannot do, so they are left out
    # and the one library-only route is named instead.
    if allow_shell:
        for name in skills:
            manual = clone_root / "harness" / "skills" / name / "SKILL.md"
            if manual.exists():
                sections.append(f"\n\n## Skill: {name}\n\n{manual.read_text(encoding='utf-8')}")
    return "\n".join(sections)


def _is_skill(clone_root: Path, name: object) -> bool:
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9_-]{1,40}", name):
        return False
    return (clone_root / "harness" / "skills" / name / "SKILL.md").exists()


def _install_skill_scripts(clone_root: Path, skills: list[str], workspace_dir: Path) -> None:
    for name in skills:
        scripts = clone_root / "harness" / "skills" / name / "scripts"
        if scripts.exists():
            shutil.copytree(scripts, workspace_dir / "skills" / name / "scripts", dirs_exist_ok=True)


def _produced_files(output_dir: Path) -> list[dict]:
    files = []
    for path in sorted(output_dir.rglob("*")):
        if not path.is_file():
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        files.append(
            {
                "path": str(path.relative_to(output_dir)).replace("\\", "/"),
                "bytes": size,
            }
        )
    return files[:200]


def _answer(output_dir: Path, last_text: str) -> str:
    """`response.md` is the harness's own convention for the written answer."""
    response = output_dir / "response.md"
    if response.exists():
        try:
            text = response.read_text(encoding="utf-8", errors="replace").strip()
            if text:
                return text[:400_000]
        except OSError:
            pass
    return (last_text or "").strip()[:400_000]


def _find_shell() -> str | None:
    """A real bash, preferring Git's over the WSL shim that cannot see the disk."""
    explicit = os.environ.get("LEGAL_AGENT_BASH")
    if explicit and Path(explicit).exists():
        return explicit
    candidates = [
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Git" / "bin" / "bash.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Git" / "usr" / "bin" / "bash.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    found = shutil.which("bash")
    # C:\Windows\System32\bash.exe is the WSL launcher: it starts a Linux shell
    # that cannot see the Windows workspace at the path we would hand it.
    if found and "system32" not in found.lower():
        return found
    return None


def _install_python_shims(workspace_dir: Path) -> Path:
    """Make `python` and `python3` mean *this* interpreter inside the shell.

    Every skill manual tells the agent to run `python scripts/…`, and a model
    that knows Windows reaches for `python3`. A venv's Scripts directory has a
    `python.exe` but no `python3.exe`, so under Git Bash `python3` falls through
    to the Windows Store stub — which prints "Python was not found" and exits 9009.
    Observed live: it cost two turns and a wrong-looking failure before the agent
    worked around it by hardcoding an absolute interpreter path.

    A shim directory in front of PATH fixes it for both names at once, and stays
    inside the run's own workspace rather than modifying the clone's venv.
    """
    bin_dir = workspace_dir / ".bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    interpreter = _posix(Path(sys.executable))
    for name in ("python", "python3"):
        shim = bin_dir / name
        shim.write_text(f'#!/bin/sh\nexec "{interpreter}" "$@"\n', encoding="utf-8", newline="\n")
        shim.chmod(0o755)
    return bin_dir


def _path_prefix() -> list[str]:
    """Directories the agent's shell needs on PATH: this venv, and pandoc."""
    prefix = [str(Path(sys.executable).parent)]
    try:
        import pypandoc  # noqa: PLC0415

        pandoc = Path(pypandoc.get_pandoc_path())
        candidate = pandoc if pandoc.exists() else pandoc.with_suffix(".exe")
        if candidate.exists():
            prefix.append(str(candidate.parent))
    except Exception:  # noqa: BLE001 - pandoc is a nice-to-have, not a dependency
        pass
    return prefix


if __name__ == "__main__":
    sys.exit(main())
