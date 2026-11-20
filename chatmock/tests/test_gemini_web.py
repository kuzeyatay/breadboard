import unittest
from unittest import mock

from chatmock.providers import dispatch, gemini_web, registry
from chatmock.providers.catalog import provider_spec


class GeminiWebTests(unittest.TestCase):
    def test_wired_as_a_browser_provider(self):
        spec = provider_spec("googleweb")
        self.assertIs(dispatch._client_for(spec), gemini_web)
        self.assertTrue(registry.drives_a_browser("googleweb/auto"))
        self.assertIn("auto", gemini_web.cached_model_ids())

    def test_every_lane_is_released(self):
        page = object()
        with mock.patch.object(gemini_web, "_ensure_page", return_value=page), \
             mock.patch.object(gemini_web, "_submit", return_value=0), \
             mock.patch.object(gemini_web, "_collect", return_value="```\n{\"name\": \"t\", \"arguments\": {}}\n```"):
            tools = [{"type": "function", "function": {"name": "t", "parameters": {}}}]
            body = {"messages": [{"role": "user", "content": "hi"}], "tools": tools}
            done = gemini_web.request_chat(None, body, "auto", stream=False)
            self.assertEqual(done.json()["choices"][0]["finish_reason"], "tool_calls")
            unread = gemini_web.request_chat(None, body, "auto", stream=True)
            unread.close()  # a client that left before reading
            streamed = gemini_web.request_chat(None, body, "auto", stream=True)
            out = b"".join(streamed.iter_stream())
            self.assertIn(b'"tool_calls"', out)
            self.assertNotIn(b'"content": "```', out)  # the call never leaks as prose
        self.assertFalse(any(lane.lock.locked() for lane in gemini_web._lanes.values()))


if __name__ == "__main__":
    unittest.main()
