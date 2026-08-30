from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
import subprocess
import time
from typing import Any, Callable, Iterable, Mapping, Sequence

from ..runtime.artifacts import append_journal_observation, create_run, show_run
from ..system.local_store import atomic_write_json, locked_json_update, utc_now
from ..system.metadata_safety import redact_metadata_text
from ..system.paths import OmhPaths
from .executor_readiness import probe_executor_readiness
from .fanout_contracts import FANOUT_CLAIM_BOUNDARY
from .inflight import InflightMarkerError, clear_inflight_marker, write_inflight_marker
from .unit_prompt_protocol import unit_protocol_lines
from .unit_telemetry import parse_unit_telemetry

FANOUT_DISPATCH_SCHEMA_VERSION = "fanout_dispatch_summary/v1"
DISPATCH_CLAIM_BOUNDARY = (
    "A dispatch summary records observed local subprocess activity only. It is not verification, review, CI, "
    "merge-readiness, or merge evidence, and omh never merges unit branches itself."
)
EXECUTOR_LIMIT_SIGNALS_SCHEMA_VERSION = "executor_limit_signals/v1"
EXECUTOR_LIMIT_SIGNALS_CLAIM_BOUNDARY = (
    "A limit signal records that one observed local dispatch failure matched a rate/usage-limit shape. "
    "It is not provider quota truth, not an entitlement statement, and it expires as evidence the moment "
    "the provider state changes."
)

# Deterministic limit-shape patterns, matched case-insensitively over the
# in-memory stdout/stderr tails of a FAILED spawn only. Only the boolean and
# the matched label are persisted — never the matched text itself. Every
# pattern is anchored to limit context: bare "429" or "quota" would match a
# stack-trace line number or a disk-quota message and fabricate provider
# evidence from unrelated text.
_LIMIT_SHAPED_PATTERNS: tuple[tuple[str, str], ...] = (
    ("rate_limit", "rate limit"),
    ("usage_limit", "usage limit"),
    ("quota_exceeded", "quota exceed"),
    ("quota_exceeded", "quota exhaust"),
    ("quota_exceeded", "api quota"),
    ("http_429", "status 429"),
    ("http_429", "error 429"),
    ("http_429", "http 429"),
    ("http_429", "429 too many"),
    ("credit", "insufficient credit"),
    ("credit", "out of credits"),
    ("limit_reached", "limit reached"),
)

# Spawnability is a data property: profiles listed here have a local headless
# CLI template. Every other profile (hermes, omx/omo/omc runtimes, generic,
# unassigned) gets a prepared-prompt fallback and is never spawned.
DISPATCH_COMMAND_TEMPLATES: dict[str, tuple[str, ...]] = {
    "codex": ("codex", "exec", "{prompt}"),
    # acceptEdits alone lets Claude edit files but blocks the `git add/commit`
    # the unit prompt asks for (observed in the first live dispatch);
    # allowedTools grants exactly those two git verbs, nothing broader.
    "claude-code": (
        "claude",
        "-p",
        "{prompt}",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Bash(git add:*),Bash(git commit:*)",
    ),
    # omo ships as an extension of a pi-family host CLI (usually `pi`;
    # `senpi` is a distribution of it with the same headless surface) or of
    # opencode. The host is DETECTED at dispatch time in a fixed order —
    # see OMO_RUNTIME_HOST_CANDIDATES — and the placeholder below is
    # replaced by the detected host's template; no personal stack is
    # hardcoded. The pi/senpi surface was validated in a live bridge
    # dispatch (2026-07, senpi): `--print --no-session` completes
    # non-interactively with clean exit codes on failure, and the
    # `workspace` permission preset allowed file creation plus exactly the
    # `git add`/`git commit` the unit prompt asks for. The opencode
    # template is prepared from `opencode run --help` (model/variant flags
    # verified locally); its permission behavior validates on first live
    # dispatch, claude-template precedent.
    "omo-runtime": (
        "senpi",
        "--print",
        "--no-session",
        "--permission-preset",
        "workspace",
        "{prompt}",
    ),
}

# Fixed detection order for the omo runtime's local host CLI: first on PATH
# wins ("usually pi" — user-stated common case; senpi is a pi distribution;
# opencode hosts omo as a plugin). Both layouts — pi-family host CLI and
# opencode plugin — are first-class dispatch hosts. Detection is
# presence-only and recorded implicitly by argv[0]/probe command. Model
# CONFIG, by contrast, is currently read only from the opencode config path
# (see MODEL_INVENTORY_CATALOG_PROFILE in model_inventory): a pi-only
# install still dispatches, but its routes degrade to `no_model_catalog`.
OMO_RUNTIME_HOST_CANDIDATES: tuple[str, ...] = ("pi", "senpi", "opencode")

