import plugins.breadboard as breadboard


def test_open_app_is_registered_against_the_desktop_launcher_route():
    tools = {name: (route, kind) for name, route, kind, _schema in breadboard._TOOLS}
    assert tools["open_app"] == ("/api/hermes/tools/open-app", "open_app")


def test_open_app_raises_the_native_approval_that_yolo_answers():
    decision = breadboard._guard_computer_use("open_app", {"target": "Mendix Studio Pro 11.17.0"})
    assert decision["action"] == "approve"
    assert "Mendix Studio Pro 11.17.0" in decision["message"]
    # One rule per target, so "always allow" for one app never covers another.
    other = breadboard._guard_computer_use("open_app", {"target": "Notepad"})
    assert other["rule_key"] != decision["rule_key"]


def test_open_app_schema_steers_away_from_terminal_launches():
    schema = next(schema for name, _route, _kind, schema in breadboard._TOOLS if name == "open_app")
    text = str(schema)
    assert "terminal_execute_command" in text and "Start-Process" in text
    assert schema["parameters"]["required"] == ["target"]
