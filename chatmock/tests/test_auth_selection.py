from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from chatmock.utils import load_chatgpt_tokens, read_auth_file


def _write_auth(home: Path, marker: str, last_refresh: str) -> Path:
    home.mkdir(parents=True, exist_ok=True)
    path = home / "auth.json"
    path.write_text(
        json.dumps(
            {
                "marker": marker,
                "last_refresh": last_refresh,
                "tokens": {
                    "access_token": f"access-{marker}",
                    "id_token": f"id-{marker}",
                    "refresh_token": f"refresh-{marker}",
                    "account_id": f"account-{marker}",
                },
            }
        ),
        encoding="utf-8",
    )
    return path


class AuthFileSelectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        root = Path(self.tempdir.name)
        self.chatgpt_home = root / ".chatgpt-local"
        self.codex_home = root / ".codex"

    def _expanduser(self, value: str) -> str:
        if value == "~/.chatgpt-local":
            return str(self.chatgpt_home)
        if value == "~/.codex":
            return str(self.codex_home)
        return value

    def _default_environment(self):
        return patch.dict(
            os.environ,
            {"CHATGPT_LOCAL_HOME": "", "CODEX_HOME": ""},
        )

    def test_default_profiles_select_the_most_recent_sign_in(self) -> None:
        _write_auth(self.chatgpt_home, "old", "2026-07-18T10:00:00Z")
        _write_auth(self.codex_home, "new", "2026-07-20T10:00:00Z")

        with self._default_environment(), patch(
            "chatmock.utils.os.path.expanduser", side_effect=self._expanduser
        ):
            auth = read_auth_file()

        self.assertIsNotNone(auth)
        self.assertEqual(auth["marker"], "new")

    def test_explicit_chatgpt_home_remains_authoritative(self) -> None:
        _write_auth(self.chatgpt_home, "explicit", "2026-07-18T10:00:00Z")
        _write_auth(self.codex_home, "newer-default", "2026-07-20T10:00:00Z")

        with patch.dict(
            os.environ,
            {"CHATGPT_LOCAL_HOME": str(self.chatgpt_home), "CODEX_HOME": ""},
        ), patch("chatmock.utils.os.path.expanduser", side_effect=self._expanduser):
            auth = read_auth_file()

        self.assertIsNotNone(auth)
        self.assertEqual(auth["marker"], "explicit")

    def test_malformed_default_profile_falls_back_to_readable_profile(self) -> None:
        self.chatgpt_home.mkdir(parents=True)
        (self.chatgpt_home / "auth.json").write_text("not json", encoding="utf-8")
        _write_auth(self.codex_home, "valid", "2026-07-20T10:00:00Z")

        with self._default_environment(), patch(
            "chatmock.utils.os.path.expanduser", side_effect=self._expanduser
        ):
            auth = read_auth_file()

        self.assertIsNotNone(auth)
        self.assertEqual(auth["marker"], "valid")

    def test_refreshed_tokens_are_persisted_to_the_selected_profile(self) -> None:
        old_path = _write_auth(
            self.chatgpt_home, "old", "2026-07-18T10:00:00Z"
        )
        selected_path = _write_auth(
            self.codex_home, "selected", "2026-07-20T10:00:00Z"
        )
        refreshed = {
            "access_token": "access-refreshed",
            "id_token": "id-refreshed",
            "refresh_token": "refresh-refreshed",
            "account_id": "account-refreshed",
        }

        with self._default_environment(), patch(
            "chatmock.utils.os.path.expanduser", side_effect=self._expanduser
        ), patch("chatmock.utils._should_refresh_access_token", return_value=True), patch(
            "chatmock.utils._refresh_chatgpt_tokens", return_value=refreshed
        ):
            access_token, account_id, id_token = load_chatgpt_tokens()

        self.assertEqual(access_token, "access-refreshed")
        self.assertEqual(account_id, "account-refreshed")
        self.assertEqual(id_token, "id-refreshed")
        self.assertEqual(
            json.loads(selected_path.read_text(encoding="utf-8"))["tokens"],
            refreshed,
        )
        self.assertEqual(
            json.loads(old_path.read_text(encoding="utf-8"))["tokens"][
                "access_token"
            ],
            "access-old",
        )


if __name__ == "__main__":
    unittest.main()
