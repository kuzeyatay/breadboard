import base64
import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from aircursor.breadboard_bridge import BreadboardBridge


def request(bridge, path="/snapshot", action=None, token=None, origin=None):
    headers = {"Authorization": f"Bearer {bridge.token if token is None else token}"}
    if origin:
        headers["Origin"] = origin
    data = json.dumps({"action": action}).encode() if action is not None else None
    req = Request(f"http://127.0.0.1:{bridge._server.server_port}{path}",
                  data=data, headers=headers)
    with urlopen(req, timeout=2) as response:
        return json.load(response)


def test_bridge_requires_secret_and_refuses_browser_origins(tmp_path):
    descriptor = tmp_path / "bridge.json"
    with BreadboardBridge(descriptor) as bridge:
        saved = json.loads(descriptor.read_text())
        assert saved["port"] == bridge._server.server_port
        assert request(bridge)["paused"] is True
        for headers in ({"token": "wrong"}, {"origin": "https://example.com"}):
            with pytest.raises(HTTPError) as error:
                request(bridge, **headers)
            assert error.value.code == 403
        assert "token" not in request(bridge)
    assert not descriptor.exists()


def test_only_pause_stop_embed_commands_are_accepted_and_queued(tmp_path):
    with BreadboardBridge(tmp_path / "bridge.json") as bridge:
        for action in ["pause", "stop", "embed"]:
            assert request(bridge, "/command", action)["ok"]
        assert bridge.commands() == ["pause", "stop", "embed"]
        assert bridge.commands() == []
        for action in ["resume", "start", "send_keys", "run", ["pause"]]:
            with pytest.raises(HTTPError) as error:
                request(bridge, "/command", action)
            assert error.value.code == 400


def test_frames_are_only_encoded_while_viewed_and_cleared_on_close(tmp_path, monkeypatch):
    now = [10.0]
    monkeypatch.setattr("aircursor.breadboard_bridge.time.monotonic", lambda: now[0])
    encoder = Mock(return_value=(True, b"jpeg"))
    monkeypatch.setitem(sys.modules, "cv2", SimpleNamespace(imencode=encoder, IMWRITE_JPEG_QUALITY=1))
    with BreadboardBridge(tmp_path / "bridge.json") as bridge:
        def publish():
            bridge.publish(object(), paused=True, status="Paused", detail="Fist to start", display="DISPLAY2")

        publish()
        encoder.assert_not_called()
        request(bridge)
        publish()
        assert request(bridge)["image"] == base64.b64encode(b"jpeg").decode()
        now[0] += 0.05
        publish()
        assert encoder.call_count == 1
        now[0] += 3
        publish()
        assert bridge._state["image"] is None
        bridge.fail("Camera unavailable")
        state = request(bridge)
        assert state["phase"] == "error" and state["paused"]
    assert bridge._state["image"] is None
