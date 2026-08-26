"""Importing CAD exchange files: real geometry in, a real mesh out.

The /convert path exists because a browser cannot read boundary-representation
formats — STEP describes trimmed surfaces, not triangles, and evaluating them is
what OpenCascade is for. These tests run the whole executor, so a passing run
proves an attached STEP file really does become something a viewer can draw.
"""

import base64
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from breadboard_cad.executor import convert
from breadboard_cad.models import ConvertRequest


def _request(payload: bytes, fmt: str = "step") -> ConvertRequest:
    return ConvertRequest.model_validate(
        {
            "format": fmt,
            "contentBase64": base64.b64encode(payload).decode("ascii"),
            "timeoutMs": 300_000,
            "exports": [{"format": "glb", "filename": "preview.glb"}],
        }
    )


def _source_fixtures() -> dict[str, bytes]:
    """Create exchange fixtures in a one-shot kernel child.

    CadQuery 2.6.0's pinned Windows native graph can fault while CPython
    unloads it. Keeping fixture generation in the same direct-exit lifecycle
    as the production worker prevents a successful test process from crashing
    during interpreter teardown.
    """
    with tempfile.TemporaryDirectory() as directory:
        script = f"""
import os
import sys
import cadquery as cq
from OCP.IGESControl import IGESControl_Writer

directory = {directory!r}
step_part = cq.Workplane("XY").box(30, 20, 10).faces(">Z").workplane().hole(6)
cq.exporters.export(step_part, os.path.join(directory, "part.step"), exportType="STEP")

shape = cq.Workplane("XY").box(20, 20, 20).val()
shape.exportBrep(os.path.join(directory, "part.brep"))
writer = IGESControl_Writer()
writer.AddShape(shape.wrapped)
writer.Write(os.path.join(directory, "part.igs"))

sys.stdout.flush()
sys.stderr.flush()
os._exit(0)
"""
        completed = subprocess.run(
            [sys.executable, "-s", "-B", "-c", script],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(
                f"CAD fixture child exited with code {completed.returncode}: {detail[:2_000]}"
            )
        return {
            name: (Path(directory) / name).read_bytes()
            for name in ("part.step", "part.brep", "part.igs")
        }


class ImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixtures = _source_fixtures()
        cls.step = fixtures["part.step"]
        cls.brep = fixtures["part.brep"]
        cls.iges = fixtures["part.igs"]

    def test_a_step_file_becomes_a_mesh_the_browser_can_draw(self) -> None:
        outcome = convert(_request(self.step))
        result = outcome.result

        self.assertTrue(result.ok, result.failure.message if result.failure else "")
        self.assertEqual(result.solid_count, 1)
        # The measurements are the kernel's, taken from the solid rather than
        # from the mesh made of it.
        self.assertAlmostEqual(result.bounding_box.x, 30.0, places=3)
        self.assertAlmostEqual(result.bounding_box.y, 20.0, places=3)
        self.assertAlmostEqual(result.bounding_box.z, 10.0, places=3)
        self.assertGreater(result.volume, 0)
        self.assertTrue(result.solids[0].watertight)
        self.assertGreater(result.tessellation.triangle_count, 0)

        glb = outcome.files["glb"]
        self.assertGreater(len(glb), 0)
        # glTF's container magic: what came back really is a GLB.
        self.assertEqual(glb[:4], b"glTF")

    def test_the_kernel_reads_brep_and_iges_as_well(self) -> None:
        brep = convert(_request(self.brep, "brep")).result
        self.assertTrue(brep.ok, brep.failure.message if brep.failure else "")
        self.assertAlmostEqual(brep.bounding_box.x, 20.0, places=3)

        iges = convert(_request(self.iges, "iges")).result
        self.assertTrue(iges.ok, iges.failure.message if iges.failure else "")
        self.assertAlmostEqual(iges.bounding_box.x, 20.0, places=3)

    def test_a_malformed_file_is_a_typed_failure_not_a_crash(self) -> None:
        result = convert(_request(b"this is not a STEP file at all")).result
        self.assertFalse(result.ok)
        self.assertEqual(result.failure.code, "import_failed")
        self.assertEqual(result.exports, [])

    def test_a_file_with_no_geometry_says_so(self) -> None:
        empty = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"
        result = convert(_request(empty)).result
        self.assertFalse(result.ok)
        self.assertEqual(result.failure.code, "import_empty")

    def test_the_payload_must_be_base64_and_within_the_import_limit(self) -> None:
        bad = ConvertRequest.model_validate(
            {"format": "step", "contentBase64": "not base64 !!", "timeoutMs": 60_000}
        )
        self.assertEqual(convert(bad).result.failure.code, "invalid_import_payload")

        empty = ConvertRequest.model_validate(
            {"format": "step", "contentBase64": "", "timeoutMs": 60_000}
        )
        self.assertEqual(convert(empty).result.failure.code, "invalid_import_payload")

    def test_an_oversized_import_is_refused_before_the_kernel_starts(self) -> None:
        from breadboard_cad import executor

        original = executor.MAX_IMPORT_BYTES
        executor.MAX_IMPORT_BYTES = 16
        try:
            result = convert(_request(self.step)).result
        finally:
            executor.MAX_IMPORT_BYTES = original
        self.assertFalse(result.ok)
        self.assertEqual(result.failure.code, "import_too_large")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