_OMO_HOST_TEMPLATES: dict[str, dict[str, tuple[str, ...] | int | None]] = {
    "pi": {
        "argv": ("pi", "--print", "--no-session", "--permission-preset", "workspace", "{prompt}"),
        "model": ("--model", "{model}"),
        "effort": ("--thinking", "{effort}"),
        "insert": 5,
    },
    "senpi": {
        "argv": ("senpi", "--print", "--no-session", "--permission-preset", "workspace", "{prompt}"),
        "model": ("--model", "{model}"),
        "effort": ("--thinking", "{effort}"),
        "insert": 5,
    },
    "opencode": {
        "argv": ("opencode", "run", "{prompt}"),
        "model": ("--model", "{model}"),
        "effort": ("--variant", "{effort}"),
        "insert": 2,
    },
}


def omo_runtime_host(which: Callable[[str], str | None] | None = None) -> str | None:
    """Return the first omo host CLI present on PATH, or None.

    The default resolves `shutil.which` at CALL time (a def-time default
    would freeze the binding and make the probe untestable/unpatchable).
    """
    resolved_which = shutil.which if which is None else which
    for candidate in OMO_RUNTIME_HOST_CANDIDATES:
        if resolved_which(candidate):
            return candidate
    return None


# Model routing is prepared metadata on the unit handoff; these fragments turn
# it into argv only at dispatch time. Codex takes options before the prompt
# positional; claude accepts them anywhere, so they append after the pinned
# base argv to keep the no-route argv byte-identical to the template.
DISPATCH_MODEL_OPTION_TEMPLATES: dict[str, tuple[str, ...]] = {
    "codex": ("--model", "{model}"),
    "claude-code": ("--model", "{model}"),
    # senpi takes `provider/model` ids — exactly the form inventory-derived
    # routes carry.
    "omo-runtime": ("--model", "{model}"),
}
DISPATCH_REASONING_OPTION_TEMPLATES: dict[str, tuple[str, ...]] = {
    # `-c` values parse as TOML with a raw-string fallback, so a bare effort
    # level is accepted verbatim (verified against `codex exec --help`).
    "codex": ("--config", "model_reasoning_effort={effort}"),
    "claude-code": ("--effort", "{effort}"),
    # senpi's thinking levels (off|minimal|low|medium|high|xhigh|max) are a
    # superset of the effort ladder, so routed efforts map verbatim.
    "omo-runtime": ("--thinking", "{effort}"),
}
# senpi treats trailing tokens as message positionals, so options insert
# before the prompt like codex; claude accepts them anywhere and appends.
_DISPATCH_OPTION_INSERT_INDEX: dict[str, int | None] = {"codex": 2, "claude-code": None, "omo-runtime": 5}


def build_dispatch_argv(
    owner: str,
    prompt: str,
    model_route: Mapping[str, Any] | None = None,
) -> list[str] | None:
    """Return the spawn argv for one owner, or None when the owner has no template.

    Without a model route the argv is byte-identical to the base template; a
    routed model/effort inserts the per-owner option fragments only.
    """
    if owner == "omo-runtime":
        host = omo_runtime_host()
        if host is None:
            return None
        host_table = _OMO_HOST_TEMPLATES[host]
        template = host_table["argv"]
        model_template = host_table["model"]
        effort_template = host_table["effort"]
        insert_index = host_table["insert"]
    else:
        template = DISPATCH_COMMAND_TEMPLATES.get(owner)
        model_template = DISPATCH_MODEL_OPTION_TEMPLATES.get(owner, ())
        effort_template = DISPATCH_REASONING_OPTION_TEMPLATES.get(owner, ())
        insert_index = _DISPATCH_OPTION_INSERT_INDEX.get(owner)
    if template is None:
        return None
    argv = [part.replace("{prompt}", prompt) for part in template]
    route = model_route or {}
    options: list[str] = []
    model = str(route.get("selected_model", "") or "")
    effort = str(route.get("selected_reasoning_effort", "") or "")
    if model:
        options.extend(part.replace("{model}", model) for part in model_template)
    if effort:
        options.extend(part.replace("{effort}", effort) for part in effort_template)
    if not options:
        return argv
    insert_at = insert_index
    if insert_at is None:
        return argv + options
    return argv[:insert_at] + options + argv[insert_at:]


