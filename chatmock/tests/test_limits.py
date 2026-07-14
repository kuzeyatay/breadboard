import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import patch

from chatmock.cli import (
    _limit_window_label,
    _print_usage_limits_block,
    _visible_limit_windows,
)
from chatmock.limits import RateLimitSnapshot, RateLimitWindow, StoredRateLimitSnapshot


def _window(minutes: int | None, used: float = 0.0) -> RateLimitWindow:
    return RateLimitWindow(
        used_percent=used,
        window_minutes=minutes,
        resets_in_seconds=0,
    )


class UsageLimitDisplayTests(unittest.TestCase):
    def test_limit_labels_follow_actual_window_length(self) -> None:
        self.assertEqual(_limit_window_label(_window(300), "fallback"), "5-hour limit")
        self.assertEqual(_limit_window_label(_window(10_080), "fallback"), "Weekly limit")
        self.assertEqual(_limit_window_label(_window(1_440), "fallback"), "Daily limit")

    def test_zero_length_placeholders_are_hidden(self) -> None:
        windows = [
            ("primary", "Primary limit", _window(10_080, 24.0)),
            ("secondary", "Secondary limit", _window(0)),
        ]

        visible = _visible_limit_windows(windows)

        self.assertEqual(
            [(label, window.window_minutes) for _, label, window in visible],
            [("Weekly limit", 10_080)],
        )

    def test_real_windows_are_sorted_shortest_first(self) -> None:
        windows = [
            ("primary", "Primary limit", _window(10_080)),
            ("secondary", "Secondary limit", _window(300)),
        ]

        visible = _visible_limit_windows(windows)

        self.assertEqual(
            [label for _, label, _ in visible],
            ["5-hour limit", "Weekly limit"],
        )

    @patch("chatmock.cli.load_rate_limit_snapshot")
    def test_cli_shows_unreported_five_hour_row(self, load_snapshot) -> None:
        load_snapshot.return_value = StoredRateLimitSnapshot(
            captured_at=datetime(2026, 7, 14, tzinfo=timezone.utc),
            snapshot=RateLimitSnapshot(
                primary=_window(10_080, 24.0),
                secondary=_window(0),
            ),
        )
        output = StringIO()

        with redirect_stdout(output):
            _print_usage_limits_block()

        rendered = output.getvalue()
        self.assertIn("5-hour limit", rendered)
        self.assertIn("Not reported in the latest response", rendered)
        self.assertIn("Weekly limit", rendered)


if __name__ == "__main__":
    unittest.main()
