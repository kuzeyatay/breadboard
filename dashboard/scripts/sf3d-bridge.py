#!/usr/bin/env python
"""Run one Stable Fast 3D reconstruction, or report whether it could be run.

The clone at `stable-fast-3d/` is a research repository: a CLI that loads the
model, prints progress, and writes numbered folders. None of that is a shape a
server can call. This bridge is the seam — one image in, one GLB out, one JSON
object on stdout — so the TypeScript side never parses human-readable output and
never has to know what SF3D's own argument names are.

Two modes, and the split matters:

    --probe     Import-checks the runtime and prints what is present. It must
                never download weights or touch CUDA memory, because it runs on
                a status read that a person triggers by opening a panel.
    --image     The actual reconstruction. Loads the model, runs it, exports.

Everything human-readable goes to stderr. Exactly one JSON object goes to
stdout, including on failure, so a caller that gets no JSON knows the process
died rather than having to guess from an exit code.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
import traceback
from contextlib import nullcontext
from pathlib import Path

# The clone is a sibling of `dashboard/`, and it is imported as a source tree
# rather than an installed package — `sf3d` is not on PyPI. Prepending rather
# than appending would let it shadow a real dependency of the same name.
REPO_ROOT = Path(__file__).resolve().parents[2]
SF3D_ROOT = Path(os.environ.get("SF3D_ROOT") or (REPO_ROOT / "stable-fast-3d")).resolve()


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(code: str, message: str, **extra) -> None:
    emit({"ok": False, "code": code, "message": message, **extra})
    sys.exit(1)


def module_present(name: str) -> bool:
    """Whether an import would resolve, without executing the module.

    `find_spec` is what keeps `--probe` cheap: importing torch alone costs
    seconds and megabytes, and importing the compiled extensions initialises a
    CUDA context.
    """
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def probe() -> None:
    """What is installed, without loading anything expensive."""
    present = {name: module_present(name) for name in (
        "torch", "rembg", "trimesh", "transformers", "open_clip",
        "texture_baker", "uv_unwrapper", "gpytoolbox", "pynanoinstantmeshes",
    )}
    device = "cpu"
    torch_version = None
    cuda_available = False
    if present["torch"]:
        try:
            import torch  # noqa: PLC0415 — deliberately deferred; see module_present

            torch_version = torch.__version__
            cuda_available = bool(torch.cuda.is_available())
            if cuda_available:
                device = "cuda"
            elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                device = "mps"
        except Exception:  # noqa: BLE001 — a broken torch install is a state, not a crash
            present["torch"] = False

    emit({
        "ok": True,
        "mode": "probe",
        "sf3dRoot": str(SF3D_ROOT),
        "clonedPresent": (SF3D_ROOT / "sf3d" / "system.py").is_file(),
        "python": sys.version.split()[0],
        "modules": present,
        "torchVersion": torch_version,
        "cudaAvailable": cuda_available,
        # The baker only has a CUDA and a Metal path; on a CPU-only machine the
        # run fails inside the extension rather than being slow, so this is a
        # blocking fact and not a performance note.
        "device": device,
        "bakingSupported": device in {"cuda", "mps"},
    })


def reconstruct(args: argparse.Namespace) -> None:
    if not (SF3D_ROOT / "sf3d" / "system.py").is_file():
        fail("sf3d_clone_missing", f"The Stable Fast 3D checkout is not at {SF3D_ROOT}.")
    sys.path.insert(0, str(SF3D_ROOT))

    image_path = Path(args.image).resolve()
    if not image_path.is_file():
        fail("sf3d_input_missing", "The input image could not be read.")

    try:
        import torch
        from PIL import Image

        from sf3d.system import SF3D
        from sf3d.utils import get_device, remove_background, resize_foreground
    except Exception as error:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        fail(
            "sf3d_runtime_incomplete",
            f"The Stable Fast 3D environment is not usable: {error}",
        )

    device = args.device or get_device()
    if device == "cuda" and not torch.cuda.is_available():
        device = "cpu"

    started = time.monotonic()
    try:
        # rembg is what makes "a photo of a chair" work rather than only a cutout
        # on white: SF3D reconstructs the foreground, so the alpha matte is part
        # of the input, not a nicety. An image that already carries transparency
        # is left alone by `remove_background` itself.
        import rembg

        source = Image.open(image_path).convert("RGBA")
        if args.remove_background:
            source = remove_background(source, rembg.new_session())
        prepared = resize_foreground(source, args.foreground_ratio)

        if args.debug_input:
            prepared.save(args.debug_input)

        model = SF3D.from_pretrained(
            args.pretrained_model,
            config_name="config.yaml",
            weight_name="model.safetensors",
        )
        model.to(device)
        model.eval()

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        with torch.no_grad():
            autocast = (
                torch.autocast(device_type=device, dtype=torch.bfloat16)
                if "cuda" in device
                else nullcontext()
            )
            with autocast:
                mesh, _ = model.run_image(
                    prepared,
                    bake_resolution=args.texture_resolution,
                    remesh=args.remesh,
                    vertex_count=args.target_vertex_count,
                )

        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        mesh.export(str(output_path), include_normals=True)
    except torch.cuda.OutOfMemoryError as error:  # type: ignore[attr-defined]
        traceback.print_exc(file=sys.stderr)
        fail(
            "sf3d_out_of_memory",
            "The GPU ran out of memory during reconstruction: "
            f"{error}. Try a lower texture resolution.",
        )
    except Exception as error:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        message = str(error)
        # A gated repository is the one failure a person can actually fix, so it
        # is reported as its own code rather than as a generic model error.
        gated = "401" in message or "gated" in message.lower() or "restricted" in message.lower()
        fail(
            "sf3d_model_access_denied" if gated else "sf3d_reconstruction_failed",
            message,
        )

    peak_mb = None
    if torch.cuda.is_available():
        peak_mb = round(torch.cuda.max_memory_allocated() / 1024 / 1024, 1)

    emit({
        "ok": True,
        "mode": "reconstruct",
        "outputPath": str(output_path),
        "byteSize": output_path.stat().st_size,
        "device": device,
        "durationSeconds": round(time.monotonic() - started, 2),
        "peakMemoryMb": peak_mb,
        "textureResolution": args.texture_resolution,
        "remesh": args.remesh,
        "vertexCount": args.target_vertex_count,
        "backgroundRemoved": bool(args.remove_background),
    })


def main() -> None:
    parser = argparse.ArgumentParser(description="Breadboard bridge for Stable Fast 3D.")
    parser.add_argument("--probe", action="store_true", help="Report runtime readiness and exit.")
    parser.add_argument("--image", help="Input image path.")
    parser.add_argument("--output", help="Destination .glb path.")
    parser.add_argument("--device", default=None, help="cuda, mps or cpu. Defaults to the best available.")
    parser.add_argument("--pretrained-model", default="stabilityai/stable-fast-3d")
    parser.add_argument("--texture-resolution", type=int, default=1024)
    parser.add_argument("--foreground-ratio", type=float, default=0.85)
    parser.add_argument("--remesh", choices=["none", "triangle", "quad"], default="none")
    parser.add_argument("--target-vertex-count", type=int, default=-1)
    parser.add_argument("--no-remove-background", dest="remove_background", action="store_false")
    parser.add_argument("--debug-input", default=None, help="Also write the preprocessed input here.")
    parser.set_defaults(remove_background=True)
    args = parser.parse_args()

    if args.probe:
        probe()
        return
    if not args.image or not args.output:
        fail("sf3d_bad_arguments", "Both --image and --output are required.")
    reconstruct(args)


if __name__ == "__main__":
    main()
