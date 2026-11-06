"""Refresh the code-only upstream snapshot from an inspected local checkout."""
import argparse
import ast
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN = "33ec7f42bf2885084a459a702a83ea3d87f95f9d"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkout", type=Path)
    source = parser.parse_args().checkout.resolve()
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != PIN:
        raise SystemExit(f"Review the upstream changes and update PIN before vendoring {revision}")
    target = ROOT / "vendor"
    target.mkdir(exist_ok=True)
    hashes = {}
    for path in sorted((source / "mcp_server/multisim_mcp").rglob("*")):
        if not path.is_file() or path.suffix not in {".py", ".json", ".md"}:
            continue
        relative = path.relative_to(source / "mcp_server")
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        hashes[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    shutil.copyfile(source / "LICENSE", target / "LICENSE.multisim-mcp")
    tree = ast.parse((source / "mcp_server/multisim_mcp/server.py").read_text(encoding="utf-8"))
    surface = {key: [] for key in ["tool", "prompt", "resource"]}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                func = decorator.func if isinstance(decorator, ast.Call) else decorator
                if isinstance(func, ast.Attribute) and func.attr in surface and isinstance(func.value, ast.Name) and func.value.id == "mcp":
                    surface[func.attr].append(node.name)
    (target / "UPSTREAM.json").write_text(json.dumps({
        "repository": "https://github.com/yxy050208/multisim-mcp", "commit": revision,
        "license": "MIT", "files": hashes, "server_surface": surface,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Vendored {len(hashes)} files at {revision}; surface: " + str({k: len(v) for k, v in surface.items()}))


if __name__ == "__main__":
    main()
