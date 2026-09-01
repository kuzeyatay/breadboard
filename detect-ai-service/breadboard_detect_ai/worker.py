"""Single-queue worker with cancellation, bounded retention, and idle unload."""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from .observability import emit
from .pipeline import DetectPipeline


@dataclass(slots=True)
class Job:
    request_id: str
    item: dict[str, object]
    options: dict[str, object]
    status: str = "queued"
    sequence: int = 0
    events: list[dict[str, object]] = field(default_factory=list)
    result: dict[str, object] | None = None
    error: str | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    created_at: float = field(default_factory=time.monotonic)


class DetectionWorker:
    def __init__(self, pipeline: DetectPipeline, idle_timeout_seconds: int = 600) -> None:
        self.pipeline = pipeline
        self.idle_timeout_seconds = max(30, idle_timeout_seconds)
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._queue: queue.Queue[Job | None] = queue.Queue(maxsize=32)
        self._thread = threading.Thread(target=self._run, name="detect-ai-worker", daemon=True)
        self._thread.start()

    def submit(self, job: Job) -> None:
        with self._lock:
            self._evict_locked()
            if job.request_id in self._jobs:
                raise ValueError("duplicate requestId")
            self._jobs[job.request_id] = job
            try:
                self._queue.put_nowait(job)
            except queue.Full:
                self._jobs.pop(job.request_id, None)
                raise

    def view(self, request_id: str, since: int = 0) -> dict[str, object]:
        with self._lock:
            job = self._jobs.get(request_id)
            if not job:
                raise KeyError("request_not_found")
            return {
                "requestId": job.request_id,
                "status": job.status,
                "events": [event for event in job.events if int(event["sequenceNumber"]) > since],
                **({"result": job.result} if job.result is not None else {}),
                **({"error": job.error} if job.error else {}),
            }

    def cancel(self, request_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(request_id)
            if not job:
                raise KeyError("request_not_found")
            if job.status in {"completed", "failed", "aborted"}:
                return False
            job.cancel_event.set()
            if job.status == "queued":
                job.status = "aborted"
                self._emit_locked(job, "run.aborted", {})
                job.item.clear()
                job.options.clear()
            return True

    def health(self) -> dict[str, object]:
        with self._lock:
            queued = sum(job.status == "queued" for job in self._jobs.values())
            running = sum(job.status == "running" for job in self._jobs.values())
        return {
            "status": "busy" if running else "ok",
            "queued": queued,
            "running": running,
            "resources": self.pipeline.resources.to_dict(),
            "assets": self.pipeline.assets.status(),
        }

    def close(self) -> None:
        self._queue.put(None)
        self._thread.join(timeout=10)
        self.pipeline.unload()

    def _run(self) -> None:
        models_may_be_loaded = False
        while True:
            try:
                job = self._queue.get(timeout=self.idle_timeout_seconds)
            except queue.Empty:
                if models_may_be_loaded:
                    self.pipeline.unload()
                    models_may_be_loaded = False
                    emit("models.unloaded", reason="idle_timeout")
                continue
            if job is None:
                return
            if job.cancel_event.is_set():
                self._queue.task_done()
                continue
            models_may_be_loaded = True
            with self._lock:
                job.status = "running"
                self._emit_locked(job, "run.started", {})
            started = time.monotonic()
            modality = str(job.item.get("modality") or "unknown")
            emit("job.started", modality=modality, queue_depth=self._queue.qsize())

            def progress(stage: str, detail: dict[str, object]) -> None:
                with self._lock:
                    self._emit_locked(job, "run.progress", {"stage": stage, **detail})

            try:
                result = self.pipeline.detect(
                    job.request_id,
                    job.item,
                    job.options,
                    progress,
                    job.cancel_event.is_set,
                )
                with self._lock:
                    if job.cancel_event.is_set():
                        job.status = "aborted"
                        self._emit_locked(job, "run.aborted", {})
                    else:
                        job.result = result.to_dict()
                        job.status = "completed"
                        self._emit_locked(job, "run.completed", {"result": job.result})
                    emit(
                        "job.completed",
                        modality=modality,
                        status=job.status,
                        duration_ms=int((time.monotonic() - started) * 1000),
                    )
            except InterruptedError:
                with self._lock:
                    job.status = "aborted"
                    self._emit_locked(job, "run.aborted", {})
                emit("job.aborted", modality=modality, status="aborted")
            except Exception as error:
                with self._lock:
                    job.status = "failed"
                    job.error = _safe_public_error(error)
                    self._emit_locked(job, "run.failed", {"error": job.error})
                emit(
                    "job.failed",
                    modality=modality,
                    status="failed",
                    duration_ms=int((time.monotonic() - started) * 1000),
                )
            finally:
                # Retain bounded events/results for reconnects, never the model
                # input itself once this item reaches a terminal state.
                job.item.clear()
                job.options.clear()
                self._queue.task_done()

    def _emit_locked(self, job: Job, event_type: str, payload: dict[str, object]) -> None:
        job.sequence += 1
        job.events.append(
            {
                "sequenceNumber": job.sequence,
                "type": event_type,
                "payload": payload,
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        if len(job.events) > 500:
            del job.events[:-500]

    def _evict_locked(self) -> None:
        cutoff = time.monotonic() - 24 * 60 * 60
        expired = [key for key, job in self._jobs.items() if job.created_at < cutoff]
        for key in expired:
            del self._jobs[key]
        if len(self._jobs) <= 100:
            return
        ordered = sorted(self._jobs.values(), key=lambda job: job.created_at)
        for job in ordered[: len(self._jobs) - 100]:
            if job.status != "running":
                self._jobs.pop(job.request_id, None)


def _safe_public_error(error: Exception) -> str:
    text = str(error).lower()
    if isinstance(error, ValueError):
        return str(error)[:500]
    if "out of memory" in text or "alloc" in text:
        return "Local model memory was exhausted. Close other GPU-heavy work or select CPU mode."
    if "checksum" in text:
        return "A model asset failed checksum verification and was quarantined. Retry to download a clean copy."
    if "connection" in text or "download" in text:
        return "A required model asset could not be downloaded. Check the connection and retry."
    return "The local detector failed. No input content was written to logs."
