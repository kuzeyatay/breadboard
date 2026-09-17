"""Preserve retrieved caption evidence when the optional media download fails."""
import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(params=[
    ROOT / "watch/skills/watch/scripts/watch.py",
    ROOT / "hermes-skills/prebuilt/watch/scripts/watch.py",
], ids=["source", "bundled"])
def watch_module(request):
    spec = importlib.util.spec_from_file_location("watch_caption_test", request.param)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepare(monkeypatch, tmp_path, watch_module, captions=True, detail="balanced", timestamps=None):
    subtitle = tmp_path / "captions.vtt"
    subtitle.write_text("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nDim the lights.\n", encoding="utf-8")
    monkeypatch.setattr(watch_module, "fetch_captions", lambda *a, **k: {
        "subtitle_path": str(subtitle) if captions else None,
        "video_path": None,
        "info": {"title": "Nighttime routine", "duration": 10},
    })

    def fail_download(*args, **kwargs):
        raise SystemExit("media download failed: HTTP 403")

    def unexpected(*args, **kwargs):
        pytest.fail("No media process should run after a blocked download")

    monkeypatch.setattr(watch_module, "download", fail_download)
    for name in ["get_metadata", "extract_at_timestamps", "extract_keyframes", "extract_scene_or_uniform", "transcribe_video"]:
        monkeypatch.setattr(watch_module, name, unexpected)
    argv = ["watch.py", "https://www.youtube.com/watch?v=BDik5Yo9Rzs", "--detail", detail, "--out-dir", str(tmp_path)]
    if timestamps:
        argv += ["--timestamps", timestamps]
    monkeypatch.setattr(sys, "argv", argv)


@pytest.mark.parametrize("detail,timestamps", [("balanced", None), ("efficient", None), ("transcript", "1")])
def test_keeps_captions_and_discloses_missing_visuals(monkeypatch, tmp_path, capsys, watch_module, detail, timestamps):
    prepare(monkeypatch, tmp_path, watch_module, detail=detail, timestamps=timestamps)
    assert watch_module.main() == 0
    output = capsys.readouterr().out
    assert "[00:01] Dim the lights." in output
    assert "**Transcript:** 1 segments" in output
    assert "**Frames:** unavailable" in output
    assert "Visual content and requested frames were not inspected" in output
    assert "**Title:** Nighttime routine" in output
    assert "skipped (transcript detail)" not in output


def test_missing_media_and_captions_still_fails(monkeypatch, tmp_path, watch_module):
    prepare(monkeypatch, tmp_path, watch_module, captions=False)
    with pytest.raises(SystemExit, match="HTTP 403"):
        watch_module.main()


def test_transcript_detail_never_downloads_media_when_captions_exist(monkeypatch, tmp_path, capsys, watch_module):
    prepare(monkeypatch, tmp_path, watch_module, detail="transcript")
    assert watch_module.main() == 0
    output = capsys.readouterr().out
    assert "[00:01] Dim the lights." in output
    assert "skipped (transcript detail)" in output
    assert "unavailable" not in output
