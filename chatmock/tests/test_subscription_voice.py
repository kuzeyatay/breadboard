import os
import tempfile
import unittest
from unittest.mock import patch, Mock

from flask import Flask
from chatmock import subscription_voice as voice


class SubscriptionVoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="breadboard-voice-unit-")
        self.env = patch.dict(os.environ, {"CODEX_HOME": self.temp.name})
        self.env.start()
        voice.secret_path().write_text("a" * 64, encoding="utf-8")
        app = Flask(__name__)
        app.register_blueprint(voice.voice_bp)
        self.client = app.test_client()
        self.headers = {"X-Breadboard-Voice-Secret": "a" * 64, "X-Breadboard-Voice-Owner": "1"}

    def tearDown(self):
        voice._sessions.clear()
        self.env.stop()
        self.temp.cleanup()

    def test_authentication_and_browser_origin(self):
        self.assertEqual(self.client.get("/breadboard/voice/status").status_code, 403)
        self.assertEqual(self.client.get("/breadboard/voice/status", headers={**self.headers, "Origin": "https://evil.test"}).status_code, 403)
        with patch.object(voice, "get_effective_chatgpt_auth", return_value=("private-token", "account")), patch.object(voice, "binary", return_value="codex"):
            response = self.client.get("/breadboard/voice/status", headers=self.headers)
            self.assertTrue(response.json["configured"])
            self.assertNotIn("private-token", response.text)
            self.assertEqual(response.json["source"], "subscription")

    def test_api_key_does_not_enable_voice(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-not-used"}), patch.object(voice, "get_effective_chatgpt_auth", return_value=(None, None)):
            self.assertFalse(self.client.get("/breadboard/voice/status", headers=self.headers).json["configured"])
            response = self.client.post("/breadboard/voice/sessions", headers=self.headers, json={"sdp": "v=0", "voice": "cove", "mode": "speak"})
            self.assertEqual(response.status_code, 401)

    def test_session_ownership_and_limits(self):
        session = Mock(owner="2", last_seen=0)
        voice._sessions["fixture"] = session
        for method in (self.client.get, self.client.delete, self.client.post):
            self.assertEqual(method("/breadboard/voice/sessions/fixture", headers=self.headers).status_code, 404)
        self.assertFalse(session.close.called)
        session.owner = "1"
        self.assertEqual(self.client.post("/breadboard/voice/sessions/fixture", headers=self.headers, json={"text": "x" * 4001}).status_code, 400)
        self.assertFalse(session.rpc.called)

    def test_only_native_subscription_voice_choices(self):
        for value in ("marin", "../../secret", "unknown"):
            response = self.client.post("/breadboard/voice/sessions", headers=self.headers, json={"sdp": "v=0", "voice": value, "mode": "speak"})
            self.assertEqual(response.status_code, 400)

    def test_native_start_is_ephemeral_and_client_managed(self):
        session = object.__new__(voice.VoiceSession)
        session.home = self.temp.name
        session.rpc = Mock(side_effect=[{}, {}, {"account": {"type": "chatgpt"}}, {"thread": {"id": "thread"}}, {}])
        session.send = Mock()
        session.start("private-token", "account", "v=0", "cove", "speak", "nl")
        calls = session.rpc.call_args_list
        self.assertEqual(calls[1].args[1]["type"], "chatgptAuthTokens")
        self.assertTrue(calls[3].args[1]["ephemeral"])
        self.assertEqual(calls[3].args[1]["approvalPolicy"], "never")
        self.assertTrue(calls[4].args[1]["clientManagedHandoffs"])
        self.assertFalse(calls[4].args[1]["includeStartupContext"])
        self.assertEqual(calls[4].args[1]["version"], "v3")


if __name__ == "__main__":
    unittest.main()
