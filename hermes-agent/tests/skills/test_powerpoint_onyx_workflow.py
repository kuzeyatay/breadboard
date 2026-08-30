"""Behavioral coverage for the Onyx-derived PowerPoint workflow.

The imported helpers remain part of the existing ``powerpoint`` skill.  These
tests exercise Hermes' real skill loader and helpers without network access,
office applications, model credentials, or third-party API keys.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
import xml.etree.ElementTree as stdlib_element_tree
import xml.dom.minidom as stdlib_minidom
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


REPO = Path(__file__).resolve().parents[2]
SKILLS_ROOT = REPO / "skills"
POWERPOINT = SKILLS_ROOT / "productivity" / "powerpoint"


@pytest.fixture
def bundled_powerpoint(monkeypatch):
    """Expose the checked-in bundled skills through the runtime loader."""
    # Import after the suite's autouse HERMES_HOME isolation fixture has run.
    # ``tools.skills_tool`` resolves its profile-scoped home during import.
    import agent.skill_commands as skill_commands
    import agent.skill_utils as skill_utils
    import tools.skills_tool as skills_tool

    monkeypatch.setattr(skills_tool, "SKILLS_DIR", SKILLS_ROOT)
    monkeypatch.setattr(skills_tool, "_get_disabled_skill_names", lambda: set())
    monkeypatch.setattr(skills_tool, "_is_skill_disabled", lambda _name: False)
    monkeypatch.setattr(skills_tool, "load_env", lambda: {})
    monkeypatch.setattr(skill_utils, "get_external_skills_dirs", lambda: [])
    skills_tool._SKILLS_CACHE.clear()
    monkeypatch.setattr(skill_commands, "_skill_commands", {})
    monkeypatch.setattr(skill_commands, "_skill_commands_platform", None)
    return SimpleNamespace(
        path=POWERPOINT,
        commands=skill_commands,
        utils=skill_utils,
        tool=skills_tool,
    )


def _view(runtime, file_path: str | None = None) -> dict:
    return json.loads(
        runtime.tool.skill_view(
            "powerpoint",
            file_path=file_path,
            preprocess=False,
        )
    )


def test_powerpoint_is_discoverable_and_loads_without_credentials(bundled_powerpoint):
    commands = bundled_powerpoint.commands.scan_skill_commands()
    loaded = _view(bundled_powerpoint)

    assert commands["/powerpoint"]["name"] == "powerpoint"
    assert loaded["success"] is True
    assert loaded["name"] == "powerpoint"
    assert loaded["readiness_status"] == "available"
    assert loaded["required_environment_variables"] == []
    assert loaded["missing_required_environment_variables"] == []
    assert loaded["missing_credential_files"] == []
    assert loaded["setup_needed"] is False
    assert "office_run" in loaded["content"]
    assert "office_export" in loaded["content"]


def test_powerpoint_loader_preserves_proprietary_license(bundled_powerpoint):
    loaded = _view(bundled_powerpoint)
    frontmatter, _body = bundled_powerpoint.utils.parse_frontmatter(loaded["content"])

    assert "Anthropic" in frontmatter["author"]
    assert "Onyx" in frontmatter["author"]
    assert frontmatter["license"] == "Proprietary. LICENSE.txt has complete terms"
    assert (Path(loaded["skill_dir"]) / "LICENSE.txt").is_file()
    assert (Path(loaded["skill_dir"]) / "NOTICE.txt").is_file()


def test_declared_templates_are_valid_and_loadable(bundled_powerpoint):
    """Every advertised local template is a loadable Office package."""
    import zipfile

    skill = _view(bundled_powerpoint)
    declared = {
        match.replace("\\", "/")
        for match in re.findall(r"templates[/\\][\w.-]+\.pptx", skill["content"])
    }
    actual = {
        path.relative_to(bundled_powerpoint.path).as_posix()
        for path in (bundled_powerpoint.path / "templates").glob("*.pptx")
    }
    assert declared
    assert actual == declared

    for relative_path in sorted(declared):
        template = bundled_powerpoint.path / relative_path
        with zipfile.ZipFile(template) as package:
            assert "[Content_Types].xml" in package.namelist()
            assert "ppt/presentation.xml" in package.namelist()

        loaded = _view(bundled_powerpoint, relative_path)
        assert loaded["success"] is True, relative_path
        assert loaded["is_binary"] is True
        assert "Binary file:" in loaded["content"]


def test_linked_guides_load_with_hermes_compatible_paths(bundled_powerpoint):
    loaded = _view(bundled_powerpoint)
    links = {
        match.split("#", 1)[0]
        for match in re.findall(r"\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)", loaded["content"])
        if "://" not in match
    }
    assert links, "the workflow should progressively disclose its detailed guides"

    visible_instructions = [loaded["content"]]
    for relative_path in sorted(links):
        guide = _view(bundled_powerpoint, relative_path)
        assert guide["success"] is True, relative_path
        visible_instructions.append(guide["content"])

    combined = "\n".join(visible_instructions)
    assert ".opencode/skills/pptx" not in combined
    assert "/workspace/templates/pptx" not in combined
    assert "`view_image`" not in combined


def test_preview_helper_reuses_cached_slides_without_office_tools(
    bundled_powerpoint, tmp_path
):
    """Exercise a real helper path while staying independent of LibreOffice."""
    source = tmp_path / "deck.pptx"
    source.write_bytes(b"cached-preview-fixture")
    cache = tmp_path / "preview"
    cache.mkdir()
    slide = cache / "slide-1.jpg"
    slide.write_bytes(b"cached-jpeg-fixture")

    now = time.time()
    os.utime(source, (now - 10, now - 10))
    os.utime(slide, (now, now))

    result = subprocess.run(
        [
            sys.executable,
            str(bundled_powerpoint.path / "scripts" / "preview.py"),
            str(source),
            str(cache),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ["CACHED", str(slide.resolve())]


def test_component_library_keyless_smoke(bundled_powerpoint, tmp_path):
    """Load and exercise the dependency-free portion of components.js."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is unavailable")

    program = """
const components = require(process.argv[1]);
const theme = components.makeTheme({ primary: "#123456" });
process.stdout.write(JSON.stringify({
  page: components.PAGE,
  margin: components.MARGIN,
  primary: theme.primary,
  onPrimary: theme.onPrimary,
}));
"""
    result = subprocess.run(
        [
            node,
            "-e",
            program,
            str(bundled_powerpoint.path / "scripts" / "components.js"),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
        env={key: value for key, value in os.environ.items() if "API_KEY" not in key},
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["page"] == {"W": 10, "H": 5.625}
    assert payload["margin"] == 0.5
    assert payload["primary"] == "123456"
    assert re.fullmatch(r"[0-9A-F]{6}", payload["onPrimary"])


def test_preflight_is_offline_and_never_requires_credentials(
    bundled_powerpoint, tmp_path
):
    """The capability check is useful even on a minimally provisioned host."""
    result = subprocess.run(
        [sys.executable, str(bundled_powerpoint.path / "scripts" / "preflight.py")],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
        env={key: value for key, value in os.environ.items() if "API_KEY" not in key},
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["keyless"] is True
    assert payload["network_required"] is False
    assert payload["credentials_required"] == []
    assert set(payload["capabilities"]) == {
        "extract_text",
        "edit_ooxml",
        "create_components",
        "render_icons",
        "render_charts",
        "lint_layout",
        "render_preview",
    }


def test_preflight_resolves_packaged_node_modules_from_an_arbitrary_workspace(
    bundled_powerpoint, tmp_path
):
    """Node checks are rooted at the installed skill, not the caller's cwd."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is unavailable")

    app = tmp_path / "installed-app"
    copied_script = (
        app / "skills" / "productivity" / "powerpoint" / "scripts" / "preflight.py"
    )
    copied_script.parent.mkdir(parents=True)
    shutil.copy2(bundled_powerpoint.path / "scripts" / "preflight.py", copied_script)

    for package in ("pptxgenjs", "lucide-static", "@tabler/icons", "sharp"):
        package_dir = app / "node_modules" / Path(*package.split("/"))
        package_dir.mkdir(parents=True)
        (package_dir / "package.json").write_text(
            json.dumps({"name": package, "main": "index.js"}), encoding="utf-8"
        )
        (package_dir / "index.js").write_text("module.exports = {};\n", encoding="utf-8")

    unrelated_cwd = tmp_path / "workspace"
    unrelated_cwd.mkdir()
    result = subprocess.run(
        [sys.executable, str(copied_script)],
        cwd=unrelated_cwd,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert all(payload["node"].values())
    assert payload["capabilities"]["create_components"] is True
    assert payload["credentials_required"] == []


def test_local_extractor_reads_a_bundled_template_without_a_service(
    bundled_powerpoint, monkeypatch
):
    """Exercise ordered PPTX extraction without a network or hosted converter."""
    import importlib.util

    fake_defused = ModuleType("defusedxml")
    fake_defused.ElementTree = stdlib_element_tree
    monkeypatch.setitem(sys.modules, "defusedxml", fake_defused)
    monkeypatch.setitem(
        sys.modules, "defusedxml.ElementTree", stdlib_element_tree
    )

    module_path = bundled_powerpoint.path / "scripts" / "extract_text.py"
    spec = importlib.util.spec_from_file_location(
        "powerpoint_local_text_extractor", module_path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    template = bundled_powerpoint.path / "templates" / "presentation-template.pptx"
    content = module.extract(template)

    assert content.startswith("<!-- Slide number: 1 -->\n## Slide 1\n")
    markers = re.findall(r"<!-- Slide number: (\d+) -->", content)
    assert markers == [str(index) for index in range(1, len(markers) + 1)]
    assert len(markers) >= 1


def test_unpack_rejects_traversal_without_touching_destination(
    bundled_powerpoint, tmp_path, monkeypatch
):
    """The imported OOXML unpacker must fail closed on a ZIP-slip member."""
    import importlib.util

    fake_defused = SimpleNamespace(
        minidom=SimpleNamespace(parseString=lambda value: value)
    )
    monkeypatch.setitem(sys.modules, "defusedxml", fake_defused)
    monkeypatch.setitem(sys.modules, "defusedxml.minidom", fake_defused.minidom)

    module_path = bundled_powerpoint.path / "scripts" / "office" / "unpack.py"
    sys.path.insert(0, str(module_path.parent))
    try:
        spec = importlib.util.spec_from_file_location("powerpoint_safe_unpack", module_path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)

    archive = tmp_path / "malicious.pptx"
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        package.writestr("../escaped.txt", "must not escape")

    destination = tmp_path / "unpacked"
    _unused, message = module.unpack(str(archive), str(destination))

    assert message.startswith("Error unpacking:")
    assert not (tmp_path / "escaped.txt").exists()
    assert not destination.exists()


def test_pack_is_atomic_and_rejects_output_inside_source(
    bundled_powerpoint, tmp_path, monkeypatch
):
    """A failed XML pass must not destroy the caller's prior output."""
    import importlib.util

    fake_defused = ModuleType("defusedxml")
    fake_defused.minidom = stdlib_minidom
    fake_validators = ModuleType("validators")

    class UnusedValidator:
        def __init__(self, *_args, **_kwargs):
            pass

    fake_validators.DOCXSchemaValidator = UnusedValidator
    fake_validators.PPTXSchemaValidator = UnusedValidator
    fake_validators.RedliningValidator = UnusedValidator
    monkeypatch.setitem(sys.modules, "defusedxml", fake_defused)
    monkeypatch.setitem(sys.modules, "defusedxml.minidom", stdlib_minidom)
    monkeypatch.setitem(sys.modules, "validators", fake_validators)

    module_path = bundled_powerpoint.path / "scripts" / "office" / "pack.py"
    spec = importlib.util.spec_from_file_location("powerpoint_atomic_pack", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    source = tmp_path / "unpacked"
    (source / "ppt").mkdir(parents=True)
    (source / "[Content_Types].xml").write_text("<Types/>", encoding="utf-8")
    malformed = source / "ppt" / "presentation.xml"
    malformed.write_text("<presentation>", encoding="utf-8")
    output = tmp_path / "deck.pptx"
    output.write_bytes(b"previous-valid-output")

    with pytest.raises(Exception):
        module.pack(str(source), str(output), validate=False)
    assert output.read_bytes() == b"previous-valid-output"

    malformed.write_text("<presentation/>", encoding="utf-8")
    _unused, message = module.pack(str(source), str(output), validate=False)
    assert message.startswith("Successfully packed")
    with zipfile.ZipFile(output) as package:
        assert set(package.namelist()) == {
            "[Content_Types].xml",
            "ppt/presentation.xml",
        }

    _unused, message = module.pack(
        str(source), str(source / "nested-output.pptx"), validate=False
    )
    assert message == "Error: output file must not be inside the input directory"
