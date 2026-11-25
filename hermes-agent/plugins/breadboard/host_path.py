"""Give the Hermes process the user's real tool PATH under Breadboard.

Runtime V2 launches Hermes with a closed PATH (Breadboard's bundled runtimes,
then System32 and Windows). Hermes resolves many tools by name --
``shutil.which("git")`` for checkpoints, ``npx`` for the browser tool, ``uv``
for lazy dependencies, ``docker`` for sandboxes -- so on a machine where Git,
uv or Docker are installed they were still reported missing.

Codex never hits this because it inherits the user's environment. This module
rebuilds it once at plugin load: the existing PATH stays first (bundled
runtimes keep priority), then the Machine and User PATH from the registry,
then well-known install folders. Mirrors dashboard/scripts/host-path.mjs.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def _expand(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        found = os.environ.get(name) or os.environ.get(name.upper())
        if found:
            return found
        fallbacks = {
            "USERPROFILE": str(Path.home()),
            "LOCALAPPDATA": str(Path.home() / "AppData" / "Local"),
            "APPDATA": str(Path.home() / "AppData" / "Roaming"),
            "PROGRAMFILES": os.environ.get("SystemDrive", "C:") + "\\Program Files",
            "PROGRAMFILES(X86)": os.environ.get("SystemDrive", "C:") + "\\Program Files (x86)",
            "PROGRAMDATA": os.environ.get("SystemDrive", "C:") + "\\ProgramData",
        }
        return fallbacks.get(name.upper(), match.group(0))

    return re.sub(r"%([^%]+)%", replace, value)


def _registry_path() -> list[str]:
    try:
        import winreg  # type: ignore[import-not-found]
    except ImportError:
        return []
    entries: list[str] = []
    for hive, key in (
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        (winreg.HKEY_CURRENT_USER, r"Environment"),
    ):
        try:
            with winreg.OpenKey(hive, key) as handle:
                value, _kind = winreg.QueryValueEx(handle, "Path")
        except OSError:
            continue
        entries.extend(_expand(part.strip()) for part in str(value).split(";") if part.strip())
    return entries


def _well_known() -> list[str]:
    home = Path.home()
    if sys.platform != "win32":
        return [str(home / ".local" / "bin"), str(home / ".cargo" / "bin"), "/usr/local/bin", "/opt/homebrew/bin"]
    local = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
    roaming = Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming")
    drive = os.environ.get("SystemDrive", "C:")
    programs = {os.environ.get("ProgramFiles") or f"{drive}\\Program Files",
                os.environ.get("ProgramW6432") or f"{drive}\\Program Files",
                os.environ.get("ProgramFiles(x86)") or f"{drive}\\Program Files (x86)"}
    folders = []
    for root in programs:
        folders += [Path(root) / "Git" / "cmd", Path(root) / "nodejs", Path(root) / "GitHub CLI",
                    Path(root) / "Docker" / "Docker" / "resources" / "bin"]
    folders += [local / "Programs" / "Git" / "cmd", home / ".local" / "bin", home / ".cargo" / "bin",
                home / "scoop" / "shims", Path(os.environ.get("ProgramData") or f"{drive}\\ProgramData") / "chocolatey" / "bin",
                roaming / "npm", local / "Programs" / "Python" / "Launcher",
                local / "Microsoft" / "WinGet" / "Links", local / "Microsoft" / "WindowsApps"]
    return [str(folder) for folder in folders]


_SECRET = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL", re.IGNORECASE)
_SESSION_OWNED = re.compile(
    r"^(PATH|PATHEXT|TEMP|TMP|HOME|USERPROFILE|USERNAME|USERDOMAIN|COMPUTERNAME|WINDIR|SYSTEMROOT|"
    r"COMSPEC|OS|PROCESSOR_.*|NUMBER_OF_PROCESSORS|DRIVERDATA|PSMODULEPATH)$",
    re.IGNORECASE,
)


def registry_user_environment() -> dict[str, str]:
    """Variables the user set in Windows (Machine, then User), minus secrets."""
    try:
        import winreg  # type: ignore[import-not-found]
    except ImportError:
        return {}
    merged: dict[str, str] = {}
    for hive, key in (
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        (winreg.HKEY_CURRENT_USER, r"Environment"),
    ):
        try:
            with winreg.OpenKey(hive, key) as handle:
                index = 0
                while True:
                    try:
                        name, value, kind = winreg.EnumValue(handle, index)
                    except OSError:
                        break
                    index += 1
                    if kind in (winreg.REG_SZ, winreg.REG_EXPAND_SZ):
                        merged[name] = _expand(str(value))
        except OSError:
            continue
    return {name: value for name, value in merged.items()
            if not _SESSION_OWNED.match(name) and not _SECRET.search(name)}


def host_search_path(current: str | None = None) -> str:
    base = [entry for entry in (current if current is not None else os.environ.get("PATH", "")).split(os.pathsep) if entry]
    seen = {os.path.normcase(os.path.abspath(entry)).rstrip("\\/") for entry in base}
    merged = list(base)
    for entry in [*_registry_path(), *_well_known()]:
        key = os.path.normcase(os.path.abspath(entry)).rstrip("\\/")
        if key in seen or not os.path.isdir(entry):
            continue
        seen.add(key)
        merged.append(entry)
    return os.pathsep.join(merged)


def extend_process_path() -> None:
    """Idempotently extend this process's PATH; never raises."""
    if os.environ.get("BREADBOARD_HOST_PATH_EXTENDED") == "1":
        return
    try:
        os.environ["PATH"] = host_search_path()
        for name, value in registry_user_environment().items():
            if name.upper() not in {key.upper() for key in os.environ}:
                os.environ[name] = value
        os.environ["BREADBOARD_HOST_PATH_EXTENDED"] = "1"
    except Exception:  # noqa: BLE001 - a PATH refresh must never break plugin load.
        pass
