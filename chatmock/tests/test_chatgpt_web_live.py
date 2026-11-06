from __future__ import annotations

import os
import tempfile
import unittest
from typing import Any, Dict, List
from unittest.mock import patch

from chatmock.providers import chatgpt_web as web
from chatmock.providers import chatgpt_web_live as live
from chatmock.providers import chatgpt_web_voice as speech

START = {"label": "Start Voice", "x": 400, "y": 600}
END = {"label": "End voice", "x": 420, "y": 610}


class Cdp:
    def __init__(self, page: "LivePage") -> None:
        self.page = page
        self.calls: List[Dict[str, Any]] = []

    def call(self, method: str, params: Dict[str, Any] | None = None, **_: Any) -> Dict[str, Any]:
        self.calls.append({"method": method, **(params or {})})
        # Like the site: pressing an end control puts the composer back.
        if (params or {}).get("type") == "mousePressed":
            at = ((params or {}).get("x"), (params or {}).get("y"))
            if any(at == (b["x"], b["y"]) and b["label"] in ("End voice", "Cancel loading") for b in self.page.buttons[0]):
                self.page.buttons = [[START]]
        return {}


class LivePage:
    """The driven page: its voice buttons and the stored conversation."""

    surface = "desktop"

    def __init__(self, buttons: List[List[Dict[str, Any]]], stored: List[List[Dict[str, Any]]], path: str = "/c/conv-1") -> None:
        self.buttons = buttons
        self.stored = stored
        self.path = path
        self.mic_blocked = False
        self.level: float | None = None
        self.cdp = Cdp(self)
        self.hidden: List[str] = []
        self.silenced = 0

    def evaluate(self, expression: str, **_: Any) -> Any:
        if "window.RTCPeerConnection = Tracked" in expression:
            return True
        if "track.enabled = false" in expression:
            self.silenced += 1
            return True
        if "location.pathname" in expression:
            shown = self.buttons.pop(0) if len(self.buttons) > 1 else self.buttons[0]
            return {"path": self.path, "buttons": shown, "micBlocked": self.mic_blocked, "level": self.level}
        if "is_visible" in expression:
            self.hidden.append(expression)
            return 0
        if "body.mapping" in expression:
            rows = self.stored.pop(0) if len(self.stored) > 1 else self.stored[0]
            return {"status": 200, "messages": rows}
        raise AssertionError(f"unexpected page request: {expression[:80]}")

    def clicks(self) -> List[tuple[float, float]]:
        return [(call["x"], call["y"]) for call in self.cdp.calls if call.get("type") == "mousePressed"]


def row(message_id: str, role: str, text: str, status: str = "finished_successfully") -> Dict[str, Any]:
    return {
        "id": message_id,
        "role": role,
        "status": status,
        "content": {"content_type": "multimodal_text", "parts": [{"content_type": "audio_transcription", "text": text}]},
    }


CONTEXT_ROWS = [row("ctx-user", "user", "context"), row("ctx-ready", "assistant", "Ready.")]


class LiveVoiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(os.environ, {"CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json")})
        env.start()
        self.addCleanup(env.stop)
        web.reset_for_tests()
        self.addCleanup(web.reset_for_tests)
        live.reset_for_tests()
        self.addCleanup(live.reset_for_tests)
        self.microphone: List[bool] = []
        for patcher in (
            patch.object(web, "set_microphone", side_effect=lambda enabled, lane=web.INTERACTIVE_LANE: self.microphone.append(enabled)),
            patch.object(live.time, "sleep"),
            patch.object(live.threading, "Thread"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def open_chat(self, page: LivePage, conversation_id: str | None = "conv-1") -> List[str]:
        prompts: List[str] = []

        def opened(context: str):
            prompts.append(context)
            return page, conversation_id

        patcher = patch.object(live, "_open_chat", side_effect=opened)
        patcher.start()
        self.addCleanup(patcher.stop)
        return prompts

    def assert_page_released(self) -> None:
        self.assertTrue(web._lane().lock.acquire(blocking=False), "the page lock was left held")
        web._lane().lock.release()

    def test_poll_says_when_chatgpt_speaks_and_the_ring_mutes_by_the_site_button(self) -> None:
        mute = {"label": "Turn off microphone", "x": 380, "y": 610}
        unmute = {"label": "Turn on microphone", "x": 380, "y": 610}
        page = LivePage(buttons=[[START], [START], [mute, END]], stored=[CONTEXT_ROWS])
        self.open_chat(page)
        started = live.start("", "7")
        page.level = 0.2
        heard = live.poll(started["id"], "7")
        self.assertEqual((heard["speaking"], heard["muted"]), (True, False))
        page.level = 0.001
        self.assertFalse(live.poll(started["id"], "7")["speaking"])
        # The ring does not wait for a poll that is reading the page.
        session = live._owned(started["id"], "7")
        with session.lock:
            self.assertEqual(live.listen(started["id"], "7", False), {"muted": True})
        self.assertEqual(page.clicks()[-1], (380.0, 610.0))
        page.buttons = [[unmute, END]]
        self.assertTrue(live.poll(started["id"], "7")["muted"])

    def test_a_conversation_is_copied_as_it_happens_and_handed_back_on_stop(self) -> None:
        page = LivePage(
            buttons=[[START], [START], [END]],
            stored=[
                CONTEXT_ROWS,
                CONTEXT_ROWS + [row("u1", "user", "What's the weather?"), row("a1", "assistant", "Sunny", status="in_progress")],
                CONTEXT_ROWS + [row("u1", "user", "What's the weather?"), row("a1", "assistant", "Sunny and mild.")],
                CONTEXT_ROWS + [row("u1", "user", "What's the weather?"), row("a1", "assistant", "Sunny and mild."),
                                row("u2", "user", "Thanks"), row("a2", "assistant", "You're", status="in_progress")],
            ],
        )
        prompts = self.open_chat(page)
        started = live.start("User: plan my day", "7")
        self.assertEqual(started["conversationId"], "conv-1")
        self.assertEqual(prompts, ["User: plan my day"])
        self.assertEqual(self.microphone, [True])
        # A real mouse click on Start Voice: the site needs a gesture for audio.
        self.assertEqual(page.clicks(), [(400.0, 600.0)])
        self.assertEqual(web._lane().holder["label"], "a ChatGPT voice conversation")

        first = live.poll(started["id"], "7")
        self.assertTrue(first["active"])
        # The context exchange is not copied back, and an answer still being
        # spoken waits until it is finished.
        self.assertEqual(first["messages"], [{"id": "u1", "role": "user", "text": "What's the weather?"}])
        second = live.poll(started["id"], "7")
        self.assertEqual(second["messages"], [{"id": "a1", "role": "assistant", "text": "Sunny and mild."}])

        with self.assertRaises(speech.WebSpeechError):
            live.poll(started["id"], "8")

        ended = live.stop(started["id"], "7")
        self.assertEqual(page.silenced, 1)
        self.assertEqual(
            ended["messages"],
            [{"id": "u2", "role": "user", "text": "Thanks"}, {"id": "a2", "role": "assistant", "text": "You're"}],
        )
        self.assertEqual(page.clicks()[-1], (420.0, 610.0))
        self.assertEqual(self.microphone, [True, False])
        self.assertEqual(len(page.hidden), 1)
        self.assertIn('"conv-1"', page.hidden[0])
        self.assert_page_released()
        with self.assertRaises(speech.WebSpeechError) as gone:
            live.poll(started["id"], "7")
        self.assertEqual(gone.exception.status, 404)

    def test_without_context_the_chat_is_the_one_the_page_now_shows(self) -> None:
        page = LivePage(buttons=[[START], [END]], stored=[[row("u1", "user", "Hello")]], path="/c/6ac60436-ce5c-83ed-beac-d10e3f92080c")
        self.open_chat(page, conversation_id=None)
        started = live.start("", "7")
        polled = live.poll(started["id"], "7")
        self.assertEqual(polled["messages"], [{"id": "u1", "role": "user", "text": "Hello"}])
        live.stop(started["id"], "7")
        self.assertIn('"6ac60436-ce5c-83ed-beac-d10e3f92080c"', page.hidden[0])

    def test_a_voice_that_moves_to_its_own_chat_is_followed_and_both_chats_hidden(self) -> None:
        page = LivePage(buttons=[[START], [END]], stored=[CONTEXT_ROWS, [row("u1", "user", "Hello")]],
                        path="/c/6ac60436-ce5c-83ed-beac-d10e3f92080c")
        self.open_chat(page, conversation_id="6ac60000-0000-83ed-beac-d10e3f920000")
        started = live.start("User: hi", "7")
        self.assertEqual(live.poll(started["id"], "7")["messages"], [{"id": "u1", "role": "user", "text": "Hello"}])
        live.stop(started["id"], "7")
        hidden = "".join(page.hidden)
        self.assertIn('"6ac60436-ce5c-83ed-beac-d10e3f92080c"', hidden)
        self.assertIn('"6ac60000-0000-83ed-beac-d10e3f920000"', hidden)

    def test_a_page_that_cannot_be_read_does_not_hang_up_until_it_keeps_failing(self) -> None:
        page = LivePage(buttons=[[START], [END]], stored=[CONTEXT_ROWS])
        self.open_chat(page)
        started = live.start("User: hi", "7")
        session = live._current
        with patch.object(live, "_state", side_effect=speech.WebSpeechError("slow", 503)):
            session.polled_at = 0
            for _ in range(live.POLL_FAILURES - 1):
                self.assertEqual(live.poll(started["id"], "7"), {"active": True, "messages": []})
            # The watchdog counts from the end of the slow poll, not its start.
            self.assertGreater(session.polled_at, 0)
            self.assertFalse(live.poll(started["id"], "7")["active"])
        live.stop(started["id"], "7")

    def test_a_voice_that_switches_itself_off_is_started_again_not_ended(self) -> None:
        page = LivePage(buttons=[[START], [END], [START], [START], [END]], stored=[CONTEXT_ROWS])
        self.open_chat(page)
        started = live.start("User: hi", "7")
        self.assertEqual(len(page.clicks()), 1)
        # The site dropped its voice: the poll still reports a live call, and
        # Start Voice is pressed again in the same chat.
        self.assertTrue(live.poll(started["id"], "7")["active"])
        self.assertEqual(page.clicks(), [(400.0, 600.0), (400.0, 600.0)])
        self.assertEqual(self.microphone, [True])
        live.stop(started["id"], "7")

    def test_a_closed_screen_is_noticed_by_its_dropped_presence(self) -> None:
        page = LivePage(buttons=[[START], [END]], stored=[CONTEXT_ROWS])
        self.open_chat(page)
        started = live.start("User: hi", "7")
        session = live._current
        # A screen that never opened a presence is left to the idle backstop.
        self.assertIsNone(live._closed_reason(session))
        first = live.presence(started["id"], "7")
        self.assertEqual(next(first), b"\n")
        # The screen opens its next presence before the last one ends.
        second = live.presence(started["id"], "7")
        next(second)
        first.close()
        self.assertEqual(session.present, 1)
        self.assertIsNone(live._closed_reason(session))
        # The tab closes: the connection drops, and after the grace it is over.
        second.close()
        self.assertIsNone(live._closed_reason(session))
        session.absent_since -= live.PRESENCE_GRACE_SECONDS
        self.assertIn("the screen was closed", live._closed_reason(session))
        live.stop(started["id"], "7")

    def test_voice_that_never_starts_gives_everything_back(self) -> None:
        page = LivePage(buttons=[[START]], stored=[CONTEXT_ROWS])
        self.open_chat(page)
        with patch.object(live, "VOICE_START_SECONDS", 0.01):
            with self.assertRaises(speech.WebSpeechError) as caught:
                live.start("User: hi", "7")
        self.assertIn("voice did not start", str(caught.exception))
        self.assertEqual(self.microphone, [True, False])
        self.assert_page_released()

    def test_a_page_refused_the_microphone_says_so(self) -> None:
        page = LivePage(buttons=[[START], [{"label": "Cancel loading", "x": 900, "y": 600}]], stored=[CONTEXT_ROWS])
        page.mic_blocked = True
        self.open_chat(page)
        with self.assertRaises(speech.WebSpeechError) as caught:
            live.start("User: hi", "7")
        self.assertIn("not allowed to use the microphone", str(caught.exception))
        # Its own "Cancel loading" closes the half-open voice.
        self.assertEqual(page.clicks()[-1], (900.0, 600.0))
        self.assertEqual(self.microphone, [True, False])
        self.assert_page_released()

    def test_a_busy_page_is_refused_with_its_holder(self) -> None:
        web._lane().lock.acquire()
        web._hold(web.INTERACTIVE_LANE, "a read-aloud request")
        try:
            with patch.object(web, "TURN_QUEUE_WAIT_SECONDS", 0.01):
                with self.assertRaises(speech.WebSpeechError) as caught:
                    live.start("", "7")
        finally:
            web._lane().holder = None
            web._lane().lock.release()
        self.assertEqual(caught.exception.status, 503)
        self.assertIn("a read-aloud request", str(caught.exception))
        self.assertEqual(self.microphone, [])

    def test_the_context_prompt_keeps_the_latest_part_of_a_long_chat(self) -> None:
        prompt = live.context_prompt("old " * 10_000 + "the latest question")
        self.assertTrue(prompt.endswith("the latest question"))
        self.assertLess(len(prompt), live.MAX_CONTEXT_CHARACTERS + 400)

    def test_message_text_reads_transcriptions_and_plain_parts(self) -> None:
        self.assertEqual(
            live.message_text({"parts": ["Hi.", {"content_type": "audio_transcription", "text": "There"}, {"content_type": "audio_asset_pointer"}]}),
            "Hi.\nThere",
        )
        self.assertEqual(live.message_text(None), "")


if __name__ == "__main__":
    unittest.main()
