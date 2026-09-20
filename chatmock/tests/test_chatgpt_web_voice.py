from __future__ import annotations

import base64
import io
import json
import os
import queue
import tempfile
import time
import unittest
from typing import Any, Dict, List
from unittest.mock import patch

os.environ.setdefault("CHATMOCK_MODEL_DISCOVERY", "0")

from flask import Flask

from chatmock import subscription_voice as voice
from chatmock.providers import chatgpt_web as web
from chatmock.providers import chatgpt_web_voice as web_voice

# One ADTS AAC frame header: what the site's Read aloud returns for format=aac.
ADTS = bytes([0xFF, 0xF1, 0x50, 0x80, 0x01, 0x7F, 0xFC])


class VoicePage:
    """The driven chatgpt.com page, answering only the requests speech makes."""

    surface = "desktop"

    def __init__(self, synthesized=None, transcribed=None, dom=None, stored=None, recent=None) -> None:
        self.synthesized: List[Any] = list(synthesized or [])
        self.transcribed: List[Any] = list(transcribed or [])
        self.stored: List[Any] = list(stored or [])
        # A list replays one page reading per poll, repeating the last.
        self.dom = dom
        self.recent = recent
        self.expressions: List[str] = []
        self.hidden: List[str] = []

    def evaluate(self, expression: str, **_: Any) -> Any:
        self.expressions.append(expression)
        if "__breadboardChatgptWeb.stop()" in expression:
            self.stopped = getattr(self, "stopped", 0) + 1
            return None
        if "/backend-api/conversations?" in expression:
            if isinstance(self.recent, list):
                return self.recent.pop(0) if len(self.recent) > 1 else self.recent[0]
            return self.recent if self.recent is not None else {"conversationId": None}
        if "body.mapping" in expression:
            # No scripted stored answer: the site could not say, so the
            # reader's own text stands.
            return self.stored.pop(0) if self.stored else {"status": 404}
        if "/backend-api/synthesize" in expression:
            return self.synthesized.pop(0)
        if "/backend-api/transcribe" in expression:
            return self.transcribed.pop(0)
        if "is_visible" in expression:
            self.hidden.append(expression)
            return 200
        if "data-message-id" in expression:
            if isinstance(self.dom, list):
                return self.dom.pop(0) if len(self.dom) > 1 else self.dom[0]
            return self.dom
        raise AssertionError(f"unexpected page request: {expression[:80]}")


def audio_result(data: bytes = ADTS, kind: str = "audio/aac") -> Dict[str, Any]:
    return {"status": 200, "type": kind, "data": base64.b64encode(data).decode()}


