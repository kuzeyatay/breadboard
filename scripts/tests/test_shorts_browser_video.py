"""Real OpenCV crop and FFmpeg export; no speech model or provider is used."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))
BIN = ROOT / "desktop/build-resources/bin"
FFMPEG = BIN / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
FFPROBE = BIN / ("ffprobe.exe" if os.name == "nt" else "ffprobe")


@unittest.skipUnless(FFMPEG.is_file() and FFPROBE.is_file() and importlib.util.find_spec("cv2"), "Requires bundled FFmpeg and the prepared OpenCV runtime")
class BrowserVideoTests(unittest.TestCase):
    def test_vertical_clip_exports_h264_with_audio_and_releases_intermediates(self):
        file = SOURCE / "AI-Youtube-Shorts-Generator/shorts_generator/local/clipper.py"
        module = types.ModuleType("owned_real_clipper")
        code = file.read_text(encoding="utf-8")
        self.assertEqual(code.count("from ..config import LOCAL_OUTPUT_DIR"), 1)
        code = code.replace("from ..config import LOCAL_OUTPUT_DIR", "LOCAL_OUTPUT_DIR = ''")
        exec(compile(code, str(file), "exec"), module.__dict__)
        with tempfile.TemporaryDirectory(prefix="owned-shorts-export-") as folder:
            source = Path(folder) / "source.mp4"
            output = Path(folder) / "portrait.mp4"
            subprocess.run([str(FFMPEG), "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=12:d=1",
                            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=22050:duration=1", "-c:v", "libx264",
                            "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source)], check=True, timeout=20)
            with patch.dict(os.environ, {"PATH": str(BIN) + os.pathsep + os.environ.get("PATH", "")}):
                module.crop_clip_local(str(source), 0, 1, "9:16", str(output))
            probe = subprocess.run([str(FFPROBE), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)],
                                   capture_output=True, text=True, check=True, timeout=20)
            metadata = json.loads(probe.stdout)
            video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
            self.assertEqual(video["codec_name"], "h264")
            self.assertEqual(video["pix_fmt"], "yuv420p")
            self.assertLess(video["width"], video["height"])
            self.assertAlmostEqual(float(metadata["format"]["duration"]), 1, delta=0.15)
            self.assertTrue(any(stream["codec_name"] == "aac" for stream in metadata["streams"]))
            subprocess.run([str(FFMPEG), "-v", "error", "-i", str(output), "-f", "null", "-"], check=True, timeout=20)
            self.assertFalse(Path(str(output) + ".cut.mp4").exists())
            self.assertFalse(Path(str(output) + ".silent.mp4").exists())


if __name__ == "__main__":
    unittest.main()
