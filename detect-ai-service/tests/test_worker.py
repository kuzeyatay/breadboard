import time
import threading
import unittest

from breadboard_detect_ai.contracts import DetectAIResult
from breadboard_detect_ai.worker import DetectionWorker, Job


class FakePipeline:
    def __init__(self):
        self.unloaded = 0

    def detect(self, request_id, item, _options, progress, cancelled):
        progress("validating", {"itemId": item["id"]})
        if cancelled():
            raise InterruptedError("cancelled")
        return DetectAIResult(
            schema_version=1,
            request_id=request_id,
            item_id=item["id"],
            name=item["name"],
            modality="text",
            verdict="inconclusive",
            confidence="low",
            summary="fixture",
            signals=[],
        )

    def unload(self):
        self.unloaded += 1


class BlockingPipeline(FakePipeline):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = []

    def detect(self, request_id, item, _options, progress, cancelled):
        self.calls.append(request_id)
        self.started.set()
        self.release.wait(timeout=2)
        return super().detect(request_id, item, _options, progress, cancelled)


class WorkerTests(unittest.TestCase):
    def test_serial_job_reaches_terminal_result(self):
        worker = DetectionWorker(FakePipeline(), idle_timeout_seconds=30)
        try:
            worker.submit(Job("request_12345678", {"id": "one", "name": "one.txt", "modality": "text", "text": "x"}, {}))
            deadline = time.time() + 2
            view = worker.view("request_12345678")
            while view["status"] not in {"completed", "failed", "aborted"} and time.time() < deadline:
                time.sleep(0.01)
                view = worker.view("request_12345678")
            self.assertEqual(view["status"], "completed")
            self.assertEqual(view["result"]["summary"], "fixture")
            sequences = [event["sequenceNumber"] for event in view["events"]]
            self.assertEqual(sequences, sorted(set(sequences)))
        finally:
            worker.close()

    def test_queued_cancellation_does_not_enter_the_pipeline(self):
        pipeline = BlockingPipeline()
        worker = DetectionWorker(pipeline, idle_timeout_seconds=30)
        first = Job("request_first_1", {"id": "one", "name": "one.txt", "modality": "text", "text": "x"}, {})
        second = Job("request_second_2", {"id": "two", "name": "two.txt", "modality": "text", "text": "x"}, {})
        try:
            worker.submit(first)
            self.assertTrue(pipeline.started.wait(timeout=1))
            worker.submit(second)
            self.assertTrue(worker.cancel(second.request_id))
            pipeline.release.set()
            deadline = time.time() + 2
            while worker.view(first.request_id)["status"] != "completed" and time.time() < deadline:
                time.sleep(0.01)
            self.assertEqual(worker.view(second.request_id)["status"], "aborted")
            self.assertEqual(pipeline.calls, [first.request_id])
        finally:
            pipeline.release.set()
            worker.close()


if __name__ == "__main__":
    unittest.main()
