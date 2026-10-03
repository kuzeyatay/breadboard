"""A visual excerpt must not hide a later experiment from the answerer."""
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
    spec = importlib.util.spec_from_file_location("watch_coverage_test", request.param)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepare(monkeypatch, tmp_path, module, *, detail="transcript", captions=True):
    subtitle = tmp_path / "captions.vtt"
    subtitle.write_text(
        "WEBVTT\n\n00:01:07.000 --> 00:01:12.000\nChecking an answer takes effort.\n\n"
        "00:08:46.000 --> 00:09:17.000\nA hard-to-read font reduced quiz errors.\n",
        encoding="utf-8",
    )
    metadata = {"title": "Thinking", "duration": 730}
    monkeypatch.setattr(module, "fetch_captions", lambda *a, **k: {
        "subtitle_path": str(subtitle) if captions else None,
        "info": metadata,
    })
    monkeypatch.setattr(module, "download", lambda *a, **k: {
        "video_path": "video.mp4", "subtitle_path": None, "info": metadata,
    })
    monkeypatch.setattr(module, "get_metadata", lambda *a: {
        "duration_seconds": 730, "has_audio": True,
        "width": 1280, "height": 720, "codec": "av1",
    })
    frame_ranges = []

    def frames(*args, **kwargs):
        frame_ranges.append((kwargs["start_seconds"], kwargs["end_seconds"]))
        return ([{"path": "frame.jpg", "timestamp_seconds": 67}], {"selected_count": 1})

    monkeypatch.setattr(module, "extract_scene_or_uniform", frames)
    monkeypatch.setattr(module, "extract_keyframes", frames)
    argv = ["watch.py", "https://www.youtube.com/watch?v=UBVV8pch1dM&t=67s",
            "--detail", detail, "--start", "00:55", "--end", "02:30",
            "--out-dir", str(tmp_path), "--no-whisper"]
    monkeypatch.setattr(sys, "argv", argv)
    return frame_ranges


@pytest.mark.parametrize("detail", ["transcript", "efficient", "balanced", "token-burner"])
def test_full_transcript_is_unconditional_in_every_detail_mode(monkeypatch, tmp_path, capsys, watch_module, detail):
    frame_ranges = prepare(monkeypatch, tmp_path, watch_module, detail=detail)
    assert watch_module.main() == 0
    report = capsys.readouterr().out
    assert "[01:07] Checking an answer takes effort." in report
    assert "[08:46] A hard-to-read font reduced quiz errors." in report
    assert "**Transcript coverage:** Full available transcript" in report
    assert "Filtered to" not in report
    if detail != "transcript":
        assert frame_ranges == [(55, 150)]
        assert "**Visual coverage:** Sampled frames in the focus range only" in report
    else:
        assert frame_ranges == []


def test_older_full_transcript_flag_remains_compatible(monkeypatch, tmp_path, capsys, watch_module):
    prepare(monkeypatch, tmp_path, watch_module)
    monkeypatch.setattr(sys, "argv", [*sys.argv, "--full-transcript"])
    assert watch_module.main() == 0
    report = capsys.readouterr().out
    assert "[01:07]" in report
    assert "[08:46]" in report
    assert "**Transcript coverage:** Full available transcript" in report


def test_no_captions_does_not_claim_full_transcript_coverage(monkeypatch, tmp_path, capsys, watch_module):
    prepare(monkeypatch, tmp_path, watch_module, captions=False)
    assert watch_module.main() == 0
    report = capsys.readouterr().out
    assert "**Transcript coverage:** Unavailable" in report
    assert "**Transcript coverage:** Full" not in report


def test_captions_found_during_download_are_also_kept_in_full(monkeypatch, tmp_path, capsys, watch_module):
    prepare(monkeypatch, tmp_path, watch_module, captions=False)
    monkeypatch.setattr(watch_module, "download", lambda *a, **k: {
        "video_path": "video.mp4", "subtitle_path": str(tmp_path / "captions.vtt"),
        "info": {"duration": 730},
    })
    assert watch_module.main() == 0
    report = capsys.readouterr().out
    assert "[08:46] A hard-to-read font reduced quiz errors." in report
    assert "**Transcript coverage:** Full available transcript" in report


def test_whisper_context_also_survives_frame_focus(monkeypatch, tmp_path, capsys, watch_module):
    prepare(monkeypatch, tmp_path, watch_module, captions=False)
    monkeypatch.setattr(sys, "argv", [arg for arg in sys.argv if arg != "--no-whisper"])
    monkeypatch.setattr(watch_module, "load_api_key", lambda *a: ("openai", "test-only"))
    monkeypatch.setattr(watch_module, "transcribe_video", lambda *a, **k: ([
        {"start": 67, "end": 72, "text": "Checking an answer takes effort."},
        {"start": 526, "end": 557, "text": "A hard-to-read font reduced quiz errors."},
    ], "openai"))
    assert watch_module.main() == 0
    report = capsys.readouterr().out
    assert "[08:46] A hard-to-read font reduced quiz errors." in report
    assert "via whisper (openai)" in report
    assert "**Transcript coverage:** Full available transcript" in report
