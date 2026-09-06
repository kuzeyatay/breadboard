"""Fixed Runtime service entrypoint; all mutable state stays under its sealed data root."""
import json
import os
from pathlib import Path
import sys


def main():
    root = Path(os.environ["BREADBOARD_ACESTEP_DIR"]).resolve(strict=True)
    port = int(os.environ["BREADBOARD_ACESTEP_PORT"])
    marker = root / "models-ready.json"
    if marker.stat().st_size > 1024 * 1024:
        raise RuntimeError("Invalid ACE-Step readiness manifest.")
    prepared = json.loads(marker.read_text(encoding="utf8"))
    if prepared.get("sourceRevision") != "ca1e85fe9430179831e6bc6be790c332190a3866" or not prepared.get("files"):
        raise RuntimeError("ACE-Step setup is incomplete.")
    for item in prepared["files"]:
        candidate = root / item["path"]
        if candidate.is_symlink() or not candidate.resolve(strict=True).is_relative_to(root) or candidate.stat().st_size != item["size"]:
            raise RuntimeError("Missing or changed model file; run explicit setup.")
    source = root / "source"
    sys.path.insert(0, str(source))
    os.chdir(source)
    os.environ.update({"ACESTEP_API_KEY": (root / "api-key").read_text().strip(),
                       "ACESTEP_CONFIG_PATH": "acestep-v15-turbo", "ACESTEP_INIT_LLM": "false",
                       "ACESTEP_USE_FLASH_ATTENTION": "false", "ACESTEP_NO_INIT": "false", "ACESTEP_ON_DEMAND_MODEL_LOAD": "false",
                       "ACESTEP_CONFIG_PATH2": "", "ACESTEP_CONFIG_PATH3": "",
                       "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "HF_HOME": str(root / "cache"), "TMPDIR": str(root / "temp"),
                       "TEMP": str(root / "temp"), "TMP": str(root / "temp")})
    (root / "temp").mkdir(exist_ok=True)
    # Fail closed even when upstream's download helpers try a ModelScope fallback.
    import acestep.model_downloader as downloader
    import acestep.api.model_download as api_download
    def already_prepared(model_name, checkpoint_dir, *args, **kwargs):
        target = Path(checkpoint_dir) / model_name
        if model_name not in ("acestep-v15-turbo", "vae", "Qwen3-Embedding-0.6B") or not target.is_dir():
            raise RuntimeError("Missing prepared model; automatic downloads are disabled.")
        return str(target)
    api_download.ensure_model_downloaded = already_prepared
    # Handler uses this separate helper; deny all network download entrypoints.
    def deny_download(*args, **kwargs):
        raise RuntimeError("Model downloads require explicit Music Producer setup.")
    for module in (downloader, api_download):
        for name in dir(module):
            if name.startswith("download_"):
                setattr(module, name, deny_download)
    # Defense in depth for helpers imported by the handler after this point.
    import huggingface_hub
    huggingface_hub.snapshot_download = deny_download
    huggingface_hub.hf_hub_download = deny_download
    from acestep.api_server import app
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
