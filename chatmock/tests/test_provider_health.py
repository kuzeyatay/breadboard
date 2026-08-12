from __future__ import annotations

import os
import tempfile
import time
import unittest
from unittest.mock import patch

from chatmock import failover, provider_health
from chatmock.providers.registry import active_failover, default_model, is_unavailable


class TransientDetectionTests(unittest.TestCase):
    def test_server_errors_are_transient(self) -> None:
        for status in (500, 502, 503, 504, 522, 524):
            self.assertTrue(provider_health.is_transient_error(status, ""), status)

    def test_timeouts_and_unreachable_endpoints_are_transient(self) -> None:
        self.assertTrue(
            provider_health.is_transient_error(
                None, "Anthropic could not be reached after 3 attempts (ConnectTimeout)."
            )
        )
        self.assertTrue(provider_health.is_transient_error(None, "Groq is unreachable."))
        self.assertTrue(
            provider_health.is_transient_error(None, "OpenRouter kept failing (last status 503).")
        )

    def test_a_wrong_request_is_not_a_sick_provider(self) -> None:
        self.assertFalse(provider_health.is_transient_error(400, "tools.0: Field required"))
        self.assertFalse(provider_health.is_transient_error(401, "Invalid API key"))
        self.assertFalse(provider_health.is_transient_error(404, "No such model"))

    def test_running_out_of_quota_is_not_a_health_problem(self) -> None:
        # The provider is fine; the plan window is spent. `failover` owns this,
        # with a cooldown measured in hours rather than seconds.
        self.assertTrue(failover.is_quota_error(429, "usage limit reached"))
        self.assertFalse(provider_health.is_transient_error(429, "usage limit reached"))
        self.assertFalse(
            provider_health.is_transient_error(400, "You exceeded your current quota")
        )

    def test_a_known_status_settles_it_without_reading_the_prose(self) -> None:
        # "connection" appears in the message, but a 400 is the caller's fault
        # however it is worded.
        self.assertFalse(
            provider_health.is_transient_error(400, "unknown parameter: connection_id")
        )


class HealthTrackingTests(unittest.TestCase):
    def setUp(self) -> None:
        provider_health.reset()
        self.addCleanup(provider_health.reset)

    def _fail(self, times: int, provider: str = "anthropic"):
        outage = None
        for _ in range(times):
            outage = provider_health.note_failure(
                provider, reason="Anthropic is unreachable.", status_code=503
            )
        return outage

    def test_one_failure_does_not_move_anyone_off_their_model(self) -> None:
        self.assertIsNone(self._fail(1))
        self.assertFalse(provider_health.is_unhealthy("anthropic"))

    def test_a_run_of_failures_trips_the_cooldown(self) -> None:
        self.assertIsNone(self._fail(provider_health.FAILURES_BEFORE_COOLDOWN - 1))
        outage = self._fail(1)
        self.assertIsNotNone(outage)
        self.assertTrue(provider_health.is_unhealthy("anthropic"))
        self.assertEqual(outage.provider, "anthropic")
        self.assertEqual(outage.consecutive_failures, provider_health.FAILURES_BEFORE_COOLDOWN)
        self.assertGreater(outage.remaining_seconds, 0)

    def test_a_success_clears_the_outage_immediately(self) -> None:
        self._fail(provider_health.FAILURES_BEFORE_COOLDOWN)
        self.assertTrue(provider_health.is_unhealthy("anthropic"))
        provider_health.note_success("anthropic")
        self.assertFalse(
            provider_health.is_unhealthy("anthropic"),
            "recovery is proven by a call that worked, not by waiting out a timer",
        )

    def test_a_success_also_forgets_the_accumulated_backoff(self) -> None:
        self._fail(provider_health.FAILURES_BEFORE_COOLDOWN)
        self._fail(provider_health.FAILURES_BEFORE_COOLDOWN)
        provider_health.note_success("anthropic")
        outage = self._fail(provider_health.FAILURES_BEFORE_COOLDOWN)
        self.assertLessEqual(
            outage.remaining_seconds,
            provider_health.BASE_COOLDOWN_SECONDS,
            "a provider is not punished for an outage that is over",
        )

    def test_repeated_trips_back_off_and_stay_capped(self) -> None:
        seen = []
        for _ in range(8):
            outage = self._fail(provider_health.FAILURES_BEFORE_COOLDOWN)
            seen.append(outage.remaining_seconds)
        self.assertGreater(seen[1], seen[0], "the second outage waits longer than the first")
        self.assertLessEqual(max(seen), provider_health.MAX_COOLDOWN_SECONDS)

    def test_a_non_transient_failure_is_not_counted_at_all(self) -> None:
        for _ in range(10):
            provider_health.note_failure("anthropic", reason="Invalid API key", status_code=401)
        self.assertFalse(
            provider_health.is_unhealthy("anthropic"),
            "a wrong key is not fixed by waiting, so it must not trip a cooldown",
        )

    def test_an_expired_cooldown_reports_healthy_again(self) -> None:
        self._fail(provider_health.FAILURES_BEFORE_COOLDOWN)
        later = time.time() + provider_health.MAX_COOLDOWN_SECONDS + 1
        with patch.object(provider_health.time, "time", return_value=later):
            self.assertFalse(provider_health.is_unhealthy("anthropic"))
            self.assertEqual(provider_health.active_outages(), [])

    def test_providers_are_tracked_apart(self) -> None:
        self._fail(provider_health.FAILURES_BEFORE_COOLDOWN, provider="anthropic")
        self.assertTrue(provider_health.is_unhealthy("anthropic"))
        self.assertFalse(provider_health.is_unhealthy("groq"))
        self.assertEqual([o.provider for o in provider_health.active_outages()], ["anthropic"])


class ResolutionTests(unittest.TestCase):
    """A sick provider must be stepped over the same way an exhausted model is."""

    def setUp(self) -> None:
        provider_health.reset()
        self.addCleanup(provider_health.reset)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(
            os.environ,
            {
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
                "CHATMOCK_HOME": self.tmp.name,
            },
        )
        env.start()
        self.addCleanup(env.stop)
        failover.clear_all()

    def test_a_healthy_default_is_left_alone(self) -> None:
        self.assertFalse(is_unavailable(default_model()))
        self.assertIsNone(active_failover())

    def test_an_unhealthy_provider_makes_its_models_unavailable(self) -> None:
        for _ in range(provider_health.FAILURES_BEFORE_COOLDOWN):
            provider_health.note_failure(
                "anthropic", reason="Anthropic is unreachable.", status_code=503
            )
        self.assertTrue(is_unavailable("anthropic/claude-opus-5"))
        self.assertFalse(is_unavailable("gpt-5.6-sol"))

    def test_the_reported_cause_distinguishes_the_two_reasons(self) -> None:
        preferred = default_model()
        failover.note_exhausted(preferred, reason="plan window spent", seconds=3600)
        state = active_failover()
        self.assertIsNotNone(state)
        self.assertEqual(state["cause"], "quota")
        self.assertEqual(state["reason"], "plan window spent")


if __name__ == "__main__":
    unittest.main()
