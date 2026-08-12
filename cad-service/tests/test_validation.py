"""Validation rules, exercised against measurements rather than through a build."""

import unittest

from breadboard_cad.models import (
    BoundingBox,
    SolidSummary,
    TessellationSummary,
    ValidationExpectations,
)
from breadboard_cad.validation import passed, validate_model


def box(x=40.0, y=30.0, z=10.0, origin=(0.0, 0.0, 0.0)):
    return BoundingBox(
        x=x,
        y=y,
        z=z,
        xmin=origin[0],
        ymin=origin[1],
        zmin=origin[2],
        xmax=origin[0] + x,
        ymax=origin[1] + y,
        zmax=origin[2] + z,
    )


def solid(name="body", *, valid=True, watertight=True, volume=12_000.0, bounds=None):
    return SolidSummary(
        name=name,
        volume=volume,
        surfaceArea=3_800.0,
        boundingBox=bounds or box(),
        valid=valid,
        watertight=watertight,
        faceCount=6,
        edgeCount=12,
    )


def mesh(**overrides):
    payload = {
        "linearTolerance": 0.05,
        "angularTolerance": 0.2,
        "vertexCount": 24,
        "triangleCount": 12,
        "degenerateTriangleCount": 0,
        "nonManifoldEdgeCount": 0,
        "openEdgeCount": 0,
        "hasNonFiniteCoordinates": False,
    }
    payload.update(overrides)
    return TessellationSummary.model_validate(payload)


def run(solids, expectations=None, tessellation=None, exports=("step", "stl", "glb")):
    return validate_model(
        solids,
        box() if not solids else None or _combined(solids),
        tessellation or mesh(),
        ValidationExpectations.model_validate(expectations or {}),
        list(exports),
    )


def _combined(solids):
    boxes = [item.bounding_box for item in solids]
    xmin = min(b.xmin for b in boxes)
    ymin = min(b.ymin for b in boxes)
    zmin = min(b.zmin for b in boxes)
    xmax = max(b.xmax for b in boxes)
    ymax = max(b.ymax for b in boxes)
    zmax = max(b.zmax for b in boxes)
    return BoundingBox(
        x=xmax - xmin,
        y=ymax - ymin,
        z=zmax - zmin,
        xmin=xmin,
        ymin=ymin,
        zmin=zmin,
        xmax=xmax,
        ymax=ymax,
        zmax=zmax,
    )


def codes(issues, severity=None):
    return {i.code for i in issues if severity is None or i.severity == severity}


