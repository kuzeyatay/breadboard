"""A setting acknowledged during construction must reach the published agent."""
import threading
from types import SimpleNamespace

import pytest

from hermes_constants import parse_reasoning_effort
import tui_gateway.server as server


@pytest.fixture
def building_session(monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    captured = {}
    session = {
        "agent": None,
        "agent_ready": threading.Event(),
        "session_key": "voice-build-race",
        "create_reasoning_override": parse_reasoning_effort("high"),
        "model_override": {"model": "selected-model", "provider": "selected-provider"},
    }

    def make_agent(_sid, _key, **kwargs):
        captured.update(kwargs)
        entered.set()
        assert release.wait(10), "test did not release construction"
        return SimpleNamespace(
            model="selected-model",
            provider="selected-provider",
            reasoning_config=kwargs.get("reasoning_config_override"),
            session_id="voice-test-session",
            api_mode=captured.get("api_mode"),
            client=captured.get("client"),
        )

    monkeypatch.setitem(server._sessions, "voice-test", session)
    monkeypatch.setattr(server, "_make_agent", make_agent)
    monkeypatch.setattr(server, "_set_session_context", lambda *_: [])
    monkeypatch.setattr(server, "_clear_session_context", lambda *_: None)
    for name in (
        "_attach_worker", "_wire_callbacks", "_emit", "_start_notification_poller",
        "_notify_session_boundary", "_schedule_mcp_late_refresh", "_persist_live_session_runtime",
    ):
        monkeypatch.setattr(server, name, lambda *a, **k: None)
    monkeypatch.setattr(server, "_SlashWorker", lambda *a, **k: None)
    monkeypatch.setattr(server, "_config_model_target", lambda: "selected-model")
    monkeypatch.setattr(server, "_resolve_model", lambda: "selected-model")
    monkeypatch.setattr(server, "_session_info", lambda *a: {})
    monkeypatch.setattr(server, "_probe_config_health", lambda *a: None)
    monkeypatch.setattr(server, "_load_cfg", lambda: {})
    monkeypatch.setattr(server, "_load_memory_notifications", lambda: False)
    monkeypatch.setattr(server, "_write_config_key", lambda *a: None)
    import tools.approval as approval
    monkeypatch.setattr(approval, "register_gateway_notify", lambda *a: None)
    monkeypatch.setattr(approval, "load_permanent_allowlist", lambda: None)
    import agent.credits_tracker as credits
    monkeypatch.setattr(credits, "seed_credits_at_session_start", lambda *a: None)
    server._start_agent_build("voice-test", session)
    assert entered.wait(10), "construction did not begin"
    try:
        yield session, captured, release
    finally:
        release.set()
        assert session["agent_ready"].wait(10), "construction did not finish"


def change(value, scope="session"):
    result = server._methods["config.set"]("voice-setting", {
        "session_id": "voice-test", "key": "reasoning", "value": value, "scope": scope,
    })
    assert result.get("result", {}).get("value") == value, result


@pytest.mark.parametrize("scope", ["session", "global"])
@pytest.mark.parametrize("values", [("none",), ("none", "low"), ("low", "none")])
def test_acknowledged_setting_survives_build(building_session, values, scope):
    session, captured, release = building_session
    # The constructor has already snapshotted High. Updating the setting must
    # return without waiting for that slow constructor, then win at publication.
    assert captured["reasoning_config_override"]["effort"] == "high"
    for value in values:
        change(value, scope)
    release.set()
    assert session["agent_ready"].wait(10)
    assert not session.get("agent_error"), session.get("agent_error")
    agent = session["agent"]
    assert agent.reasoning_config == parse_reasoning_effort(values[-1])
    assert agent.model == "selected-model"
    assert agent.provider == "selected-provider"
    if scope == "global":
        assert "create_reasoning_override" not in session
    else:
        assert session["create_reasoning_override"] == agent.reasoning_config
    # Changes after publication must still update the same agent.
    change("high")
    assert session["agent"] is agent
    assert agent.reasoning_config == parse_reasoning_effort("high")


def test_unchanged_build_retains_selected_effort(building_session):
    session, captured, release = building_session
    release.set()
    assert session["agent_ready"].wait(10)
    assert not session.get("agent_error"), session.get("agent_error")
    assert session["agent"].reasoning_config == captured["reasoning_config_override"]

def test_background_build_prepares_real_sdk_without_provider_requests(building_session):
    import httpx
    from openai import OpenAI

    session, captured, release = building_session
    requests = []
    transport = httpx.MockTransport(lambda request: requests.append(request) or httpx.Response(503))
    with OpenAI(api_key="offline-fixture", base_url="http://127.0.0.1:9/v1", http_client=httpx.Client(transport=transport)) as client:
        captured["api_mode"] = "chat_completions"
        captured["client"] = client
        assert "chat" not in vars(client)
        release.set()
        assert session["agent_ready"].wait(10)
        assert not session.get("agent_error"), session.get("agent_error")
        # Both cached resources must already exist when initialization signals
        # ready; looking them up here would hide lazy first-request work.
        chat = vars(client).get("chat")
        assert chat is not None, "SDK imports were left on the first spoken request"
        assert vars(chat).get("completions") is not None
        assert requests == [], "preparation must not contact or charge a provider"
        assert session["agent"].client is client
        assert not client.is_closed(), "the published agent retains its healthy primary client"


def test_other_model_transports_are_untouched_by_preparation(building_session):
    class OtherClient:
        @property
        def chat(self):
            raise AssertionError("A different transport must not load chat resources")

    session, captured, release = building_session
    client = OtherClient()
    captured["api_mode"] = "codex_responses"
    captured["client"] = client
    release.set()
    assert session["agent_ready"].wait(10)
    assert not session.get("agent_error"), session.get("agent_error")
    assert session["agent"].client is client


def test_optional_sdk_preparation_failure_does_not_poison_session(building_session, monkeypatch):
    import httpx
    from openai import OpenAI

    session, captured, release = building_session
    with OpenAI(api_key="offline-fixture", base_url="http://127.0.0.1:9/v1", http_client=httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503)))) as client:
        def unavailable(_):
            raise RuntimeError("Optional resource import is unavailable")

        monkeypatch.setattr(OpenAI, "chat", property(unavailable))
        captured["api_mode"] = "chat_completions"
        captured["client"] = client
        release.set()
        assert session["agent_ready"].wait(10)
        assert not session.get("agent_error"), session.get("agent_error")
        assert session["agent"].client is client