def build_unit_prompt(
    unit: Mapping[str, Any],
    goal_text: str,
    discovery: Mapping[str, Any] | None = None,
) -> str:
    boundary = unit.get("boundary", {}) if isinstance(unit.get("boundary"), Mapping) else {}
    file_scope = ", ".join(str(path) for path in boundary.get("file_scope", []))
    do_not_touch = ", ".join(str(path) for path in boundary.get("do_not_touch", []))
    lines = [
        f"Work unit: {unit.get('title', unit.get('unit_id'))}",
        f"Overall goal: {goal_text.strip()}",
        f"Stay strictly inside these paths: {file_scope}.",
    ]
    if do_not_touch:
        lines.append(f"Do not touch: {do_not_touch} (owned by sibling units).")
    lines.append(f"Work on branch {unit.get('branch_suggestion', '')} in the current worktree.")
    # Goal echo-back, pre-declared completion criteria (absorbing the unit's
    # integration checks), bounded verification discipline, and — on
    # high-effort routes — the per-family over-verification calibration.
    lines.extend(unit_protocol_lines(unit))
    # Skills the operator actually has, named with the invocation form their
    # source directory implies. Absent discovery (the default, and every
    # zero-skill environment) leaves the prompt byte-identical.
    lines.extend(unit_skill_lines(unit, discovery))
    lines.append("Commit your work; do not merge or push other branches.")
    return "\n".join(lines)


# The one hedge every emitted sequence carries: declared-on-disk is not loaded,
# and a step the work does not need is droppable.
_SKILL_SEQUENCE_PREAMBLE = (
    "Suggested skill sequence for this unit, from what this environment declares. OMH read these "
    "definitions on disk; it did not load or verify them, so resolve each one in your own registry, "
    "skip any that does not resolve, and drop any step that does not fit the work:"
)
_DECLARED_SEQUENCE_PREAMBLE = (
    "Operator-declared skill sequence for this unit. Resolve each one in your own registry and skip "
    "any that does not resolve:"
)


def unit_skill_lines(unit: Mapping[str, Any], discovery: Mapping[str, Any] | None) -> list[str]:
    """Return the skill-sequence block for one unit, or an empty list.

    Precedence: an explicit `skill_sequence` on the unit always wins — a
    non-empty list renders verbatim (interview option 4), an empty list
    suppresses the block entirely (option 5, pure prompt). Otherwise the
    recommended sequence is arranged from discovery; and with no discovery or
    no matches the block is absent, so the modal operator — a fresh install
    with no executor skills — gets exactly the prompt they get today.
    """
    from .executor_skill_discovery import suggested_skill_sequence

    declared = unit.get("skill_sequence")
    if isinstance(declared, (list, tuple)):
        entries = [str(entry).strip() for entry in declared if str(entry).strip()]
        if not entries:
            return []
        steps = [f"{index}. `{entry}`" for index, entry in enumerate(entries, start=1)]
        return [_DECLARED_SEQUENCE_PREAMBLE, *steps]
    if not isinstance(discovery, Mapping):
        return []
    steps = [
        f"{index}. `{step['invocation']}` — {step['purpose']}"
        for index, step in enumerate(suggested_skill_sequence(discovery, _unit_role(unit)), start=1)
    ]
    if not steps:
        return []
    return [_SKILL_SEQUENCE_PREAMBLE, *steps]


def _unit_role(unit: Mapping[str, Any]) -> str:
    handoff = unit.get("handoff", {}) if isinstance(unit.get("handoff"), Mapping) else {}
    route = handoff.get("model_route") if isinstance(handoff.get("model_route"), Mapping) else {}
    return str(route.get("role", "") or "") if isinstance(route, Mapping) else ""


def _owner_skill_discoveries(
    units: Iterable[Mapping[str, Any]],
    project_root: Path | None = None,
) -> dict[str, dict[str, Any]]:
    """Observe declared skills once per distinct spawnable owner in this contract.

    Only owners that actually spawn are probed — a prepared-prompt fallback
    owner never reaches `build_unit_prompt`, so scanning for it would be IO
    nobody reads. `project_root` is the dispatch target repo, so repo-local
    `.claude/skills` definitions are discovered alongside the operator-level
    ones.
    """
    from .executor_skill_discovery import discovered_executor_skills

    owners = {
        str(unit.get("handoff", {}).get("executor_target", ""))
        for unit in units
        if isinstance(unit.get("handoff"), Mapping)
    }
    return {
        owner: discovered_executor_skills(owner, project_root=project_root)
        for owner in sorted(owners)
        if owner and DISPATCH_COMMAND_TEMPLATES.get(owner) is not None
    }


