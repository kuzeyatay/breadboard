import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))


class DocumentAssignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = SOURCE / "scripts/legal-bridge.py"
        spec = importlib.util.spec_from_file_location("legal_assignment_under_test", source)
        cls.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.bridge)

    def test_plain_text_does_not_require_a_nonexistent_extraction(self):
        prompt = self.bridge._assignment({"task":"Review payment deadlines.", "documents":[{"filename":"agreement.txt", "extracted":None, "figures":[], "editable":False}]}, ["agreement.txt"])
        self.assertIn("agreement.txt", prompt)
        self.assertNotIn(".extracted.md", prompt)
        self.assertIn("Review payment deadlines.", prompt)

    def test_binary_document_keeps_its_real_extraction_and_figures(self):
        prompt = self.bridge._assignment({"task":"Review the supplied table.", "documents":[{"filename":"agreement.docx", "extracted":"agreement.extracted.md", "figures":["diagram.png"], "editable":True}, {"filename":"note.txt", "extracted":None}]}, [])
        for name in ("agreement.docx", "agreement.extracted.md", "diagram.png", "note.txt"):
            self.assertIn(name, prompt)
        self.assertNotIn("note.extracted", prompt)


class ClipFailureCleanupTests(unittest.TestCase):
    def check_failure(self, missing_api):
        source = SOURCE / "AI-Youtube-Shorts-Generator/shorts_generator/local/clipper.py"
        module = types.ModuleType("owned_clipper")
        # Configuration is unrelated to cropping; supply only its output default.
        code = source.read_text(encoding="utf-8").replace("from ..config import LOCAL_OUTPUT_DIR", "LOCAL_OUTPUT_DIR = ''")
        exec(compile(code, str(source), "exec"), module.__dict__)
        state = {"captureReleased":False, "writerReleased":False, "writerCreated":False}
        capture = types.SimpleNamespace(isOpened=lambda:True, get=lambda prop:{1:320,2:180,3:30}[prop], read=lambda:(True, object()), release=lambda:state.update(captureReleased=True))
        def make_writer(*args):
            state["writerCreated"] = True
            return types.SimpleNamespace(isOpened=lambda:True, release=lambda:state.update(writerReleased=True))
        cv2 = types.SimpleNamespace(VideoCapture=lambda _:capture, CAP_PROP_FRAME_WIDTH=1, CAP_PROP_FRAME_HEIGHT=2, CAP_PROP_FPS=3,
                                    VideoWriter_fourcc=lambda *args:0, VideoWriter=make_writer, COLOR_BGR2GRAY=4, cvtColor=lambda frame,_:frame,
                                    data=types.SimpleNamespace(haarcascades="owned/"))
        if not missing_api:
            def failed_detector(*args, **kwargs):
                raise RuntimeError("owned face detector failure")
            cv2.CascadeClassifier=lambda _:types.SimpleNamespace(empty=lambda:False, detectMultiScale=failed_detector)
        with tempfile.TemporaryDirectory(prefix="owned-clip-cleanup-") as folder:
            out = Path(folder) / "clip.mp4"
            def cut(_source, _start, _end, output):
                Path(output).write_bytes(b"owned clip")
            real_remove = os.remove
            def windows_delete(file):
                if not state["captureReleased"]:
                    raise PermissionError("owned Windows video handle is still open")
                return real_remove(file)
            with patch.dict(sys.modules, {"cv2":cv2}), patch.object(module, "_cut_subclip", cut), patch.object(module.os, "remove", windows_delete):
                with self.assertRaisesRegex(RuntimeError, "OpenCV 4" if missing_api else "owned face detector failure"):
                    module.crop_clip_local("owned-source", 0, 1, "9:16", str(out))
            self.assertTrue(state["captureReleased"])
            self.assertEqual(state["writerCreated"], not missing_api)
            self.assertEqual(state["writerReleased"], not missing_api)
            self.assertFalse(Path(str(out) + ".cut.mp4").exists())

    def test_missing_face_api_closes_the_capture_and_preserves_the_error(self):
        self.check_failure(True)

    def test_detector_failure_closes_both_handles_before_removing_the_cut(self):
        self.check_failure(False)


if __name__ == "__main__":
    unittest.main()
