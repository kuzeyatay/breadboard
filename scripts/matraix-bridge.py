#!/usr/bin/env python
"""Breadboard's bridge into the MatrAIx-Persona-8B clone.

MatrAIx simulates a population: it samples persona records out of a pool built on
a 1,290-dimension schema, instantiates each one as an LLM agent, and runs it
through a task. This bridge drives the **Survey** lane, which is the one lane
that is host-native -- no Docker, no Harbor job YAML, no bash verifier -- and so
the one lane that runs unmodified on this machine.

Nothing in the clone is patched. Every load-bearing step is upstream's own code:

* ``PersonaPoolService.sample_pool``   cohort retrieval, dimension filters,
                                       stratified quotas
* ``InprocessSurveyEvalRunner``        the persona prompt, the model call, answer
                                       normalisation, trajectory and metrics
* ``render_persona_block``             the persona rendering (reached through the
                                       runner, from the persona's own YAML)
* ``collect_job_results``              the deterministic population report

The one thing Breadboard supplies is the questionnaire, and it arrives as a spec
file rather than as a task folder inside the clone. That works because
``build_survey_task_prompt`` falls back to rendering instruction, context,
questionnaire and answer envelope **from the instrument itself** when the
questionnaire id is not a task in the clone -- and ``instrument.description`` is
what that fallback renders as the context section. Generated ids are namespaced
``bb_`` so they can never collide with a real task and silently borrow its text.

The report is produced by writing the trials into the ``jobs/<job>/`` layout the
clone's own reader expects and then calling that reader, so the aggregation is
upstream's rather than a second implementation of it -- and the same directory
can be handed to ``uv run matraix results`` verbatim.

Protocol: one JSON object per line on stdout. Diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# process plumbing
# ---------------------------------------------------------------------------


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - stream without reconfigure
            pass


def emit(event: str, **payload: Any) -> None:
    """One protocol line, flushed, so the run card moves while the study runs."""
    sys.stdout.write(json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _inject_clone_imports(root: Path) -> None:
    """Put the clone's packages on ``sys.path`` exactly as its own launchers do."""
    src = str(root / "src")
    if src not in sys.path:
        sys.path.insert(0, src)
    from matraix.launch_env import required_pythonpath_entries

    entries = required_pythonpath_entries(root)
    for entry in reversed(entries):
        if entry not in sys.path:
            sys.path.insert(0, entry)
    existing = [part for part in (os.environ.get("PYTHONPATH") or "").split(os.pathsep) if part]
    os.environ["PYTHONPATH"] = os.pathsep.join(dict.fromkeys(entries + existing))
    _quiet_litellm()


def _quiet_litellm() -> None:
    """Stop LiteLLM printing its provider banner once per priced-lookup miss.

    Cost estimation asks LiteLLM to price the model, and a model served by a
    local proxy is not in its table -- so every trial would otherwise write four
    lines of provider documentation to stderr, which the run card shows as log
    output. The pricing result is unaffected: an unknown model stays unpriced.
    """
    os.environ.setdefault("LITELLM_LOG", "ERROR")
    try:
        import litellm

        litellm.suppress_debug_info = True
        litellm.set_verbose = False
    except Exception:  # noqa: BLE001 - pricing is optional, silence is cosmetic
        pass


# ---------------------------------------------------------------------------
# --check
# ---------------------------------------------------------------------------


def command_check(root: Path) -> int:
    _inject_clone_imports(root)
    from backend.service.persona_pool_service import DEFAULT_PERSONA_POOL, PersonaPoolService
    from matraix.job_results import collect_job_results  # noqa: F401 - import is the check
    from playground.inprocess.survey_eval import InprocessSurveyEvalRunner  # noqa: F401

    service = PersonaPoolService.from_repo(repo_root=root)
    pools = [
        {
            "pool": str(entry.get("pool") or ""),
            "label": str(entry.get("label") or ""),
            "count": int(entry.get("count") or 0),
            "kind": str(entry.get("kind") or ""),
        }
        for entry in service.list_datasets()
    ]
    emit("check.ok", python=sys.version.split()[0], defaultPool=DEFAULT_PERSONA_POOL, pools=pools)
    return 0


