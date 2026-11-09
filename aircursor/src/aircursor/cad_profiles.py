"""Default view-navigation bindings; custom app mouse preferences may differ."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import PureWindowsPath


@dataclass(frozen=True, slots=True)
class CadProfile:
    name: str
    buttons: tuple[str, ...]
    keys: tuple[int, ...] = ()
    zoom_sign: int = 1


PROFILES = {
    "breadboard": CadProfile("Breadboard CAD", ("left",)),
    "blender": CadProfile("Blender", ("middle",)),
    "solidworks": CadProfile("SOLIDWORKS", ("middle",)),
    "sketchup": CadProfile("SketchUp", ("middle",)),
    "fusion": CadProfile("Autodesk Fusion", ("middle",), (0x10,)),
    "inventor": CadProfile("Inventor", ("left",), (0x73,)),
    "freecad": CadProfile("FreeCAD CAD navigation", ("middle", "left")),
    "onshape": CadProfile("Onshape", ("right",)),
    "rhino": CadProfile("Rhino perspective", ("right",)),
    "maya": CadProfile("Maya", ("left",), (0x12,)),
    "3dsmax": CadProfile("3ds Max", ("middle",), (0x12,)),
    "autocad": CadProfile("AutoCAD 3D", ("middle",), (0x10,)),
    "navisworks": CadProfile("Navisworks 3D", ("middle",), (0x10,)),
}

EXECUTABLES = {
    "blender.exe": "blender", "sldworks.exe": "solidworks", "sketchup.exe": "sketchup",
    "fusion360.exe": "fusion", "autodeskfusion.exe": "fusion",
    "inventor.exe": "inventor", "freecad.exe": "freecad", "rhino.exe": "rhino",
    "maya.exe": "maya", "3dsmax.exe": "3dsmax", "acad.exe": "autocad",
    "roamer.exe": "navisworks",
}
BROWSERS = {"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe",
            "vivaldi.exe", "chromium.exe", "zen.exe", "arc.exe",
            "breadboard.exe", "msedgewebview2.exe"}


def detect_profile(executable: str, title: str, override: str = "auto") -> CadProfile | None:
    if override != "auto":
        return PROFILES.get(override)
    name = PureWindowsPath(executable).name.casefold()
    # Breadboard publishes this only while its ready 3D canvas is hovered and
    # focused. Matching its ordinary title would hijack chat and parameter edits.
    if name in BROWSERS | {"electron.exe"} and title.casefold().startswith(
        ("breadboard cad | ", "private — breadboard cad | ")
    ):
        return PROFILES["breadboard"]
    profile = EXECUTABLES.get(name)
    if name in BROWSERS:
        if "onshape" in title.casefold():
            profile = "onshape"
        elif "sketchup" in title.casefold():
            profile = "sketchup"
    return PROFILES.get(profile)
