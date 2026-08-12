"""Static admission control for model-generated CAD source.

Every program is parsed and walked before a process is spawned for it, and the
worker repeats the same check on the source it is handed. The rules are an
allowlist for imports and a denylist for the names and syntax that would let a
program leave the CAD problem domain: process control, the filesystem, the
network, dynamic evaluation, and attribute paths that reach the interpreter
internals.

This is admission control, not a sandbox. It removes the obvious escapes from a
program the model wrote for us; it is not a defence against an adversary who
controls the source. The process isolation in ``executor`` is the boundary that
matters, and its limits are documented in docs/PARAMETRIC_CAD_AGENT_DEV.md.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field

#: Modules a CAD program may import. Everything a parametric part needs to
#: describe geometry, and nothing that reaches outside the process.
ALLOWED_IMPORTS: frozenset[str] = frozenset(
    {
        "cadquery",
        "math",
        "cmath",
        "statistics",
        "decimal",
        "fractions",
        "itertools",
        "functools",
        "operator",
        "typing",
        "dataclasses",
        "enum",
        "collections",
        "copy",
        "numbers",
    }
)

#: Modules named explicitly in the threat model. They are already excluded by
#: the allowlist; naming them produces a specific message instead of a generic
#: "not allowed", which is what makes a repair prompt actionable.
DENIED_IMPORTS: frozenset[str] = frozenset(
    {
        "os",
        "sys",
        "subprocess",
        "socket",
        "socketserver",
        "requests",
        "urllib",
        "urllib3",
        "http",
        "httpx",
        "ftplib",
        "smtplib",
        "telnetlib",
        "asyncio",
        "multiprocessing",
        "threading",
        "concurrent",
        "signal",
        "ctypes",
        "cffi",
        "pathlib",
        "shutil",
        "tempfile",
        "glob",
        "io",
        "pickle",
        "shelve",
        "marshal",
        "dill",
        "importlib",
        "imp",
        "runpy",
        "builtins",
        "gc",
        "inspect",
        "traceback",
        "code",
        "codeop",
        "compileall",
        "py_compile",
        "pty",
        "webbrowser",
        "platform",
        "sysconfig",
        "site",
        "resource",
        "pwd",
        "grp",
        "atexit",
    }
)

#: Callables a program may never name, whatever it imports.
DENIED_CALLS: frozenset[str] = frozenset(
    {
        "eval",
        "exec",
        "compile",
        "open",
        "input",
        "breakpoint",
        "__import__",
        "globals",
        "locals",
        "vars",
        "getattr",
        "setattr",
        "delattr",
        "memoryview",
        "exit",
        "quit",
        "help",
    }
)

#: Attribute names that reach the interpreter's own machinery. Blocking dunder
#: attribute access closes the usual `().__class__.__bases__[0]...` route to
#: arbitrary objects. Ordinary method names that a legitimate part description
#: might use (``list.remove``, say) are deliberately absent: the import
#: allowlist already keeps `os` and friends out of scope, so listing them here
#: would only reject correct programs.
DENIED_ATTRIBUTES: frozenset[str] = frozenset(
    {
        "__class__",
        "__bases__",
        "__base__",
        "__subclasses__",
        "__mro__",
        "__globals__",
        "__builtins__",
        "__code__",
        "__closure__",
        "__func__",
        "__self__",
        "__dict__",
        "__getattribute__",
        "__reduce__",
        "__reduce_ex__",
        "__init_subclass__",
        "__loader__",
        "__spec__",
        "system",
        "popen",
        "spawn",
        "fork",
        "unlink",
        "rmdir",
        "rmtree",
        "chmod",
        "chown",
        "environ",
        "getenv",
        "putenv",
        "urlopen",
    }
)

#: A generated program is a description of one part. Anything longer is either
#: a mistake or an attempt to hide something in the noise.
MAX_SOURCE_BYTES = 200_000
MAX_SOURCE_LINES = 4_000
MAX_AST_NODES = 40_000


@dataclass(frozen=True)
class GuardViolation:
    """One reason a program was refused, in the shape the agent repairs from."""

    code: str
    message: str
    line: int = 0
    symbol: str = ""

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
            "line": self.line,
            "symbol": self.symbol,
        }


@dataclass
class GuardResult:
    ok: bool
    violations: list[GuardViolation] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "violations": [violation.as_dict() for violation in self.violations],
        }


def _root_module(name: str) -> str:
    return name.split(".", 1)[0]


class _Walker(ast.NodeVisitor):
    def __init__(self, entrypoint: str) -> None:
        self.entrypoint = entrypoint
        self.violations: list[GuardViolation] = []
        self.node_count = 0
        self.defined_functions: set[str] = set()

    def visit(self, node: ast.AST) -> None:
        self.node_count += 1
        if self.node_count > MAX_AST_NODES:
            raise _TooComplex()
        super().visit(node)

    def _refuse(self, code: str, message: str, node: ast.AST, symbol: str = "") -> None:
        self.violations.append(
            GuardViolation(
                code=code,
                message=message,
                line=getattr(node, "lineno", 0) or 0,
                symbol=symbol,
            )
        )

    # -- imports ----------------------------------------------------------
    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_module(alias.name, node)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.level:
            self._refuse(
                "relative_import",
                "Relative imports are not available: a generated program is a single file.",
                node,
            )
        elif node.module:
            self._check_module(node.module, node)
        self.generic_visit(node)

    def _check_module(self, name: str, node: ast.AST) -> None:
        root = _root_module(name)
        if root in DENIED_IMPORTS:
            self._refuse(
                "forbidden_import",
                f"`{name}` is not available. CAD source may not touch the filesystem, "
                "processes, or the network — describe the geometry instead.",
                node,
                root,
            )
            return
        if root not in ALLOWED_IMPORTS:
            allowed = ", ".join(sorted(ALLOWED_IMPORTS))
            self._refuse(
                "import_not_allowed",
                f"`{name}` is not in the CAD import allowlist. Allowed: {allowed}.",
                node,
                root,
            )

    # -- calls and names --------------------------------------------------
    def visit_Call(self, node: ast.Call) -> None:
        target = node.func
        if isinstance(target, ast.Name) and target.id in DENIED_CALLS:
            self._refuse(
                "forbidden_call",
                f"`{target.id}()` is not available in CAD source.",
                node,
                target.id,
            )
        if isinstance(target, ast.Attribute) and target.attr in DENIED_ATTRIBUTES:
            self._refuse(
                "forbidden_attribute",
                f"`.{target.attr}` is not available in CAD source.",
                node,
                target.attr,
            )
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Load) and node.id in DENIED_CALLS:
            self._refuse(
                "forbidden_name",
                f"`{node.id}` is not available in CAD source.",
                node,
                node.id,
            )
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in DENIED_ATTRIBUTES:
            self._refuse(
                "forbidden_attribute",
                f"`.{node.attr}` is not available in CAD source.",
                node,
                node.attr,
            )
        self.generic_visit(node)

    # -- syntax that has no place in a part description --------------------
    def visit_Global(self, node: ast.Global) -> None:
        self._refuse(
            "global_state",
            "A CAD program must be deterministic and free of module-level mutable state.",
            node,
        )
        self.generic_visit(node)

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self._refuse(
            "global_state",
            "A CAD program must be deterministic and free of hidden shared state.",
            node,
        )
        self.generic_visit(node)

    def visit_With(self, node: ast.With) -> None:
        self._refuse(
            "context_manager",
            "`with` blocks are not available: a CAD program manages no external resources.",
            node,
        )
        self.generic_visit(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        self.visit_With(node)  # type: ignore[arg-type]

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._refuse("async_not_supported", "A CAD program is synchronous.", node)
        self.generic_visit(node)

    def visit_Await(self, node: ast.Await) -> None:
        self._refuse("async_not_supported", "A CAD program is synchronous.", node)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.defined_functions.add(node.name)
        self.generic_visit(node)


class _TooComplex(Exception):
    pass


def check_source(source: str, entrypoint: str = "build_model") -> GuardResult:
    """Admit or refuse one generated CAD program.

    Returns every violation found, not just the first: a repair turn should be
    able to fix the whole program at once.
    """

    violations: list[GuardViolation] = []

    if not source.strip():
        return GuardResult(False, [GuardViolation("empty_source", "The CAD source is empty.")])

    encoded = source.encode("utf-8")
    if len(encoded) > MAX_SOURCE_BYTES:
        violations.append(
            GuardViolation(
                "source_too_large",
                f"The CAD source is {len(encoded)} bytes; the limit is {MAX_SOURCE_BYTES}.",
            )
        )
    line_count = source.count("\n") + 1
    if line_count > MAX_SOURCE_LINES:
        violations.append(
            GuardViolation(
                "source_too_long",
                f"The CAD source is {line_count} lines; the limit is {MAX_SOURCE_LINES}.",
            )
        )
    if "\x00" in source:
        violations.append(
            GuardViolation("invalid_source", "The CAD source contains a null byte.")
        )
    if violations:
        return GuardResult(False, violations)

    try:
        tree = ast.parse(source, filename="<cad-model>", mode="exec")
    except SyntaxError as error:
        return GuardResult(
            False,
            [
                GuardViolation(
                    "syntax_error",
                    f"{error.msg} (line {error.lineno}, column {error.offset}).",
                    error.lineno or 0,
                )
            ],
        )

    walker = _Walker(entrypoint)
    try:
        walker.visit(tree)
    except _TooComplex:
        return GuardResult(
            False,
            [
                GuardViolation(
                    "source_too_complex",
                    f"The CAD source exceeds {MAX_AST_NODES} syntax nodes.",
                )
            ],
        )

    if entrypoint not in walker.defined_functions:
        walker.violations.append(
            GuardViolation(
                "missing_entrypoint",
                f"The CAD source must define `def {entrypoint}(params):` at module level.",
                0,
                entrypoint,
            )
        )

    return GuardResult(not walker.violations, walker.violations)
