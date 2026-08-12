"""Non-interactive iFixAi bridge used by Breadboard's maintenance scheduler.

The bridge accepts one JSON object on stdin and writes one JSON object on
stdout. Credentials stay off argv, iFixAi telemetry is disabled by the parent,
and every report is written beneath the caller-supplied isolated run directory.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from ifixai.api import run_selected
from ifixai.core.types import EvaluationMode, EvaluationPipelineConfig, TestRunResult
from ifixai.harness.suites import resolve_suite
from ifixai.inspections.holdout_ids import generate_holdout_ids
from ifixai.judge.config import JudgeConfig
from ifixai.reporting.artifact import render_artifact
from ifixai.reporting.scorecard import (
    generate_json_report,
    generate_markdown_report,
    generate_summary_report,
    scorecard_warnings,
)


MAX_STDIN_BYTES = 2 * 1024 * 1024
SEED_FIELDS = (
    "b12",
    "b14",
    "b28",
    "b30",
    "b29",
    "b32",
    "p13",
    "p19",
    "p22",
    "p27",
    "p32",
    "c02",
    "c05",
    "c11",
    "s02",
    "x04",
    "x11",
)


def _read_request() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
    if len(raw) > MAX_STDIN_BYTES:
        raise ValueError("request exceeds the 2 MiB input limit")
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("request must be a JSON object")
    return value


def _required_text(request: dict[str, Any], key: str) -> str:
    value = request.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required")
    return value.strip()


def _vendor(model: str) -> str:
    normalized = model.strip().lower()
    if "/" in normalized:
        return normalized.split("/", 1)[0]
    if normalized.startswith(("gpt-", "o1", "o3", "o4")):
        return "openai"
    if normalized.startswith("claude-"):
        return "anthropic"
    if normalized.startswith("gemini-"):
        return "google"
    if normalized.startswith(("llama-", "meta-")):
        return "meta"
    return "unknown"


def _pipeline(seed: int, with_judge: bool, max_calls: int) -> EvaluationPipelineConfig:
    values: dict[str, Any] = {
        "mode": EvaluationMode.SINGLE if with_judge else EvaluationMode.DETERMINISTIC,
        "judge_max_calls": max_calls,
    }
    for index, name in enumerate(SEED_FIELDS):
        values[f"{name}_seed"] = (seed + index * 104729) % (2**31)
        values[f"{name}_seed_pinned"] = True
    return EvaluationPipelineConfig(**values)


def _failure_payload(result: TestRunResult) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    for test in sorted(result.test_results, key=lambda item: item.score):
        if test.status.value not in {"fail", "error"}:
            continue
        evidence = []
        for item in test.evidence[:3]:
            evidence.append(
                {
                    "prompt": (item.prompt_sent or "")[:1200],
                    "expected": (item.expected_behavior or item.expected or "")[:800],
                    "actual": (item.actual_response or item.actual or "")[:1200],
                    "passed": item.passed,
                }
            )
        failures.append(
            {
                "id": test.test_id,
                "name": test.name,
                "category": test.category.value,
                "score": test.score,
                "threshold": test.threshold,
                "status": test.status.value,
                "evidence": evidence,
            }
        )
    return failures[:8]


def _summary(result: TestRunResult, output_dir: Path) -> dict[str, Any]:
    categories = {
        item.category.value: item.score
        for item in result.category_scores
        if item.score is not None
    }
    tests = {
        item.test_id: {"status": item.status.value, "score": item.score}
        for item in result.test_results
    }
    return {
        "ok": True,
        "score": result.overall_score,
        "grade": result.grade.value,
        "passed": result.passed,
        "partial": result.partial,
        "abortReason": result.abort_reason,
        "selfJudged": result.self_judged,
        "judgeRelation": result.judge_relation,
        "categories": categories,
        "tests": tests,
        "failures": _failure_payload(result),
        "warnings": list(result.warnings),
        "reports": {
            "json": str(output_dir / "report.json"),
            "markdown": str(output_dir / "report.md"),
            "summary": str(output_dir / "summary.md"),
            "html": str(output_dir / "report.html"),
        },
    }


async def _run(request: dict[str, Any]) -> dict[str, Any]:
    endpoint = _required_text(request, "endpoint")
    model = _required_text(request, "model")
    fixture = Path(_required_text(request, "fixture")).resolve()
    output_dir = Path(_required_text(request, "outputDir")).resolve()
    system_prompt = _required_text(request, "systemPrompt")
    suite_name = str(request.get("suite") or "strategic").strip().lower()
    seed = int(request.get("seed") or 1701)
    timeout = max(5, min(int(request.get("timeoutSeconds") or 120), 600))
    max_calls = max(1, min(int(request.get("judgeMaxCalls") or 200), 500))
    api_key = str(request.get("apiKey") or "")
    judge_model = str(request.get("judgeModel") or "").strip()

    if not fixture.is_file():
        raise ValueError(f"fixture does not exist: {fixture}")
    output_dir.mkdir(parents=True, exist_ok=False)

    suite = resolve_suite(suite_name)
    if suite["unknown"] or not suite["test_ids"]:
        raise ValueError(f"unknown or empty suite: {suite_name}")

    judge_config = None
    relation = ""
    if judge_model:
        judge_config = JudgeConfig(
            provider="http",
            model=judge_model,
            api_key=api_key,
            endpoint=endpoint,
            temperature=0.0,
            max_calls_per_run=max_calls,
            timeout=timeout,
        )
        sut_vendor = _vendor(model)
        judge_vendor = _vendor(judge_model)
        relation = (
            "cross-vendor"
            if sut_vendor != "unknown" and judge_vendor != "unknown" and sut_vendor != judge_vendor
            else "same-provider"
        )

    nonce_source = f"{seed}\0{suite_name}\0{hashlib.sha256(system_prompt.encode()).hexdigest()}"
    run_nonce = hashlib.sha256(nonce_source.encode()).hexdigest()[:16]
    result = await run_selected(
        test_ids=set(suite["test_ids"]),
        provider="http",
        fixture=str(fixture),
        api_key=api_key,
        system_name="Breadboard Hermes Assistant",
        system_version="proposal-evaluation-v1",
        endpoint=endpoint,
        model=model,
        system_prompt=system_prompt,
        timeout=timeout,
        max_retries=1,
        pipeline_config=_pipeline(seed, judge_config is not None, max_calls),
        judge_config=judge_config,
        sut_temperature=0.0,
        sut_seed=seed,
        run_nonce=run_nonce,
        holdout_ids=generate_holdout_ids(seed).to_dict(),
        auth_method="bearer",
    )
    result.judge_relation = relation
    result.self_judged = relation == "same-provider"
    if judge_config is not None:
        result.warnings = scorecard_warnings(
            judge_config,
            "http",
            model,
            extra=list(result.warnings),
        )

    (output_dir / "report.json").write_text(generate_json_report(result), encoding="utf-8")
    (output_dir / "report.md").write_text(generate_markdown_report(result), encoding="utf-8")
    (output_dir / "summary.md").write_text(generate_summary_report(result), encoding="utf-8")
    (output_dir / "report.html").write_text(
        render_artifact(
            result,
            live=True,
            transport="breadboard-local-chatmock",
            sut_model=model,
            judge_model=judge_model or "deterministic inspections only",
            honesty_note=(
                "Prompt-level evaluation through local ChatMock. Structural governance "
                "results come from the declared synthetic fixture, not the live capability broker."
            ),
        ),
        encoding="utf-8",
    )
    return _summary(result, output_dir)


def main() -> int:
    os.environ.setdefault("IFIXAI_TELEMETRY", "0")
    os.environ.setdefault("DO_NOT_TRACK", "1")
    try:
        response = asyncio.run(_run(_read_request()))
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as exc:  # The Node parent turns this into a durable receipt.
        print(
            json.dumps(
                {"ok": False, "error": f"{type(exc).__name__}: {exc}"},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
