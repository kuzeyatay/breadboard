import json
import unittest

import requests

from chatmock.responses_api import stream_upstream_bytes
from chatmock.utils import sse_translate_chat, sse_translate_text, chat_usage_from_response_event


class Upstream:
    def __init__(self, body, *, split=7, fail=False):
        self.body = body
        self.split = split
        self.fail = fail
        self.closed = False

    def iter_content(self, **_kwargs):
        for start in range(0, len(self.body), self.split):
            yield self.body[start:start + self.split]
        if self.fail:
            raise requests.ConnectionError('connection interrupted')

    def iter_lines(self, **_kwargs):
        yield from self.body.splitlines()
        if self.fail:
            raise requests.ConnectionError('connection interrupted')

    def close(self):
        self.closed = True


def event(kind, **fields):
    return b'data: ' + json.dumps({'type': kind, **fields}).encode() + b'\n\n'


def decode(body):
    return [json.loads(line[5:]) for line in body.splitlines()
            if line.startswith(b'data:') and line[5:].strip() != b'[DONE]']


class StreamCompletionTests(unittest.TestCase):
    def test_stream_usage_preserves_cached_and_reasoning_counts(self):
        usage = {'input_tokens':10000, 'output_tokens':200, 'total_tokens':10200,
                 'input_tokens_details':{'cached_tokens':9000},
                 'output_tokens_details':{'reasoning_tokens':150}}
        for translate in [sse_translate_chat, sse_translate_text]:
            with self.subTest(translate=translate):
                upstream = Upstream(event('response.completed', response={'id':'usage', 'usage':usage}))
                events = decode(b''.join(translate(upstream, 'gpt-6-sol', 0, include_usage=True)))
                recorded = [e['usage'] for e in events if e.get('usage')][-1]
                self.assertEqual(recorded, {'prompt_tokens':10000, 'completion_tokens':200, 'total_tokens':10200,
                    'prompt_tokens_details':{'cached_tokens':9000}, 'completion_tokens_details':{'reasoning_tokens':150}})

    def test_missing_usage_details_remain_unknown_and_bad_usage_is_ignored(self):
        self.assertEqual(chat_usage_from_response_event({'response':{'usage':{'input_tokens':10,'output_tokens':2}}}),
                         {'prompt_tokens':10,'completion_tokens':2,'total_tokens':12})
        for payload in [{}, {'response':[]}, {'response':{'usage':None}}, {'response':{'usage':{'input_tokens':'bad'}}}]:
            self.assertIsNone(chat_usage_from_response_event(payload))

    def test_partial_text_followed_by_eof_or_done_is_an_error(self):
        for suffix in [b'', b'data: [DONE]\n\n']:
            for translate in [stream_upstream_bytes, lambda u: sse_translate_chat(u, 'model', 0)]:
                with self.subTest(suffix=suffix, translate=translate):
                    upstream = Upstream(event('response.output_text.delta', delta='unfinished because') + suffix)
                    raw = b''.join(translate(upstream))
                    events = decode(raw)
                    self.assertIn(b'unfinished because', raw)
                    self.assertIn(b'upstream_incomplete', raw)
                    self.assertNotIn(b'data: [DONE]', raw)
                    self.assertFalse(any(c.get('finish_reason') == 'stop'
                                         for e in events for c in e.get('choices', [])))
                    self.assertTrue(upstream.closed)

    def test_fragmented_complete_response_is_preserved_and_callback_runs(self):
        body = event('response.output_text.delta', delta='finished') + event('response.completed', response={'id': 'r'}) + b'data: [DONE]\n\n'
        upstream = Upstream(body, split=1)
        observed = []
        self.assertEqual(b''.join(stream_upstream_bytes(upstream, on_event=observed.append)), body)
        self.assertEqual([e['type'] for e in observed], ['response.output_text.delta', 'response.completed'])
        self.assertTrue(upstream.closed)

    def test_final_event_without_a_trailing_newline_is_recognized(self):
        upstream = Upstream(event('response.completed', response={'id': 'r'}).rstrip())
        events = decode(b''.join(stream_upstream_bytes(upstream)))
        self.assertEqual([e['type'] for e in events], ['response.completed'])

    def test_local_failure_reaches_the_session_observer(self):
        observed = []
        upstream = Upstream(event('response.created', response={'id': 'unfinished'}))
        list(stream_upstream_bytes(upstream, on_event=observed.append))
        self.assertEqual(observed[-1]['type'], 'error')
        self.assertEqual(observed[-1]['code'], 'upstream_incomplete')

    def test_transport_failure_preserves_partial_text_and_reports_error(self):
        for translate in [stream_upstream_bytes, lambda u: sse_translate_chat(u, 'model', 0)]:
            upstream = Upstream(event('response.output_text.delta', delta='partial'), fail=True)
            raw = b''.join(translate(upstream))
            self.assertIn(b'partial', raw)
            self.assertIn(b'upstream_incomplete', raw)
            self.assertTrue(upstream.closed)

    def test_explicit_failure_is_not_replaced_by_an_eof_error(self):
        body = event('response.failed', response={'error': {'message': 'original failure'}})
        for translate in [stream_upstream_bytes, lambda u: sse_translate_chat(u, 'model', 0)]:
            raw = b''.join(translate(Upstream(body)))
            self.assertIn(b'original failure', raw)
            self.assertNotIn(b'upstream_incomplete', raw)

    def test_transport_failure_after_a_terminal_event_does_not_change_its_result(self):
        for kind in ['response.completed', 'response.failed']:
            for translate in [stream_upstream_bytes, lambda u: sse_translate_chat(u, 'model', 0)]:
                with self.subTest(kind=kind, translate=translate):
                    upstream = Upstream(event(kind, response={'id': 'r'}), fail=True)
                    raw = b''.join(translate(upstream))
                    self.assertNotIn(b'upstream_incomplete', raw)
                    self.assertTrue(upstream.closed)

    def test_incomplete_response_is_not_reported_as_success(self):
        upstream = Upstream(event('response.incomplete', response={'status': 'incomplete'}))
        raw = b''.join(sse_translate_chat(upstream, 'model', 0))
        self.assertIn(b'upstream_incomplete', raw)
        self.assertNotIn(b'data: [DONE]', raw)

    def test_failure_before_iteration_is_not_a_done_marker(self):
        class FailedStart(Upstream):
            def iter_lines(self, **_kwargs):
                raise requests.exceptions.ChunkedEncodingError('failed before first event')
        upstream = FailedStart(b'')
        raw = b''.join(sse_translate_chat(upstream, 'model', 0))
        self.assertIn(b'upstream_incomplete', raw)
        self.assertNotIn(b'data: [DONE]', raw)
        self.assertTrue(upstream.closed)


if __name__ == '__main__':
    unittest.main()
