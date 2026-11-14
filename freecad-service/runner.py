"""Trusted entrypoint executed by neka-nat/freecad-mcp's headless tool.

Generated code builds objects in a fresh document. Only this wrapper chooses
paths, saves FCStd, and exports STEP. Admission checks are not an OS sandbox.
"""
import ast
import json
import math
from pathlib import Path
import traceback

ALLOWED_IMPORTS = {"FreeCAD", "Part", "Sketcher", "math", "cmath", "itertools", "functools"}
DENIED = {
    "eval", "exec", "compile", "open", "input", "breakpoint", "globals", "locals",
    "vars", "getattr", "setattr", "delattr", "exit", "quit", "help",
    "openDocument", "newDocument", "closeDocument", "loadFile", "load", "save",
    "saveAs", "saveCopy", "export", "exportStep", "exportStl", "exportBrep",
    "exportIges", "read", "write", "restore", "importBrep", "importBinary",
    "ParamGet", "ConfigGet", "ConfigSet", "getHomePath", "getUserAppDataDir",
    "getResourceDir", "getUserCachePath", "getUserConfigDir", "getTempPath",
    "setLogLevel", "addImportType", "addExportType", "setImportType", "setExportType",
    "loadModule", "loadMacro", "runMacro", "Console", "ActiveDocument",
    "getDocument", "listDocuments", "FileName", "Proxy", "Observer",
}


def validate_source(source, entrypoint="build_model"):
    if len(source.encode("utf-8")) > 200_000:
        raise ValueError("FreeCAD source exceeds 200 KB")
    if entrypoint != "build_model":
        raise ValueError("FreeCAD programs must define build_model(doc, params)")
    tree = ast.parse(source, filename="model.py")
    nodes = list(ast.walk(tree))
    if len(nodes) > 40_000:
        raise ValueError("FreeCAD program is too complex")
    if not any(isinstance(n, ast.FunctionDef) and n.name == entrypoint for n in tree.body):
        raise ValueError("Define build_model(doc, params) and return named document objects")
    for node in nodes:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            if isinstance(node, ast.ImportFrom) and node.level:
                raise ValueError("Relative imports are not allowed")
            if any(name not in ALLOWED_IMPORTS for name in names):
                raise ValueError("Only FreeCAD, Part, Sketcher, math, cmath, itertools and functools imports are allowed")
        symbols = []
        if isinstance(node, ast.Name): symbols.append(node.id)
        if isinstance(node, ast.Attribute): symbols.append(node.attr)
        if isinstance(node, ast.alias): symbols.extend([node.name, node.asname or ""])
        if any(symbol.startswith("__") or symbol in DENIED for symbol in symbols):
            raise ValueError(f"Forbidden CAD operation at line {getattr(node, 'lineno', 0)}: {symbols}")
    return tree


def run(request):
    import FreeCAD as App
    import Part

    source = request["source"]
    tree = validate_source(source, request["entrypoint"])
    namespace = {"__name__": "breadboard_model"}
    exec(compile(tree, "model.py", "exec"), namespace)
    parameters = {**namespace.get("DEFAULT_PARAMS", {}), **request["parameters"]}
    if any(not isinstance(key, str) or not isinstance(value, (str, int, float, bool))
           or isinstance(value, float) and not math.isfinite(value)
           for key, value in parameters.items()):
        raise ValueError("Parameters must contain finite numbers, strings or booleans")
    doc = App.newDocument("BreadboardDesign")
    try:
        named = namespace["build_model"](doc, dict(parameters))
        doc.recompute()
        if not isinstance(named, dict) or not named or len(named) > 120:
            raise ValueError("build_model must return a non-empty dict of named document objects")
        objects = []
        for name, obj in named.items():
            if not isinstance(name, str) or not name.strip():
                raise ValueError("Every returned body needs a name")
            if getattr(obj, "Document", None) != doc or not hasattr(obj, "Shape"):
                raise ValueError(f"{name} must be an object in the supplied document, not a raw Part shape")
            shape = obj.Shape
            if shape.isNull() or not shape.isValid() or len(shape.Solids) != 1 or shape.Volume <= 0:
                raise ValueError(f"{name} must contain exactly one valid solid")
            if obj in objects:
                raise ValueError("The same body cannot be returned twice")
            obj.Label = name
            objects.append(obj)
        broken = [obj.Name for obj in doc.Objects if "Invalid" in obj.State or "Error" in obj.State]
        if broken:
            raise ValueError(f"FreeCAD features did not recompute: {broken}")
        target = Path(request["directory"])
        doc.saveAs(str(target / "model.FCStd"))
        Part.export(objects, str(target / "model.step"))
        return {
            "ok": True, "engineVersion": ".".join(App.Version()[:3]),
            "parameters": parameters, "bodyNames": list(named),
            "volume": sum(obj.Shape.Volume for obj in objects),
            "features": [{"name": obj.Name, "type": obj.TypeId} for obj in doc.Objects],
        }
    finally:
        App.closeDocument(doc.Name)


if "REQUEST_PATH" in globals():
    request = json.loads(Path(REQUEST_PATH).read_text(encoding="utf-8"))
    try:
        result = run(request)
    except Exception as error:
        result = {"ok": False, "error": str(error), "traceback": traceback.format_exc()[-6000:]}
    (Path(request["directory"]) / "result.json").write_text(json.dumps(result), encoding="utf-8")
    if not result["ok"]:
        raise RuntimeError(result["error"])
