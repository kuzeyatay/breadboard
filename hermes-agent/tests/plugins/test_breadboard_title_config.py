"""Embedded titles remain canonical without an auxiliary model request."""

import os
from pathlib import Path
from unittest.mock import Mock, patch

from agent.title_generator import generate_title, maybe_auto_title


def test_disabled_auxiliary_title_uses_real_isolated_profile_and_never_calls_model():
    home = Path(os.environ["HERMES_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text("auxiliary:\n  title_generation:\n    enabled: false\n", encoding="utf-8")
    db = Mock()
    db.get_session_title.return_value = None
    with patch("agent.title_generator.call_llm") as llm, patch("agent.title_generator.threading.Thread") as thread:
        assert generate_title("Explain Gauss's law", "Here is the explanation.") is None
        maybe_auto_title(db, "breadboard-session", "Explain Gauss's law", "Here is the explanation.",
                         [{"role": "user", "content": "Explain Gauss's law"}])
    llm.assert_not_called()
    thread.assert_not_called()
    db.set_session_title.assert_not_called()
