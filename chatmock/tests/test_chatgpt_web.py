from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from typing import Any, Dict, List
from unittest.mock import patch

os.environ.setdefault("CHATMOCK_MODEL_DISCOVERY", "0")

from chatmock.app import create_app
from chatmock.providers import chatgpt_web, store
from chatmock.providers.catalog import provider_spec
from chatmock.providers.registry import external_model_ids, model_entries, resolve_model
from chatmock.providers.store import ResolvedCredentials
from chatmock.providers.types import ModelCall, ProviderError


class IsolatedHome(unittest.TestCase):
    """Every test writes its sign-in state beside an isolated providers.json."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(self.tmp.name, "model-routing.jsonl"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        chatgpt_web.reset_for_tests()
        self.addCleanup(chatgpt_web.reset_for_tests)

    def sign_out(self) -> None:
        """A freshly verified signed-out page: the only state that refuses."""
        from datetime import datetime, timezone

        chatgpt_web._write_state(
            signedIn=False,
            email=None,
            checkedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            models=[],
        )

    def sign_in(self, models: List[str] | None = None) -> None:
        chatgpt_web._write_state(
            signedIn=True,
            email="person@example.com",
            checkedAt="2026-09-14T00:00:00Z",
            models=[{"slug": slug, "title": slug, "description": "", "tags": []} for slug in (models or [])],
        )


class CatalogTests(IsolatedHome):
    def test_provider_is_registered_as_a_signed_in_browser_kind(self) -> None:
        spec = provider_spec("openaiweb")
        assert spec is not None
        self.assertEqual(spec.kind, "chatgpt_web")
        self.assertEqual(spec.label, "OpenAI (web)")
        self.assertFalse(spec.requires_api_key)

    def test_state_lives_beside_the_provider_store(self) -> None:
        self.assertEqual(os.path.dirname(chatgpt_web.state_path()), self.tmp.name)
        self.assertEqual(os.path.dirname(chatgpt_web.profile_dir()), self.tmp.name)

    def test_signed_out_is_not_configured_and_says_why(self) -> None:
        spec = provider_spec("openaiweb")
        self.sign_out()
        credentials = store.resolve_credentials(spec)
        self.assertFalse(credentials.usable)
        self.assertIn("not signed in", credentials.reason or "")
        self.assertNotIn("openaiweb/auto", external_model_ids())

    def test_an_unverified_state_never_refuses_a_turn(self) -> None:
        # 2026-09-17: a state file that had never been probed (checkedAt null)
        # refused every request for hours while the same page answered chats.
        # Nothing was verified, so nothing may be refused: the turn's own live
        # probe decides and records the verdict.
        spec = provider_spec("openaiweb")
        self.assertIsNone(chatgpt_web.unavailable_reason())
        self.assertTrue(store.resolve_credentials(spec).usable)
        self.sign_out()
        self.assertIsNotNone(chatgpt_web.unavailable_reason())
        # A stale signed-out verdict is re-checked rather than trusted forever.
        chatgpt_web._write_state(checkedAt="2026-09-01T00:00:00Z")
        self.assertIsNone(chatgpt_web.unavailable_reason())

    def test_signed_in_models_are_listed_with_the_provider_prefix(self) -> None:
        self.sign_in(["auto", "gpt-5-2-thinking"])
        ids = external_model_ids()
        self.assertIn("openaiweb/auto", ids)
        self.assertIn("openaiweb/gpt-5-2-thinking", ids)
        rows = {row["id"]: row for row in model_entries([])}
        self.assertEqual(rows["openaiweb/gpt-5-2-thinking"]["owned_by"], "openaiweb")
        self.assertEqual(rows["openaiweb/gpt-5-2-thinking"]["reasoning_efforts"], ["low", "medium", "high"])

    def test_model_ids_resolve_to_the_web_provider(self) -> None:
        resolved = resolve_model("openaiweb/gpt-5-2")
        self.assertEqual(resolved.provider.id, "openaiweb")
        self.assertEqual(resolved.upstream_model, "gpt-5-2")
        self.assertFalse(resolved.is_chatgpt)

    def test_hidden_legacy_slugs_are_dropped(self) -> None:
        shaped = chatgpt_web._shape_models(
            [
                {"slug": "auto", "title": "Auto"},
                {"slug": "text-davinci-002-render-sha", "title": "Legacy"},
                {"slug": "auto"},
                {"nope": True},
            ]
        )
        self.assertEqual([row["slug"] for row in shaped], ["auto"])


class PromptTests(unittest.TestCase):
    def test_single_user_message_is_verbatim(self) -> None:
        self.assertEqual(chatgpt_web.compose_prompt([{"role": "user", "content": "Hello there"}]), "Hello there")

    def test_transcript_is_framed_with_instructions_and_history(self) -> None:
        prompt = chatgpt_web.compose_prompt(
            [
                {"role": "system", "content": "Answer in French."},
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": None, "tool_calls": [{"function": {"name": "lookup", "arguments": "{\"q\":1}"}}]},
                {"role": "tool", "name": "lookup", "content": "42"},
                {"role": "user", "content": [{"type": "text", "text": "And now?"}]},
            ]
        )
        self.assertTrue(prompt.startswith("<instructions>\nAnswer in French.\n</instructions>"))
        self.assertIn("User: Hi", prompt)
        self.assertIn("[called tool lookup with {\"q\":1}]", prompt)
        self.assertIn("Tool result (lookup): 42", prompt)
        self.assertIn("User: And now?", prompt)
        self.assertTrue(prompt.rstrip().endswith("no commentary about this framing."))

    def test_chat_url_carries_model_and_only_known_efforts(self) -> None:
        self.assertEqual(
            chatgpt_web._chat_url("gpt-5-2", "high"),
            "https://chatgpt.com/?temporary-chat=true&model=gpt-5-2&reasoning_effort=high",
        )
        self.assertEqual(chatgpt_web._chat_url("a/b", "bogus"), "https://chatgpt.com/?temporary-chat=true&model=a%2Fb")

    def test_site_refusals_keep_their_status(self) -> None:
        error = chatgpt_web._site_error(429, json.dumps({"detail": {"message": "Too many requests"}}))
        self.assertEqual(error.status_code, 429)
        self.assertIn("usage limit", str(error))
        self.assertIn("Too many requests", str(error))
        self.assertTrue(error.replay_safe)


class BridgeTests(IsolatedHome):
    def test_no_agent_means_no_bridge(self) -> None:
        self.assertEqual(chatgpt_web.bridge_state(), {"connected": False, "cdpPort": None})

    def test_polling_is_the_heartbeat_and_answers_are_matched_by_nonce(self) -> None:
        self.assertEqual(chatgpt_web.pending_tab_requests(), [])
        self.assertTrue(chatgpt_web.bridge_state()["connected"])

        outcome: List[Any] = []

        def ask() -> None:
            try:
                outcome.append(chatgpt_web._bridge_open_tab({}, foreground=True))
            except ProviderError as exc:
                outcome.append(exc)

        import threading

        asker = threading.Thread(target=ask)
        asker.start()
        pending = chatgpt_web.pending_tab_requests(wait=5)
        self.assertEqual(len(pending), 1)
        self.assertTrue(pending[0]["foreground"])
        self.assertFalse(chatgpt_web.answer_tab_request("unknown", {"cdpPort": 1, "targetId": "x"}))
        self.assertTrue(chatgpt_web.answer_tab_request(pending[0]["nonce"], {"cdpPort": 45678, "targetId": "ABC"}))
        asker.join(5)
        self.assertEqual(outcome, [(45678, "ABC")])
        self.assertEqual(chatgpt_web.bridge_state()["cdpPort"], 45678)
        self.assertEqual(chatgpt_web.pending_tab_requests(), [])

    def test_a_refusal_from_the_shell_is_reported(self) -> None:
        import threading

        outcome: List[Any] = []

        def ask() -> None:
            try:
                chatgpt_web._bridge_open_tab({}, foreground=False)
            except ProviderError as exc:
                outcome.append(str(exc))

        asker = threading.Thread(target=ask)
        asker.start()
        pending = chatgpt_web.pending_tab_requests(wait=5)
        chatgpt_web.answer_tab_request(pending[0]["nonce"], {"error": "browser navigation is off"})
        asker.join(5)
        self.assertEqual(len(outcome), 1)
        self.assertIn("browser navigation is off", outcome[0])

    def test_an_unanswered_request_times_out(self) -> None:
        with patch.object(chatgpt_web, "TAB_REQUEST_TIMEOUT_SECONDS", 0.2):
            with self.assertRaises(ProviderError) as raised:
                chatgpt_web._bridge_open_tab({}, foreground=False)
        self.assertIn("did not answer", str(raised.exception))
        self.assertEqual(chatgpt_web.pending_tab_requests(), [])

    def test_stale_agent_is_forgotten(self) -> None:
        chatgpt_web.note_agent_seen(5000)
        with patch.object(chatgpt_web, "time") as clock:
            clock.time.return_value = 10**12
            self.assertFalse(chatgpt_web.bridge_state()["connected"])


class AttachStub:
    """A page that stands in for a driven one while it is being attached to."""

    unresponsive_targets: set = set()

    def __init__(self, ws_url: str, surface: str) -> None:
        self.ws_url = ws_url
        self.surface = surface
        self.closed = False
        self.installed = False

    def install(self) -> None:
        if any(self.ws_url.endswith(target) for target in AttachStub.unresponsive_targets):
            raise chatgpt_web._PageUnresponsive(
                "the browser did not answer Page.enable in time", phase="receive"
            )
        self.installed = True

    def current_url(self) -> str:
        return "https://chatgpt.com/"

    def ensure_script(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True


class AttachTests(IsolatedHome):
    """A page that stops answering DevTools is replaced, not waited on."""

    def attach(self, *, unresponsive: set) -> tuple[Any, List[bool], List[AttachStub]]:
        AttachStub.unresponsive_targets = unresponsive
        asked: List[bool] = []
        pages: List[AttachStub] = []

        def open_tab(bridge: Any, *, foreground: bool, reset: bool = False, lane: str = "interactive") -> tuple[int, str]:
            asked.append(reset)
            return 9333, "FRESH" if reset else "STALE"

        def make(ws_url: str, surface: str) -> AttachStub:
            page = AttachStub(ws_url, surface)
            pages.append(page)
            return page

        with patch.object(chatgpt_web, "_live_bridge", return_value={"cdpPort": 9333}), patch.object(
            chatgpt_web, "_bridge_open_tab", side_effect=open_tab
        ), patch.object(
            chatgpt_web,
            "_page_websocket",
            side_effect=lambda port, target_id=None: f"ws://127.0.0.1:{port}/devtools/page/{target_id}",
        ), patch.object(chatgpt_web, "_Page", make):
            try:
                return chatgpt_web._ensure_page(), asked, pages
            except ProviderError as exc:
                return exc, asked, pages

    def test_a_page_that_never_answers_is_asked_for_again_fresh(self) -> None:
        page, asked, pages = self.attach(unresponsive={"STALE"})
        self.assertIsInstance(page, AttachStub)
        self.assertEqual(asked, [False, True])
        self.assertTrue(pages[0].closed)
        self.assertTrue(pages[1].installed)
        self.assertIs(chatgpt_web._lane().page, page)

    def test_a_fresh_page_that_answers_nothing_either_is_reported_plainly(self) -> None:
        outcome, asked, pages = self.attach(unresponsive={"STALE", "FRESH"})
        self.assertIsInstance(outcome, ProviderError)
        self.assertIn("stopped responding", str(outcome))
        self.assertNotIn("Page.enable", str(outcome))
        self.assertEqual(asked, [False, True])
        self.assertTrue(all(page.closed for page in pages))
        self.assertIsNone(chatgpt_web._lane().page)

    def unusable_page(self, *, socket_closed: bool) -> Any:
        import threading

        class Unusable:
            surface = "desktop"

            def __init__(self) -> None:
                closed = threading.Event()
                if socket_closed:
                    closed.set()
                self.cdp = type("cdp", (), {"closed": closed})()

            def alive(self) -> bool:
                return False

            def close(self) -> None:
                pass

        return Unusable()

    def test_a_wedged_live_page_goes_straight_for_a_replacement(self) -> None:
        chatgpt_web._lane().page = self.unusable_page(socket_closed=False)
        page, asked, _pages = self.attach(unresponsive=set())
        self.assertIsInstance(page, AttachStub)
        self.assertEqual(asked, [True])

    def test_a_page_whose_socket_died_under_us_is_replaced_too(self) -> None:
        # A crashed renderer takes its target, and its socket, with it. Trying
        # the same page first only spends the attach budget twice over before
        # asking for the replacement that was always the answer.
        chatgpt_web._lane().page = self.unusable_page(socket_closed=True)
        page, asked, _pages = self.attach(unresponsive=set())
        self.assertIsInstance(page, AttachStub)
        self.assertEqual(asked, [True])


class FakePage:
    """Stands in for a driven page: replays scripted events for a turn."""

    def __init__(self, events: List[Dict[str, Any]], snapshots: List[Dict[str, Any]] | None = None) -> None:
        import queue

        self.events: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self._scripted = events
        self._snapshots = list(snapshots or [])
        self.surface = "desktop"
        self.evaluated: List[str] = []

    def start(self, turn_id: str) -> None:
        for event in self._scripted:
            self.events.put({**event, "turn": turn_id})

    def evaluate(self, expression: str, **_: Any) -> Any:
        self.evaluated.append(expression)
        if "snapshot()" in expression:
            if len(self._snapshots) > 1:
                return self._snapshots.pop(0)
            return self._snapshots[0] if self._snapshots else {"generating": False, "text": "", "hasAssistant": False}
        return None


class StubCdp:
    """A DevTools socket that misses the deadlines a test asks it to."""

    def __init__(self, misses: int, value: Any = 1) -> None:
        self.misses = misses
        self.value = value
        self.calls = 0
        self.closed = __import__("threading").Event()

    def call(self, method: str, params: Dict[str, Any] | None = None, *, timeout: float = 30) -> Dict[str, Any]:
        self.calls += 1
        if self.calls <= self.misses:
            raise chatgpt_web._PageUnresponsive(
                f"the browser did not answer {method} in time", phase="receive"
            )
        return {"result": {"value": self.value}}

    def close(self) -> None:
        self.closed.set()


class EvaluateTests(IsolatedHome):
    """A page rendering a long answer is busy, not dead."""

    def page(self, misses: int) -> tuple[Any, StubCdp]:
        cdp = StubCdp(misses)
        with patch.object(chatgpt_web, "_Cdp", return_value=cdp):
            return chatgpt_web._Page("ws://page", "desktop"), cdp

    def test_a_missed_deadline_is_re_asked(self) -> None:
        page, cdp = self.page(misses=2)
        self.assertEqual(page.evaluate("1", attempts=3), 1)
        self.assertEqual(cdp.calls, 3)

    def test_a_read_that_never_answers_still_fails(self) -> None:
        page, cdp = self.page(misses=5)
        with self.assertRaises(chatgpt_web._PageUnresponsive):
            page.evaluate("1", attempts=3)
        self.assertEqual(cdp.calls, 3)

    def test_sending_is_never_repeated(self) -> None:
        page, cdp = self.page(misses=1)
        with self.assertRaises(chatgpt_web._PageUnresponsive):
            page.evaluate("window.__breadboardChatgptWeb.send(1000)")
        self.assertEqual(cdp.calls, 1)

    def test_a_slow_page_is_not_called_dead(self) -> None:
        page, _cdp = self.page(misses=1)
        self.assertTrue(page.alive())


class ImageTests(unittest.TestCase):
    """Images reach the site as pasted files, or the request is refused."""

    PNG = "data:image/png;base64,iVBORw0KGgo="

    def test_image_parts_become_data_urls_and_the_text_points_at_them(self) -> None:
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": "Judge this render."},
                {"type": "image_url", "image_url": {"url": self.PNG, "detail": "low"}},
                {"type": "input_image", "image_url": self.PNG},
            ]},
        ]
        self.assertEqual(chatgpt_web._image_data_urls(messages), [self.PNG, self.PNG])
        self.assertIn("[see the attached image]", chatgpt_web.compose_prompt(messages))
        self.assertNotIn("not available", chatgpt_web.compose_prompt(messages))

    def test_too_many_images_are_refused_not_trimmed(self) -> None:
        parts = [{"type": "image_url", "image_url": {"url": self.PNG}}] * (chatgpt_web.MAX_IMAGE_ATTACHMENTS + 1)
        with self.assertRaises(ProviderError) as raised:
            chatgpt_web._image_data_urls([{"role": "user", "content": parts}])
        self.assertEqual(raised.exception.status_code, 400)

    def test_a_missing_upload_fails_the_turn_rather_than_sending_blind(self) -> None:
        class Page:
            surface = "desktop"

            def __init__(self, held: int) -> None:
                self.held = held
                self.evaluated: List[str] = []

            def evaluate(self, expression: str, **_: Any) -> Any:
                self.evaluated.append(expression)
                if ".attach(" in expression:
                    return "ok"
                if ".attachments()" in expression:
                    return self.held
                return None

        with patch.object(chatgpt_web, "IMAGE_ATTACH_TIMEOUT_SECONDS", 0.6):
            ready = Page(held=2)
            chatgpt_web._attach_images(ready, [self.PNG, self.PNG])  # type: ignore[arg-type]
            self.assertTrue(any(".attach(" in e for e in ready.evaluated))
            short = Page(held=1)
            with self.assertRaises(ProviderError) as raised:
                chatgpt_web._attach_images(short, [self.PNG, self.PNG])  # type: ignore[arg-type]
        self.assertIn("1 of 2", str(raised.exception))

    def test_a_paste_the_editor_ignores_is_an_error(self) -> None:
        class Page:
            surface = "desktop"

            def evaluate(self, expression: str, **_: Any) -> Any:
                return "paste_ignored:0" if ".attach(" in expression else 0

        with self.assertRaises(ProviderError) as raised:
            chatgpt_web._attach_images(Page(), [self.PNG])  # type: ignore[arg-type]
        self.assertIn("paste_ignored", str(raised.exception))


class TurnTests(IsolatedHome):
    def run_request(self, page: FakePage, *, stream: bool, payload: Dict[str, Any] | None = None):
        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            page.start("turn-1")
            return page, "turn-1"

        with patch.object(chatgpt_web, "_begin_turn", side_effect=begin):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            body = payload or {"messages": [{"role": "user", "content": "hi"}]}
            return chatgpt_web.request_chat(credentials, body, "gpt-5-2", stream=stream)

    def test_non_streaming_answer_comes_from_the_event_stream(self) -> None:
        page = FakePage(
            [
                {"type": "stream", "mode": "sse", "model": "gpt-5-2"},
                {"type": "text", "append": "Hello"},
                {"type": "text", "append": " world"},
                {"type": "done", "text": "Hello world", "reasoning": "thought", "conversationId": "c1", "model": "gpt-5-2"},
            ]
        )
        response = self.run_request(page, stream=False)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["choices"][0]["message"]["content"], "Hello world")
        self.assertEqual(body["choices"][0]["message"]["reasoning"], "thought")
        self.assertEqual(body["model"], "openaiweb/gpt-5-2")
        self.assertGreater(body["usage"]["completion_tokens"], 0)
        self.assertFalse(chatgpt_web._lane().lock.locked())

    def test_streaming_answer_relays_deltas_and_releases_the_lock(self) -> None:
        page = FakePage(
            [
                {"type": "stream", "mode": "sse"},
                {"type": "text", "append": "Hel"},
                {"type": "text", "append": "lo"},
                {"type": "done", "text": "Hello", "reasoning": ""},
            ]
        )
        response = self.run_request(page, stream=True, payload={"messages": [{"role": "user", "content": "hi"}], "stream": True, "stream_options": {"include_usage": True}})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(chatgpt_web._lane().lock.locked())
        frames = list(chatgpt_web.relay_stream(response))
        self.assertFalse(chatgpt_web._lane().lock.locked())
        payloads = [json.loads(f.decode()[6:]) for f in frames if f.startswith(b"data: {")]
        deltas = "".join(p["choices"][0]["delta"].get("content", "") for p in payloads)
        self.assertEqual(deltas, "Hello")
        self.assertEqual(payloads[-1]["choices"][0]["finish_reason"], "stop")
        self.assertIn("usage", payloads[-1])
        self.assertEqual(frames[-1], b"data: [DONE]\n\n")

    def test_the_sites_citation_markup_never_reaches_the_client(self) -> None:
        # Seen live 2026-09-14 on an answer about an attached image:
        # "...below the circle. \ue200filecite\ue202turn0file0\ue202L525-L530\ue201".
        # The marker arrives split across deltas; the cleaned stream must
        # still be a pure append, or the client is handed a rewrite.
        page = FakePage(
            [
                {"type": "stream", "mode": "sse"},
                {"type": "text", "append": "A blue circle"},
                {"type": "text", "append": " sits left. \ue200filecite\ue202turn0"},
                {"type": "text", "append": "file0\ue202L5-L9\ue201 Done."},
                {"type": "done", "text": "A blue circle sits left. \ue200filecite\ue202turn0file0\ue202L5-L9\ue201 Done.", "reasoning": ""},
            ]
        )
        response = self.run_request(page, stream=True, payload={"messages": [{"role": "user", "content": "hi"}], "stream": True})
        frames = list(chatgpt_web.relay_stream(response))
        payloads = [json.loads(f.decode()[6:]) for f in frames if f.startswith(b"data: {")]
        deltas = [p["choices"][0]["delta"].get("content", "") for p in payloads]
        text = "".join(deltas)
        self.assertEqual(text, "A blue circle sits left.  Done.")
        self.assertFalse(any(d.startswith("\n") for d in deltas), "a held-back marker must not force a rewrite")
        self.assertEqual(chatgpt_web._clean_text("plain text"), "plain text")

    def test_a_refusal_whose_body_the_site_already_read_is_fetched_from_the_network_log(self) -> None:
        # Live 2026-09-14: the page script reported status 400 with an empty
        # body, while the network layer's copy said "Your input image may
        # contain content that is not allowed by our safety system."
        page = FakePage([{"type": "error", "status": 400, "body": ""}])
        page.failed_responses = [("req-1", 400)]
        page.cdp = type("cdp", (), {"call": staticmethod(lambda method, params=None, timeout=5: {
            "body": json.dumps({"detail": "Your input image may contain content that is not allowed by our safety system."}),
            "base64Encoded": False,
        } if method == "Network.getResponseBody" and (params or {}).get("requestId") == "req-1" else {})})()
        page.refusal_body = lambda status, timeout=3.0: chatgpt_web._Page.refusal_body(page, status, timeout=timeout)  # type: ignore[assignment]
        response = self.run_request(page, stream=False)
        self.assertEqual(response.status_code, 400)
        self.assertIn("safety system", response.json()["error"]["message"])

    def test_site_refusal_before_the_answer_is_a_status(self) -> None:
        page = FakePage([{"type": "error", "status": 429, "body": json.dumps({"detail": "usage cap"})}])
        response = self.run_request(page, stream=False)
        self.assertEqual(response.status_code, 429)
        self.assertIn("usage limit", response.json()["error"]["message"])
        self.assertFalse(chatgpt_web._lane().lock.locked())

    def test_rendered_page_carries_the_turn_when_no_stream_is_heard(self) -> None:
        page = FakePage(
            [],
            snapshots=[
                {"generating": True, "text": "Partial", "hasAssistant": True},
                {"generating": False, "text": "Partial answer", "hasAssistant": True},
            ],
        )
        with patch.object(chatgpt_web, "TURN_TIMEOUT_SECONDS", 20):
            response = self.run_request(page, stream=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["choices"][0]["message"]["content"], "Partial answer")

    def test_a_marker_that_never_closes_does_not_swallow_the_answer(self) -> None:
        dangling = '{"reason":"before \ue200filecite\ue202turn0file0\ue202L3 after","ok":true}'
        # Streaming: held back, so the next delta is still a pure append.
        self.assertEqual(chatgpt_web._clean_text(dangling), '{"reason":"before ')
        # Finished: only the private-use characters go.
        self.assertEqual(
            chatgpt_web._clean_text(dangling, final=True),
            '{"reason":"before fileciteturn0file0L3 after","ok":true}',
        )
        page = FakePage(
            [
                {"type": "stream", "mode": "ws"},
                {"type": "text", "append": dangling},
                {"type": "done", "text": dangling, "reasoning": ""},
            ]
        )
        content = self.run_request(page, stream=False).json()["choices"][0]["message"]["content"]
        self.assertEqual(json.loads(content)["ok"], True)
        self.assertIn("after", content)

    def test_a_writing_block_is_unwrapped_with_its_commentary(self) -> None:
        page = (
            '---\ntitle: "2.1 Traffic Intensity and Trunking"\n---\n\n'
            "I'll treat the pasted content as the requested lesson-generation input and produce the subsection directly.\n\n"
            ':::writing{variant="document" id="47219" title="Traffic Intensity and Trunking"}\n'
            "A network may have thousands of users.\n\n### Sharing a finite channel pool\n\nBody.\n"
            ":::\n"
        )
        self.assertEqual(
            chatgpt_web._unwrap_writing_block(page),
            '---\ntitle: "2.1 Traffic Intensity and Trunking"\n---\n\n'
            "A network may have thousands of users.\n\n### Sharing a finite channel pool\n\nBody.\n",
        )
        # Ordinary prose before the block is not commentary and stays.
        kept = "Intro paragraph about trunking.\n\n:::writing{variant=\"document\"}\nDoc.\n:::"
        self.assertEqual(chatgpt_web._unwrap_writing_block(kept), "Intro paragraph about trunking.\n\nDoc.")
        # Text with no complete block is left alone.
        for untouched in ("No block here.", ':::writing{variant="document"}\nNever closed.'):
            self.assertEqual(chatgpt_web._unwrap_writing_block(untouched), untouched)
        page_events = FakePage(
            [
                {"type": "stream", "mode": "ws"},
                {"type": "done", "text": page, "reasoning": ""},
            ]
        )
        content = self.run_request(page_events, stream=False).json()["choices"][0]["message"]["content"]
        self.assertNotIn(":::writing", content)
        self.assertNotIn("I'll treat the pasted content", content)
        self.assertIn("### Sharing a finite channel pool", content)

    def test_the_websocket_answer_wins_over_the_rendered_page(self) -> None:
        # The rendered page's markdown ate the backslashes of `\"`, and Learn
        # could not parse the JSON it was handed. The socket keeps them.
        raw = '{"citation": "5XTA0 \\"Intro\\" lecture"}'
        page = FakePage(
            [
                {"type": "stream", "mode": "sse", "model": "gpt-5-6-thinking"},
                {"type": "stream", "mode": "ws"},
                {"type": "handoff"},
                {"type": "text", "append": raw},
                {"type": "done", "text": raw, "reasoning": ""},
            ],
            snapshots=[{"generating": False, "text": '{"citation": "5XTA0 "Intro" lecture"}', "hasAssistant": True}],
        )
        response = self.run_request(page, stream=False)
        content = response.json()["choices"][0]["message"]["content"]
        self.assertEqual(content, raw)
        self.assertEqual(json.loads(content)["citation"], '5XTA0 "Intro" lecture')

    def test_a_page_too_busy_to_read_does_not_drop_a_streaming_answer(self) -> None:
        # A ~190k-character answer keeps the renderer busy; reads of the
        # rendered page time out while the socket still delivers every delta.
        class BusyPage(FakePage):
            def evaluate(self, expression: str, **kwargs: Any) -> Any:
                if "snapshot()" in expression:
                    raise chatgpt_web._PageUnresponsive("the browser did not answer Runtime.evaluate in time", phase="receive")
                return super().evaluate(expression, **kwargs)

        import threading

        page = BusyPage([])
        answer = '{"learningUnits":[' + ",".join('{"id":"U%d"}' % i for i in range(40)) + "]}"

        def feed() -> None:
            page.events.put({"type": "stream", "mode": "ws", "turn": "turn-1"})
            for start in range(0, len(answer), 50):
                time.sleep(0.05)
                page.events.put({"type": "text", "append": answer[start:start + 50], "turn": "turn-1"})
            page.events.put({"type": "done", "text": answer, "reasoning": "", "turn": "turn-1"})

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            threading.Thread(target=feed, daemon=True).start()
            return page, "turn-1"

        dropped: List[bool] = []
        with patch.object(chatgpt_web, "_begin_turn", side_effect=begin), patch.object(
            chatgpt_web, "_drop_page", side_effect=lambda: dropped.append(True)
        ), patch.object(chatgpt_web, "EVAL_TIMEOUT_SECONDS", 0.01), patch.object(chatgpt_web, "TURN_TIMEOUT_SECONDS", 30):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}]}, "gpt-5-6-thinking", stream=False
            )
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(json.loads(response.json()["choices"][0]["message"]["content"]), json.loads(answer))
        self.assertEqual(dropped, [])

    def test_a_handoff_with_no_socket_stream_falls_back_to_the_page(self) -> None:
        page = FakePage(
            [{"type": "stream", "mode": "sse"}, {"type": "handoff"}],
            snapshots=[{"generating": False, "text": "Rendered answer", "hasAssistant": True}],
        )
        with patch.object(chatgpt_web, "HANDOFF_GRACE_SECONDS", 0.05), patch.object(chatgpt_web, "TURN_TIMEOUT_SECONDS", 20):
            response = self.run_request(page, stream=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["choices"][0]["message"]["content"], "Rendered answer")

    def test_a_wedged_page_is_reported_in_plain_words(self) -> None:
        # A DevTools method name is not something a person can act on, and the
        # page it came from must not be handed to the next request.
        page = FakePage([])
        dropped: List[bool] = []

        def submit(*_args: Any, **_kwargs: Any) -> str:
            raise chatgpt_web._PageUnresponsive(
                "the browser did not answer Runtime.evaluate in time", phase="receive"
            )

        with patch.object(chatgpt_web, "_ensure_page", return_value=page), patch.object(
            chatgpt_web, "_submit_turn", side_effect=submit
        ), patch.object(chatgpt_web, "_drop_page", side_effect=lambda *_: dropped.append(True)):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}]}, "gpt-5-2", stream=False
            )
        self.assertEqual(response.status_code, 503)
        message = response.json()["error"]["message"]
        self.assertNotIn("Runtime.evaluate", message)
        self.assertIn("stopped responding", message)
        self.assertEqual(dropped, [True])
        self.assertFalse(chatgpt_web._lane().lock.locked())

    def test_an_abandoned_stream_stops_the_page_and_frees_it(self) -> None:
        # A retry arrives as a second request. The first one's collector must
        # already have let go of the page - otherwise it reads the new turn's
        # rendering and, at its own deadline, presses Stop on it.
        page = FakePage([], snapshots=[{"generating": True, "text": "thinking", "hasAssistant": True}])
        response = self.run_request(
            page,
            stream=True,
            payload={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        )
        stream = chatgpt_web.relay_stream(response)
        next(stream)
        stream.close()
        self.assertFalse(chatgpt_web._lane().lock.locked())
        self.assertIn("stop()", "".join(page.evaluated))

    def test_a_long_think_keeps_the_stream_warm(self) -> None:
        # Minutes can pass before a reasoning model's first word. A stream
        # that sends nothing at all for that long is one an intermediary is
        # entitled to drop, so a comment frame goes out in the meantime.
        page = FakePage([], snapshots=[{"generating": True, "text": "", "hasAssistant": True}])
        with patch.object(chatgpt_web, "STREAM_HEARTBEAT_SECONDS", 0.05):
            response = self.run_request(
                page,
                stream=True,
                payload={"messages": [{"role": "user", "content": "hi"}], "stream": True},
            )
            stream = chatgpt_web.relay_stream(response)
            self.assertTrue(next(stream).startswith(b"data: "))
            warm = next(stream)
            stream.close()
        # A real chunk, so a client's SDK parses it and its stale-stream
        # watchdog resets; an SSE comment would be dropped before that.
        self.assertTrue(warm.startswith(b"data: {"))
        payload = json.loads(warm.decode()[6:])
        self.assertEqual(payload["choices"][0]["delta"], {})
        self.assertIsNone(payload["choices"][0]["finish_reason"])

    def test_a_batch_caller_that_hangs_up_frees_the_page_for_the_next_turn(self) -> None:
        # Live 2026-09-15: a cancelled Learn job's worker was killed mid-answer.
        # ChatMock kept collecting that answer (up to the 45-minute turn
        # timeout) and the next garden's first call sat in the lock queue
        # until its own socket died, so that plan never wrote a Learn event.
        page = FakePage([{"type": "stream", "mode": "ws", "model": "gpt-5-2"}, {"type": "text", "append": "A slow"}])
        hung_up = threading.Event()

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            page.start("turn-1")
            return page, "turn-1"

        with patch.object(chatgpt_web, "CLIENT_WATCH_INTERVAL_SECONDS", 0.05), patch.object(chatgpt_web, "_begin_turn", side_effect=begin):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            body = {"messages": [{"role": "user", "content": "hi"}]}
            started = time.time()
            timer = threading.Timer(0.3, hung_up.set)
            timer.start()
            self.addCleanup(timer.cancel)
            response = chatgpt_web.request_chat(credentials, body, "gpt-5-2", stream=False, client_gone=hung_up.is_set)
        self.assertLess(time.time() - started, 5, "the turn must end within moments of the client leaving")
        self.assertEqual(response.status_code, 499)
        self.assertIn("abandoned", response.json()["error"]["message"])
        self.assertTrue(any("stop()" in expression for expression in page.evaluated), "the site's Stop must be pressed")
        self.assertFalse(chatgpt_web._lane().lock.locked())

    def test_a_second_interactive_turn_is_refused_rather_than_queued(self) -> None:
        # A person watching a spinner: waiting out a thinking model behind the
        # lock is indistinguishable from a hang, so they are told to send again.
        chatgpt_web._lane().lock.acquire()
        self.addCleanup(chatgpt_web._lane().lock.release)
        with patch.object(chatgpt_web, "TURN_QUEUE_WAIT_SECONDS", 0.1), patch.object(
            chatgpt_web, "TURN_TIMEOUT_SECONDS", 5.0
        ):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            started = time.time()
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}], "stream": True}, "gpt-5-2", stream=True
            )
        self.assertLess(time.time() - started, 2.0)
        self.assertEqual(response.status_code, 503)
        self.assertIn("one conversation at a time", response.json()["error"]["message"])

    def test_a_refusal_names_who_holds_the_page_and_for_how_long(self) -> None:
        # 2026-09-18: three chat turns were refused with "an earlier message"
        # while a Learn job held the page; the person had no way to know.
        lane = chatgpt_web._lane()
        lane.lock.acquire()
        self.addCleanup(lane.lock.release)
        chatgpt_web._hold(chatgpt_web.INTERACTIVE_LANE, "a Learn job on telecom-1 (subsection_repair) on gpt-5-6-thinking")
        lane.holder["since"] -= 192  # type: ignore[index]
        with patch.object(chatgpt_web, "TURN_QUEUE_WAIT_SECONDS", 0.05):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}], "stream": True}, "gpt-5-2", stream=True
            )
        self.assertEqual(response.status_code, 503)
        message = response.json()["error"]["message"]
        self.assertIn("a Learn job on telecom-1 (subsection_repair) on gpt-5-6-thinking", message)
        self.assertIn("3m 12s ago", message)
        self.assertIn("chat page", message)

    def test_callers_are_described_by_what_asked(self) -> None:
        describe = chatgpt_web._describe_caller
        self.assertEqual(
            describe({"taskType": "subsection_generation", "gardenId": "telecom-1"}, "gpt-5-6-thinking", stream=False),
            "a Learn job on telecom-1 (subsection_generation) on gpt-5-6-thinking",
        )
        self.assertEqual(
            describe({"taskType": "subsection_repair"}, "gpt-6-pro", stream=False),
            "a council task (subsection_repair) on gpt-6-pro",
        )
        self.assertEqual(describe({"tools": [{"type": "function"}]}, "gpt-6-pro", stream=True), "another chat message on gpt-6-pro")
        self.assertEqual(describe({}, "gpt-6-pro", stream=True), "another chat message on gpt-6-pro")
        self.assertEqual(describe({}, "gpt-6-pro", stream=False), "an earlier message on gpt-6-pro")

    def test_batch_work_runs_on_its_own_page_while_a_chat_holds_the_other(self) -> None:
        # The whole point of lanes: a Learn stage and a chat turn are two
        # pages, so neither waits for the other.
        chatgpt_web._lanes_supported = True
        interactive = chatgpt_web._lane()
        interactive.lock.acquire()
        self.addCleanup(interactive.lock.release)
        page = FakePage([{"type": "stream", "mode": "sse"}, {"type": "done", "text": "Hello", "reasoning": ""}])
        lanes: List[str] = []

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **kwargs: Any):
            lanes.append(kwargs.get("lane", chatgpt_web.INTERACTIVE_LANE))
            page.start("turn-1")
            return page, "turn-1"

        with patch.object(chatgpt_web, "TURN_QUEUE_WAIT_SECONDS", 0.05), patch.object(
            chatgpt_web, "_begin_turn", side_effect=begin
        ):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            started = time.time()
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}]}, "gpt-5-2", stream=False
            )
        self.assertEqual(response.status_code, 200)
        self.assertLess(time.time() - started, 2.0, "the batch turn must not wait behind the chat page")
        self.assertEqual(lanes, [chatgpt_web.BATCH_LANE])
        self.assertTrue(interactive.lock.locked())
        self.assertFalse(chatgpt_web._lane(chatgpt_web.BATCH_LANE).lock.locked())

    def test_batch_work_shares_the_page_when_the_shell_has_only_one(self) -> None:
        # An older shell (or dashboard relay) hands out one page whatever the
        # lane, so batch work must queue on the interactive lock - a lock of
        # its own would be two turns typed into one composer.
        chatgpt_web._lanes_supported = False
        interactive = chatgpt_web._lane()
        interactive.lock.acquire()
        page = FakePage([{"type": "stream", "mode": "sse"}, {"type": "done", "text": "Hello", "reasoning": ""}])
        lanes: List[str] = []

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **kwargs: Any):
            lanes.append(kwargs.get("lane"))
            page.start("turn-1")
            return page, "turn-1"

        import threading

        threading.Timer(0.4, interactive.lock.release).start()
        with patch.object(chatgpt_web, "TURN_QUEUE_WAIT_SECONDS", 0.05), patch.object(
            chatgpt_web, "_begin_turn", side_effect=begin
        ):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            started = time.time()
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}]}, "gpt-5-2", stream=False
            )
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(time.time() - started, 0.3)
        self.assertEqual(lanes, [chatgpt_web.INTERACTIVE_LANE])
        self.assertFalse(interactive.lock.locked())

    def test_the_first_batch_turn_learns_whether_the_shell_keeps_lanes(self) -> None:
        # Learned from the shell's answer to the tab request: a shell that
        # keeps a page per lane echoes the lane; an older one does not.
        import threading

        def answer(echo_lane: bool) -> None:
            pending = chatgpt_web.pending_tab_requests(wait=5)
            row = pending[0]
            reply: Dict[str, Any] = {"cdpPort": 9333, "targetId": f"T-{row['lane']}"}
            if echo_lane:
                reply["lane"] = row["lane"]
            chatgpt_web.answer_tab_request(row["nonce"], reply)

        for echo_lane, expected in ((True, chatgpt_web.BATCH_LANE), (False, chatgpt_web.INTERACTIVE_LANE)):
            chatgpt_web.reset_for_tests()
            AttachStub.unresponsive_targets = set()
            pages: List[AttachStub] = []
            responder = threading.Thread(target=answer, args=(echo_lane,), daemon=True)
            responder.start()
            if not echo_lane:
                # The interactive page is then asked for in turn.
                threading.Thread(target=answer, args=(False,), daemon=True).start()
            with patch.object(chatgpt_web, "_live_bridge", return_value={"cdpPort": 9333}), patch.object(
                chatgpt_web,
                "_page_websocket",
                side_effect=lambda port, target_id=None: f"ws://127.0.0.1:{port}/devtools/page/{target_id}",
            ), patch.object(chatgpt_web, "_Page", lambda ws_url, surface: pages.append(AttachStub(ws_url, surface)) or pages[-1]):
                lane = chatgpt_web._resolve_lane(stream=False)
            responder.join(5)
            self.assertEqual(lane, expected, f"echo_lane={echo_lane}")
            self.assertEqual(chatgpt_web._lanes_supported, echo_lane)
            if echo_lane:
                self.assertEqual([page.lane for page in pages], [chatgpt_web.BATCH_LANE])
                self.assertIs(chatgpt_web._lane(chatgpt_web.BATCH_LANE).page, pages[0])
                self.assertIn("T-batch", pages[0].ws_url)
            else:
                self.assertIsNone(chatgpt_web._lane(chatgpt_web.BATCH_LANE).page)
                self.assertEqual([page.lane for page in pages], [chatgpt_web.INTERACTIVE_LANE])
            # A streaming caller never leaves the interactive page.
            self.assertEqual(chatgpt_web._resolve_lane(stream=True), chatgpt_web.INTERACTIVE_LANE)

    def test_a_batch_caller_waits_for_the_page_instead(self) -> None:
        # Learn, the council and Thought Topology have no one watching and no
        # stand-in to fall back to: a "busy" refusal fails a whole stage. They
        # wait for the page - and get it when the earlier turn lets go.
        chatgpt_web._lane().lock.acquire()
        page = FakePage([{"type": "stream", "mode": "sse"}, {"type": "done", "text": "Hello", "reasoning": ""}])

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            page.start("turn-1")
            return page, "turn-1"

        import threading

        threading.Timer(0.4, chatgpt_web._lane().lock.release).start()
        with patch.object(chatgpt_web, "TURN_QUEUE_WAIT_SECONDS", 0.05), patch.object(
            chatgpt_web, "_begin_turn", side_effect=begin
        ):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            started = time.time()
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}]}, "gpt-5-2", stream=False
            )
        self.assertGreaterEqual(time.time() - started, 0.3)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["choices"][0]["message"]["content"], "Hello")
        self.assertFalse(chatgpt_web._lane().lock.locked())

    def test_signed_out_refusal_is_reported_not_raised(self) -> None:
        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            raise ProviderError("signed out", status_code=401, phase="prepare", replay_safe=True)

        with patch.object(chatgpt_web, "_begin_turn", side_effect=begin):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            response = chatgpt_web.request_chat(credentials, {"messages": [{"role": "user", "content": "hi"}]}, "auto", stream=True)
        self.assertEqual(response.status_code, 401)
        self.assertFalse(chatgpt_web._lane().lock.locked())

    def test_learn_strict_routing_is_admitted(self) -> None:
        # Learn asks for exactly one upstream call per logical call. One turn
        # here is one message typed into the site and one submit, so the page
        # is an admissible target - unlike the Claude Code CLI, which owns its
        # own session lifecycle.
        from chatmock.providers import dispatch
        from chatmock.providers.registry import resolve_model

        self.assertTrue(dispatch.strict_single_attempt_supported(resolve_model("openaiweb/auto")))

        page = FakePage([{"type": "stream", "mode": "sse"}, {"type": "done", "text": "strict", "reasoning": ""}])

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            page.start("s")
            return page, "s"

        self.sign_in(["auto"])
        with create_app().test_request_context(), patch.object(chatgpt_web, "_begin_turn", side_effect=begin):
            response = dispatch.chat_completion_response(
                resolve_model("openaiweb/auto"),
                {"messages": [{"role": "user", "content": "hi"}]},
                strict_route=True,
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["choices"][0]["message"]["content"], "strict")

    def test_council_call_returns_text_and_usage(self) -> None:
        page = FakePage([{"type": "stream", "mode": "sse"}, {"type": "done", "text": "Council says hi", "reasoning": "r"}])

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            page.start("turn-1")
            return page, "turn-1"

        call = ModelCall(model="openaiweb/auto", messages=[{"role": "user", "content": "hi"}], system="be brief")
        with patch.object(chatgpt_web, "_begin_turn", side_effect=begin):
            credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
            text = chatgpt_web.call_model(call, credentials, "auto")
        self.assertEqual(text, "Council says hi")
        self.assertEqual(call.reasoning_out, "r")
        assert call.usage_out is not None
        self.assertGreater(call.usage_out.total_tokens, 0)


class WorkModeTests(IsolatedHome):
    """OpenAI (web) is the web chat; the site's Work-mode entries stay out."""

    SITE_ROWS = [
        {"slug": "gpt-5-6", "title": "GPT-5.6 Sol"},
        {"slug": "gpt-5-6-thinking", "title": "GPT-5.6 Sol"},
        {"slug": "gpt-5.6-sol-wm", "title": "GPT-5.6 Sol"},
        {"slug": "gpt-6-astra-wm", "title": "GPT-6 Astra"},
        {"slug": "gpt-reserve", "title": "GPT-5.6 Luna"},
    ]

    def test_work_mode_entries_are_not_listed(self) -> None:
        shaped = [row["slug"] for row in chatgpt_web._shape_models(self.SITE_ROWS)]
        self.assertEqual(shaped, ["gpt-5-6", "gpt-5-6-thinking"])

    def test_a_list_cached_before_they_were_hidden_drops_them_too(self) -> None:
        self.sign_in(["gpt-5-6-thinking", "gpt-5.6-sol-wm", "gpt-reserve"])
        self.assertEqual(chatgpt_web.cached_model_ids(), ["gpt-5-6-thinking"])

    def test_a_request_naming_one_is_refused_without_touching_the_page(self) -> None:
        credentials = ResolvedCredentials("openaiweb", None, "https://chatgpt.com", True, None)
        with patch.object(chatgpt_web, "_begin_turn", side_effect=AssertionError("the page must not be used")):
            response = chatgpt_web.request_chat(
                credentials, {"messages": [{"role": "user", "content": "hi"}]}, "gpt-5.6-sol-wm", stream=False
            )
        self.assertEqual(response.status_code, 400)
        message = response.json()["error"]["message"]
        self.assertIn("Work-mode", message)
        self.assertIn("openaiweb/gpt-5-6-thinking", message)
        self.assertFalse(chatgpt_web._lane().lock.locked())