# ---------------------------------------------------------------------------
# --catalog
# ---------------------------------------------------------------------------


def _pool_dimension_index(
    service: Any, pool: str, *, top: int
) -> tuple[list[dict[str, Any]], int]:
    """Dimensions that are actually usable as a filter *on this pool*.

    The schema carries 1,290 dimensions and every persona holds a different
    sparse subset of them, so the schema alone says nothing about what can be
    filtered here. This reads the pool's own personas and reports, per dimension,
    how many carry it and which values occur -- the only form of that question a
    requested cohort can be checked against before a run is started.
    """
    coverage: Counter[str] = Counter()
    values: dict[str, Counter[str]] = defaultdict(Counter)
    for entry in service.filter_pool(persona_pool=pool):
        for key, value in service._yaml_dimensions(entry).items():  # noqa: SLF001
            text = str(value).strip()
            if not text or text.lower() == "null":
                continue
            coverage[key] += 1
            values[key][text] += 1
    index = [
        {
            "id": key,
            "personas": count,
            "values": [{"value": value, "personas": n} for value, n in values[key].most_common(24)],
        }
        for key, count in coverage.most_common(top)
    ]
    return index, len(coverage)


def command_catalog(root: Path, pool: str | None, top: int) -> int:
    _inject_clone_imports(root)
    from backend.service.persona_pool_service import DEFAULT_PERSONA_POOL, PersonaPoolService

    service = PersonaPoolService.from_repo(repo_root=root)
    resolved = (pool or "").strip() or DEFAULT_PERSONA_POOL
    summary = service.get_catalog(resolved)
    dimensions, distinct = _pool_dimension_index(service, resolved, top=top)
    emit(
        "catalog",
        pool=resolved,
        count=int(summary.get("count") or 0),
        dimensionCount=distinct,
        sourceCounts=dict(summary.get("sourceCounts") or summary.get("source_counts") or {}),
        dimensions=dimensions,
    )
    return 0


# ---------------------------------------------------------------------------
# --run
# ---------------------------------------------------------------------------

_SLUG = re.compile(r"[^a-z0-9]+")


def _slug(value: str, *, fallback: str = "study") -> str:
    slug = _SLUG.sub("-", str(value or "").lower()).strip("-")
    return slug or fallback


def _questionnaire_payload(spec: dict[str, Any]) -> dict[str, Any]:
    """The spec's questionnaire in the clone's own ``questionnaire.yaml`` shape."""
    return {
        "schemaVersion": "1.0",
        "id": str(spec["instrumentId"]),
        "title": str(spec.get("title") or "Survey"),
        "description": str(spec.get("description") or ""),
        "askRationale": bool(spec.get("askRationale", False)),
        "askConfidence": bool(spec.get("askConfidence", False)),
        "questions": list(spec.get("questions") or []),
    }


