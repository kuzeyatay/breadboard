"""Tests for synthetic persona consistency and generation."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from matraix.persona_consistency import validate_dimensions
from matraix.persona_generator import generate_persona_pool

REPO_ROOT = Path(__file__).resolve().parents[3]
MANIFEST = REPO_ROOT / "persona" / "datasets" / "matraix-persona-dev-sample" / "manifest.json"


def test_generate_dimensions_respects_fixed_life_stage_without_age() -> None:
    """Fixed life_stage must pick a compatible age (no empty seniority lists)."""
    import random

    from matraix.persona_consistency import LIFE_STAGE_BY_AGE, validate_dimensions
    from matraix.persona_generator import (
        generate_persona_dimensions,
        load_catalog_values,
    )
    from matraix.persona_consistency import load_dev_dimension_ids

    catalog = load_catalog_values()
    dev_ids = load_dev_dimension_ids()
    rng = random.Random(0)
    for life_stage in ("Student", "Mid-life", "Career change", "Retirement"):
        dims = generate_persona_dimensions(
            rng=rng,
            catalog=catalog,
            dev_dimension_ids=dev_ids,
            fixed_dimensions={"life_stage": life_stage, "values_priority": "Autonomy"},
        )
        assert dims["life_stage"] == life_stage
        assert life_stage in LIFE_STAGE_BY_AGE[dims["age_bracket"]]
        assert validate_dimensions(dims) == []


def test_validate_rejects_counterfactual_combo() -> None:
    errors = validate_dimensions(
        {
            "age_bracket": "18-24",
            "life_stage": "Retirement",
            "seniority": "Retired",
            "years_experience": "20+",
            "highest_education": "Secondary",
        }
    )
    assert errors
    assert any("life_stage" in err for err in errors)


def test_validate_accepts_v2_age_bracket_dash_style() -> None:
    assert (
        validate_dimensions(
            {
                "age_bracket": "18–24",
                "life_stage": "Early career",
                "seniority": "Entry",
                "years_experience": "0-2",
                "highest_education": "Bachelor's",
            }
        )
        == []
    )


def test_dev_dimension_ids_include_core_catalog_fields() -> None:
    from matraix.persona_consistency import load_dev_dimension_ids

    dev_ids = set(load_dev_dimension_ids())

    assert {
        "age_bracket",
        "socioeconomic_band",
        "tech_savviness",
        "risk_tolerance",
        "economic_motivation",
        "lstyle_diet_type",
        "health_dietary_restriction",
        "habit_meal_prepping",
        "habit_skipping_breakfast",
        "habit_late_night_snacking",
        "att_veganism",
        "fam_nutrition",
    } <= dev_ids
    assert any(dim_id.startswith("cuis_") for dim_id in dev_ids)
    assert len(dev_ids) == 124


def test_generate_pool_is_synthetic_full_dag() -> None:
    personas = generate_persona_pool(count=50, seed=99)
    for entry in personas:
        assert entry.get("source") == "synthetic"
        assert entry.get("version") == "1.0"
        assert len(entry["dimensions"]) >= 1000
        assert "age_bracket" in entry["dimensions"]
        assert "lstyle_diet_type" in entry["dimensions"]
        assert "health_dietary_restriction" in entry["dimensions"]
        assert "habit_meal_prepping" in entry["dimensions"]
        assert any(key.startswith("cuis_") for key in entry["dimensions"])


def test_top_up_strata_fills_filter_cells() -> None:
    from matraix.persona_generator import (
        build_probe_strata,
        generate_persona_pool,
        top_up_strata,
    )

    confounders = {
        "socioeconomic_band": "Middle",
        "age_bracket": "25-34",
        "risk_tolerance": "Balanced",
        "tech_savviness": "Comfortable",
    }
    strata = build_probe_strata(
        confounders=confounders,
        probe_dimension="dimensions.economic_motivation",
        probe_values=["Cost-sensitive", "Indifferent"],
    )
    personas = generate_persona_pool(count=50, seed=1, smoke_persona_id="0001")
    topped = top_up_strata(
        personas,
        strata=strata,
        min_per_stratum=2,
        seed=99,
    )
    assert len(topped) > len(personas)
    for stratum in strata:
        matches = [
            entry
            for entry in topped
            if all(entry["dimensions"].get(k) == v for k, v in stratum.items())
        ]
        assert len(matches) >= 2
        for entry in matches:
            assert entry.get("source") == "synthetic"


def test_build_filter_strata_cartesian() -> None:
    from matraix.persona_generator import build_filter_strata

    strata = build_filter_strata(
        {
            "age_bracket": ["25-34", "35-44"],
            "life_stage": ["Early career"],
        }
    )
    assert len(strata) == 2
    assert {"age_bracket": "25-34", "life_stage": "Early career"} in strata
    assert {"age_bracket": "35-44", "life_stage": "Early career"} in strata


def test_stratified_cell_quota_matches_playground_allocations() -> None:
    import pytest

    from matraix.persona_generator import stratified_cell_quota

    assert (
        stratified_cell_quota(
            allocation="perCell", per_cell=4, sample_size=None, n_cells=10
        )
        == 4
    )
    assert (
        stratified_cell_quota(
            allocation="equalTotal", per_cell=None, sample_size=8, n_cells=3
        )
        == 3
    )
    assert (
        stratified_cell_quota(
            allocation="proportional", per_cell=None, sample_size=8, n_cells=3
        )
        == 3
    )
    with pytest.raises(ValueError, match="below the stratified cell count"):
        stratified_cell_quota(
            allocation="equalTotal", per_cell=None, sample_size=2, n_cells=5
        )


def test_strategy_pin_cells_pins_extra_filters() -> None:
    from matraix.persona_generator import strategy_pin_cells

    cells, _dropped = strategy_pin_cells(
        dimension_filters={
            "age_bracket": ["25-34", "35-44"],
            "life_stage": ["Early career", "Mid-life"],
        },
        stratify_fields=["life_stage"],
        seed=1,
    )
    assert cells
    for cell in cells:
        assert cell["life_stage"] in {"Early career", "Mid-life"}
        assert cell["age_bracket"] in {"25-34", "35-44"}


def test_generate_pool_strategy_top_up_only() -> None:
    from matraix.persona_generator import (
        build_filter_strata,
        generate_persona_pool,
    )

    strata = build_filter_strata(
        {
            "age_bracket": ["25-34", "35-44"],
            "life_stage": ["Early career", "Mid-life"],
        }
    )
    personas = generate_persona_pool(
        count=0,
        seed=7,
        stratum_top_up=strata,
        min_per_stratum=2,
        include_smoke=False,
    )
    filled = 0
    for stratum in strata:
        matches = [
            entry
            for entry in personas
            if all(entry["dimensions"].get(k) == v for k, v in stratum.items())
        ]
        if not matches:
            continue
        filled += 1
        assert len(matches) >= 2
        for entry in matches:
            assert entry.get("source") == "synthetic"
    assert filled >= 1
    assert len(personas) >= 2 * filled


def test_checked_in_sample_manifest_is_consistent() -> None:
    """The dev sample is a slice of matraix-persona-1m, not generator output.

    Real personas carry a sparse subset of the catalog and legitimately break the
    synthetic generator's coherence rules, so only catalog membership is checked.
    """
    from matraix.persona_generator import load_catalog_values

    catalog_ids = set(load_catalog_values())
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert manifest["count"] == len(manifest["personas"])
    assert manifest["count"] >= 2
    assert manifest.get("schema_version") == "1.0"
    assert manifest.get("dimension_count") == len(manifest["dimension_ids"])
    assert set(manifest["dimension_ids"]) == catalog_ids
    assert str(manifest.get("parent_pool", "")).endswith("matraix-persona-1m")

    sources = set(manifest["source_counts"])
    assert sum(manifest["source_counts"].values()) == manifest["count"]
    for entry in manifest["personas"]:
        rel_path = entry if isinstance(entry, str) else entry["path"]
        if not isinstance(rel_path, str):
            rel_path = rel_path.split("/")[-1]
        yaml_path = MANIFEST.parent / Path(rel_path).name
        payload = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        assert payload.get("version") == "1.0"
        assert payload.get("source") in sources
        assert payload["dimensions"]
        assert set(payload["dimensions"]) <= catalog_ids
