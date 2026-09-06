import os
import io
import json
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock

from flask import Flask
from chatmock import subscription_voice as voice


class SubscriptionVoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="breadboard-voice-unit-")
        self.env = patch.dict(os.environ, {"CODEX_HOME": self.temp.name})
        self.env.start()
        self.auth = ({"tokens": {"access_token": "private-token", "account_id": "account"}}, os.path.join(self.temp.name, "auth.json"))
        self.selection = patch.object(voice, "selected_auth", return_value=self.auth)
        self.selection.start()
        voice.secret_path().write_text("a" * 64, encoding="utf-8")
        app = Flask(__name__)
        app.register_blueprint(voice.voice_bp)
        self.client = app.test_client()
        self.headers = {"X-Breadboard-Voice-Secret": "a" * 64, "X-Breadboard-Voice-Owner": "1"}

    def tearDown(self):
        voice._sessions.clear()
        self.selection.stop()
        self.env.stop()
        self.temp.cleanup()

    def test_authentication_and_browser_origin(self):
        self.assertEqual(self.client.get("/breadboard/voice/status").status_code, 403)
        self.assertEqual(self.client.get("/breadboard/voice/status", headers={**self.headers, "Origin": "https://evil.test"}).status_code, 403)
        with patch.object(voice, "binary", return_value="codex"), patch.object(voice, "get_effective_chatgpt_auth") as refresh:
            response = self.client.get("/breadboard/voice/status", headers=self.headers)
            self.assertTrue(response.json["configured"])
            self.assertNotIn("private-token", response.text)
            self.assertEqual(response.json["source"], "subscription")
            self.assertTrue(response.json["signedIn"])
            self.assertEqual(response.json["reason"], "ready")
            refresh.assert_not_called()

    def test_api_key_does_not_enable_voice(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-not-used"}), patch.object(voice, "selected_auth", return_value=None):
            status = self.client.get("/breadboard/voice/status", headers=self.headers).json
            self.assertFalse(status["configured"])
            self.assertEqual(status["reason"], "sign_in_required")
            response = self.client.post("/breadboard/voice/sessions", headers=self.headers, json={"sdp": "v=0", "voice": "cove", "mode": "speak"})
            self.assertEqual(response.status_code, 401)

    def test_missing_runtime_does_not_require_second_login(self):
        with patch.object(voice, "binary", return_value=None):
            status = self.client.get("/breadboard/voice/status", headers=self.headers).json
        self.assertTrue(status["signedIn"])
        self.assertFalse(status["configured"])
        self.assertEqual(status["reason"], "runtime_missing")
        self.assertIn("no new sign-in", status["error"])

    def test_refreshable_account_is_still_signed_in(self):
        auth = ({"tokens": {"refresh_token": "private-refresh", "account_id": "account"}}, self.auth[1])
        with patch.object(voice, "selected_auth", return_value=auth), patch.object(voice, "binary", return_value="codex"), patch("chatmock.utils._refresh_chatgpt_tokens") as refresh:
            response = self.client.get("/breadboard/voice/status", headers=self.headers)
        self.assertTrue(response.json["configured"])
        self.assertNotIn("private-refresh", response.text)
        refresh.assert_not_called()

    def test_voice_uses_chats_existing_additional_account_selection(self):
        self.selection.stop()
        account = Mock(auth=self.auth[0], path=self.auth[1])
        with patch.object(voice, "select_account", return_value=account), patch.object(voice, "_read_auth_file_with_path") as fallback:
            self.assertEqual(voice.selected_auth(), self.auth)
        fallback.assert_not_called()
        with patch.object(voice, "select_account", return_value=None), patch.object(voice, "_read_auth_file_with_path", return_value=self.auth):
            self.assertEqual(voice.selected_auth(), self.auth)

    def test_create_passes_existing_tokens_without_browser_login(self):
        session = Mock(id="fixture")
        with patch.object(voice, "binary", return_value="codex"), patch.object(voice, "VoiceSession", return_value=session):
            response = self.client.post("/breadboard/voice/sessions", headers=self.headers, json={"sdp": "v=0", "voice": "cove", "mode": "conversation"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"id": "fixture"})
        session.start.assert_called_once_with("private-token", "account", "v=0", "cove", "conversation", None, auth_path=self.auth[1])

    def refresh_session(self):
        session = object.__new__(voice.VoiceSession)
        session.account_id, session.access_token, session.auth_path = "account", "private-token", self.auth[1]
        session.refresh_lock = threading.Lock()
        session.refresh_lock.acquire()
        session.send = Mock()
        session.publish = Mock()
        return session

    def test_native_refresh_reuses_newer_stored_token(self):
        session = self.refresh_session()
        auth = {"tokens": {"access_token": "already-refreshed", "account_id": "account"}}
        with patch.object(voice, "_read_auth_path", return_value=auth) as read, patch("chatmock.utils._refresh_chatgpt_tokens") as refresh:
            session.refresh_auth({"id": 8, "params": {"previousAccountId": "account"}})
        read.assert_called_once_with(self.auth[1])
        refresh.assert_not_called()
        self.assertEqual(session.send.call_args.args[0], {"id": 8, "result": {"accessToken": "already-refreshed", "chatgptAccountId": "account", "chatgptPlanType": None}})
        session.publish.assert_not_called()
        self.assertFalse(session.refresh_lock.locked())

    def test_native_refresh_renews_same_existing_login_without_interaction(self):
        session = self.refresh_session()
        auth = {"tokens": {**self.auth[0]["tokens"], "refresh_token": "existing-refresh"}}
        with patch.object(voice, "_read_auth_path", return_value=auth), patch("chatmock.utils._refresh_chatgpt_tokens", return_value={"access_token": "renewed", "id_token": "id", "account_id": "account"}) as refresh:
            session.refresh_auth({"id": 8, "params": {"previousAccountId": "account"}})
        self.assertEqual(refresh.call_args.args[0], "existing-refresh")
        self.assertEqual(refresh.call_args.kwargs["timeout"], 7)
        self.assertEqual(session.send.call_args.args[0]["result"]["accessToken"], "renewed")
        with open(self.auth[1], encoding="utf-8") as file:
            self.assertEqual(json.load(file)["tokens"]["access_token"], "renewed")
        session.publish.assert_not_called()

    def test_native_refresh_never_switches_accounts_or_leaks_credentials(self):
        for stored in (None, {"tokens": {"access_token": "different-private-token", "account_id": "different"}}, self.auth[0]):
            session = self.refresh_session()
            with patch.object(voice, "_read_auth_path", return_value=stored), patch("chatmock.utils._refresh_chatgpt_tokens") as refresh:
                session.refresh_auth({"id": 8, "params": {"previousAccountId": "account"}})
            self.assertIn("error", session.send.call_args.args[0])
            self.assertNotIn("private-token", str(session.send.call_args) + str(session.publish.call_args))
            refresh.assert_not_called()
            self.assertFalse(session.refresh_lock.locked())

    def test_reader_handles_only_auth_refresh_server_requests(self):
        session = self.refresh_session()
        session.refresh_lock.release()
        session.pending = {}
        session.condition = threading.Condition()
        done = threading.Event()
        session.refresh_auth = Mock(side_effect=lambda _: done.set())
        session.proc = Mock(stdout=io.StringIO('\n'.join(json.dumps(msg) for msg in [
            {"id": 8, "method": "account/chatgptAuthTokens/refresh", "params": {}},
            {"id": 9, "method": "item/commandExecution/requestApproval", "params": {}},
        ])))
        session.read()
        self.assertTrue(done.wait(1))
        self.assertEqual(session.refresh_auth.call_args.args[0]["id"], 8)
        self.assertEqual(session.send.call_args.args[0]["id"], 9)
        self.assertEqual(session.send.call_args.args[0]["error"]["code"], -32601)

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

    def test_read_aloud_frames_the_exact_script_instead_of_answering_its_contents(self):
        session = Mock(owner="1", thread_id="thread")
        voice._sessions["fixture"] = session
        for text in (
            "Breadboard can read this response aloud in your chosen voice.",
            "What is two plus two?",
            'Say "hello".\nCafé, rain, and 🦉. {"text": "still part of the script"}',
        ):
            response = self.client.post("/breadboard/voice/sessions/fixture", headers=self.headers, json={"text": text})
            self.assertEqual(response.status_code, 200)
            method, params = session.rpc.call_args.args
            self.assertEqual(method, "thread/realtime/appendSpeech")
            self.assertEqual(params["threadId"], "thread")
            instruction, script = params["text"].split("\n", 1)
            self.assertIn("Say no other words", instruction)
            self.assertEqual(json.loads(script), {"text": text})

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
        self.assertFalse(calls[4].args[1]["delegationAckFiller"])
        self.assertFalse(calls[4].args[1]["includeStartupContext"])
        self.assertEqual(calls[4].args[1]["version"], "v3")


if __name__ == "__main__":
    unittest.main()