class WebVoiceBase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(os.environ, {"CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json")})
        env.start()
        self.addCleanup(env.stop)
        web.reset_for_tests()
        self.addCleanup(web.reset_for_tests)
        web_voice.reset_for_tests()
        self.addCleanup(web_voice.reset_for_tests)
        web._write_state(
            signedIn=True,
            email="person@example.com",
            checkedAt="2026-09-15T00:00:00Z",
            models=[
                {"slug": slug, "title": slug, "description": "", "tags": []}
                for slug in ("gpt-5-6-thinking", "gpt-5-5-instant", "auto")
            ],
        )

    def turns(self, page: VoicePage, answers: List[str], *, message_id: str = "msg-1", conversation_id: str = "conv-1"):
        """Each ChatGPT turn answers with the next text in ``answers``."""
        started: List[Dict[str, Any]] = []

        def begin(model, prompt, effort, images=None, *, temporary=True):
            started.append({"model": model, "prompt": prompt, "temporary": temporary})
            return page, f"turn-{len(started)}"

        def collect(_page, _turn_id, *, on_text, deadline, cancel=None):
            return web.TurnResult(text=answers.pop(0), conversation_id=conversation_id, message_id=message_id)

        for patcher in (
            patch.object(web, "_begin_turn", side_effect=begin),
            patch.object(web, "_collect_turn", side_effect=collect),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        return started

    def assert_page_released(self) -> None:
        self.assertTrue(web._lane().lock.acquire(blocking=False), "the page lock was left held")
        web._lane().lock.release()


class StatusTests(WebVoiceBase):
    def test_signed_out_says_where_to_sign_in(self) -> None:
        web._write_state(signedIn=False)
        status = web_voice.status()
        self.assertFalse(status["configured"])
        self.assertEqual(status["reason"], "sign_in_required")
        self.assertIn("OpenAI (web)", status["error"])

    def test_signed_in_without_a_breadboard_window_is_not_ready(self) -> None:
        with patch.object(web, "bridge_state", return_value={"connected": False, "cdpPort": None}), patch.object(
            web, "system_browser_allowed", return_value=False
        ):
            status = web_voice.status()
        self.assertFalse(status["configured"])
        self.assertEqual(status["reason"], "service_unavailable")

    def test_ready_while_the_shell_relays_the_page(self) -> None:
        with patch.object(web, "bridge_state", return_value={"connected": True, "cdpPort": 9222}):
            self.assertEqual(
                web_voice.status(),
                {"configured": True, "source": "web", "signedIn": True, "reason": "ready", "error": None},
            )


class ReadAloudTests(WebVoiceBase):
    def test_a_verified_repeat_is_read_in_the_chosen_voice(self) -> None:
        page = VoicePage(synthesized=[audio_result()])
        started = self.turns(page, ["Your answer is ready."])
        audio, kind = web_voice.synthesize("Your answer is ready.", "maple")
        self.assertEqual((audio, kind), (ADTS, "audio/aac"))
        self.assertEqual(started[0]["model"], "gpt-5-5-instant")
        # A temporary chat's answer cannot be read (the site calls it deleted).
        self.assertFalse(started[0]["temporary"])
        self.assertTrue(started[0]["prompt"].endswith("\n\nText: Your answer is ready."))
        self.assertIn("Never turn it into a list, table", started[0]["prompt"])
        request = next(expression for expression in page.expressions if "/backend-api/synthesize" in expression)
        for fragment in ('"message_id": "msg-1"', '"conversation_id": "conv-1"', '"voice": "maple"', '"format": "aac"'):
            self.assertIn(fragment, request)
        # Hidden again once the audio is fetched, never before.
        self.assertEqual(len(page.hidden), 1)
        self.assertIn('"conv-1"', page.hidden[0])
        self.assertLess(page.expressions.index(request), page.expressions.index(page.hidden[0]))
        self.assert_page_released()

    def test_a_paraphrase_is_never_read(self) -> None:
        page = VoicePage()
        started = self.turns(page, ["Sure! Here it is: your answer's ready", "Here you go.", "| Your | answer |"])
        with self.assertRaises(web_voice.WebSpeechError) as caught:
            web_voice.synthesize("Your answer is ready.", "cove")
        self.assertEqual(len(started), web_voice.REPEAT_ATTEMPTS)
        self.assertIn("did not repeat", str(caught.exception))
        self.assertFalse(any("/backend-api/synthesize" in expression for expression in page.expressions))
        # Every rejected repeat is stopped, then leaves the history.
        self.assertEqual(len(page.hidden), web_voice.REPEAT_ATTEMPTS)
        self.assertEqual(page.stopped, web_voice.REPEAT_ATTEMPTS)
        self.assert_page_released()

    def test_a_repeat_that_cannot_be_found_stops_without_more_turns(self) -> None:
        page = VoicePage()
        started = self.turns(page, ["Hello.", "Hello.", "Hello."], message_id=None, conversation_id=None)
        with patch.object(web_voice, "ID_WAIT_SECONDS", 0), patch.object(web_voice.time, "sleep"):
            with self.assertRaises(web_voice.WebSpeechError) as caught:
                web_voice.synthesize("Hello.", "maple")
        self.assertIn("did not say which message", str(caught.exception))
        self.assertEqual(len(started), 1, "a chat that cannot be found must not be followed by more blind turns")
        self.assertEqual(page.stopped, 1)
        self.assertEqual(page.hidden, [])
        self.assertFalse(any("/backend-api/synthesize" in expression for expression in page.expressions))
        self.assert_page_released()

    def test_a_page_not_ready_to_send_is_waited_out(self) -> None:
        page = VoicePage(synthesized=[audio_result()])
        calls: List[int] = []

        def begin(model, prompt, effort, images=None, *, temporary=True):
            calls.append(1)
            if len(calls) == 1:
                raise web.ProviderError("ChatGPT did not accept the message (not_ready).", status_code=502)
            return page, "turn"

        def collect(_page, _turn_id, *, on_text, deadline, cancel=None):
            return web.TurnResult(text="Hello.", conversation_id="conv-1", message_id="msg-1")

        with patch.object(web, "_begin_turn", side_effect=begin), patch.object(
            web, "_collect_turn", side_effect=collect
        ), patch.object(web_voice.time, "sleep") as slept:
            audio, _kind = web_voice.synthesize("Hello.", "maple")
        self.assertEqual(audio, ADTS)
        self.assertEqual(len(calls), 2)
        slept.assert_any_call(web_voice.NOT_READY_WAIT_SECONDS)

    def test_a_refused_send_is_never_sent_again(self) -> None:
        calls: List[int] = []

        def begin(model, prompt, effort, images=None, *, temporary=True):
            calls.append(1)
            raise web.ProviderError("ChatGPT did not accept the message (not_accepted).", status_code=502)

        with patch.object(web, "_begin_turn", side_effect=begin), patch.object(web_voice.time, "sleep"):
            with self.assertRaises(web_voice.WebSpeechError):
                web_voice.synthesize("Hello.", "maple")
        self.assertEqual(len(calls), 1)
        self.assert_page_released()

    def test_the_stored_answer_is_judged_once_it_has_finished(self) -> None:
        # The page's reader gave up after two words; the site stored the rest.
        page = VoicePage(
            synthesized=[audio_result()],
            stored=[
                {"status": 200, "text": "Your answer", "finished": False},
                {"status": 200, "text": "Your answer is ready.", "finished": True},
            ],
        )
        started = self.turns(page, ["Your answer"])
        with patch.object(web_voice.time, "sleep"):
            audio, _kind = web_voice.synthesize("Your answer is ready.", "maple")
        self.assertEqual(audio, ADTS)
        self.assertEqual(len(started), 1, "a finished stored answer must not cost a second turn")
        lookups = [expression for expression in page.expressions if "body.mapping" in expression]
        self.assertEqual(len(lookups), 2)
        self.assertIn('"conv-1"', lookups[0])
        self.assertIn('"msg-1"', lookups[0])

    def test_a_stored_paraphrase_is_rejected_even_if_the_stream_looked_right(self) -> None:
        page = VoicePage(stored=[
            {"status": 200, "text": "Sure, your answer is ready!", "finished": True},
            {"status": 200, "text": "Here it is: your answer is ready.", "finished": True},
            {"status": 200, "text": "| Status | Your answer is ready. |", "finished": True},
        ])
        self.turns(page, ["Your answer is ready."] * web_voice.REPEAT_ATTEMPTS)
        with self.assertRaises(web_voice.WebSpeechError):
            web_voice.synthesize("Your answer is ready.", "maple")
        self.assertFalse(any("/backend-api/synthesize" in expression for expression in page.expressions))

    def test_the_reader_never_leaves_the_model_to_the_site(self) -> None:
        def offer(*slugs: str) -> None:
            web._write_state(models=[{"slug": slug, "title": slug, "description": "", "tags": []} for slug in slugs])

        offer("gpt-6-pro", "gpt-5-3-mini", "auto")
        self.assertEqual(web_voice.reader_model(), "gpt-5-3-mini")
        offer("gpt-6-pro", "gpt-5-6-thinking", "auto")
        self.assertEqual(web_voice.reader_model(), web_voice.FALLBACK_READER_MODEL)
        offer()
        self.assertEqual(web_voice.reader_model(), web_voice.FALLBACK_READER_MODEL)
        self.assertNotEqual(web_voice.FALLBACK_READER_MODEL, "auto")

    def test_small_formatting_differences_still_count_as_the_script(self) -> None:
        self.assertTrue(web_voice.faithful("Hello, world - it’s 5 o'clock.", "Hello world, it's 5 o’clock"))
        self.assertFalse(web_voice.faithful("Delete nothing.", "Delete everything."))

    def test_without_stream_ids_the_chat_is_found_in_the_chat_list_not_the_page(self) -> None:
        # The chat list can lag the answer by a moment.
        page = VoicePage(
            synthesized=[audio_result()],
            recent=[{"conversationId": None}, {"conversationId": "conv-listed"}],
            stored=[{"status": 200, "messageId": "msg-listed", "text": "Hello.", "finished": True}],
        )
        self.turns(page, ["stale text from the previous chat"], message_id=None, conversation_id=None)
        with patch.object(web_voice.time, "sleep"):
            web_voice.synthesize("Hello.", "vale")
        request = next(expression for expression in page.expressions if "/backend-api/synthesize" in expression)
        self.assertIn('"message_id": "msg-listed"', request)
        self.assertIn('"conversation_id": "conv-listed"', request)
        search = next(expression for expression in page.expressions if "/backend-api/conversations?" in expression)
        self.assertIn(json.dumps(web_voice.repeat_prompt("")[:80]), search)
        self.assertEqual(len(page.hidden), 1)
        self.assertIn('"conv-listed"', page.hidden[0])
        # The rendered page, which can still show the previous chat, is never asked.
        self.assertFalse(any("data-message-id" in expression or "location.pathname" in expression for expression in page.expressions))

    def test_a_refused_reading_still_hides_its_chat_and_says_why(self) -> None:
        deleted = {"detail": {"message": "Conversation has been deleted. Start a new chat.", "code": "conversation_deleted"}}
        page = VoicePage(synthesized=[{"status": 404, "body": json.dumps(deleted)}])
        started = self.turns(page, ["Hi there."])
        with self.assertRaises(web_voice.WebSpeechError) as caught:
            web_voice.synthesize("Hi there.", "sol")
        self.assertEqual([turn["temporary"] for turn in started], [False])
        self.assertEqual(len(page.hidden), 1)
        self.assertEqual(caught.exception.status, 502)
        self.assertIn("Conversation has been deleted", str(caught.exception))
        self.assert_page_released()

    def test_a_long_repeat_with_different_formatting_is_still_the_script(self) -> None:
        script = (
            "Response ready. The M2 folder contains a total of 25,844 words across 22 pages. "
            "Word Count Breakdown by Note. Section / Note; Word Count. Root Notes. Topic Overview; 1,460."
        )
        repeated = (
            "Response ready. The M2 folder contains a total of 25,844 words across 22 pages.\n\n"
            "**Word Count Breakdown by Note**\n\n| Section / Note | Word Count |\n|---|---|\n"
            "| Root Notes | |\n| Topic Overview | 1,460 |"
        )
        self.assertTrue(web_voice.faithful(script, repeated))

    def test_long_text_is_read_in_passages_and_joined(self) -> None:
        text = "This sentence is part of a long answer that goes on for quite a while. " * 70
        passages = web_voice.split_passages(text)
        self.assertGreater(len(passages), 1)
        self.assertTrue(all(len(passage) <= web_voice.PASSAGE_CHARACTERS for passage in passages))
        self.assertEqual(" ".join(passages), text.strip())
        page = VoicePage(synthesized=[audio_result() for _ in passages])
        self.turns(page, list(passages))
        audio, kind = web_voice.synthesize(text, "ember")
        self.assertEqual(audio, ADTS * len(passages))
        self.assertEqual(kind, "audio/aac")
        self.assertEqual(len(page.hidden), len(passages))

    def test_a_busy_page_refuses_in_plain_words(self) -> None:
        with patch.object(web, "TURN_QUEUE_WAIT_SECONDS", 0.01):
            web._lane().lock.acquire()
            try:
                with self.assertRaises(web_voice.WebSpeechError) as caught:
                    web_voice.synthesize("Hello.", "cove")
            finally:
                web._lane().lock.release()
        self.assertEqual(caught.exception.status, 503)
        self.assertIn("still answering", str(caught.exception))

    def test_a_site_limit_becomes_a_plain_error(self) -> None:
        page = VoicePage(synthesized=[{"status": 429, "body": ""}])
        self.turns(page, ["Hello."])
        with self.assertRaises(web_voice.WebSpeechError) as caught:
            web_voice.synthesize("Hello.", "cove")
        self.assertEqual(caught.exception.status, 429)
        self.assert_page_released()

    def test_bad_input_never_touches_the_page(self) -> None:
        with patch.object(web, "_begin_turn", side_effect=AssertionError("no turn")):
            for text, voice_name in (("", "cove"), ("Hello.", "marin"), ("x" * 50_001, "cove")):
                with self.assertRaises(web_voice.WebSpeechError):
                    web_voice.synthesize(text, voice_name)

    def test_the_finished_turn_names_its_answer_message(self) -> None:
        class EventPage:
            surface = "desktop"

            def __init__(self) -> None:
                self.events: "queue.Queue[Dict[str, Any]]" = queue.Queue()

            def evaluate(self, expression: str, **_: Any) -> Any:
                return {"generating": False, "text": "", "hasAssistant": False} if "snapshot()" in expression else None

        page = EventPage()
        page.events.put({"type": "stream", "mode": "sse", "turn": "t"})
        page.events.put(
            {"type": "done", "turn": "t", "text": "Hello.", "reasoning": "", "conversationId": "conv-9", "messageId": "msg-9"}
        )
        result = web._collect_turn(page, "t", on_text=None, deadline=time.time() + 5)
        self.assertEqual((result.text, result.conversation_id, result.message_id), ("Hello.", "conv-9", "msg-9"))
        self.assertIn("messageId: reducer.assistantId()", web.PAGE_SCRIPT)
        self.assertIn("messageId: entry.reducer.assistantId()", web.PAGE_SCRIPT)

    @unittest.skipUnless(__import__("shutil").which("node"), "node runs the page request")
    def test_the_chosen_voice_is_sent_as_the_sites_own_voice_id(self) -> None:
        # chatgpt.com, measured 2026-09-15: ids are not names ("Sol" is glimmer,
        # "Arbor" is fathom); sending the name answered 404 voice_not_found.
        listed = {
            "selected": "vale",
            "voices": [
                {"voice": "vale", "name": "Vale"},
                {"voice": "glimmer", "name": "Sol"},
                {"voice": "fathom", "name": "Arbor"},
                {"voice": "maple", "name": "Maple"},
            ],
        }
        harness = r"""
const listed = %s;
const asked = [];
globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
globalThis.fetch = async (url) => {
  asked.push(String(url));
  if (url === '/api/auth/session') return { ok: true, json: async () => ({ accessToken: 'test-token' }) };
  if (url === '/backend-api/settings/voices') return { ok: true, json: async () => listed };
  return { ok: true, status: 200, headers: { get: () => 'audio/aac' }, arrayBuffer: async () => new Uint8Array([255, 241]).buffer };
};
(async () => {
  const results = [];
  for (const expression of %s) results.push(await eval(expression));
  console.log(JSON.stringify({ results, asked }));
})();
""" % (
            json.dumps(listed),
            json.dumps([web_voice._synthesize_expression("m", "c", voice) for voice in ("sol", "arbor", "maple", "spruce")]),
        )
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "voices.js")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(harness)
            run = __import__("subprocess").run(["node", path], capture_output=True, text=True, timeout=30)
        self.assertEqual(run.returncode, 0, run.stderr)
        output = json.loads(run.stdout)
        # By name, by id, and a voice the site no longer lists falls back to the account's.
        self.assertEqual([result["voice"] for result in output["results"]], ["glimmer", "fathom", "maple", "vale"])
        synthesized = [url for url in output["asked"] if url.startswith("/backend-api/synthesize?")]
        self.assertIn("voice=glimmer", synthesized[0])
        self.assertIn("voice=vale", synthesized[3])

    def test_only_read_aloud_asks_for_an_ordinary_chat(self) -> None:
        self.assertEqual(web._chat_url("gpt-5-5-instant", None), "https://chatgpt.com/?temporary-chat=true&model=gpt-5-5-instant")
        self.assertEqual(web._chat_url("gpt-5-5-instant", None, temporary=False), "https://chatgpt.com/?model=gpt-5-5-instant")


