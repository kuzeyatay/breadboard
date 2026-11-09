"""Optional notification SDKs must not delay ordinary API imports or webhooks."""
import subprocess
import sys
from pathlib import Path


def test_feishu_registry_and_webhook_do_not_import_sdk():
    source = r'''
import importlib.abc
import sys
from types import SimpleNamespace
from unittest.mock import patch

class RejectOptionalSdk(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "lark_oapi" or fullname.startswith("lark_oapi."):
            raise AssertionError("Optional SDK imported before an App Bot operation")

sys.meta_path.insert(0, RejectOptionalSdk())
from src.notification_sender import FeishuSender
sender = FeishuSender(SimpleNamespace(feishu_webhook_url="https://example.invalid/fixture"))
with patch("src.notification_sender.feishu_sender.requests.post") as post:
    post.return_value.status_code = 200
    post.return_value.json.return_value = {"code": 0}
    assert sender.send_to_feishu("Offline fixture") is True
    post.assert_called_once()
assert "lark_oapi" not in sys.modules
'''
    subprocess.run(
        [sys.executable, "-c", source],
        cwd=Path(__file__).resolve().parents[1],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
