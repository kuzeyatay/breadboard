import os
import shutil
import sys

import pytest

from plugins.breadboard import host_path


CLOSED = os.pathsep.join([
    os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32"),
    os.environ.get("SystemRoot", r"C:\Windows"),
])


def test_closed_path_keeps_priority_and_gains_user_folders():
    merged = host_path.host_search_path(CLOSED).split(os.pathsep)
    assert merged[:2] == CLOSED.split(os.pathsep)
    keys = [os.path.normcase(os.path.abspath(entry)).rstrip("\/") for entry in merged]
    assert len(keys) == len(set(keys))


@pytest.mark.skipif(
    sys.platform != "win32" or not os.path.exists(r"C:\Program Files\Git\cmd\git.exe"),
    reason="needs Git for Windows",
)
def test_git_is_found_from_runtime_v2_closed_path():
    assert shutil.which("git", path=host_path.host_search_path(CLOSED))


def test_user_environment_excludes_secrets_and_identity():
    user = host_path.registry_user_environment()
    assert not any(host_path._SECRET.search(name) for name in user)
    assert not any(name.upper() in {"USERNAME", "PATH", "TEMP", "WINDIR"} for name in user)
