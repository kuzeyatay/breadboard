"""Supervised execution: real geometry, real exports, real failure modes.

These tests run the whole executor, so they build actual solids through
OpenCascade. They are the slowest tests in the repository and the only ones that
prove the service does what its contract says.
"""

import struct
import unittest
from pathlib import Path
from unittest.mock import patch

from breadboard_cad.executor import execute
from breadboard_cad.models import BuildRequest
from breadboard_cad.validation import passed

BOX = """
import cadquery as cq

DEFAULT_PARAMS = {"width": 40.0, "depth": 30.0, "height": 10.0}

def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    return {"block": cq.Workplane("XY").box(p["width"], p["depth"], p["height"])}
"""

ENCLOSURE = """
import cadquery as cq

DEFAULT_PARAMS = {
    "inner_width": 92.0,
    "inner_depth": 65.0,
    "inner_height": 28.0,
    "wall": 2.4,
    "lid_clearance": 0.35,
    "lid_thickness": 2.4,
}

def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    outer_width = p["inner_width"] + 2 * p["wall"]
    outer_depth = p["inner_depth"] + 2 * p["wall"]
    outer_height = p["inner_height"] + p["wall"]

    shell = (
        cq.Workplane("XY")
        .box(outer_width, outer_depth, outer_height, centered=(True, True, False))
        .faces(">Z")
        .shell(-p["wall"])
    )
    lid = (
        cq.Workplane("XY")
        .workplane(offset=outer_height + 10.0)
        .box(
            p["inner_width"] - 2 * p["lid_clearance"],
            p["inner_depth"] - 2 * p["lid_clearance"],
            p["lid_thickness"],
            centered=(True, True, False),
        )
    )
    return {"enclosure": shell, "lid": lid}
"""


def build(source, **overrides):
    payload = {
        "source": source,
        "entrypoint": "build_model",
        "parameters": {},
        "timeoutMs": 120_000,
        "exports": [
            {"format": "step", "filename": "model.step"},
            {"format": "stl", "filename": "model.stl"},
            {"format": "glb", "filename": "model.glb"},
        ],
    }
    payload.update(overrides)
    return execute(BuildRequest.model_validate(payload))