class RouteTests(IsolatedHome):
    def setUp(self) -> None:
        super().setUp()
        self.app = create_app()
        self.client = self.app.test_client()

    def test_session_route_reports_signed_out_without_a_browser(self) -> None:
        response = self.client.get("/v1/providers/openaiweb/session")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload["signedIn"])
        self.assertEqual(payload["models"], [])
        self.assertFalse(payload["bridge"]["connected"])

    def test_provider_list_carries_the_web_provider(self) -> None:
        self.sign_out()
        entry = next(p for p in self.client.get("/v1/providers").get_json()["providers"] if p["id"] == "openaiweb")
        self.assertEqual(entry["kind"], "chatgpt_web")
        self.assertFalse(entry["configured"])
        self.assertIn("not signed in", entry["unavailableReason"])
        self.sign_in(["auto"])
        entry = next(p for p in self.client.get("/v1/providers").get_json()["providers"] if p["id"] == "openaiweb")
        self.assertTrue(entry["configured"])

    def test_models_route_lists_web_models_once_signed_in(self) -> None:
        self.sign_in(["auto", "gpt-5-2-instant"])
        ids = [row["id"] for row in self.client.get("/v1/models").get_json()["data"]]
        self.assertIn("openaiweb/auto", ids)
        self.assertIn("openaiweb/gpt-5-2-instant", ids)

    def test_tab_request_routes_relay_between_agent_and_provider(self) -> None:
        empty = self.client.get("/v1/providers/openaiweb/tab-requests?cdpPort=45678")
        self.assertEqual(empty.get_json()["requests"], [])
        self.assertEqual(empty.get_json()["bridge"], {"connected": True, "cdpPort": 45678})
        self.assertEqual(
            self.client.post("/v1/providers/openaiweb/tab-requests/nope", json={"cdpPort": 1, "targetId": "x"}).status_code,
            404,
        )
        self.assertEqual(self.client.post("/v1/providers/openaiweb/tab-requests/nope", json=[]).status_code, 400)

    def test_chat_completion_dispatches_through_the_page(self) -> None:
        self.sign_in(["auto"])
        page = FakePage([{"type": "stream", "mode": "sse"}, {"type": "done", "text": "From the web", "reasoning": ""}])

        seen: List[tuple[str, str]] = []

        def begin(model: str, prompt: str, effort: str | None, images: Any = None, **_: Any):
            seen.append((model, prompt))
            page.start("t")
            return page, "t"

        with patch.object(chatgpt_web, "_begin_turn", side_effect=begin):
            response = self.client.post(
                "/v1/chat/completions",
                json={"model": "openaiweb/auto", "messages": [{"role": "user", "content": "ping"}]},
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["choices"][0]["message"]["content"], "From the web")
        # The council wraps the turn in Breadboard's own instructions; the
        # person's message still reaches the composer inside that framing.
        self.assertTrue(seen)
        self.assertEqual(seen[0][0], "auto")
        self.assertIn("User: ping", seen[0][1])


