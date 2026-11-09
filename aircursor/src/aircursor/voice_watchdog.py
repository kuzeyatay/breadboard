"""Release voice modifiers even if capture/inference stops returning frames."""
from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)


class VoiceWatchdog:
    def __init__(self, controller) -> None:
        self.controller = controller
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name="AirCursor voice release", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def _run(self) -> None:
        while not self.stop.wait(0.05):
            try:
                self.controller.expire_voice()
                self.controller.expire_navigation()
            except OSError:
                # Keep ownership and retry a failed release on the next tick.
                logger.exception("Retrying voice key release")

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=1.0)
        self.controller.release_all()
