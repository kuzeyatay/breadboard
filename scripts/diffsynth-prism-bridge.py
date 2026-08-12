#!/usr/bin/env python3
"""Narrow NDJSON bridge from Breadboard's Prism agent to DiffSynth Studio."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import traceback

MODEL_ID = "AI-ModelScope/stable-diffusion-v1-5"


def configure_stdio() -> None:
    """Keep DiffSynth's Unicode status output safe on Windows consoles."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def emit(event: str, **payload: object) -> None:
    print(json.dumps({"event": event, **payload}, ensure_ascii=False), flush=True)


def configs(*, allow_download: bool):
    import torch
    from diffsynth.core import ModelConfig

    vram = {
        "offload_dtype": torch.float32,
        "offload_device": "cpu",
        "onload_dtype": torch.float32,
        "onload_device": "cpu",
        "preparing_dtype": torch.float32,
        "preparing_device": "cuda",
        "computation_dtype": torch.float32,
        "computation_device": "cuda",
        "skip_download": not allow_download,
    }
    return [
        ModelConfig(model_id=MODEL_ID, origin_file_pattern="text_encoder/model.safetensors", **vram),
        ModelConfig(model_id=MODEL_ID, origin_file_pattern="unet/diffusion_pytorch_model.safetensors", **vram),
        ModelConfig(model_id=MODEL_ID, origin_file_pattern="vae/diffusion_pytorch_model.safetensors", **vram),
    ], ModelConfig(
        model_id=MODEL_ID,
        origin_file_pattern="tokenizer/",
        skip_download=not allow_download,
    )


def prefetch() -> int:
    # This path is intentionally CLI-only. Breadboard's run API never invokes it.
    os.environ["DIFFSYNTH_SKIP_DOWNLOAD"] = "False"
    model_configs, tokenizer = configs(allow_download=True)
    for config in [*model_configs, tokenizer]:
        config.download_if_necessary()
    print(f"Prism model downloaded under {os.environ.get('DIFFSYNTH_MODEL_BASE_PATH', './models')}")
    return 0


def read_job() -> dict[str, object]:
    raw = sys.stdin.readline()
    if not raw:
        raise ValueError("Prism received no generation job.")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Prism's generation job must be an object.")
    prompt = value.get("prompt")
    output = value.get("output")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt.strip()) > 4000:
        raise ValueError("Prism received an invalid image prompt.")
    if not isinstance(output, str) or not output:
        raise ValueError("Prism received no output path.")
    seed = value.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed <= 2_147_483_647:
        raise ValueError("Prism received an invalid seed.")
    return {"prompt": prompt.strip(), "output": output, "seed": seed}


def run() -> int:
    job = read_job()
    output = Path(str(job["output"])).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    emit("stage.started", stage="load")
    import torch
    from diffsynth.pipelines.stable_diffusion import StableDiffusionPipeline

    if not torch.cuda.is_available():
        raise RuntimeError("DiffSynth cannot see a CUDA GPU.")
    model_configs, tokenizer = configs(allow_download=False)
    pipe = StableDiffusionPipeline.from_pretrained(
        torch_dtype=torch.float32,
        model_configs=model_configs,
        tokenizer_config=tokenizer,
        vram_limit=max(0.5, torch.cuda.mem_get_info("cuda")[1] / (1024 ** 3) - 0.5),
    )
    emit("stage.completed", stage="load")

    emit("stage.started", stage="diffuse")
    image = pipe(
        prompt=str(job["prompt"]),
        negative_prompt="blurry, low quality, distorted, deformed, watermark, text artifacts",
        cfg_scale=7.5,
        height=512,
        width=512,
        seed=int(job["seed"]),
        rand_device="cuda",
        num_inference_steps=30,
    )
    emit("stage.completed", stage="diffuse")

    emit("stage.started", stage="save")
    image.save(output, format="PNG", optimize=True)
    size = output.stat().st_size
    emit("stage.completed", stage="save")
    emit("result", image=str(output), sizeBytes=size, seed=int(job["seed"]), width=512, height=512)
    return 0


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefetch", action="store_true")
    args = parser.parse_args()
    try:
        return prefetch() if args.prefetch else run()
    except Exception as error:  # The TypeScript side turns this into a durable failure.
        if args.prefetch:
            traceback.print_exc(file=sys.stderr)
        else:
            emit("error", message=str(error) or error.__class__.__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