@unittest.skipUnless(shutil.which("node"), "node is needed to run the page script")
class PageScriptTests(unittest.TestCase):
    """The reducer and the rendered-text reader, run under Node with a stub DOM."""

    @classmethod
    def run_node(cls, body: str, prelude: str = "") -> Any:
        stub = r"""
const listeners = {};
const stubNode = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = globalThis;
globalThis.document = { readyState: 'complete', querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, documentElement: {} };
globalThis.location = { origin: 'https://chatgpt.com', href: 'https://chatgpt.com/' };
globalThis.fetch = () => Promise.reject(new Error('no network'));
globalThis.TextDecoder = globalThis.TextDecoder || class { decode() { return ''; } };
"""
        # A file, not `node -e`: the page script alone is close to the length
        # Windows allows for a whole command line (WinError 206).
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "page-script-test.js")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(stub + prelude + chatgpt_web.PAGE_SCRIPT + "\n" + body)
            script = subprocess.run(
                ["node", path],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=30,
                check=False,
            )
        if script.returncode != 0:
            raise AssertionError(script.stderr)
        return json.loads(script.stdout.strip())

    COMPOSER_STUB = r"""
const calls = [];
const box = {
  tagName: 'DIV', isConnected: true, textContent: '',
  focus() {}, getAttribute: () => null,
  dispatchEvent(event) {
    calls.push(event.type);
    if (globalThis.__editorHandlesPaste) {
      event.defaultPrevented = true;
      if (!globalThis.__editorKeepsItAsAnAttachment) {
        box.textContent = event.clipboardData.getData('text/plain');
      }
    }
    return true;
  },
};
globalThis.DataTransfer = class { constructor() { this.items = {}; } setData(type, value) { this.items[type] = value; } getData(type) { return this.items[type]; } };
globalThis.ClipboardEvent = class { constructor(type, init) { this.type = type; this.clipboardData = init.clipboardData; this.defaultPrevented = false; } };
document.querySelector = (selector) => selector === '#prompt-textarea' ? box : null;
document.getSelection = () => ({ selectAllChildren: () => {} });
document.activeElement = box;
document.createElement = () => ({ children: [], append(...nodes) { this.children.push(...nodes); }, innerHTML: 'serialised' });
document.createTextNode = (text) => ({ text });
document.execCommand = (name, _ui, _value) => { calls.push(name); box.textContent = 'a long transcript'; return true; };
"""

    def test_the_composer_is_pasted_into_rather_than_re_parsed_as_html(self) -> None:
        # The transcript grows with the conversation, and serialising it as
        # HTML for the editor to parse is what took minutes and crashed the
        # renderer. A paste is the editor's own path.
        result = self.run_node(
            self.COMPOSER_STUB
            + "globalThis.__editorHandlesPaste = true;\n"
            + "const outcome = window.__breadboardChatgptWeb.insert('a long transcript');\n"
            + "console.log(JSON.stringify({outcome, calls}));"
        )
        self.assertEqual(result["outcome"], "ok")
        self.assertEqual(result["calls"], ["paste"])

    def test_a_paste_the_editor_keeps_its_own_way_is_still_accepted(self) -> None:
        # A long paste becomes a "Pasted text" attachment instead of composer
        # content. Demanding the text back out of the box called that a failure
        # and re-inserted the whole transcript, which is what left Send greyed
        # out. The editor taking the paste is the answer; send() judges the rest.
        result = self.run_node(
            self.COMPOSER_STUB
            + "globalThis.__editorHandlesPaste = true;\n"
            + "globalThis.__editorKeepsItAsAnAttachment = true;\n"
            + "const outcome = window.__breadboardChatgptWeb.insert('a long transcript');\n"
            + "console.log(JSON.stringify({outcome, calls, left: box.textContent}));"
        )
        self.assertEqual(result["outcome"], "ok")
        self.assertEqual(result["calls"], ["paste"])
        self.assertEqual(result["left"], "")

    def test_an_editor_that_ignores_a_paste_still_gets_the_native_edit(self) -> None:
        result = self.run_node(
            self.COMPOSER_STUB
            + "globalThis.__editorHandlesPaste = false;\n"
            + "const outcome = window.__breadboardChatgptWeb.insert('a long transcript');\n"
            + "console.log(JSON.stringify({outcome, calls}));"
        )
        self.assertEqual(result["outcome"], "ok")
        self.assertEqual(result["calls"], ["paste", "insertHTML"])

    def test_a_refused_send_carries_what_the_site_said(self) -> None:
        # "send_disabled" alone names a button. The sentence the site puts on
        # screen - a spent cap for the chosen model - is the actionable part.
        result = self.run_node(
            self.COMPOSER_STUB
            + "globalThis.MutationObserver = class { observe() {} disconnect() {} };\n"
            + "document.documentElement = {};\n"
            + "document.querySelectorAll = (selector) => selector.includes('role=\"alert\"')\n"
            + "  ? [{ textContent: '  You have hit the limit for GPT-6 Pro.  ' }] : [];\n"
            + "window.__breadboardChatgptWeb.send(1).then((outcome) =>\n"
            + "  console.log(JSON.stringify({outcome})));"
        )
        self.assertTrue(result["outcome"].startswith("send_disabled"))
        self.assertIn("limit for GPT-6 Pro", result["outcome"])

    def test_reducer_follows_the_delta_protocol(self) -> None:
        events = [
            json.dumps({"v": {"message": {"id": "m1", "author": {"role": "assistant"}, "content": {"content_type": "thoughts", "thoughts": [{"content": "hmm"}]}}, "conversation_id": "c1"}}),
            json.dumps({"v": {"message": {"id": "m2", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": [""]}}}}),
            json.dumps({"p": "/message/content/parts/0", "o": "append", "v": "Hel"}),
            json.dumps({"v": "lo"}),
            json.dumps({"o": "patch", "v": [{"p": "/message/content/parts/0", "o": "append", "v": " world"}, {"p": "/message/status", "o": "replace", "v": "finished_successfully"}]}),
            json.dumps({"type": "message_stream_complete", "conversation_id": "c1"}),
        ]
        result = self.run_node(
            "const r = window.__breadboardChatgptWeb.debug.createReducer();\n"
            f"for (const e of {json.dumps(events)}) r.event(e);\n"
            "console.log(JSON.stringify({text: r.text(), reasoning: r.reasoning(), done: r.isDone(), conversation: r.conversationId()}));"
        )
        self.assertEqual(result, {"text": "Hello world", "reasoning": "hmm", "done": True, "conversation": "c1"})

    SOCKET_PRELUDE = r"""
globalThis.WebSocket = class {
  constructor(url) { this.url = url; this.listeners = []; }
  addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
  dispatch(data) { for (const listener of this.listeners) listener({ data }); }
};
const emitted = [];
globalThis.__breadboardChatgptWebEmit = (payload) => emitted.push(JSON.parse(payload));
"""

    def test_the_socket_observer_rebuilds_the_raw_answer(self) -> None:
        # The answer as the site streams it over its WebSocket, escapes intact.
        answer = '{"citation": "5XTA0 \\"Intro\\" lecture"}'
        frames = [
            [{"id": 5, "type": "reply", "reply": {"type": "subscribe", "topic_id": "conversation-turn-x"}}],
            'event: delta_encoding\ndata: "v1"\n\n',
            "event: delta\ndata: " + json.dumps({"v": {"message": {"id": "u", "author": {"role": "user"}, "content": {"content_type": "text", "parts": ["question"]}}}}) + "\n\n",
            "event: delta\ndata: " + json.dumps({"v": {"message": {"id": "a", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": [""]}, "channel": "final"}}}) + "\n\n",
            "event: delta\ndata: " + json.dumps({"p": "/message/content/parts/0", "o": "append", "v": answer[:20]}) + "\n\n",
            "event: delta\ndata: " + json.dumps({"v": answer[20:]}) + "\n\n",
            'data: {"type":"message_stream_complete"}\n\ndata: [DONE]\n\n',
            "done",
        ]

        def wire(frame: Any) -> str:
            if isinstance(frame, list):
                return json.dumps(frame)
            inner = {"type": "done"} if frame == "done" else {"type": "stream-item", "encoded_item": frame}
            return json.dumps([{"type": "message", "topic_id": "conversation-turn-x", "payload": {"type": "conversation-turn-stream", "payload": inner}}])

        result = self.run_node(
            "window.__breadboardChatgptWeb.setTurn('t1');\n"
            # The POST that started this turn sent the user message "u".
            "window.__breadboardChatgptWeb.debug.expect(['u'], null);\n"
            "const socket = new WebSocket('wss://ws.chatgpt.com/ws/user');\n"
            f"for (const data of {json.dumps([wire(frame) for frame in frames])}) socket.dispatch(data);\n"
            "console.log(JSON.stringify({ emitted, observed: WebSocket.__breadboardObserved === true }));",
            prelude=self.SOCKET_PRELUDE,
        )
        self.assertTrue(result["observed"])
        kinds = [event["type"] for event in result["emitted"]]
        self.assertEqual(kinds[0], "stream")
        self.assertEqual(result["emitted"][0]["mode"], "ws")
        self.assertEqual(kinds.count("done"), 1)
        done = result["emitted"][-1]
        self.assertEqual((done["type"], done["turn"]), ("done", "t1"))
        self.assertEqual(done["text"], answer)
        streamed = "".join(event.get("append", "") for event in result["emitted"] if event["type"] == "text")
        self.assertEqual(streamed, answer)
        self.assertEqual(json.loads(done["text"])["citation"], '5XTA0 "Intro" lecture')

    def test_reducer_applies_an_operation_list_without_its_patch_marker(self) -> None:
        # The frame shape that cut a critic's JSON at its first citation: the
        # list that closes the marker arrives without `"o": "patch"`.
        events = [
            json.dumps({"v": {"message": {"id": "a", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": [""]}, "channel": "final"}}}),
            json.dumps({"p": "/message/content/parts/0", "o": "append", "v": '{"reason":"before'}),
            json.dumps({"p": "", "o": "patch", "v": [
                {"p": "/message/content/parts/0", "o": "append", "v": " cite \ue200filecite\ue202turn0file0\ue202L3"},
                {"p": "/message/metadata/content_references", "o": "append", "v": [{"matched_text": "x"}]},
            ]}),
            json.dumps({"v": [
                {"p": "/message/content/parts/0", "o": "append", "v": "-L8\ue201 after"},
                {"p": "/message/metadata/citations", "o": "append", "v": [{"start_ix": 1}]},
            ]}),
            json.dumps({"p": "/message/content/parts/0", "o": "append", "v": " more"}),
            json.dumps({"v": '","ok":true}'}),
            json.dumps({"type": "message_stream_complete"}),
        ]
        result = self.run_node(
            "const r = window.__breadboardChatgptWeb.debug.createReducer();\n"
            f"for (const e of {json.dumps(events)}) r.event(e);\n"
            "console.log(JSON.stringify({ text: r.text(), done: r.isDone() }));"
        )
        self.assertTrue(result["done"])
        self.assertEqual(result["text"], '{"reason":"before cite \ue200filecite\ue202turn0file0\ue202L3-L8\ue201 after more","ok":true}')

    def test_socket_frames_outside_a_turn_are_ignored(self) -> None:
        frame = json.dumps([{"type": "message", "topic_id": "conversation-turn-x", "payload": {"type": "conversation-turn-stream", "payload": {"type": "done"}}}])
        result = self.run_node(
            "const socket = new WebSocket('wss://ws.chatgpt.com/ws/user');\n"
            f"socket.dispatch({json.dumps(frame)});\n"
            "console.log(JSON.stringify(emitted));",
            prelude=self.SOCKET_PRELUDE,
        )
        self.assertEqual(result, [])

    def test_reducer_notes_a_handoff_to_the_socket(self) -> None:
        result = self.run_node(
            "const r = window.__breadboardChatgptWeb.debug.createReducer();\n"
            "r.event(JSON.stringify({ type: 'stream_handoff', conversation_id: 'c1' }));\n"
            "r.event('[DONE]');\n"
            "console.log(JSON.stringify([r.handedOff(), r.text(), r.isDone(), r.conversationId()]));"
        )
        # The hand-off names the conversation the socket stream belongs to.
        self.assertEqual(result, [True, "", True, "c1"])

    @staticmethod
    def socket_wire(topic: str, *, data: str | None = None, done: bool = False) -> str:
        inner = {"type": "done"} if done else {"type": "stream-item", "encoded_item": data}
        return json.dumps([{"type": "message", "topic_id": topic, "payload": {"type": "conversation-turn-stream", "payload": inner}}])

    @staticmethod
    def socket_delta(event: Dict[str, Any]) -> str:
        return "event: delta\ndata: " + json.dumps(event) + "\n\n"

    def test_a_foreign_conversation_on_the_socket_is_never_adopted(self) -> None:
        # 2026-09-15: a leftover read-aloud chat's stream, interleaved with the
        # real answer's, was returned as a GPT-6 Pro turn's reply.
        def message(message_id: str, role: str, text: str) -> str:
            return self.socket_delta({"v": {"message": {"id": message_id, "author": {"role": role}, "content": {"content_type": "text", "parts": [text]}}}})

        wire = [
            self.socket_wire("conversation-turn-old", data=message("old-user", "user", "Write back the text")),
            self.socket_wire("conversation-turn-new", data=message("mine", "user", "The real question")),
            self.socket_wire("conversation-turn-old", data=message("old-answer", "assistant", "Response ready. Leftover repeat.")),
            self.socket_wire("conversation-turn-old", done=True),
            self.socket_wire("conversation-turn-new", data=message("my-answer", "assistant", "The real answer.")),
            self.socket_wire("conversation-turn-new", done=True),
        ]
        result = self.run_node(
            "window.__breadboardChatgptWeb.setTurn('t2');\n"
            "window.__breadboardChatgptWeb.debug.expect(['mine'], null);\n"
            "const socket = new WebSocket('wss://ws.chatgpt.com/ws/user');\n"
            f"for (const data of {json.dumps(wire)}) socket.dispatch(data);\n"
            "console.log(JSON.stringify(emitted));",
            prelude=self.SOCKET_PRELUDE,
        )
        dones = [event for event in result if event["type"] == "done"]
        self.assertEqual(len(dones), 1)
        self.assertEqual((dones[0]["text"], dones[0]["messageId"], dones[0]["turn"]), ("The real answer.", "my-answer", "t2"))
        self.assertFalse(any("Leftover" in json.dumps(event) for event in result))
        self.assertEqual([event["type"] for event in result].count("stream"), 1)

    def test_a_socket_stream_waits_for_the_handoff_to_name_its_conversation(self) -> None:
        # No message id matched: the stream is held until the POST's hand-off
        # names the conversation, then shown whole. Another conversation stays out.
        def message(conversation: str, message_id: str, role: str, text: str) -> str:
            return self.socket_delta({"v": {"message": {"id": message_id, "author": {"role": role}, "content": {"content_type": "text", "parts": [text]}}, "conversation_id": conversation}})

        wire = [
            self.socket_wire("conversation-turn-a", data=message("conv-1", "server-user", "user", "question")),
            self.socket_wire("conversation-turn-a", data=message("conv-1", "answer-1", "assistant", "Held until named.")),
            self.socket_wire("conversation-turn-a", done=True),
            self.socket_wire("conversation-turn-b", data=message("conv-9", "other", "assistant", "Someone else's chat.")),
            self.socket_wire("conversation-turn-b", done=True),
        ]
        result = self.run_node(
            "window.__breadboardChatgptWeb.setTurn('t3');\n"
            "const socket = new WebSocket('wss://ws.chatgpt.com/ws/user');\n"
            f"for (const data of {json.dumps(wire)}) socket.dispatch(data);\n"
            "const before = emitted.length;\n"
            "window.__breadboardChatgptWeb.debug.expect([], 'conv-1');\n"
            "console.log(JSON.stringify({ before, emitted }));",
            prelude=self.SOCKET_PRELUDE,
        )
        self.assertEqual(result["before"], 0)
        dones = [event for event in result["emitted"] if event["type"] == "done"]
        self.assertEqual(len(dones), 1)
        self.assertEqual((dones[0]["text"], dones[0]["conversationId"]), ("Held until named.", "conv-1"))
        self.assertFalse(any("Someone else" in json.dumps(event) for event in result["emitted"]))

    def test_reducer_ignores_user_and_tool_messages(self) -> None:
        events = [
            json.dumps({"message": {"id": "u", "author": {"role": "user"}, "content": {"content_type": "text", "parts": ["question"]}}}),
            json.dumps({"v": {"message": {"id": "a", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["answer"]}}}}),
            "[DONE]",
        ]
        result = self.run_node(
            "const r = window.__breadboardChatgptWeb.debug.createReducer();\n"
            f"for (const e of {json.dumps(events)}) r.event(e);\n"
            "console.log(JSON.stringify([r.text(), r.isDone()]));"
        )
        self.assertEqual(result, ["answer", True])


if __name__ == "__main__":
    unittest.main()
