"""Breadboard's source-pinned entry point (stdlib only, before Hermes imports).

The embedded Windows interpreter ignores cwd and PYTHONPATH. Its .pth hook
must carry this same source selection into -m workers, not a packaged fallback.
"""

import importlib.util
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys

SOURCE_ENV = "BREADBOARD_HERMES_SOURCE_ROOT"
MODULES = ("hermes_cli", "tui_gateway", "tools", "plugins", "agent", "model_tools")


def module_origins():
    origins = {}
    for name in MODULES:
        spec = importlib.util.find_spec(name)
        origins[name] = str(Path(spec.origin).resolve()) if spec and spec.origin else None
    return origins


def assert_origins(root, origins):
    for name in MODULES:
        origin = origins.get(name)
        if not origin or not Path(origin).is_relative_to(root):
            raise RuntimeError(f"Hermes source mismatch: {name} resolved to {origin!r}, expected {root}")


def select_source():
    root = Path(__file__).resolve().parent
    # Remove competing source roots instead of leaving a partial checkout able
    # to silently borrow missing top-level modules from a different Hermes.
    sys.path[:] = [str(root)] + [entry for entry in sys.path if entry and
        Path(entry).resolve() != root and not (Path(entry) / "hermes_cli" / "main.py").is_file()]
    os.environ[SOURCE_ENV] = str(root)
    os.environ["HERMES_BUNDLED_PLUGINS"] = str(root / "plugins")
    # Normal Python/venv children use PYTHONPATH; embedded Python uses our .pth
    # hook. This is internal launch state, never a user-selected feature flag.
    inherited = os.environ.get("PYTHONPATH", "").split(os.pathsep)
    os.environ["PYTHONPATH"] = os.pathsep.join([str(root)] + [entry for entry in inherited
        if entry and Path(entry).resolve() != root and
        not (Path(entry) / "hermes_cli" / "main.py").is_file()])
    origins = module_origins()
    assert_origins(root, origins)
    return root, origins


def verify_child(root):
    # Use an ordinary child invocation, not our launcher again: this proves
    # slash workers and cli.exec inherit the source even after changing cwd.
    probe = subprocess.run(
        [sys.executable, "-c", "import json, breadboard_runtime as r; print(json.dumps(r.module_origins()))"],
        cwd=str(root.parent),
        capture_output=True, text=True, encoding="utf-8", timeout=15,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        origins = json.loads(probe.stdout) if probe.returncode == 0 else {}
        assert_origins(root, origins)
    except (ValueError, RuntimeError) as exc:
        raise RuntimeError(
            "Hermes child processes would load a different source tree. "
            "Refresh the Breadboard Python source hook before starting the agent."
        ) from exc
    return origins


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    root, parent = select_source()
    child = verify_child(root)
    identity = {"sourceRoot": str(root), "parent": parent, "child": child}
    from hermes_cli.runtime_identity import RUNTIME_SOURCE
    identity.update(RUNTIME_SOURCE)
    if sys.argv[1:] == ["--check-source"]:
        print(json.dumps(identity))
        return
    if sys.argv[1:] == ["--check-imports"]:
        import importlib

        for name in ("hermes_cli.main", "plugins.breadboard", "tui_gateway.server"):
            importlib.import_module(name)
        print(json.dumps(identity))
        return
    print(f"[hermes-source] parent and child verified: {root} ({identity['sourceSha256']})", file=sys.stderr, flush=True)
    sys.argv[0] = str(root / "hermes_cli" / "main.py")
    runpy.run_module("hermes_cli.main", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError) as exc:
        print(f"[hermes-source] {exc}", file=sys.stderr)
        raise SystemExit(1)
