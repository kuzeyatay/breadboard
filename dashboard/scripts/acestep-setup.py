"""Explicit Runtime-owned setup. No model work is performed by health or generation setup checks."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import urllib.request
import zipfile

SOURCE_REVISION = "ca1e85fe9430179831e6bc6be790c332190a3866"
MODEL_REVISION = "19671f406d603126926c1b7e2adc169acbcade22"
MODEL_DIRS = ("acestep-v15-turbo", "vae", "Qwen3-Embedding-0.6B")


def direct(root, candidate):
    if candidate.is_symlink() or not candidate.resolve().is_relative_to(root.resolve()):
        raise RuntimeError("Setup path escaped Runtime data.")
    return candidate


def main():
    if len(sys.argv) != 3:
        raise RuntimeError("Setup requires Runtime-owned data and uv paths.")
    data = Path(sys.argv[1]).resolve(strict=True)
    root = direct(data, data / "runtime-v2" / "services" / "acestep")
    root.mkdir(parents=True, exist_ok=True)
    # An explicit repeat repairs missing files using the same immutable revisions.
    source = direct(data, root / "source")
    source.mkdir(exist_ok=True)
    archive = direct(data, root / "source.zip.part")
    print("Downloading pinned ACE-Step source (MIT).", flush=True)
    with urllib.request.urlopen(f"https://codeload.github.com/ace-step/ACE-Step-1.5/zip/{SOURCE_REVISION}", timeout=60) as response, archive.open("wb") as output:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > 512 * 1024 * 1024:
                raise RuntimeError("Source archive exceeded 512 MiB.")
            output.write(chunk)
    with zipfile.ZipFile(archive) as bundle:
        total = 0
        for member in bundle.infolist():
            relative = Path(*Path(member.filename).parts[1:])
            if not relative.parts or member.is_dir():
                continue
            # Ship only program/configuration/license sources; no datasets, fixtures, audio or models.
            if relative.parts[0] not in ("acestep", "openrouter", "pyproject.toml", "uv.lock", "README.md", "LICENSE"):
                continue
            if relative.suffix.lower() in (".mp3", ".wav", ".flac", ".png", ".jpg", ".safetensors", ".pt"):
                continue
            if member.external_attr >> 16 & 0o170000 == 0o120000:
                raise RuntimeError("Source archive contains a symlink.")
            total += member.file_size
            if member.file_size > 32 * 1024 * 1024 or total > 128 * 1024 * 1024:
                raise RuntimeError("Expanded source exceeds its bound.")
            target = direct(source, source / relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(member) as incoming, target.open("wb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
    archive.unlink()
    env = dict(os.environ, UV_PROJECT_ENVIRONMENT=str(root / ".venv"), UV_CACHE_DIR=str(root / "uv-cache"), UV_LINK_MODE="copy")
    print("Installing isolated dependencies using the pinned upstream uv.lock.", flush=True)
    subprocess.run([sys.argv[2], "sync", "--frozen", "--no-dev", "--project", str(source), "--python", sys.executable], env=env, check=True, timeout=1800)
    python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    # The child is a fixed script invocation and remains in the Runtime setup worker's process tree.
    subprocess.run([str(python), __file__, "--models", str(root)], env=env, check=True, timeout=1800)


def models(root):
    from huggingface_hub import HfApi, snapshot_download
    import torch
    print("Downloading pinned turbo, VAE, and text encoder weights; no music-planning LM is installed.", flush=True)
    checkpoint = root / "source" / "checkpoints"
    inventory = HfApi().model_info("ACE-Step/Ace-Step1.5", revision=MODEL_REVISION, files_metadata=True)
    selected = [entry for entry in inventory.siblings if entry.rfilename.split("/")[0] in MODEL_DIRS]
    if not selected or any(entry.size is None for entry in selected) or sum(entry.size for entry in selected) > 16 * 1024**3:
        raise RuntimeError("Model inventory exceeds the 16 GiB download budget or has unknown sizes.")
    if shutil.disk_usage(root).free < sum(entry.size for entry in selected) + 2 * 1024**3:
        raise RuntimeError("Insufficient disk space for model files and download staging.")
    snapshot_download(repo_id="ACE-Step/Ace-Step1.5", revision=MODEL_REVISION, local_dir=str(checkpoint),
                      allow_patterns=[f"{name}/*" for name in MODEL_DIRS] + ["README.md", "config.json"], max_workers=2)
    files = []
    total = 0
    for name in MODEL_DIRS:
        weights = list((checkpoint / name).rglob("*.safetensors"))
        if not weights:
            raise RuntimeError(f"Missing model weights: {name}")
        for filename in (checkpoint / name).rglob("*"):
            if not filename.is_file() or ".cache" in filename.parts:
                continue
            direct(root, filename)
            size = filename.stat().st_size
            total += size
            if total > 16 * 1024**3:
                raise RuntimeError("Selected model assets exceed the 16 GiB setup budget.")
            files.append({"path": str(filename.relative_to(root)).replace("\\", "/"), "size": size})
    hardware = {"cuda": torch.cuda.is_available(), "mps": bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()),
                "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                "vramBytes": torch.cuda.get_device_properties(0).total_memory if torch.cuda.is_available() else None}
    token = root / "api-key"
    if not token.exists():
        token.write_text(secrets.token_urlsafe(48), encoding="utf8")
    marker = root / "models-ready.json.part"
    marker.write_text(json.dumps({"sourceRevision": SOURCE_REVISION, "modelRevision": MODEL_REVISION, "model": "acestep-v15-turbo", "files": files, "hardware": hardware}), encoding="utf8")
    marker.replace(root / "models-ready.json")
    print(json.dumps({"prepared": True, "hardware": hardware, "modelBytes": total}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--models":
        models(Path(sys.argv[2]).resolve(strict=True))
    else:
        main()
