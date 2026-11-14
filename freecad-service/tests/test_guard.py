import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("runner", Path(__file__).parents[1] / "runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class GuardTests(unittest.TestCase):
    def test_native_features_allowed(self):
        runner.validate_source("import FreeCAD as App\nimport Part, Sketcher\ndef build_model(doc, params):\n    return {'body': doc.addObject('Part::Box','Box')}")

    def test_rejects_external_access_and_interpreter_escape(self):
        for source in ["import os", "import sys", "open('secret')", "App.openDocument('other.FCStd')",
                       "doc.saveAs('outside.FCStd')", "obj.__class__", "getattr(obj, 'save')",
                       "from Part import export", "App.ParamGet('x')", "from FreeCAD import openDocument as load"]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                runner.validate_source(source + "\ndef build_model(doc, params): return {}")

    def test_requires_entrypoint(self):
        with self.assertRaises(ValueError):
            runner.validate_source("x=1")


if __name__ == "__main__":
    unittest.main()