def _write_task_directory(
    task_dir: Path,
    *,
    spec: dict[str, Any],
    instrument: Any,
    questionnaire: dict[str, Any],
    cohort: dict[str, Any],
) -> None:
    """Write a real MatrAIx survey task beside the results.

    This is not what the run reads -- the prompt is built from the instrument in
    memory. It is written because it makes the study reproducible outside
    Breadboard: dropped into the clone's ``application/tasks/`` it is a task the
    upstream CLI runs, and the markdown written here is the same markdown the run
    used, so the prompt comes out identical rather than merely similar.
    """
    import yaml
    from backend.service.survey_instruction_builder import (
        render_survey_context_markdown,
        render_survey_task_instruction_markdown,
    )

    (task_dir / "input").mkdir(parents=True, exist_ok=True)
    (task_dir / "input" / "questionnaire.yaml").write_text(
        yaml.safe_dump(questionnaire, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    (task_dir / "input" / "context.md").write_text(
        render_survey_context_markdown(instrument), encoding="utf-8"
    )
    (task_dir / "instruction.md").write_text(
        render_survey_task_instruction_markdown(instrument), encoding="utf-8"
    )
    (task_dir / "task.toml").write_text(
        "\n".join(
            [
                'version = "1.0"',
                'artifacts = [ "/app/output",]',
                "",
                "[task]",
                'name = "application/{}"'.format(_slug(spec.get("title") or "study")),
                "",
                "[metadata]",
                'difficulty = "easy"',
                'type = "survey"',
                'domain = "breadboard"',
                "tags = []",
                "",
                "[verifier]",
                "timeout_sec = 120.0",
                "",
                "[agent]",
                "timeout_sec = 600.0",
                "",
                "[environment]",
                'definition = "application/shared-survey-form"',
                "build_timeout_sec = 600.0",
                "cpus = 1",
                "memory_mb = 2048",
                "storage_mb = 10240",
                "gpus = 0",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (task_dir / "persona_strategy.json").write_text(
        json.dumps(
            {
                "schemaVersion": "1.0",
                "sources": list(cohort.get("sources") or []),
                "dimensionFilters": dict(cohort.get("filters") or {}),
                "sampling": {
                    "mode": "stratified" if cohort.get("stratify") else "random",
                    "fields": list(cohort.get("stratify") or []),
                    "allocation": str(cohort.get("allocation") or "equalTotal"),
                    "sampleSize": int(cohort.get("sampleSize") or 1),
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (task_dir / "reporting.json").write_text(
        json.dumps({"schemaVersion": "1.0", "contextRules": []}, indent=2) + "\n",
        encoding="utf-8",
    )


def _choice_labels(questionnaire: dict[str, Any]) -> dict[str, dict[str, str]]:
    """``question id -> {choice id: label}``, so the report reads as English."""
    labels: dict[str, dict[str, str]] = {}
    for question in questionnaire.get("questions") or []:
        if not isinstance(question, dict) or not question.get("id"):
            continue
        mapping: dict[str, str] = {}
        for option in question.get("options") or []:
            if isinstance(option, dict) and option.get("id"):
                mapping[str(option["id"])] = str(option.get("label") or option["id"])
        labels[str(question["id"])] = mapping
    return labels


def _question_prompts(questionnaire: dict[str, Any]) -> dict[str, str]:
    return {
        str(question["id"]): str(question.get("prompt") or "")
        for question in questionnaire.get("questions") or []
        if isinstance(question, dict) and question.get("id")
    }


def _answer_counts(trials: list[Any], question_id: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for trial in trials:
        value = trial.survey_answers.get(question_id)
        if value is None:
            continue
        if isinstance(value, list):
            for item in value:
                counts[str(item)] += 1
        else:
            counts[str(value)] += 1
    return counts


def _render_study_markdown(
    *,
    spec: dict[str, Any],
    report: Any,
    questionnaire: dict[str, Any],
    cohort_meta: dict[str, Any],
    rationales: list[dict[str, str]],
    failures: list[dict[str, str]],
) -> str:
    """The population read-out, written only from what the trials actually hold."""
    labels = _choice_labels(questionnaire)
    prompts = _question_prompts(questionnaire)
    trials = [trial for trial in report.ledger.trials if trial.error is None]

    lines = [
        "# {}".format(spec.get("title") or "Simulated population study"),
        "",
        "Answers from MatrAIx persona agents: a model conditioned on persona records, "
        "one run per persona. Useful for exploration and stress testing, and not a "
        "substitute for evidence from real people.",
        "",
        "## Cohort",
        "",
        "- Pool: `{}` ({} personas matched the filters)".format(
            cohort_meta.get("pool"), cohort_meta.get("matchedCount")
        ),
        "- Respondents: {} answered, {} failed".format(len(trials), len(failures)),
        "- Seed: {}".format(cohort_meta.get("seed")),
    ]
    if cohort_meta.get("filters"):
        lines.append(
            "- Filters: {}".format(
                "; ".join(
                    "{} = {}".format(key, ", ".join(values))
                    for key, values in sorted(cohort_meta["filters"].items())
                )
            )
        )
    if cohort_meta.get("stratify"):
        lines.append("- Stratified by: {}".format(", ".join(cohort_meta["stratify"])))
    lines.append("- Persona model: `{}`".format(spec.get("model")))
    usage = report.ledger.usage
    if usage.n_input_tokens or usage.n_output_tokens:
        lines.append(
            "- Tokens: {:,} in, {:,} out ({})".format(
                usage.n_input_tokens or 0,
                usage.n_output_tokens or 0,
                "${:.4f}".format(usage.cost_usd)
                if usage.cost_usd
                else "this model is not in the pricing table, so no cost is reported",
            )
        )
    lines.append("")

    if not trials:
        lines.extend(["## Result", "", "No persona answered, so there is nothing to report.", ""])
        return "\n".join(lines) + "\n"

    lines.extend(["## Answers", ""])
    for question_id, prompt in prompts.items():
        counts = _answer_counts(trials, question_id)
        if not counts:
            continue
        lines.extend(["### {}".format(prompt or question_id), ""])
        numeric: list[float] = []
        for value, count in counts.items():
            try:
                numeric.extend([float(value)] * count)
            except (TypeError, ValueError):
                numeric = []
                break
        if numeric:
            lines.extend(
                ["Mean {:.2f} across {} answers.".format(sum(numeric) / len(numeric), len(numeric)), ""]
            )
        total = sum(counts.values())
        lines.extend(["| answer | n | share |", "|---|---:|---:|"])
        for value, count in counts.most_common():
            lines.append(
                "| {} | {} | {:.0f}% |".format(
                    labels.get(question_id, {}).get(value, value), count, 100 * count / total
                )
            )
        lines.append("")

    # ``grouped_distributions`` is nested group key → group value → question →
    # answer → count. Transposed here to question → group value, because the
    # question is what a reader is comparing subgroups on.
    for group_key, by_value in sorted((report.grouped_distributions or {}).items()):
        by_question: dict[str, dict[str, dict[str, int]]] = defaultdict(dict)
        for group_value, questions in by_value.items():
            for question_id, answer_counts in (questions or {}).items():
                if isinstance(answer_counts, dict) and answer_counts:
                    by_question[str(question_id)][str(group_value)] = answer_counts
        if not by_question:
            continue
        lines.extend(["## Subgroups by {}".format(group_key), ""])
        for question_id, per_value in by_question.items():
            lines.extend(
                [
                    "**{}**".format(prompts.get(question_id, question_id)),
                    "",
                    "| {} | answer | n |".format(group_key),
                    "|---|---|---:|",
                ]
            )
            for group_value, answer_counts in sorted(per_value.items()):
                for value, count in sorted(answer_counts.items(), key=lambda item: -item[1]):
                    lines.append(
                        "| {} | {} | {} |".format(
                            group_value,
                            labels.get(question_id, {}).get(str(value), str(value)),
                            count,
                        )
                    )
            lines.append("")

    if rationales:
        lines.extend(["## Reasons respondents gave", ""])
        by_question_rationales: dict[str, list[dict[str, str]]] = defaultdict(list)
        for entry in rationales:
            by_question_rationales[entry.get("questionId", "")].append(entry)
        for question_id, prompt in prompts.items():
            entries = by_question_rationales.get(question_id) or []
            if not entries:
                continue
            lines.extend(["### {}".format(prompt or question_id), ""])
            for entry in entries[:10]:
                lines.append("- **{}** — {}".format(entry["persona"], entry["text"]))
            lines.append("")

    if failures:
        lines.extend(["## Respondents that failed", ""])
        for failure in failures:
            lines.append("- `{}` — {}".format(failure["personaId"], failure["error"]))
        lines.append("")

    lines.extend(
        [
            "## Provenance",
            "",
            "- `job/` — the trial directory, readable by `uv run matraix results`",
            "- `task/` — a MatrAIx survey task; drop it into the clone's "
            "`application/tasks/` to rerun this study there",
            "- `responses/` — one file per respondent, with the full answer trajectory",
            "- `results.json` / `results.csv` / `results.txt` — the clone's own report",
            "",
        ]
    )
    return "\n".join(lines) + "\n"


def _headline(report: Any, questionnaire: dict[str, Any]) -> list[dict[str, Any]]:
    """A few per-question modes, so the chat turn can say something concrete."""
    labels = _choice_labels(questionnaire)
    prompts = _question_prompts(questionnaire)
    trials = [trial for trial in report.ledger.trials if trial.error is None]
    headline: list[dict[str, Any]] = []
    for question_id, prompt in list(prompts.items())[:6]:
        counts = _answer_counts(trials, question_id)
        if not counts:
            continue
        value, count = counts.most_common(1)[0]
        headline.append(
            {
                "questionId": question_id,
                "prompt": prompt,
                "topAnswer": labels.get(question_id, {}).get(value, value),
                "count": count,
                "total": sum(counts.values()),
            }
        )
    return headline


def command_run(root: Path, workspace: Path, spec_path: Path) -> int:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    _inject_clone_imports(root)

    from backend.service.persona_pool_service import DEFAULT_PERSONA_POOL, PersonaPoolService
    from backend.service.survey_types import SurveyEvalConfig, SurveyInstrument
    from matraix.job_results import (
        collect_job_results,
        format_csv_report,
        format_json_report,
        format_text_report,
    )
    from playground.inprocess.survey_eval import InprocessSurveyEvalRunner
    from playground.types import Persona as EvalPersona

    output = workspace / "output"
    job_dir = output / "job"
    responses_dir = output / "responses"
    task_dir = output / "task"
    for directory in (output, job_dir, responses_dir, task_dir):
        directory.mkdir(parents=True, exist_ok=True)

    questionnaire = _questionnaire_payload(spec)
    instrument = SurveyInstrument.from_dict(questionnaire)
    cohort = dict(spec.get("cohort") or {})
    pool = str(cohort.get("pool") or DEFAULT_PERSONA_POOL)
    model = str(spec.get("model") or "").strip()
    if not model:
        raise ValueError("the study spec names no persona model")

    max_cost = spec.get("maxCostUsd")
    if isinstance(max_cost, (int, float)) and max_cost > 0:
        os.environ["MATRIX_MAX_COST_USD"] = "{:g}".format(float(max_cost))

    emit(
        "run.started",
        model=model,
        pool=pool,
        instrumentId=instrument.id,
        title=instrument.title,
        questions=len(instrument.questions),
    )

    service = PersonaPoolService.from_repo(repo_root=root)
    sampled = service.sample_pool(
        persona_pool=pool,
        sample_size=int(cohort.get("sampleSize") or 1),
        seed=int(cohort.get("seed") or 42),
        sources=list(cohort.get("sources") or []) or None,
        dimension_filters=dict(cohort.get("filters") or {}) or None,
        stratify_fields=list(cohort.get("stratify") or []) or None,
        allocation=str(cohort.get("allocation") or "") or None,
        include_persona_ids=True,
        preview_limit=200,
    )
    cards = [row for row in (sampled.get("personas") or []) if isinstance(row, dict)]
    cohort_meta = {
        "pool": str(sampled.get("pool") or pool),
        "matchedCount": int(sampled.get("matchedCount") or 0),
        "seed": int(sampled.get("seed") or 42),
        "filters": {
            str(key): [str(item) for item in (value if isinstance(value, list) else [value])]
            for key, value in (cohort.get("filters") or {}).items()
        },
        "stratify": [str(field) for field in (sampled.get("fields") or [])],
    }
    emit(
        "cohort.sampled",
        sampleSize=len(cards),
        matchedCount=cohort_meta["matchedCount"],
        seed=cohort_meta["seed"],
        pool=cohort_meta["pool"],
        stratify=cohort_meta["stratify"],
        personas=[
            {
                "personaId": str(card.get("personaId") or ""),
                "name": str(card.get("name") or ""),
                "source": str(card.get("source") or ""),
                "dimensions": dict(card.get("dimensions") or {}),
            }
            for card in cards
        ],
    )

    _write_task_directory(
        task_dir, spec=spec, instrument=instrument, questionnaire=questionnaire, cohort=cohort
    )

    runner = InprocessSurveyEvalRunner()
    config = SurveyEvalConfig(persona_model=model)
    task_path = "application/tasks/survey_{}".format(_slug(spec.get("title") or "study"))
    created_at = _utc_now()
    failures: list[dict[str, str]] = []
    rationales: list[dict[str, str]] = []
    completed = 0
    total_cost = 0.0
    input_tokens = 0
    output_tokens = 0
    priced = False

    for index, card in enumerate(cards, start=1):
        persona_id = str(card.get("personaId") or "")
        persona_name = str(card.get("name") or persona_id)
        relative = str(card.get("path") or "")
        persona_yaml = (root / relative) if relative else None
        emit(
            "trial.started",
            index=index,
            total=len(cards),
            personaId=persona_id,
            personaName=persona_name,
            dimensions=dict(card.get("dimensions") or {}),
        )

        trial_dir = job_dir / "trial_{:03d}_persona_{}".format(index, persona_id or index)
        trial_output = trial_dir / "artifacts" / "app" / "output"
        trial_output.mkdir(parents=True, exist_ok=True)
        (trial_dir / "persona_meta.json").write_text(
            json.dumps(
                {
                    "persona_id": persona_id,
                    "display_name": persona_name,
                    "source": str(card.get("source") or ""),
                    "persona_path": str(persona_yaml) if persona_yaml else "",
                    "dimensions": dict(card.get("dimensions") or {}),
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        # The clone's reader votes on the app type partly from this path, which
        # is how the report comes out as a survey report rather than "unknown".
        (trial_dir / "config.json").write_text(
            json.dumps({"task": {"path": task_path}}, indent=2) + "\n", encoding="utf-8"
        )

        if persona_yaml is None or not persona_yaml.is_file():
            message = "the persona record for {} was not found in the pool".format(persona_id)
            failures.append({"personaId": persona_id, "error": message})
            (trial_dir / "result.json").write_text(
                json.dumps({"error": message}, indent=2) + "\n", encoding="utf-8"
            )
            emit("trial.failed", index=index, personaId=persona_id, error=message)
            continue

        try:
            result = runner(
                EvalPersona(id=persona_id, name=persona_name, source=str(card.get("source") or "")),
                instrument,
                config=config,
                created_at=created_at,
                persona_yaml_path=str(persona_yaml),
                job_dir=job_dir,
            )
        except Exception as exc:  # noqa: BLE001 - one persona must not end the study
            message = "{}: {}".format(type(exc).__name__, exc)[:400]
            failures.append({"personaId": persona_id, "error": message})
            (trial_dir / "result.json").write_text(
                json.dumps({"error": message}, indent=2) + "\n", encoding="utf-8"
            )
            emit("trial.failed", index=index, personaId=persona_id, error=message)
            continue

        answers = [answer.to_dict() for answer in result.answers]
        for answer in answers:
            text = str(answer.get("rationale") or "").strip()
            if text:
                rationales.append(
                    {
                        "persona": persona_name,
                        "questionId": str(answer.get("questionId") or ""),
                        "text": text[:400],
                    }
                )
        payload: dict[str, Any] = {
            "instrument": {"id": result.instrument.id, "title": result.instrument.title},
            "persona": {"id": persona_id, "name": persona_name},
            "answers": answers,
            "trajectory": [event.to_dict() for event in result.trajectory],
        }
        # ``LlmUsage.to_dict`` is snake_case and omits ``cost_usd`` entirely when
        # the model is not in the pricing table, which is the normal case for a
        # locally proxied model — so a missing cost means unpriced, not free.
        usage = dict(result.usage) if getattr(result, "usage", None) else {}
        if usage:
            payload["usage"] = usage
            total_cost += float(usage.get("cost_usd") or 0.0)
            input_tokens += int(usage.get("n_input_tokens") or 0)
            output_tokens += int(usage.get("n_output_tokens") or 0)
            if usage.get("cost_usd") is not None:
                priced = True

        body = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        (trial_output / "survey_result.json").write_text(body, encoding="utf-8")
        (responses_dir / "persona_{}.json".format(persona_id or index)).write_text(
            body, encoding="utf-8"
        )
        (trial_dir / "result.json").write_text(
            json.dumps(
                {"agent_result": usage, "verifier_result": {"reward": 1.0}},
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        completed += 1
        emit(
            "trial.completed",
            index=index,
            total=len(cards),
            personaId=persona_id,
            personaName=persona_name,
            answers=len(answers),
            meanLikert=getattr(result.metrics, "mean_likert", None),
        )

    (job_dir / "result.json").write_text(
        json.dumps(
            {
                "stats": {
                    "n_completed_trials": completed,
                    "n_errored_trials": len(failures),
                    "cost_usd": round(total_cost, 6),
                    "n_input_tokens": input_tokens,
                    "n_output_tokens": output_tokens,
                }
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    group_by = [str(field) for field in (spec.get("groupBy") or []) if str(field).strip()]
    report = collect_job_results(job_dir, group_by=group_by or None)
    (output / "results.json").write_text(format_json_report(report), encoding="utf-8")
    (output / "results.csv").write_text(format_csv_report(report), encoding="utf-8")
    (output / "results.txt").write_text(format_text_report(report), encoding="utf-8")
    (output / "study.md").write_text(
        _render_study_markdown(
            spec=spec,
            report=report,
            questionnaire=questionnaire,
            cohort_meta=cohort_meta,
            rationales=rationales,
            failures=failures,
        ),
        encoding="utf-8",
    )

    emit(
        "run.completed",
        completed=completed,
        failed=len(failures),
        costUsd=round(total_cost, 6),
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        priced=priced,
        headline=_headline(report, questionnaire),
        summary="{} of {} simulated respondents answered {} question{}.".format(
            completed,
            len(cards),
            len(instrument.questions),
            "" if len(instrument.questions) == 1 else "s",
        ),
    )
    return 0 if completed else 1


# ---------------------------------------------------------------------------


def main() -> int:
    _configure_stdio()
    parser = argparse.ArgumentParser(description="Breadboard's MatrAIx survey bridge")
    parser.add_argument("--root", required=True, help="MatrAIx clone root")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--catalog", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--pool", default=None)
    parser.add_argument("--top", type=int, default=60)
    parser.add_argument("--workspace", default=None)
    parser.add_argument("--spec", default=None)
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    if not (root / "environment" / "runtime" / "harbor").is_dir():
        emit("run.failed", error="{} is not a MatrAIx checkout".format(root))
        return 2

    try:
        if args.check:
            return command_check(root)
        if args.catalog:
            return command_catalog(root, args.pool, max(1, min(int(args.top), 400)))
        if args.run:
            if not args.workspace or not args.spec:
                raise ValueError("--run needs both --workspace and --spec")
            return command_run(
                root,
                Path(args.workspace).expanduser().resolve(),
                Path(args.spec).expanduser().resolve(),
            )
    except Exception as exc:  # noqa: BLE001 - one protocol line, then a real traceback
        emit("run.failed", error="{}: {}".format(type(exc).__name__, str(exc)[:600]))
        traceback.print_exc(file=sys.stderr)
        return 1

    emit("run.failed", error="no command was given")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