class ValidationTest(unittest.TestCase):
    def test_a_sound_solid_passes(self):
        issues = run([solid()])
        self.assertTrue(passed(issues), [i.model_dump() for i in issues])

    def test_no_solid_is_a_single_terminal_error(self):
        issues = run([])
        self.assertEqual([i.code for i in issues], ["no_solid"])
        self.assertFalse(passed(issues))

    def test_an_invalid_shape_is_an_error(self):
        issues = run([solid(valid=False)])
        self.assertIn("invalid_shape", codes(issues, "error"))

    def test_an_open_body_cannot_be_printed(self):
        issues = run([solid(watertight=False)])
        self.assertIn("not_watertight", codes(issues, "error"))

    def test_a_zero_volume_body_is_an_error(self):
        issues = run([solid(volume=0.0)])
        self.assertIn("degenerate_solid", codes(issues, "error"))

    def test_every_issue_carries_the_documented_shape(self):
        issues = run([solid(valid=False)], {"expectedSolidCount": 3, "printerBed": {"x": 1}})
        self.assertTrue(issues)
        for issue in issues:
            payload = issue.model_dump(by_alias=True)
            self.assertIn(payload["severity"], {"info", "warning", "error"})
            self.assertTrue(payload["code"])
            self.assertTrue(payload["message"])
            self.assertEqual(
                set(payload),
                {"code", "severity", "message", "feature", "expected", "actual", "repairHint"},
            )

    def test_declared_dimensions_are_checked_within_tolerance(self):
        inside = run([solid()], {"boundingBox": {"x": 40.4}, "boundingBoxTolerance": 0.6})
        self.assertNotIn("bounding_box_mismatch", codes(inside))
        outside = run([solid()], {"boundingBox": {"x": 41.4}, "boundingBoxTolerance": 0.6})
        self.assertIn("bounding_box_mismatch", codes(outside, "error"))

    def test_separated_bodies_are_reported_as_a_warning(self):
        far = solid("lid", bounds=box(origin=(500.0, 0.0, 0.0)))
        issues = run([solid(), far])
        self.assertIn("disconnected_bodies", codes(issues, "warning"))
        self.assertTrue(passed(issues))

    def test_touching_bodies_are_not_reported(self):
        touching = solid("lid", bounds=box(z=4.0, origin=(0.0, 0.0, 10.0)))
        issues = run([solid(), touching], {"expectedSolidCount": 2})
        self.assertNotIn("disconnected_bodies", codes(issues))

    def test_holes_below_the_minimum_feature_size_are_warned_about(self):
        issues = run([solid()], {"holeDiameters": [0.4], "minimumFeatureSize": 0.8})
        self.assertIn("hole_below_minimum", codes(issues, "warning"))

    def test_an_impossible_hole_is_an_error(self):
        issues = run([solid()], {"holeDiameters": [0.0]})
        self.assertIn("invalid_hole_diameter", codes(issues, "error"))

    def test_tight_clearances_are_warned_about(self):
        issues = run([solid()], {"clearances": [0.05]})
        self.assertIn("clearance_too_tight", codes(issues, "warning"))

    def test_the_printer_bed_is_enforced_on_every_axis(self):
        issues = run([solid()], {"printerBed": {"x": 220, "y": 220, "z": 5}})
        self.assertIn("exceeds_printer_bed", codes(issues, "error"))

    def test_mesh_defects_are_errors(self):
        issues = run([solid()], tessellation=mesh(openEdgeCount=6))
        self.assertIn("open_mesh_edges", codes(issues, "error"))
        issues = run([solid()], tessellation=mesh(nonManifoldEdgeCount=2))
        self.assertIn("non_manifold_mesh", codes(issues, "error"))
        issues = run([solid()], tessellation=mesh(hasNonFiniteCoordinates=True))
        self.assertIn("mesh_non_finite", codes(issues, "error"))
        issues = run([solid()], tessellation=mesh(triangleCount=0))
        self.assertIn("tessellation_empty", codes(issues, "error"))

    def test_degenerate_triangles_are_only_a_warning(self):
        issues = run([solid()], tessellation=mesh(degenerateTriangleCount=3))
        self.assertIn("degenerate_triangles", codes(issues, "warning"))
        self.assertTrue(passed(issues))

    def test_a_missing_stl_export_is_reported(self):
        issues = run([solid()], exports=("step",))
        self.assertIn("stl_not_exported", codes(issues, "warning"))

    def test_a_hollowing_operation_that_did_nothing_is_an_error(self):
        # 40 mm cube, 30 mm walls, and the body still fills its whole envelope:
        # `shell` returned the original solid instead of raising.
        block = solid("shell", volume=64_000.0, bounds=box(40.0, 40.0, 40.0))
        issues = run([block], {"minimumWallThickness": 30.0})
        hollow = [i for i in issues if i.code == "hollowing_had_no_effect"]
        self.assertEqual(len(hollow), 1)
        self.assertEqual(hollow[0].severity, "error")
        self.assertIn("shell", hollow[0].repair_hint)
        self.assertFalse(passed(issues))

    def test_a_genuinely_hollow_body_is_not_flagged(self):
        shell = solid("shell", volume=20_000.0, bounds=box(40.0, 40.0, 40.0))
        issues = run([shell], {"minimumWallThickness": 2.4})
        self.assertNotIn("hollowing_had_no_effect", codes(issues))

    def test_a_flat_plate_whose_thickness_is_its_wall_is_not_flagged(self):
        # 60 × 40 × 2.4 mm at 2.4 mm "wall": solid on purpose.
        plate = solid("plate", volume=60 * 40 * 2.4, bounds=box(60.0, 40.0, 2.4))
        issues = run([plate], {"minimumWallThickness": 2.4})
        self.assertNotIn("hollowing_had_no_effect", codes(issues))

    def test_the_wall_thickness_limitation_is_disclosed(self):
        issues = run([solid()], {"minimumWallThickness": 2.4})
        disclosure = [i for i in issues if i.code == "wall_thickness_declared"]
        self.assertEqual(len(disclosure), 1)
        self.assertEqual(disclosure[0].severity, "info")
        self.assertIn("not", disclosure[0].message)

    def test_non_millimetre_units_are_disclosed(self):
        issues = run([solid()], {"units": "inch"})
        self.assertIn("units_not_millimetres", codes(issues, "info"))


if __name__ == "__main__":
    unittest.main()
