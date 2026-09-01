"""Pinned, verified model assets with resumable first-use downloads."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
import urllib.request
from pathlib import Path
from typing import Callable

Progress = Callable[[str, dict[str, object]], None]

FALCON_BASE = (
    "tiiuae/falcon-7b",
    "ec89142b67d748a1865ea4451372db8313ada0d8",
)
FALCON_INSTRUCT = (
    "tiiuae/falcon-7b-instruct",
    "8782b5c5d8c9290412416618f36a133653e85285",
)
CLIP_URL = (
    "https://openaipublic.azureedge.net/clip/models/"
    "b8cca3fd41ae0c99ba7e8951adf17d267cdb84cd88be6f7c2e0eca1737a03836/ViT-L-14.pt"
)
CLIP_SHA256 = "b8cca3fd41ae0c99ba7e8951adf17d267cdb84cd88be6f7c2e0eca1737a03836"
UNIVFD_HEAD_URL = (
    "https://raw.githubusercontent.com/WisconsinAIVision/UniversalFakeDetect/"
    "030495aea3300a8b54c0ec37ec7fe1dd7e63c619/pretrained_weights/fc_weights.pth"
)
UNIVFD_HEAD_SHA256 = "477100745713bcc957beb2b40859536859b6483fd6301b3b9293151b194c7847"


class AssetStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.hf_cache = self.root / "huggingface"
        self.files = self.root / "files"
        self.quarantine = self.root / "quarantine"
        for path in (self.hf_cache, self.files, self.quarantine):
            path.mkdir(parents=True, exist_ok=True)

    def status(self) -> dict[str, bool]:
        def snapshot_present(repo_id: str, revision: str) -> bool:
            repository = "models--" + repo_id.replace("/", "--")
            return (self.hf_cache / repository / "snapshots" / revision).is_dir()

        return {
            "textInstalled": snapshot_present(*FALCON_BASE)
            and snapshot_present(*FALCON_INSTRUCT),
            "imageInstalled": (self.files / "ViT-L-14.pt").is_file()
            and (self.files / "universalfakedetect-fc_weights.pth").is_file(),
        }

    def ensure_hf_snapshot(
        self,
        repo_id: str,
        revision: str,
        progress: Progress,
        *,
        allow_patterns: list[str] | None = None,
    ) -> Path:
        from huggingface_hub import model_info, snapshot_download
        from tqdm.auto import tqdm

        progress("checking_assets", {"modelId": repo_id, "revision": revision})
        try:
            local = snapshot_download(
                repo_id,
                revision=revision,
                cache_dir=str(self.hf_cache),
                local_files_only=True,
                allow_patterns=allow_patterns,
            )
            self._verify_or_record(Path(local), repo_id, revision, progress)
            return Path(local)
        except Exception:
            pass

        info = model_info(repo_id, revision=revision, files_metadata=True)
        expected = sum(
            int(sibling.size or 0)
            for sibling in info.siblings
            if not allow_patterns or _matches_any(sibling.rfilename, allow_patterns)
        )
        counter = _DownloadCounter(expected, progress, repo_id)

        class ReportingTqdm(tqdm):
            def update(self, n: int | float = 1):  # type: ignore[override]
                result = super().update(n)
                counter.add(int(n))
                return result

        progress("downloading_assets", {"modelId": repo_id, "downloadedBytes": 0, "totalBytes": expected})
        local = snapshot_download(
            repo_id,
            revision=revision,
            cache_dir=str(self.hf_cache),
            local_files_only=False,
            allow_patterns=allow_patterns,
            max_workers=1,
            tqdm_class=ReportingTqdm,
        )
        self._verify_or_record(Path(local), repo_id, revision, progress)
        return Path(local)

    def ensure_url(
        self,
        name: str,
        url: str,
        expected_sha256: str,
        progress: Progress,
    ) -> Path:
        target = self.files / name
        if target.is_file() and _sha256(target) == expected_sha256:
            return target
        if target.exists():
            self._quarantine(target, f"sha256-mismatch-{name}")
        partial = target.with_suffix(target.suffix + ".partial")
        partial.unlink(missing_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": "Breadboard-Detect-AI/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
            total = int(response.headers.get("content-length") or 0)
            downloaded = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                progress(
                    "downloading_assets",
                    {"asset": name, "downloadedBytes": downloaded, "totalBytes": total},
                )
        actual = _sha256(partial)
        if actual != expected_sha256:
            self._quarantine(partial, f"sha256-mismatch-{name}")
            raise RuntimeError(f"asset checksum mismatch for {name}")
        partial.replace(target)
        return target

    def _verify_or_record(
        self, snapshot: Path, repo_id: str, revision: str, progress: Progress
    ) -> None:
        manifest_path = snapshot / ".breadboard-sha256.json"
        files = [
            path
            for path in snapshot.rglob("*")
            if path.is_file() and path.name != manifest_path.name
        ]
        if manifest_path.is_file():
            try:
                recorded = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                self._quarantine(snapshot, f"corrupt-{repo_id.replace('/', '--')}")
                raise RuntimeError("cached model checksum manifest is invalid") from error
            bad = []
            for relative, expected in recorded.get("files", {}).items():
                path = snapshot / relative
                if not path.is_file() or _sha256(path) != expected:
                    bad.append(relative)
            if bad:
                self._quarantine(snapshot, f"corrupt-{repo_id.replace('/', '--')}")
                raise RuntimeError(f"cached model failed checksum verification: {', '.join(bad[:3])}")
            progress("verifying_assets", {"modelId": repo_id, "verifiedFiles": len(files)})
            return
        hashes: dict[str, str] = {}
        for index, path in enumerate(files, start=1):
            hashes[path.relative_to(snapshot).as_posix()] = _sha256(path)
            progress(
                "verifying_assets",
                {"modelId": repo_id, "verifiedFiles": index, "totalFiles": len(files)},
            )
        manifest_path.write_text(
            json.dumps(
                {"repoId": repo_id, "revision": revision, "files": hashes},
                sort_keys=True,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _quarantine(self, path: Path, label: str) -> None:
        destination = self.quarantine / f"{label}-{os.getpid()}-{time.time_ns()}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(destination))


class _DownloadCounter:
    def __init__(self, total: int, progress: Progress, model_id: str) -> None:
        self.total = total
        self.progress = progress
        self.model_id = model_id
        self.value = 0
        self.lock = threading.Lock()

    def add(self, amount: int) -> None:
        if amount <= 0:
            return
        with self.lock:
            self.value += amount
            if self.total:
                self.value = min(self.total, self.value)
            self.progress(
                "downloading_assets",
                {
                    "modelId": self.model_id,
                    "downloadedBytes": self.value,
                    "totalBytes": self.total,
                },
            )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _matches_any(name: str, patterns: list[str]) -> bool:
    from fnmatch import fnmatch

    return any(fnmatch(name, pattern) for pattern in patterns)
