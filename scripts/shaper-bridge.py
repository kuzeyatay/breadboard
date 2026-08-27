#!/usr/bin/env python3
"""Image-only Breadboard bridge for ShapeR's experimental single-view path."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image


active_process: subprocess.Popen[str] | None = None


def emit(event: str, **payload: object) -> None:
    print(json.dumps({"event": event, **payload}), flush=True)


def stop(_signum: int, _frame: object) -> None:
    global active_process
    if active_process and active_process.poll() is None:
        active_process.terminate()
    raise SystemExit(130)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)


def automatic_masks(source: Path, photo: Path, foreground: Path, ground: Path) -> None:
    image = Image.open(source).convert("RGB")
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    image.save(photo, "JPEG", quality=96)
    bgr = cv2.imread(str(photo), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError("The uploaded picture could not be decoded.")
    height, width = bgr.shape[:2]
    mask = np.zeros((height, width), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    inset_x = max(2, int(width * 0.04))
    inset_y = max(2, int(height * 0.04))
    rect = (inset_x, inset_y, max(1, width - 2 * inset_x), max(1, height - 2 * inset_y))
    cv2.grabCut(bgr, mask, rect, bgd, fgd, 5, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    kernel = np.ones((7, 7), np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, kernel)
    ratio = float(np.count_nonzero(fg)) / float(fg.size)
    if ratio < 0.03 or ratio > 0.92:
        fg.fill(0)
        cv2.ellipse(
            fg,
            (width // 2, int(height * 0.48)),
            (max(4, int(width * 0.38)), max(4, int(height * 0.43))),
            0,
            0,
            360,
            255,
            -1,
        )
    floor = np.zeros_like(fg)
    floor[int(height * 0.70) :, :] = 255
    floor[cv2.dilate(fg, np.ones((15, 15), np.uint8), iterations=1) > 0] = 0
    if np.count_nonzero(floor) < 128:
        floor.fill(0)
        floor[int(height * 0.84) :, :] = 255
    cv2.imwrite(str(foreground), fg)
    cv2.imwrite(str(ground), floor)


def run_stage(command: list[str], cwd: Path, stage: str, env: dict[str, str]) -> None:
    global active_process
    emit("stage.started", stage=stage)
    active_process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    tail: list[str] = []
    assert active_process.stdout is not None
    for line in active_process.stdout:
        clean = line.strip()
        if clean:
            tail.append(clean)
            tail = tail[-30:]
    code = active_process.wait()
    active_process = None
    if code != 0:
        raise RuntimeError(f"{stage} failed.\n" + "\n".join(tail[-12:]))
    emit("stage.completed", stage=stage)


def main() -> None:
    job = json.loads(sys.stdin.read())
    source = Path(job["source"]).resolve()
    workspace = Path(job["workspace"]).resolve()
    shaper_root = Path(job["shaperRoot"]).resolve()
    shaper_state_root = Path(job["shaperStateRoot"]).resolve()
    preset = str(job.get("preset", "speed"))
    caption = str(job.get("caption", "a 3D object")).strip() or "a 3D object"
    if preset not in {"speed", "balance", "quality"}:
        preset = "speed"
    if not source.is_file():
        raise RuntimeError("The uploaded picture is no longer available.")
    if not shaper_root.is_dir():
        raise RuntimeError("The sealed ShapeR source is unavailable.")
    if not shaper_state_root.is_dir():
        raise RuntimeError("ShapeR's writable Runtime state is unavailable.")

    example = workspace / "example"
    output = workspace / "output"
    example.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    photo = example / "cup_painting.jpg"
    emit("stage.started", stage="prepare")
    automatic_masks(source, photo, example / "foreground.png", example / "xy_plane.png")
    (example / "caption.txt").write_text(caption, encoding="utf-8")
    emit("stage.completed", stage="prepare")

    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        item for item in [str(shaper_root), env.get("PYTHONPATH", "")] if item
    )
    run_stage(
        [sys.executable, str(shaper_root / "experimental" / "workaround_dataproc.py")],
        workspace,
        "depth",
        env,
    )
    sample = example / "cup_painting.pkl"
    run_stage(
        [
            sys.executable,
            str(shaper_root / "infer_shape.py"),
            "--input_pkl",
            str(sample),
            "--config",
            preset,
            "--output_dir",
            str(output),
            "--is_local_path",
        ],
        shaper_state_root,
        "reconstruct",
        env,
    )
    candidates = sorted(output.glob("*.glb"))
    if not candidates:
        raise RuntimeError("ShapeR finished without producing a GLB mesh.")
    mesh = workspace / "formsmith.glb"
    shutil.copy2(candidates[0], mesh)
    emit("result", mesh=str(mesh), sizeBytes=mesh.stat().st_size)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit("error", message=str(exc))
        raise SystemExit(1)
