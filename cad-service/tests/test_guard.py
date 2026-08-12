"""Static admission control: what a generated CAD program may and may not do."""

import unittest

from breadboard_cad.guard import check_source

SAFE = """
import cadquery as cq
import math

DEFAULT_PARAMS = {"width": 40.0}

def helper(value):
    return value * math.sqrt(2.0)

def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    return {"body": cq.Workplane("XY").box(p["width"], 20.0, 5.0)}
"""


def codes(source, entrypoint="build_model"):
    return sorted({violation.code for violation in check_source(source, entrypoint).violations})


class GuardTest(unittest.TestCase):
    def test_safe_source_is_admitted(self):
        result = check_source(SAFE)
        self.assertTrue(result.ok, [v.as_dict() for v in result.violations])

    def test_allowed_helper_imports(self):
        for module in ("math", "itertools", "functools", "dataclasses", "enum", "typing"):
            source = f"import {module}\ndef build_model(params):\n    return None\n"
            self.assertTrue(check_source(source).ok, module)

    def test_dangerous_imports_are_refused(self):
        for module in (
            "os",
            "sys",
            "subprocess",
            "socket",
            "requests",
            "urllib",
            "http",
            "pathlib",
            "shutil",
            "ctypes",
            "importlib",
            "pickle",
            "threading",
        ):
            source = f"import {module}\ndef build_model(params):\n    return None\n"
            self.assertIn("forbidden_import", codes(source), module)

    def test_from_imports_are_refused_too(self):
        self.assertIn(
            "forbidden_import",
            codes("from os import path\ndef build_model(params):\n    return None\n"),
        )

    def test_unlisted_import_is_refused(self):
        self.assertIn(
            "import_not_allowed",
            codes("import numpy\ndef build_model(params):\n    return None\n"),
        )

    def test_relative_import_is_refused(self):
        self.assertIn(
            "relative_import",
            codes("from . import thing\ndef build_model(params):\n    return None\n"),
        )

    def test_dynamic_evaluation_is_refused(self):
        for snippet in (
            "eval('1+1')",
            "exec('x=1')",
            "compile('1', 'x', 'eval')",
            "__import__('os')",
            "globals()",
            "getattr(object, 'x')",
        ):
            source = f"def build_model(params):\n    {snippet}\n    return None\n"
            self.assertTrue(
                {"forbidden_call", "forbidden_name"} & set(codes(source)),
                snippet,
            )

    def test_file_access_is_refused(self):
        source = "def build_model(params):\n    open('/etc/passwd')\n    return None\n"
        self.assertIn("forbidden_call", codes(source))

    def test_interpreter_internals_are_refused(self):
        source = (
            "def build_model(params):\n"
            "    return ().__class__.__bases__[0].__subclasses__()\n"
        )
        self.assertIn("forbidden_attribute", codes(source))

    def test_process_control_attributes_are_refused(self):
        source = "def build_model(params):\n    params.system('dir')\n    return None\n"
        self.assertIn("forbidden_attribute", codes(source))

    def test_global_state_is_refused(self):
        source = "COUNT = 0\ndef build_model(params):\n    global COUNT\n    COUNT += 1\n    return None\n"
        self.assertIn("global_state", codes(source))

    def test_context_managers_are_refused(self):
        source = "def build_model(params):\n    with params:\n        pass\n    return None\n"
        self.assertIn("context_manager", codes(source))

    def test_async_is_refused(self):
        source = "async def build_model(params):\n    return None\n"
        self.assertIn("async_not_supported", codes(source))

    def test_missing_entrypoint_is_refused(self):
        self.assertIn("missing_entrypoint", codes("import cadquery as cq\nx = 1\n"))

    def test_syntax_error_is_reported_with_a_line(self):
        result = check_source("def build_model(params)\n    return None\n")
        self.assertFalse(result.ok)
        self.assertEqual(result.violations[0].code, "syntax_error")
        self.assertGreater(result.violations[0].line, 0)

    def test_empty_source_is_refused(self):
        self.assertIn("empty_source", codes("   \n"))

    def test_oversized_source_is_refused(self):
        source = "def build_model(params):\n    return None\n" + ("# padding\n" * 400_000)
        self.assertTrue({"source_too_large", "source_too_long"} & set(codes(source)))

    def test_every_violation_is_reported_not_just_the_first(self):
        source = "import os\nimport socket\ndef build_model(params):\n    return eval('1')\n"
        result = check_source(source)
        self.assertGreaterEqual(len(result.violations), 3)


if __name__ == "__main__":
    unittest.main()