def verify_goal_matches_contract(contract: Mapping[str, Any], goal_text: str) -> None:
    """Refuse dispatch when the supplied goal diverges from the frozen contract.

    The contract stores the goal as a digest only (privacy); the operator
    re-supplies the text at dispatch time, so integrity must be re-proven.
    """
    from hashlib import sha256

    normalized = " ".join(goal_text.split())
    digest = sha256(normalized.encode("utf-8")).hexdigest()
    expected = str(contract.get("goal", {}).get("sha256", ""))
    if digest != expected:
        raise ValueError(
            "goal text does not match the digest frozen in the fanout contract; "
            "dispatch refuses to run a diverged goal (re-run fanout prepare for a new goal)"
        )


def dispatch_fanout(
    paths: OmhPaths,
    contract: Mapping[str, Any],
    *,
    goal_text: str,
    repo_root: Path,
    base_sha: str,
    concurrency: int = 2,
    timeout: int = 1800,
    only_units: Sequence[str] | None = None,
    dry_run: bool = False,
    runner: Callable[..., Any] = subprocess.run,
    readiness: Callable[..., dict[str, object]] = probe_executor_readiness,
) -> dict[str, Any]:
    verify_goal_matches_contract(contract, goal_text)
    units = {str(unit["unit_id"]): unit for unit in contract.get("units", []) if isinstance(unit, Mapping)}
    order = [str(unit_id) for unit_id in contract.get("merge_plan", {}).get("merge_order", [])]
    current_catalog_digest = _current_catalog_digest(units.values())
    # Resolved up here rather than beside the summary write below: the dispatch
    # loop needs it to write per-unit in-flight markers while units are running.
    fanout_id = str(contract.get("fanout_id", "") or "")
    selected = set(only_units) if only_units else set(order)
    # Observed once per distinct owner, here at the dispatch boundary rather
    # than inside the prompt builder: `build_unit_prompt` stays a pure function
    # of its arguments, so a prompt built without discovery is byte-identical
    # across machines.
    discoveries = _owner_skill_discoveries(units.values(), project_root=repo_root)
    results: dict[str, dict[str, Any]] = {}

    for unit_id in order:
        unit = units[unit_id]
        if _already_completed(paths, unit):
            # Completed units satisfy dependencies whether or not they are in
            # the current selection, so partial re-dispatch of downstream
            # units works after an earlier run (or manual recovery) finished
            # their prerequisites.
            results[unit_id] = _skipped(unit, "already_completed", merge_ready=True)
        elif unit_id not in selected:
            results[unit_id] = _skipped(unit, "not_selected")

    pending = [unit_id for unit_id in order if unit_id not in results]
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        while pending:
            ready = [
                unit_id
                for unit_id in pending
                if all(_dependency_satisfied(results.get(dep)) for dep in units[unit_id].get("depends_on", []))
            ]
            blocked = [
                unit_id
                for unit_id in pending
                if any(_dependency_failed(results.get(dep)) for dep in units[unit_id].get("depends_on", []))
            ]
            for unit_id in blocked:
                results[unit_id] = _blocked(units[unit_id], results)
                pending.remove(unit_id)
            ready = [unit_id for unit_id in ready if unit_id in pending]
            if not ready:
                if pending and not blocked:
                    for unit_id in list(pending):
                        results[unit_id] = _blocked(units[unit_id], results)
                        pending.remove(unit_id)
                continue
            futures = {
                unit_id: pool.submit(
                    _dispatch_unit,
                    paths,
                    units[unit_id],
                    goal_text=goal_text,
                    repo_root=repo_root,
                    base_sha=base_sha,
                    timeout=timeout,
                    dry_run=dry_run,
                    runner=runner,
                    readiness=readiness,
                    current_catalog_digest=current_catalog_digest,
                    fanout_id=fanout_id,
                    discoveries=discoveries,
                )
                for unit_id in ready
            }
            for unit_id, future in futures.items():
                results[unit_id] = future.result()
                pending.remove(unit_id)

    summary_units = [results[unit_id] for unit_id in order]
    summary = {
        "schema_version": FANOUT_DISPATCH_SCHEMA_VERSION,
        "fanout_id": contract.get("fanout_id", ""),
        "dry_run": dry_run,
        "observed_at": utc_now(),
        "merge_order": order,
        "units": summary_units,
        "merge_ready_units": [entry["unit_id"] for entry in summary_units if entry.get("merge_ready")],
        "auto_merge": False,
        "dependency_bar": (
            "A satisfied dependency means only that the owner agent process exited 0. "
            "It is not verified, reviewed, or correct work."
        ),
        "base_sha": base_sha,
        "claim_boundary": f"{DISPATCH_CLAIM_BOUNDARY} {FANOUT_CLAIM_BOUNDARY}",
    }
    if not dry_run and fanout_id:
        from .fanout_artifacts import fanout_dispatch_summary_path

        # Metadata-only persistence so `omh coding fanout brief` can join
        # observed telemetry without replaying the journal. The validated
        # helper re-checks the id pattern and containment because this
        # fanout_id comes from the contract body, not the CLI argument.
        # Per-unit entries merge with the stored summary so a partial
        # re-dispatch (`--unit b`) does not erase unit a's observed telemetry
        # with a skipped placeholder.
        summary_path = fanout_dispatch_summary_path(paths, fanout_id)
        stored = _merged_dispatch_summary(summary_path, summary)
        atomic_write_json(summary_path, stored, private=True)
    return summary


