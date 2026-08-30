"""Report availability of the local, keyless PowerPoint toolchain.

The script performs read-only checks and never installs packages, reads
credentials, or contacts a network service. It exits zero even when optional
capabilities are missing so an agent can select the OfficeCLI fallback.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from pathlib import Path


PYTHON_MODULES = {
    "defusedxml": "safe OOXML parsing",
    "lxml": "schema validation",
    "pptx": "layout linting",
    "matplotlib": "chart rendering",
    "PIL": "thumbnail and image QA",
}
NODE_PACKAGES = ("pptxgenjs", "lucide-static", "@tabler/icons", "sharp")
BINARIES = ("node", "soffice", "pdftoppm", "pdfimages")


def _node_packages() -> dict[str, bool]:
    node = shutil.which("node")
    if not node:
        return {package: False for package in NODE_PACKAGES}
    program = (
        "const {createRequire}=require('module');"
        "const fs=require('fs');const path=require('path');"
        "const req=createRequire(process.argv[1]);"
        "const out={};"
        "for(const p of process.argv.slice(2)){"
        "try{req.resolve(p);out[p]=true}catch{"
        "const parts=p.split('/');"
        "out[p]=(req.resolve.paths(p)||[]).some(base=>"
        "fs.existsSync(path.join(base,...parts,'package.json')))}}"
        "process.stdout.write(JSON.stringify(out))"
    )
    try:
        result = subprocess.run(
            [node, "-e", program, str(Path(__file__).resolve()), *NODE_PACKAGES],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if result.returncode == 0:
            parsed = json.loads(result.stdout)
            return {package: bool(parsed.get(package)) for package in NODE_PACKAGES}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        pass
    return {package: False for package in NODE_PACKAGES}


def inspect() -> dict[str, object]:
    python = {
        name: importlib.util.find_spec(name) is not None for name in PYTHON_MODULES
    }
    node = _node_packages()
    binaries = {name: shutil.which(name) is not None for name in BINARIES}
    capabilities = {
        "extract_text": python["defusedxml"],
        "edit_ooxml": python["defusedxml"] and python["lxml"],
        "create_components": binaries["node"] and node["pptxgenjs"],
        "render_icons": binaries["node"] and all(
            node[name] for name in ("lucide-static", "@tabler/icons", "sharp")
        ),
        "render_charts": python["matplotlib"],
        "lint_layout": python["pptx"] and python["PIL"],
        "render_preview": binaries["soffice"] and binaries["pdftoppm"],
    }
    return {
        "keyless": True,
        "network_required": False,
        "credentials_required": [],
        "python": python,
        "node": node,
        "binaries": binaries,
        "capabilities": capabilities,
        "ready": all(capabilities.values()),
    }


if __name__ == "__main__":
    print(json.dumps(inspect(), indent=2, sort_keys=True))
