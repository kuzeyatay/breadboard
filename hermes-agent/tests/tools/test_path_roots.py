"""The two path roots, and what the file tools do with them.

The rule being tested is asymmetric on purpose: the runtime's own state is
refused by default because nothing legitimate reaches it that way, while the
working root is only enforced when an operator asks, because confining an
existing install would break real work rather than close a real hole.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tools import path_roots


@pytest.fixture(autouse=True)
def isolated_roots(tmp_path, monkeypatch):
    home = tmp_path / "hermes-home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("HERMES_ACTION_DIR", raising=False)
    monkeypatch.setattr(path_roots, "_config_section", lambda: {})
    path_roots.reset_cache()
    yield home
    path_roots.reset_cache()


# ── the runtime's own state ───────────────────────────────────────────


class TestWorkspaceRoot:
    def test_reading_runtime_state_is_refused(self, isolated_roots):
        refusal = path_roots.check_path(str(isolated_roots / "auth.json"), path_roots.READ)
        assert refusal is not None
        assert "runtime's own state" in refusal

    def test_writing_runtime_state_is_refused(self, isolated_roots):
        refusal = path_roots.check_path(str(isolated_roots / "config.yaml"), path_roots.WRITE)
        assert refusal is not None

    def test_a_nested_path_is_refused_too(self, isolated_roots):
        refusal = path_roots.check_path(
            str(isolated_roots / "profiles" / "coder" / "state.db"), path_roots.READ
        )
        assert refusal is not None

    def test_a_symlink_out_of_the_work_area_does_not_get_in(self, tmp_path, isolated_roots):
        secret = isolated_roots / "auth.json"
        secret.write_text("{}", encoding="utf-8")
        link = tmp_path / "innocent.json"
        try:
            link.symlink_to(secret)
        except (OSError, NotImplementedError):
            pytest.skip("this platform will not create symlinks here")
        assert path_roots.check_path(str(link), path_roots.READ) is not None

    def test_an_operator_exception_reopens_one_subtree(self, isolated_roots, monkeypatch):
        monkeypatch.setattr(
            path_roots, "_config_section", lambda: {"workspace_exceptions": ["skills/mine"]}
        )
        path_roots.reset_cache()
        allowed = isolated_roots / "skills" / "mine" / "SKILL.md"
        assert path_roots.check_path(str(allowed), path_roots.READ) is None
        # and only that subtree
        assert path_roots.check_path(str(isolated_roots / "auth.json"), path_roots.READ) is not None

    def test_ordinary_paths_are_untouched(self, tmp_path):
        assert path_roots.check_path(str(tmp_path / "project" / "main.py"), path_roots.WRITE) is None


# ── the working root ──────────────────────────────────────────────────


class TestActionRoot:
    def test_declared_but_not_enforced_by_default(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            path_roots, "_config_section", lambda: {"action_dir": str(tmp_path / "work")}
        )
        path_roots.reset_cache()
        assert path_roots.action_root() is not None
        assert path_roots.action_root_enforced() is False
        assert path_roots.check_path(str(tmp_path / "elsewhere" / "f.txt"), path_roots.READ) is None

    def test_enforced_when_the_operator_asks(self, tmp_path, monkeypatch):
        work = tmp_path / "work"
        work.mkdir()
        monkeypatch.setattr(
            path_roots,
            "_config_section",
            lambda: {"action_dir": str(work), "enforce_action_dir": True},
        )
        path_roots.reset_cache()
        assert path_roots.check_path(str(work / "main.py"), path_roots.WRITE) is None
        outside = path_roots.check_path(str(tmp_path / "elsewhere.txt"), path_roots.WRITE)
        assert outside is not None
        assert "outside the working root" in outside

    def test_enforcement_without_a_root_is_ignored(self, tmp_path, monkeypatch):
        # Enforcing a root that was never configured would refuse everything.
        monkeypatch.setattr(path_roots, "_config_section", lambda: {"enforce_action_dir": True})
        path_roots.reset_cache()
        assert path_roots.action_root_enforced() is False
        assert path_roots.check_path(str(tmp_path / "anything.txt"), path_roots.READ) is None

    def test_the_env_var_wins_over_config(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HERMES_ACTION_DIR", str(tmp_path / "from-env"))
        monkeypatch.setattr(
            path_roots, "_config_section", lambda: {"action_dir": str(tmp_path / "from-config")}
        )
        path_roots.reset_cache()
        assert path_roots.action_root() == (tmp_path / "from-env").resolve()


# ── failing open ──────────────────────────────────────────────────────


class TestNeverBreaksTheTool:
    @pytest.mark.parametrize("value", ["", "   ", None])
    def test_empty_paths_pass_through(self, value):
        assert path_roots.check_path(value or "", path_roots.READ) is None

    def test_an_unparseable_path_passes_through(self):
        # The tool's own error handling is better placed to explain this than
        # a root check is.
        assert path_roots.check_path("\x00bad", path_roots.READ) is None

    def test_a_broken_check_never_raises(self, monkeypatch):
        def explode(*_args, **_kwargs):
            raise RuntimeError("settings are broken")

        monkeypatch.setattr(path_roots, "_settings", explode)
        assert path_roots.check_path("/tmp/whatever", path_roots.READ) is None


# ── the seam in the file tools ────────────────────────────────────────


class TestFileToolsHonourTheRoots:
    def test_read_file_refuses_runtime_state(self, isolated_roots):
        from tools.file_tools import _handle_read_file

        result = _handle_read_file({"path": str(isolated_roots / "auth.json")})
        assert "runtime's own state" in result

    def test_write_file_refuses_runtime_state(self, isolated_roots):
        from tools.file_tools import _handle_write_file

        result = _handle_write_file(
            {"path": str(isolated_roots / "config.yaml"), "content": "malicious: true"}
        )
        assert "runtime's own state" in result
        assert not (isolated_roots / "config.yaml").exists()

    def test_patch_refuses_runtime_state(self, isolated_roots):
        from tools.file_tools import _handle_patch

        result = _handle_patch(
            {
                "mode": "replace",
                "path": str(isolated_roots / "config.yaml"),
                "old_string": "a",
                "new_string": "b",
            }
        )
        assert "runtime's own state" in result

    def test_search_refuses_runtime_state(self, isolated_roots):
        from tools.file_tools import _handle_search_files

        result = _handle_search_files({"pattern": "token", "path": str(isolated_roots)})
        assert "runtime's own state" in result
