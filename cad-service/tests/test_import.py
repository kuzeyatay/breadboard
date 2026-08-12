"""Importing CAD exchange files: real geometry in, a real mesh out.

The /convert path exists because a browser cannot read boundary-representation
formats — STEP describes trimmed surfaces, not triangles, and evaluating them is
what OpenCascade is for. These tests run the whole executor, so a passing run
proves an attached STEP file really does become something a viewer can draw.
"""

import base64
import unittest

import cadquery as cq

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


def _export(shape, suffix: str, export_type: str) -> bytes:
    import os
    import tempfile

    directory = tempfile.mkdtemp()
    path = os.path.join(directory, f"part{suffix}")
    cq.exporters.export(shape, path, exportType=export_type)
    with open(path, "rb") as handle:
        return handle.read()


class ImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # A part with a hole, so the tessellation has something curved to do.
        cls.part = cq.Workplane("XY").box(30, 20, 10).faces(">Z").workplane().hole(6)
        cls.step = _export(cls.part, ".step", "STEP")

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
        from OCP.IGESControl import IGESControl_Writer

        import os
        import tempfile

        shape = cq.Workplane("XY").box(20, 20, 20).val()
        directory = tempfile.mkdtemp()

        brep_path = os.path.join(directory, "part.brep")
        shape.exportBrep(brep_path)
        with open(brep_path, "rb") as handle:
            brep = convert(_request(handle.read(), "brep")).result
        self.assertTrue(brep.ok, brep.failure.message if brep.failure else "")
        self.assertAlmostEqual(brep.bounding_box.x, 20.0, places=3)

        iges_path = os.path.join(directory, "part.igs")
        writer = IGESControl_Writer()
        writer.AddShape(shape.wrapped)
        writer.Write(iges_path)
        with open(iges_path, "rb") as handle:
            iges = convert(_request(handle.read(), "iges")).result
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