class ExecutionTest(unittest.TestCase):
    def test_a_valid_box_builds_measures_and_exports(self):
        outcome = build(BOX, expectations={"expectedSolidCount": 1, "boundingBox": {"x": 40, "y": 30, "z": 10}})
        result = outcome.result
        self.assertTrue(result.ok, result.failure)
        self.assertEqual(result.solid_count, 1)
        self.assertAlmostEqual(result.volume, 12_000.0, places=3)
        self.assertAlmostEqual(result.surface_area, 3_800.0, places=3)
        self.assertAlmostEqual(result.bounding_box.x, 40.0, places=6)
        self.assertAlmostEqual(result.bounding_box.y, 30.0, places=6)
        self.assertAlmostEqual(result.bounding_box.z, 10.0, places=6)
        self.assertTrue(result.solids[0].valid)
        self.assertTrue(result.solids[0].watertight)
        self.assertTrue(passed(result.issues), [i.model_dump() for i in result.issues])
        self.assertEqual({"step", "stl", "glb"}, set(outcome.files))

    def test_a_native_crash_is_rejected_even_after_writing_a_result(self):
        class CrashedWorker:
            returncode = -1073741819

            def __init__(self, argv, **_kwargs):
                Path(argv[-1]).write_text('{"ok":true}', encoding="utf-8")

            def communicate(self, timeout=None):  # noqa: ARG002 - subprocess-compatible fake
                return b"", b""

        with patch("breadboard_cad.executor.subprocess.Popen", CrashedWorker):
            outcome = build(BOX, exports=[])
        self.assertFalse(outcome.result.ok)
        self.assertEqual(outcome.result.failure.code, "worker_crashed")
        self.assertEqual(outcome.files, {})

    def test_step_and_stl_are_nonempty_and_parseable(self):
        outcome = build(BOX)
        step = outcome.files["step"].decode("utf-8", errors="replace")
        self.assertIn("ISO-10303-21", step)
        self.assertIn("MANIFOLD_SOLID_BREP", step)

        stl = outcome.files["stl"]
        self.assertGreater(len(stl), 84)
        if stl[:5] == b"solid":
            self.assertIn(b"facet normal", stl)
        else:
            (triangles,) = struct.unpack("<I", stl[80:84])
            self.assertEqual(len(stl), 84 + triangles * 50)
            self.assertGreaterEqual(triangles, 12)

        glb = outcome.files["glb"]
        self.assertEqual(glb[:4], b"glTF")

    def test_reported_hashes_match_the_bytes(self):
        import hashlib

        outcome = build(BOX)
        for export in outcome.result.exports:
            payload = outcome.files[export.format]
            self.assertEqual(export.byte_size, len(payload))
            self.assertEqual(export.sha256, hashlib.sha256(payload).hexdigest())

    def test_parameters_override_the_program_defaults(self):
        outcome = build(BOX, parameters={"width": 55.0, "height": 4.0})
        self.assertTrue(outcome.result.ok, outcome.result.failure)
        self.assertAlmostEqual(outcome.result.bounding_box.x, 55.0, places=6)
        self.assertAlmostEqual(outcome.result.bounding_box.z, 4.0, places=6)

    def test_the_program_reports_the_values_it_actually_built_with(self):
        # The program's own DEFAULT_PARAMS, with the supplied overrides applied.
        # Breadboard reconciles the design specification from this, so a
        # rewritten default is recorded rather than silently overwritten.
        outcome = build(BOX, parameters={"height": 4.0})
        self.assertTrue(outcome.result.ok, outcome.result.failure)
        self.assertEqual(
            outcome.result.effective_parameters,
            {"width": 40.0, "depth": 30.0, "height": 4.0},
        )

    def test_a_program_without_defaults_reports_only_its_overrides(self):
        source = (
            "import cadquery as cq\n"
            "def build_model(params):\n"
            "    size = params.get('size', 10.0)\n"
            "    return {'body': cq.Workplane('XY').box(size, size, size)}\n"
        )
        outcome = build(source, parameters={"size": 12.0})
        self.assertTrue(outcome.result.ok, outcome.result.failure)
        self.assertEqual(outcome.result.effective_parameters, {"size": 12.0})

    def test_output_is_reproducible(self):
        first = build(BOX)
        second = build(BOX)
        self.assertEqual(
            [export.sha256 for export in first.result.exports if export.format == "stl"],
            [export.sha256 for export in second.result.exports if export.format == "stl"],
        )

    def test_a_hollow_enclosure_with_a_lid_builds_as_two_bodies(self):
        outcome = build(
            ENCLOSURE,
            expectations={
                "expectedSolidCount": 2,
                "minimumWallThickness": 2.4,
                "clearances": [0.35],
                "printerBed": {"x": 220, "y": 220, "z": 250},
            },
        )
        result = outcome.result
        self.assertTrue(result.ok, result.failure)
        self.assertEqual(result.solid_count, 2)
        for solid in result.solids:
            self.assertTrue(solid.valid, solid.name)
            self.assertTrue(solid.watertight, solid.name)
        self.assertAlmostEqual(result.bounding_box.x, 96.8, places=3)
        # A lid modelled apart from its shell is a disconnected body, and that is
        # a warning about intent — never a reason to fail a two-part design.
        codes = {issue.code: issue.severity for issue in result.issues}
        self.assertEqual(codes.get("disconnected_bodies"), "warning")
        self.assertTrue(passed(result.issues), [i.model_dump() for i in result.issues])

    def test_overlapping_printed_bodies_fail_assembly_validation(self):
        source = (
            "import cadquery as cq\n"
            "def build_model(params):\n"
            "    first = cq.Workplane('XY').box(20, 20, 10)\n"
            "    second = cq.Workplane('XY').box(20, 20, 10).translate((10, 0, 0))\n"
            "    return {'chassis': first, 'carriage': second}\n"
        )
        outcome = build(source, expectations={"expectedSolidCount": 2})
        self.assertTrue(outcome.result.ok, outcome.result.failure)
        collisions = [
            issue for issue in outcome.result.issues
            if issue.code == "assembly_interference"
        ]
        self.assertEqual(len(collisions), 1)
        self.assertAlmostEqual(collisions[0].actual, 2_000.0, places=3)
        self.assertFalse(passed(outcome.result.issues))

    def test_an_empty_model_is_refused(self):
        outcome = build("def build_model(params):\n    return None\n")
        self.assertFalse(outcome.result.ok)
        self.assertEqual(outcome.result.failure.code, "empty_result")

    def test_a_runtime_error_reports_the_offending_line(self):
        source = (
            "import cadquery as cq\n"
            "def build_model(params):\n"
            "    return cq.Workplane('XY').box(1, 1, 0)\n"
        )
        outcome = build(source)
        self.assertFalse(outcome.result.ok)
        self.assertEqual(outcome.result.failure.code, "execution_error")
        self.assertEqual(outcome.result.failure.line, 3)

    def test_a_forbidden_import_never_reaches_a_process(self):
        source = "import os\ndef build_model(params):\n    return os.listdir('.')\n"
        outcome = build(source)
        self.assertFalse(outcome.result.ok)
        self.assertEqual(outcome.result.failure.code, "forbidden_source")
        self.assertTrue(
            any(v["code"] == "forbidden_import" for v in outcome.result.failure.violations)
        )
        # Nothing ran, so nothing was measured.
        self.assertEqual(outcome.result.solid_count, 0)
        self.assertEqual(outcome.files, {})

    def test_a_timeout_terminates_the_process_tree(self):
        source = (
            "import cadquery as cq\n"
            "def build_model(params):\n"
            "    total = 0\n"
            "    while True:\n"
            "        total += 1\n"
        )
        outcome = build(source, timeoutMs=4_000)
        self.assertFalse(outcome.result.ok)
        self.assertEqual(outcome.result.failure.code, "execution_timeout")
        # The deadline is honoured rather than merely reported: importing the
        # kernel costs a few seconds, so allow generous headroom over the 4 s.
        self.assertLess(outcome.result.duration_ms, 60_000)

    def test_a_part_larger_than_the_bed_is_an_error(self):
        outcome = build(
            BOX,
            parameters={"width": 400.0},
            expectations={"printerBed": {"x": 220, "y": 220, "z": 250}},
        )
        self.assertTrue(outcome.result.ok)
        codes = {issue.code for issue in outcome.result.issues if issue.severity == "error"}
        self.assertIn("exceeds_printer_bed", codes)
        self.assertFalse(passed(outcome.result.issues))

    def test_a_declared_dimension_that_the_geometry_misses_is_an_error(self):
        outcome = build(BOX, expectations={"boundingBox": {"x": 60.0, "y": 30.0, "z": 10.0}})
        self.assertTrue(outcome.result.ok)
        mismatches = [i for i in outcome.result.issues if i.code == "bounding_box_mismatch"]
        self.assertEqual(len(mismatches), 1)
        self.assertEqual(mismatches[0].expected, 60.0)
        self.assertAlmostEqual(mismatches[0].actual, 40.0, places=3)

    def test_a_wrong_solid_count_is_an_error(self):
        outcome = build(BOX, expectations={"expectedSolidCount": 2})
        codes = {i.code for i in outcome.result.issues if i.severity == "error"}
        self.assertIn("solid_count_mismatch", codes)

    def test_a_sub_millimetre_wall_is_flagged(self):
        outcome = build(
            BOX,
            parameters={"height": 0.4},
            expectations={"minimumFeatureSize": 0.8, "minimumWallThickness": 0.4},
        )
        codes = {i.code for i in outcome.result.issues}
        self.assertIn("feature_below_minimum", codes)
        self.assertIn("wall_below_minimum_feature", codes)

    def test_the_worker_environment_carries_no_caller_secrets(self):
        import os

        os.environ["BREADBOARD_CAD_TEST_SECRET"] = "must-not-leak"
        try:
            from breadboard_cad.executor import _child_environment

            environment = _child_environment(os.getcwd())
            self.assertNotIn("BREADBOARD_CAD_TEST_SECRET", environment)
            self.assertNotIn("BREADBOARD_CAD_SECRET", environment)
            self.assertNotIn("OPENAI_API_KEY", environment)
        finally:
            os.environ.pop("BREADBOARD_CAD_TEST_SECRET", None)


if __name__ == "__main__":
    unittest.main()
