import base64
import tempfile
import unittest
from pathlib import Path

from breadboard_detect_ai.assets import AssetStore
from breadboard_detect_ai.pipeline import DetectPipeline, MAX_IMAGE_BYTES, _estimated_tokens
from breadboard_detect_ai.resources import ResourceProfile
from breadboard_detect_ai.detectors.text import TextDetectorSuite, _language_hint


class PipelineSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.pipeline = DetectPipeline(
            AssetStore(Path(self.temporary.name)),
            ResourceProfile("cpu", "float32", "cpu", None, 8192, True),
            60,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_short_text_returns_insufficient_without_downloading(self):
        stages = []
        result = self.pipeline.detect(
            "request_12345678",
            {"id": "item-1", "name": "note.txt", "modality": "text", "text": "Too short."},
            {},
            lambda stage, _detail: stages.append(stage),
            lambda: False,
        )
        self.assertEqual(result.verdict, "insufficient_evidence")
        self.assertFalse(any(stage in {"checking_assets", "downloading_assets"} for stage in stages))

    def test_invalid_base64_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "imageBase64"):
            self.pipeline.detect(
                "request_12345678",
                {"id": "item-1", "name": "bad.png", "modality": "image", "imageBase64": "not base64"},
                {},
                lambda _stage, _detail: None,
                lambda: False,
            )

    def test_oversize_text_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "text"):
            self.pipeline.detect(
                "request_12345678",
                {"id": "item-1", "name": "large.txt", "modality": "text", "text": "a" * 100_001},
                {},
                lambda _stage, _detail: None,
                lambda: False,
            )

    def test_small_cuda_device_routes_falcon_text_inference_to_cpu(self):
        suite = TextDetectorSuite(
            self.pipeline.assets,
            ResourceProfile("cuda:0", "float16", "cuda", 6_144, 32_768, True),
        )
        self.assertEqual(suite.device, "cpu")
        self.assertEqual(suite.dtype, "bfloat16")

    def test_non_english_text_is_identified_for_a_visible_caveat(self):
        self.assertEqual(_language_hint("这是一个用于测试语言提示的中文段落。"), "non_english_or_mixed")

    def test_code_heavy_text_preflight_counts_symbols_conservatively(self):
        code = "\n".join(f"value_{index} = call({index});" for index in range(30))
        self.assertGreaterEqual(_estimated_tokens(code), 80)


if __name__ == "__main__":
    unittest.main()