class DictationTests(WebVoiceBase):
    def test_the_recording_is_posted_and_a_cancelled_upload_is_sent_again(self) -> None:
        page = VoicePage(
            transcribed=[
                {"status": 0, "body": "Failed to fetch"},
                {"status": 200, "body": json.dumps({"text": " Hello from Breadboard. "})},
            ]
        )
        with patch.object(web, "_ensure_page", return_value=page), patch.object(web_voice.time, "sleep"):
            text = web_voice.transcribe(b"RIFF-audio", "audio/wav", "dictation.wav", "en")
        self.assertEqual(text, "Hello from Breadboard.")
        uploads = [expression for expression in page.expressions if "/backend-api/transcribe" in expression]
        self.assertEqual(len(uploads), 2)
        self.assertIn(base64.b64encode(b"RIFF-audio").decode(), uploads[0])
        self.assertIn('"language": "en"', uploads[0])
        self.assertIn('"name": "dictation.wav"', uploads[0])

    def test_refusals_are_explained(self) -> None:
        for site_status, expected in ((401, 409), (429, 429), (500, 502)):
            page = VoicePage(transcribed=[{"status": site_status, "body": ""}])
            with patch.object(web, "_ensure_page", return_value=page):
                with self.assertRaises(web_voice.WebSpeechError) as caught:
                    web_voice.transcribe(b"x", "audio/wav", "a.wav")
            self.assertEqual(caught.exception.status, expected)

    def test_no_page_is_opened_for_an_empty_or_oversized_recording(self) -> None:
        with patch.object(web, "_ensure_page", side_effect=AssertionError("no page")):
            with self.assertRaises(web_voice.WebSpeechError):
                web_voice.transcribe(b"", "audio/wav", "a.wav")
            with patch.object(web_voice, "MAX_RECORDING_BYTES", 3):
                with self.assertRaises(web_voice.WebSpeechError) as caught:
                    web_voice.transcribe(b"abcd", "audio/wav", "a.wav")
            self.assertEqual(caught.exception.status, 413)


class RouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="breadboard-web-voice-")
        self.addCleanup(self.temp.cleanup)
        env = patch.dict(os.environ, {"CODEX_HOME": self.temp.name})
        env.start()
        self.addCleanup(env.stop)
        voice.secret_path().write_text("b" * 64, encoding="utf-8")
        app = Flask(__name__)
        app.register_blueprint(voice.voice_bp)
        self.client = app.test_client()
        self.headers = {"X-Breadboard-Voice-Secret": "b" * 64, "X-Breadboard-Voice-Owner": "1"}

    def test_routes_require_the_bridge_secret(self) -> None:
        for method, path in (
            ("get", "/breadboard/voice/web/status"),
            ("post", "/breadboard/voice/web/synthesize"),
            ("post", "/breadboard/voice/web/transcribe"),
        ):
            self.assertEqual(getattr(self.client, method)(path).status_code, 403)

    def test_status_synthesize_and_transcribe(self) -> None:
        ready = {"configured": True, "source": "web", "signedIn": True, "reason": "ready", "error": None}
        with patch.object(web_voice, "status", return_value=ready):
            self.assertEqual(self.client.get("/breadboard/voice/web/status", headers=self.headers).json, ready)
        with patch.object(web_voice, "synthesize", return_value=(ADTS, "audio/aac")) as synthesize:
            response = self.client.post(
                "/breadboard/voice/web/synthesize", headers=self.headers, json={"text": "Hello.", "voice": "maple"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, ADTS)
        self.assertEqual(response.mimetype, "audio/aac")
        synthesize.assert_called_once_with("Hello.", "maple")
        with patch.object(web_voice, "transcribe", return_value="hello") as transcribe:
            response = self.client.post(
                "/breadboard/voice/web/transcribe",
                headers=self.headers,
                data={"file": (io.BytesIO(b"RIFF"), "dictation.wav", "audio/wav"), "language": "nl"},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.json, {"text": "hello"})
        transcribe.assert_called_once_with(b"RIFF", "audio/wav", "dictation.wav", "nl")

    def test_bad_requests_and_site_errors(self) -> None:
        response = self.client.post(
            "/breadboard/voice/web/synthesize", headers=self.headers, json={"text": "Hi", "voice": "marin"}
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            "/breadboard/voice/web/transcribe",
            headers=self.headers,
            data={"file": (io.BytesIO(b"RIFF"), "a.wav", "audio/wav"), "language": "../x"},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)
        with patch.object(web_voice, "synthesize", side_effect=web_voice.WebSpeechError("limit reached", 429)):
            response = self.client.post(
                "/breadboard/voice/web/synthesize", headers=self.headers, json={"text": "Hi", "voice": "cove"}
            )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json["error"], "limit reached")


if __name__ == "__main__":
    unittest.main()
