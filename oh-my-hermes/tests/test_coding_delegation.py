from __future__ import annotations

import unittest

from _local_package import load_local_package

load_local_package()

from omh.coding.coding_delegation import _coding_status_request_applies  # noqa: E402


class CodingStatusAgentTermTests(unittest.TestCase):
    """pi-family executor names reach the coding status board classification.

    `_CODING_STATUS_AGENT_TERMS` matches by substring on the lowered message,
    and bare "pi" hides inside "api" and "pipeline" while the token itself is
    owned by Raspberry-Pi physical-device routing — so pi only counts through
    right-bounded forms matched at word boundaries ("raspi status" hides
    "pi status"), and never in raspberry/api context.
    """

    POSITIVE = (
        "how far along is senpi?",
        "pi 진행상황?",
        "pi 세션 상태 알려줘",
        "opencode 진행상황 알려줘",
        "omo runtime status?",
        # The incumbent names keep working alongside the pi family.
        "how far along is codex?",
        "claude code 작업 어디까지 됐어?",
    )
    NEGATIVE = (
        "raspberry pi 진행상황?",
        "raspberry pi status check",
        "api 진행상황 알려줘",
        # Word-boundary guard: "raspi status" and "spi status" contain
        # "pi status" as a raw substring without any raspberry/api blocker term.
        "raspi status check",
        "check spi status",
    )

    def test_pi_family_status_questions_apply_on_the_status_workflow(self) -> None:
        for message in self.POSITIVE:
            with self.subTest(message=message):
                self.assertTrue(_coding_status_request_applies(message.lower(), "ultraprocess"))

    def test_raspberry_pi_and_api_context_never_applies(self) -> None:
        for message in self.NEGATIVE:
            with self.subTest(message=message):
                self.assertFalse(_coding_status_request_applies(message.lower(), "ultraprocess"))

    def test_status_terms_only_apply_on_the_status_workflow(self) -> None:
        self.assertFalse(_coding_status_request_applies("how far along is senpi?", "loop"))

    def test_an_agent_name_without_a_status_request_never_applies(self) -> None:
        self.assertFalse(_coding_status_request_applies("senpi is a nice tool", "ultraprocess"))


if __name__ == "__main__":  # pragma: no cover - unittest entry point
    unittest.main()
