#!/usr/bin/env python3
"""Write a synthetic persona pool you can pick in Playground Dataset.

Default: sample ``--count`` rows (2000) into
``persona/datasets/generated-persona-dev-<count>/``.

``--strategy PATH`` fills the task's stratified cells (perCell / equalTotal /
proportional) so a later Playground draw will not run short.
``--task PATH --stratum-min N`` fills grounding probe cells.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from matraix.persona_dimension_catalog import values_for_dimension
from matraix.persona_generator import (
    build_probe_strata,
    generate_persona_pool,
    stratified_cell_quota,
    strategy_pin_cells,
    write_persona_dataset,
)
from matraix.task_catalog import (
    confounder_values_from_grounding,
    get_task_grounding_spec,
    probe_dimension_from_grounding,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_COUNT = 2000
DATASETS_DIR = REPO_ROOT / "persona" / "datasets"
DEFAULT_POOL_PREFIX = "generated-persona-dev"
# Keep in sync with playground persona_pool_service._DATASETS_SKIP_TOP_LEVEL.
_DATASETS_SKIP_TOP_LEVEL = frozenset(
    {"_generated", "_sampled", "cohorts", "matraix-persona-1m"}
)
DEFAULT_STRATEGY_STRATUM_MIN = 2
# Keep in sync with playground persona_pool_service.MAX_FILTER_STRATA.
MAX_FILTER_STRATA = 2048


def _default_out_dir(count: int) -> Path:
    return DATASETS_DIR / f"{DEFAULT_POOL_PREFIX}-{count}"


def _strategy_out_dir(task_slug: str) -> Path:
    return DATASETS_DIR / f"{DEFAULT_POOL_PREFIX}-strategy-{task_slug}"


def _is_picker_listed(out: Path) -> bool:
    try:
        rel = out.resolve().relative_to(DATASETS_DIR.resolve())
    except ValueError:
        return False
    return len(rel.parts) == 1 and rel.parts[0] not in _DATASETS_SKIP_TOP_LEVEL


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "strategy"


def _progress(stage: str, message: str) -> None:
    print(f"[{stage}] {message}", flush=True)


def _wipe_stale_personas(out: Path) -> int:
    """Remove leftover ``persona_*.yaml`` so a smaller rewrite cannot leave ghosts."""
    if not out.is_dir():
        return 0
    removed = 0
    for stale in out.glob("persona_*.yaml"):
        stale.unlink()
        removed += 1
    return removed


def _write_progress(stage: str, payload: dict) -> None:
    label = str(payload.get("label") or stage)
    if stage == "write":
        done = int(payload.get("done") or 0)
        total = int(payload.get("total") or 0)
        if total > 0:
            pct = round(100 * done / total)
            _progress("write", f"{label} ({pct}%)")
            return
    _progress(stage, label)


def _stratum_top_up_from_task(
    task_path: str,
) -> tuple[list[dict[str, str]], dict[str, object]]:
    grounding = get_task_grounding_spec(task_path, repo_root=REPO_ROOT)
    if not grounding:
        raise SystemExit(f"No grounding.toml (or catalog grounding) for {task_path!r}")
    confounders = confounder_values_from_grounding(grounding)
    probe_dimension = probe_dimension_from_grounding(grounding)
    if not confounders or not probe_dimension:
        raise SystemExit(
            f"Task {task_path!r} grounding must define confounders and probe_dimension"
        )
    probe_key = probe_dimension.removeprefix("dimensions.")
    probe_values = values_for_dimension(probe_key)
    if not probe_values:
        raise SystemExit(f"No catalog values for probe dimension {probe_key!r}")
    return build_probe_strata(
        confounders=confounders,
        probe_dimension=probe_dimension,
        probe_values=probe_values,
    ), grounding


def _resolve_strategy_path(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = REPO_ROOT / path
    if path.is_dir():
        candidate = path / "persona_strategy.json"
        if not candidate.is_file():
            raise SystemExit(f"No persona_strategy.json under {path}")
        return candidate
    if path.is_file():
        return path
    raise SystemExit(f"Strategy path not found: {raw}")


def _load_strategy(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to read strategy {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise SystemExit(f"Strategy {path} must be a JSON object")
    # Prefer shared normalizer when Playground backend is importable.
    try:
        from backend.service.persona_strategy import normalize_persona_strategy

        return normalize_persona_strategy(raw)
    except Exception:  # noqa: BLE001 — CLI fallback without playground on path
        filters = raw.get("dimensionFilters") or {}
        if not isinstance(filters, dict):
            filters = {}
        normalized_filters: dict[str, list[str]] = {}
        for key, values in filters.items():
            dim = str(key).removeprefix("dimensions.").strip()
            if not dim:
                continue
            if isinstance(values, list):
                cleaned = [str(v).strip() for v in values if str(v).strip()]
            else:
                text = str(values).strip()
                cleaned = [text] if text else []
            if cleaned:
                normalized_filters[dim] = cleaned
        sources = raw.get("sources") or []
        if not isinstance(sources, list):
            sources = []
        sampling = raw.get("sampling") if isinstance(raw.get("sampling"), dict) else {}
        stratify = sampling.get("fields") or []
        if not isinstance(stratify, list):
            stratify = []
        per_group = sampling.get("perCell")
        sample_size = sampling.get("sampleSize")
        return {
            "dimensionFilters": normalized_filters,
            "sources": [str(s).strip() for s in sources if str(s).strip()],
            "sampling": {
                "mode": str(sampling.get("mode") or "random"),
                "fields": [str(s).strip() for s in stratify if str(s).strip()],
                "allocation": sampling.get("allocation"),
                "perCell": per_group if isinstance(per_group, int) else None,
                "sampleSize": sample_size if isinstance(sample_size, int) else None,
            },
        }


def _stratum_top_up_from_strategy(
    strategy_path: Path,
) -> tuple[list[dict[str, str]], dict[str, object], int]:
    strategy = _load_strategy(strategy_path)
    filters = strategy.get("dimensionFilters") or {}
    if not isinstance(filters, dict) or not filters:
        raise SystemExit(
            f"{strategy_path} has no dimensionFilters; nothing to top up. "
            "Add allow-lists for the cohort this task needs."
        )

    sampling = strategy.get("sampling") if isinstance(strategy.get("sampling"), dict) else {}
    stratify_fields = [
        str(field).removeprefix("dimensions.").strip()
        for field in (sampling.get("fields") or [])
        if str(field).strip()
    ]
    missing_axes = [field for field in stratify_fields if field not in filters]
    if missing_axes:
        raise SystemExit(
            f"{strategy_path}: every sampling.fields entry must also appear in "
            f"dimensionFilters (missing: {', '.join(missing_axes)})"
        )

    try:
        strata, dropped = strategy_pin_cells(
            dimension_filters={
                str(k): list(v) for k, v in filters.items() if isinstance(v, list)
            },
            stratify_fields=stratify_fields,
            max_strata=MAX_FILTER_STRATA,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if dropped:
        print(
            f"WARNING: dropped {len(dropped)} filter cells the DAG cannot pin "
            f"(unknown value or hard mask), e.g. {dropped[0]!r}"
        )
    if not strata:
        raise SystemExit(
            f"{strategy_path}: dimensionFilters produced zero cells the DAG can pin"
        )

    allocation = str(sampling.get("allocation") or "").strip() or None
    per_group = sampling.get("perCell")
    sample_size = sampling.get("sampleSize")
    try:
        stratum_min = stratified_cell_quota(
            allocation=allocation,
            per_cell=per_group if isinstance(per_group, int) else None,
            sample_size=sample_size if isinstance(sample_size, int) else None,
            n_cells=len(strata),
            default=DEFAULT_STRATEGY_STRATUM_MIN,
        )
    except ValueError as exc:
        raise SystemExit(f"{strategy_path}: {exc}") from exc

    meta = {
        "strategy_path": str(strategy_path.relative_to(REPO_ROOT)),
        "dimensionFilters": filters,
        "sampling": {
            "mode": sampling.get("mode"),
            "fields": stratify_fields,
            "allocation": allocation,
            "perCell": per_group if isinstance(per_group, int) else None,
            "sampleSize": sample_size if isinstance(sample_size, int) else None,
        },
        "strata_count": len(strata),
        "rows_per_cell": stratum_min,
    }
    return strata, meta, stratum_min


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help=(
            f"How many personas to sample (default: {DEFAULT_COUNT}; "
            "0 when --strategy is set)"
        ),
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help=(
            "Output directory (default: "
            f"persona/datasets/{DEFAULT_POOL_PREFIX}-<count>, listed in "
            "the Playground Dataset picker)"
        ),
    )
    parser.add_argument("--smoke-id", default="0042")
    parser.add_argument(
        "--task",
        default=None,
        help=(
            "Fill grounding probe cells for this task (requires --stratum-min)"
        ),
    )
    parser.add_argument(
        "--strategy",
        default=None,
        metavar="PATH",
        help=(
            "Fill this task's stratified cells (perCell / equalTotal / "
            "proportional) from persona_strategy.json so a later Dataset draw "
            "will not run short. Writes "
            f"persona/datasets/{DEFAULT_POOL_PREFIX}-strategy-<task>/ "
            "(listed in the Playground Dataset picker)."
        ),
    )
    parser.add_argument(
        "--stratum-min",
        type=int,
        default=None,
        help=(
            "Override rows per cell (--strategy quota otherwise follows "
            "perCell / equalTotal / proportional; "
            f"fallback {DEFAULT_STRATEGY_STRATUM_MIN})"
        ),
    )
    args = parser.parse_args()

    if args.task and args.strategy:
        raise SystemExit("Use either --task (grounding) or --strategy, not both")

    stratum_top_up: list[dict[str, str]] | None = None
    grounding_meta: dict[str, object] | None = None
    strategy_meta: dict[str, object] | None = None
    strategy_path: Path | None = None
    stratum_min = args.stratum_min if args.stratum_min is not None else 0

    if args.strategy:
        strategy_path = _resolve_strategy_path(args.strategy)
        stratum_top_up, strategy_meta, derived_min = _stratum_top_up_from_strategy(
            strategy_path
        )
        if args.stratum_min is None:
            stratum_min = derived_min
        elif args.stratum_min < 1:
            raise SystemExit("--stratum-min must be >= 1 when --strategy is set")
        else:
            stratum_min = args.stratum_min
        count = 0 if args.count is None else args.count
    elif args.task:
        if stratum_min < 1:
            raise SystemExit("--task requires --stratum-min >= 1")
        stratum_top_up, grounding_meta = _stratum_top_up_from_task(args.task)
        count = DEFAULT_COUNT if args.count is None else args.count
    else:
        count = DEFAULT_COUNT if args.count is None else args.count

    if count < 0:
        raise SystemExit("--count must be >= 0")

    if args.out is not None:
        out = args.out if args.out.is_absolute() else REPO_ROOT / args.out
    elif strategy_path is not None:
        out = _strategy_out_dir(_slug(strategy_path.parent.name))
    else:
        out = _default_out_dir(count if count > 0 else DEFAULT_COUNT)

    _progress("prepare", f"Output → {out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out}")
    removed = _wipe_stale_personas(out)
    if removed:
        _progress("prepare", f"Removed {removed} stale persona_*.yaml")

    if count > 0:
        _progress("sample", f"Sampling Full DAG ({count} personas, seed={args.seed})…")
    elif stratum_top_up and stratum_min > 0:
        _progress(
            "sample",
            f"Sampling stratified cells ({len(stratum_top_up)} × min {stratum_min})…",
        )
    else:
        _progress("sample", "Sampling…")

    personas = generate_persona_pool(
        count=count,
        seed=args.seed,
        smoke_persona_id=args.smoke_id,
        stratum_top_up=stratum_top_up,
        min_per_stratum=stratum_min,
        include_smoke=count > 0,
    )
    _progress("sample", f"Sampled {len(personas)} personas")

    kind = (
        f"{DEFAULT_POOL_PREFIX}-strategy-{_slug(strategy_path.parent.name)}"
        if strategy_path is not None
        else f"{DEFAULT_POOL_PREFIX}-{count if count > 0 else len(personas)}"
    )
    _progress("write", f"Writing {len(personas)} YAML files…")
    manifest = write_persona_dataset(
        out_dir=out,
        personas=personas,
        repo_root=REPO_ROOT,
        kind=kind,
        seed=args.seed,
        smoke_persona_id=args.smoke_id,
        on_progress=_write_progress,
    )
    if stratum_top_up and stratum_min > 0:
        if grounding_meta is not None:
            manifest["stratum_top_up"] = {
                "task": args.task,
                "min_per_stratum": stratum_min,
                "strata_count": len(stratum_top_up),
                "grounding": grounding_meta,
            }
        if strategy_meta is not None:
            manifest["stratum_top_up"] = {
                "strategy": strategy_meta,
                "min_per_stratum": stratum_min,
                "strata_count": len(stratum_top_up),
            }
        _progress("manifest", "Updating manifest with stratum metadata…")
        (out / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )

    rel_out = out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out
    _progress("done", f"Wrote {manifest['count']} personas to {rel_out}")
    if count > 0:
        print(f"Smoke: persona_{manifest['smoke_persona_id']}.yaml")
    print(
        f"Dimensions: {manifest.get('dimension_count', len(manifest['dimension_ids']))} fields"
    )
    if _is_picker_listed(out):
        print(f"Playground Dataset picker: {rel_out}")
    else:
        print(
            "Not listed in the Playground Dataset picker "
            f"(use --out persona/datasets/{DEFAULT_POOL_PREFIX}-<name>)."
        )
    if stratum_top_up and args.task:
        print(
            f"Filled {len(stratum_top_up)} grounding cells × min {stratum_min} "
            f"from {args.task}"
        )
    if stratum_top_up and strategy_path is not None:
        print(
            f"Filled {len(stratum_top_up)} filter cells × min {stratum_min} "
            f"from {strategy_path.relative_to(REPO_ROOT)}"
        )
        print(f'Point the task "pool" at "{rel_out}", or pick it in Playground Dataset.')


if __name__ == "__main__":
    main()