_DISPATCH_SKIP_STATUSES = frozenset({"already_completed", "not_selected"})


def _merged_dispatch_summary(summary_path: Path, summary: dict[str, Any]) -> dict[str, Any]:
    from ..system.local_store import read_json_object_result

    previous, _error = read_json_object_result(summary_path)
    previous_units = {
        str(entry.get("unit_id", "")): entry
        for entry in (previous or {}).get("units", [])
        if isinstance(entry, dict)
    }
    merged_units = []
    for entry in summary.get("units", []):
        if not isinstance(entry, dict):
            continue
        unit_id = str(entry.get("unit_id", ""))
        earlier = previous_units.get(unit_id)
        if entry.get("status") in _DISPATCH_SKIP_STATUSES and isinstance(earlier, dict):
            # A skipped unit carries no telemetry; the earlier observed entry
            # is the richer record and stays.
            merged_units.append(earlier)
        else:
            merged_units.append(entry)
    merged = dict(summary)
    merged["units"] = merged_units
    merged["merge_ready_units"] = [
        str(entry.get("unit_id")) for entry in merged_units if isinstance(entry, dict) and entry.get("merge_ready")
    ]
    return merged


def _current_catalog_digest(units: Iterable[Mapping[str, Any]]) -> str:
    """Observe the current local-catalog digest once per dispatch, and only
    when some unit's frozen route actually carries a catalog fingerprint —
    contracts routed purely from built-in catalogs never trigger the read."""
    for unit in units:
        handoff = unit.get("handoff", {}) if isinstance(unit.get("handoff"), Mapping) else {}
        route = handoff.get("model_route")
        if isinstance(route, Mapping) and isinstance(route.get("catalog_fingerprint"), Mapping):
            break
    else:
        return ""
    from .model_inventory import inventory_model_catalog, local_model_inventory

    catalog = inventory_model_catalog(local_model_inventory())
    if not isinstance(catalog, Mapping):
        return ""
    fingerprint = catalog.get("fingerprint")
    return str(fingerprint.get("digest", "") or "") if isinstance(fingerprint, Mapping) else ""


# Telemetry keys copied onto a dispatch result. `parse_unit_telemetry` also
# returns schema/owner/parsed/source, which describe the READING rather than the
# unit, and would be noise on every row of the summary.
_TELEMETRY_RESULT_KEYS: tuple[str, ...] = (
    "tokens_total",
    "tokens_billable",
    "tokens_billable_source",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "session_ref",
)


def _write_inflight(paths: OmhPaths, fanout_id: str, unit_id: str, fields: dict[str, str]) -> None:
    """Best-effort marker write. Observability must never fail a dispatch."""
    if not fanout_id:
        return
    try:
        write_inflight_marker(paths, fanout_id, unit_id, fields)
    except (InflightMarkerError, OSError):
        return


def _clear_inflight(paths: OmhPaths, fanout_id: str, unit_id: str) -> None:
    """Runs inside `finally`, so it must never mask the dispatch exception."""
    if not fanout_id:
        return
    try:
        clear_inflight_marker(paths, fanout_id, unit_id)
    except (InflightMarkerError, OSError):
        return


def _dispatch_unit(
    paths: OmhPaths,
    unit: Mapping[str, Any],
    *,
    goal_text: str,
    repo_root: Path,
    base_sha: str,
    timeout: int,
    dry_run: bool,
    runner: Callable[..., Any],
    readiness: Callable[..., dict[str, object]],
    current_catalog_digest: str = "",
    fanout_id: str = "",
    discoveries: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    from .model_inventory import catalog_fingerprint_note

    unit_id = str(unit["unit_id"])
    run_ref = str(unit.get("run_ref", unit_id))
    handoff = unit.get("handoff", {}) if isinstance(unit.get("handoff"), Mapping) else {}
    owner = str(handoff.get("executor_target", "choose"))
    model_route = handoff.get("model_route") if isinstance(handoff.get("model_route"), Mapping) else None
    routed_model = str(model_route.get("selected_model", "") or "") if model_route else ""
    routed_effort = str(model_route.get("selected_reasoning_effort", "") or "") if model_route else ""
    fingerprint_note = catalog_fingerprint_note(model_route, current_catalog_digest)
    if model_route is not None and str(model_route.get("status", "")) == "choice_required":
        # A frozen choice_required route means the contract explicitly says
        # "a human or wrapper must pick the model". Spawning anyway would
        # silently substitute the executor CLI default for a choice the
        # contract reserved — fail closed and name the unresolved choice
        # instead. Recovery: re-prepare the unit with an explicit `model`
        # (or a role that resolves), then re-run dispatch for this unit.
        return {
            "unit_id": unit_id,
            "run_ref": run_ref,
            "owner": owner,
            "status": "model_choice_required",
            "merge_ready": False,
            "reason": (
                "the frozen route requires an explicit model choice; re-prepare the unit with a "
                "declared model or resolvable role, then re-dispatch"
            ),
        }
    if DISPATCH_COMMAND_TEMPLATES.get(owner) is None:
        return {
            "unit_id": unit_id,
            "run_ref": run_ref,
            "owner": owner,
            "status": "unsupported_for_local_dispatch",
            "merge_ready": False,
            "fallback": "use the unit handoff as a prepared prompt for this owner",
        }
    probe = readiness(paths, owner)
    if str(probe.get("status", "")) != "ready":
        return {
            "unit_id": unit_id,
            "run_ref": run_ref,
            "owner": owner,
            "status": "executor_not_ready",
            "readiness_status": str(probe.get("status", "unknown")),
            "merge_ready": False,
        }
    discovery = (discoveries or {}).get(owner)
    prompt = build_unit_prompt(unit, goal_text, discovery)
    argv = build_dispatch_argv(owner, prompt, model_route)
    worktree = _worktree_path(repo_root, unit_id)
    if dry_run:
        from .executor_skill_discovery import skill_selection_card, suggested_skill_sequence

        planned: dict[str, Any] = {
            "unit_id": unit_id,
            "run_ref": run_ref,
            "owner": owner,
            "model": routed_model,
            "status": "dry_run_planned",
            "planned_argv": [part if part != prompt else "<unit prompt>" for part in argv],
            "worktree_path": str(worktree),
            "merge_ready": False,
        }
        if fingerprint_note is not None:
            planned["inventory_fingerprint"] = fingerprint_note
        # The deep-interview surface: when the unit has not answered (no
        # declared skill_sequence) and the environment offers a genuine
        # arrangement choice, the dry run carries the question card so a
        # wrapper can double-check with the user before live dispatch. Live
        # dispatch never blocks on it — unanswered means option 1.
        declared = unit.get("skill_sequence")
        if isinstance(declared, (list, tuple)):
            planned["skill_sequence_source"] = "declared" if any(str(v).strip() for v in declared) else "declared_none"
        else:
            card = skill_selection_card(discovery, _unit_role(unit))
            if card is not None:
                planned["skill_sequence_source"] = "auto_recommended"
                planned["skill_selection"] = card
            else:
                auto_steps = suggested_skill_sequence(discovery, _unit_role(unit))
                if auto_steps:
                    planned["skill_sequence_source"] = "auto"
                    # Name the sequence that will actually ride the prompt:
                    # "auto" alone told the operator a skill was chosen
                    # without saying which one.
                    planned["skill_sequence"] = [str(step["invocation"]) for step in auto_steps]
                else:
                    planned["skill_sequence_source"] = "none"
        return planned
    from .worktree_creator import ensure_fanout_unit_worktree

    worktree_record = ensure_fanout_unit_worktree(
        paths,
        repo_root=repo_root,
        unit_id=unit_id,
        branch=str(unit.get("branch_suggestion", f"agent/{unit_id}")),
        base_sha=base_sha,
        runner=runner,
    )
    if not worktree_record.get("created"):
        return {
            "unit_id": unit_id,
            "run_ref": run_ref,
            "owner": owner,
            "status": "worktree_failed",
            "reason": str(worktree_record.get("reason", "")),
            "merge_ready": False,
        }
    worktree = Path(str(worktree_record["worktree_path"]))
    _ensure_unit_run(paths, unit, owner)
    append_journal_observation(
        paths,
        {
            "target_type": "run",
            "target_id": run_ref,
            "run_id": run_ref,
            "event": "worker_dispatch",
            "status": "observed",
            "summary": f"local dispatch of unit {unit_id} to {owner}",
            "worker_ref": unit_id,
            "worktree_ref": str(worktree),
            # The schema has carried this field all along and nothing set it,
            # so the runtime name survived only inside free-text `summary`.
            "runtime_profile": owner,
        },
    )
    started_at = utc_now()
    started_clock = time.monotonic()
    stderr_tail = ""
    stdout_text = ""
    owner_host = omo_runtime_host() or "" if owner == "omo-runtime" else ""
    # Written BEFORE the spawn and cleared in `finally`. This call blocks for
    # the whole unit, so the dispatching process cannot report on itself; the
    # marker is what lets ANOTHER session see that this unit is running and
    # compute its elapsed time. Marker failures never block a dispatch.
    _write_inflight(
        paths,
        fanout_id,
        unit_id,
        {
            "owner": owner,
            "owner_host": owner_host,
            "model": routed_model,
            "reasoning_effort": routed_effort,
            "run_ref": run_ref,
            "worktree": str(worktree),
            "started_at": started_at,
        },
    )
    try:
        completed = runner(argv, cwd=str(worktree), text=True, capture_output=True, timeout=timeout)
        exit_code = int(getattr(completed, "returncode", 1))
        stdout_text = str(getattr(completed, "stdout", "") or "")
        output_tail = stdout_text[-2000:]
        stderr_tail = str(getattr(completed, "stderr", "") or "")[-2000:]
    except FileNotFoundError:
        exit_code, output_tail = 127, f"{argv[0]} not found on PATH"
    except subprocess.TimeoutExpired:
        exit_code, output_tail = 124, f"unit timed out after {timeout}s"
    except OSError as exc:
        exit_code, output_tail = 1, f"spawn failed: {exc}"
    finally:
        _clear_inflight(paths, fanout_id, unit_id)
    finished_at = utc_now()
    duration_seconds = round(time.monotonic() - started_clock, 3)
    limit_label = _limit_shaped_label(output_tail, stderr_tail) if exit_code != 0 else ""
    if limit_label:
        _record_limit_signal(paths, owner, run_ref=run_ref, unit_id=unit_id, pattern_label=limit_label)
    elif exit_code == 0:
        # A successful dispatch to this executor is the freshest evidence the
        # provider is serving it again; a stale limit signal must not keep
        # down-ranking the executor forever.
        _clear_limit_signal(paths, owner)
    status = "observed" if exit_code == 0 else "failed"
    summary = (
        f"unit {unit_id} exit {exit_code} after {duration_seconds}s: "
        f"{redact_metadata_text(output_tail[-300:], limit=300)}"
    )
    if limit_label:
        summary = f"limit-shaped failure ({limit_label}); {summary}"
    append_journal_observation(
        paths,
        {
            "target_type": "run",
            "target_id": run_ref,
            "run_id": run_ref,
            "event": "worker_result",
            "status": status,
            "summary": summary,
            "worker_ref": unit_id,
            "worktree_ref": str(worktree),
            "runtime_profile": owner,
        },
    )
    result = {
        "unit_id": unit_id,
        "run_ref": run_ref,
        "owner": owner,
        "model": routed_model,
        "reasoning_effort": routed_effort,
        "status": "completed" if exit_code == 0 else "failed",
        "exit_code": exit_code,
        "worktree_path": str(worktree),
        "merge_ready": exit_code == 0,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_seconds": duration_seconds,
    }
    if owner_host:
        result["owner_host"] = owner_host
    # `tokens_total` and `session_ref` were READ by `omh coding fanout brief`
    # and had no write site anywhere, so both columns always printed "unknown".
    # Only keys the executor actually reported are copied: an absent count stays
    # absent rather than becoming a zero that would read as an observation.
    for key, value in parse_unit_telemetry(owner, stdout_text).items():
        if key in _TELEMETRY_RESULT_KEYS:
            result[key] = value
    if fingerprint_note is not None:
        result["inventory_fingerprint"] = fingerprint_note
    if limit_label:
        result["limit_shaped"] = True
        result["limit_pattern"] = limit_label
    return result


def _ensure_unit_run(paths: OmhPaths, unit: Mapping[str, Any], owner: str) -> None:
    run_ref = str(unit.get("run_ref", unit.get("unit_id", "")))
    run_path = paths.runtime_runs_dir / run_ref / "run.json"
    if run_path.exists():
        return
    create_run(
        paths,
        {
            "run_id": run_ref,
            "skill": "fanout-unit",
            "harness": "coding-handling",
            "trigger": f"fanout:dispatch:{unit.get('unit_id')}",
            "privacy": "metadata_only",
            "inputs_summary": f"fanout unit {unit.get('unit_id')} owned by {owner}",
            "outputs_summary": "local dispatch bridge run",
            "verification_summary": "observed via journal worker_dispatch/worker_result events",
        },
    )


def _already_completed(paths: OmhPaths, unit: Mapping[str, Any]) -> bool:
    run_ref = str(unit.get("run_ref", ""))
    try:
        shown = show_run(paths, run_ref)
    except (OSError, ValueError, KeyError):
        return False
    if not isinstance(shown, dict):
        return False
    for event in shown.get("journal_events", []) or []:
        if (
            isinstance(event, dict)
            and str(event.get("event", "")) in {"worker_result", "executor_result_observed"}
            and str(event.get("status", "")) == "observed"
        ):
            return True
    return False


def _dependency_satisfied(result: dict[str, Any] | None) -> bool:
    if result is None:
        return False
    # dry_run_planned satisfies dependencies so a --dry-run renders the full
    # plan; live dispatch only advances on an observed exit-0 result.
    return (
        result.get("status") in {"completed", "already_completed", "dry_run_planned"}
        or bool(result.get("merge_ready"))
    )


def _dependency_failed(result: dict[str, Any] | None) -> bool:
    if result is None:
        return False
    return result.get("status") in {
        "failed",
        "blocked_by_dependency",
        "executor_not_ready",
        "unsupported_for_local_dispatch",
        "worktree_failed",
        "not_selected",
    } and not result.get("merge_ready")


def _blocked(unit: Mapping[str, Any], results: Mapping[str, dict[str, Any]]) -> dict[str, Any]:
    entry = _skipped(unit, "blocked_by_dependency")
    entry["blocked_on"] = [
        str(dep)
        for dep in unit.get("depends_on", []) or []
        if _dependency_failed(results.get(str(dep)))
    ]
    return entry


def _skipped(unit: Mapping[str, Any], status: str, *, merge_ready: bool = False) -> dict[str, Any]:
    return {
        "unit_id": str(unit["unit_id"]),
        "run_ref": str(unit.get("run_ref", "")),
        "owner": str(unit.get("handoff", {}).get("executor_target", "choose")),
        "status": status,
        "merge_ready": merge_ready,
    }


def _worktree_path(repo_root: Path, unit_id: str) -> Path:
    return repo_root.parent / f"{repo_root.name}-fanout-{unit_id}"


def _limit_shaped_label(output_tail: str, stderr_tail: str) -> str:
    haystack = f"{output_tail}\n{stderr_tail}".casefold()
    for label, pattern in _LIMIT_SHAPED_PATTERNS:
        if pattern in haystack:
            return label
    return ""


def _record_limit_signal(paths: OmhPaths, owner: str, *, run_ref: str, unit_id: str, pattern_label: str) -> None:
    def _update(state: dict[str, Any]) -> dict[str, Any]:
        state["schema_version"] = EXECUTOR_LIMIT_SIGNALS_SCHEMA_VERSION
        profiles = state.setdefault("profiles", {})
        profiles[owner] = {
            "last_limit_shaped_at": utc_now(),
            "run_ref": run_ref,
            "unit_id": unit_id,
            "pattern_label": pattern_label,
        }
        state["claim_boundary"] = EXECUTOR_LIMIT_SIGNALS_CLAIM_BOUNDARY
        return state

    try:
        locked_json_update(paths.executor_limit_signals_path, _update, private=True)
    except (OSError, TimeoutError):
        # An advisory that cannot be written must never abort the dispatch —
        # losing the whole summary over a lock timeout would be worse than
        # missing one ranking hint.
        pass


def _clear_limit_signal(paths: OmhPaths, owner: str) -> None:
    if not paths.executor_limit_signals_path.exists():
        return

    def _update(state: dict[str, Any]) -> dict[str, Any]:
        profiles = state.get("profiles")
        if isinstance(profiles, dict):
            profiles.pop(owner, None)
        return state

    try:
        locked_json_update(paths.executor_limit_signals_path, _update, private=True)
    except (OSError, TimeoutError):
        pass
