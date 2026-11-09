"""Breadboard keeps foreground input behind an invocation-scoped approval."""
import json
import pytest
import plugins.breadboard as breadboard


@pytest.mark.parametrize('action', ['capture', 'wait', 'list_apps', 'list_windows'])
def test_read_only_computer_use_does_not_request_approval(action):
    assert breadboard._guard_computer_use(tool_name='computer_use', args={'action': action}) is None


@pytest.mark.parametrize('action', [
    'click', 'double_click', 'right_click', 'middle_click', 'drag',
    'scroll', 'type', 'key', 'set_value', 'focus_app',
])
@pytest.mark.parametrize('mode', [None, 'background'])
def test_mutating_background_computer_use_requires_scoped_approval(action, mode):
    args = {'action': action, 'delivery_mode': mode, 'text': 'private value'}
    result = breadboard._guard_computer_use(tool_name='computer_use', args=args)
    assert result['action'] == 'approve'
    assert result['rule_key'] == f'breadboard-computer-use:{action}:background'
    assert 'background' in result['message']
    assert 'private value' not in result['message']


@pytest.mark.parametrize('args', [
    {'action': 'click', 'delivery_mode': 'foreground'},
    {'action': 'click', 'bring_to_front': True},
    {'action': 'focus_app', 'raise_window': True},
    {'action': 'key', 'delivery_mode': 'background', 'bring_to_front': True},
])
def test_foreground_requires_a_distinct_approval(args):
    result = breadboard._guard_computer_use(tool_name='computer_use', args=args)
    assert result['action'] == 'approve'
    assert f":{args['action']}:foreground:" in result['rule_key']
    assert 'mouse or keyboard' in result['message']


@pytest.mark.parametrize('mode', ['surprise', '', 'Foreground', False, 1, [], {}])
def test_unknown_delivery_is_blocked(mode):
    assert breadboard._guard_computer_use(
        tool_name='computer_use', args={'action': 'click', 'delivery_mode': mode},
    )['action'] == 'block'


@pytest.mark.parametrize('action', ['capture', 'list_windows', 'not-an-action'])
def test_foreground_flags_cannot_turn_read_only_or_unknown_actions_into_input(action):
    assert breadboard._guard_computer_use(
        tool_name='computer_use', args={'action': action, 'bring_to_front': True},
    )['action'] == 'block'


def test_foreground_approval_does_not_carry_to_other_invocations_or_targets():
    args = {'action': 'type', 'delivery_mode': 'foreground', 'text': 'private value', 'app': 'test-app'}
    context = {'session_id': 's', 'task_id': 't', 'turn_id': 'turn', 'tool_call_id': 'call'}
    def key(values=args, **changes):
        return breadboard._guard_computer_use(
            tool_name='computer_use', args=values, **(context | changes),
        )['rule_key']
    original = key()
    assert original == key()
    for field in context:
        assert original != key(**{field: 'different'})
    for field, value in [('app', 'other-app'), ('text', 'different value')]:
        assert original != key(args | {field: value})
    assert 'private value' not in original
    assert key(tool_call_id='') != key(tool_call_id='')


def test_other_tools_are_untouched():
    assert breadboard._guard_computer_use(tool_name='terminal_execute_command', args={'action': 'click'}) is None


def test_register_installs_the_computer_use_guard_hook():
    hooks = {}
    class Context:
        def register_hook(self, name, callback):
            hooks[name] = callback
        def register_tool(self, **kwargs):
            pass
    breadboard.register(Context())
    assert hooks == {'pre_tool_call': breadboard._guard_computer_use}


@pytest.fixture
def dispatch(monkeypatch):
    # Exercise the real dispatcher, plugin resolver, approval queue and computer
    # tool. Only the external desktop is replaced with its shipped noop backend.
    import model_tools
    from hermes_cli import plugins
    from tools import approval
    from tools.computer_use import tool
    from tools.registry import registry
    manager = plugins.PluginManager()
    context = plugins.PluginContext(plugins.PluginManifest(name='breadboard'), manager)
    context.register_hook('pre_tool_call', breadboard._guard_computer_use)
    monkeypatch.setattr(plugins, '_plugin_manager', manager)
    monkeypatch.setenv('HERMES_GATEWAY_SESSION', '1')
    monkeypatch.setattr(approval, '_permanent_approved', set())
    token = approval.set_current_session_key('guard-test-session')
    tool.reset_backend_for_tests()
    backend = tool._NoopBackend()
    backend.start()
    monkeypatch.setattr(tool, '_backend', backend)
    registry.register(name='computer_use', toolset='computer_use',
                      schema=tool.get_computer_use_schema(), handler=tool.handle_computer_use)
    calls = []
    def run(choice, args=None, before_decision=None, **changes):
        def notify(data):
            calls.append(data)
            if before_decision:
                before_decision()
            if choice == 'error':
                raise RuntimeError('approval transport failed')
            assert approval.resolve_gateway_approval('guard-test-session', choice) == 1
        approval.register_gateway_notify('guard-test-session', notify)
        context = {'session_id': 'guard-test-session', 'task_id': 'task', 'turn_id': 'turn', 'tool_call_id': 'call'} | changes
        result = model_tools.handle_function_call(
            'computer_use', args or {'action': 'key', 'keys': 'CTRL+O', 'delivery_mode': 'foreground'},
            **context,
        )
        return json.loads(result)
    yield run, calls, backend, approval
    approval.unregister_gateway_notify('guard-test-session')
    approval.clear_session('guard-test-session')
    approval.reset_current_session_key(token)
    tool.reset_backend_for_tests()


@pytest.mark.parametrize('choice', ['once', 'deny', 'error'])
def test_foreground_dispatch_requires_successful_normal_approval(dispatch, choice):
    run, prompts, backend, _ = dispatch
    result = run(choice)
    assert len(prompts) == 1
    assert ':foreground:' in prompts[0]['pattern_key']
    assert bool(backend.calls) == (choice == 'once')
    if choice == 'once':
        assert 'error' not in result
        assert backend.calls[0][1]['delivery_mode'] == 'foreground'
    else:
        assert 'BLOCKED' in result['error']


def test_saved_background_approval_never_grants_foreground(dispatch):
    run, prompts, backend, approval = dispatch
    approval.approve_session('guard-test-session', 'plugin_rule:breadboard-computer-use:key:background')
    result = run('deny')
    assert len(prompts) == 1
    assert 'denied' in result['error']
    assert backend.calls == []


def test_foreground_session_choice_does_not_grant_the_next_call(dispatch):
    run, prompts, backend, _ = dispatch
    run('session')
    result = run('deny', tool_call_id='next-call')
    assert len(prompts) == 2
    assert len(backend.calls) == 1
    assert 'denied' in result['error']


def test_invalid_mode_never_reaches_approval_or_backend(dispatch):
    run, prompts, backend, _ = dispatch
    result = run('once', {'action': 'click', 'delivery_mode': 'invalid'})
    assert 'error' in result
    assert prompts == []
    assert backend.calls == []


def test_normal_approval_does_not_bypass_destructive_key_block(dispatch):
    run, prompts, backend, _ = dispatch
    result = run('once', {'action': 'key', 'keys': 'WIN+L', 'delivery_mode': 'foreground'})
    assert 'blocked key combo' in result['error']
    assert backend.calls == []


def select_target(monkeypatch, backend, pid=101, window_id=202):
    state = {'pid': pid, 'window_id': window_id, 'generation': 1}
    monkeypatch.setattr(backend, 'current_input_target', lambda: dict(state), raising=False)
    return state


def test_explicit_session_choice_reuses_same_target_and_user_turn(dispatch, monkeypatch):
    run, prompts, backend, _ = dispatch
    state = select_target(monkeypatch, backend)
    run('session')
    # A fresh capture of the same native window does not broaden the grant.
    state['generation'] += 1
    result = run('deny', {'action': 'key', 'keys': 'ENTER', 'delivery_mode': 'foreground'}, tool_call_id='second')
    assert 'error' not in result
    assert len(prompts) == 1
    assert len(backend.calls) == 2


def test_once_does_not_reuse_even_in_same_target_and_turn(dispatch, monkeypatch):
    run, prompts, backend, _ = dispatch
    select_target(monkeypatch, backend)
    run('once')
    result = run('deny', tool_call_id='second')
    assert 'denied' in result['error']
    assert len(prompts) == 2
    assert len(backend.calls) == 1


@pytest.mark.parametrize('change', ['turn_id', 'task_id', 'session_id', 'pid', 'window_id', 'action'])
def test_session_choice_cannot_cross_scope_boundaries(dispatch, monkeypatch, change):
    run, prompts, backend, _ = dispatch
    state = select_target(monkeypatch, backend)
    run('session')
    context = {'tool_call_id': 'second'}
    args = None
    if change in ('pid', 'window_id'):
        state[change] += 1
        state['generation'] += 1
    elif change == 'action':
        args = {'action': 'click', 'coordinate': [1, 2], 'delivery_mode': 'foreground'}
    else:
        context[change] = 'different'
    result = run('deny', args, **context)
    assert 'denied' in result['error']
    assert len(prompts) == 2
    assert len(backend.calls) == 1


def test_model_target_labels_cannot_spoof_backend_target(dispatch, monkeypatch):
    run, prompts, backend, _ = dispatch
    state = select_target(monkeypatch, backend)
    args = {'action': 'key', 'keys': 'ENTER', 'delivery_mode': 'foreground', 'app': 'original', 'pid': 101, 'window_id': 202}
    run('session', args)
    state.update(pid=999, window_id=888, generation=2)
    result = run('deny', args, tool_call_id='second')
    assert 'denied' in result['error']
    assert len(prompts) == 2
    assert len(backend.calls) == 1


@pytest.mark.parametrize('return_to_original', [False, True])
def test_retarget_during_approval_blocks_before_input(dispatch, monkeypatch, return_to_original):
    run, prompts, backend, _ = dispatch
    state = select_target(monkeypatch, backend)
    def retarget():
        state.update(pid=303, window_id=404, generation=2)
        if return_to_original:
            state.update(pid=101, window_id=202, generation=3)
    result = run('once', before_decision=retarget)
    assert result['code'] == 'input_target_changed'
    assert backend.calls == []
    # Binding was consumed: the next correctly approved action can proceed.
    result = run('once', tool_call_id='second')
    assert 'error' not in result
    assert len(backend.calls) == 1


@pytest.mark.parametrize('outcome', ['deny', 'error'])
def test_failed_approval_binding_cannot_leak_into_next_action(dispatch, monkeypatch, outcome):
    run, prompts, backend, _ = dispatch
    state = select_target(monkeypatch, backend)
    run(outcome)
    assert backend.calls == []
    state.update(pid=303, window_id=404, generation=2)
    result = run('once', tool_call_id='second')
    assert 'error' not in result
    assert len(backend.calls) == 1


def test_focus_target_changes_stay_per_invocation(dispatch, monkeypatch):
    run, prompts, backend, _ = dispatch
    select_target(monkeypatch, backend)
    args = {'action': 'focus_app', 'app': 'test-app', 'raise_window': True}
    run('session', args)
    result = run('deny', args, tool_call_id='second')
    assert 'denied' in result['error']
    assert len(prompts) == 2


def test_native_target_getter_does_not_start_or_create_backend(monkeypatch):
    from tools.computer_use import tool
    monkeypatch.setattr(tool, '_backend', None)
    def unexpected():
        pytest.fail('read-only target lookup must not start a backend')
    monkeypatch.setattr(tool, '_get_backend', unexpected)
    assert tool.current_input_target() is None
    assert tool.bind_input_target({'action': 'key'}, 'test') is None


def test_native_cua_target_identity_and_selection_generation():
    from tools.computer_use.cua_backend import CuaDriverBackend
    backend = CuaDriverBackend.__new__(CuaDriverBackend)
    backend._target_generation = 0
    backend._clear_active_target()
    assert backend.current_input_target() is None
    backend._load_windows = lambda: [
        {'app_name': 'test-app', 'pid': 101, 'window_id': 202, 'title': 'test'},
    ]
    assert backend.focus_app('test-app').ok
    first = backend.current_input_target()
    assert first['pid'] == 101 and first['window_id'] == 202
    backend.focus_app('test-app')
    assert backend.current_input_target()['generation'] > first['generation']
    backend._clear_active_target()
    assert backend.current_input_target() is None


def test_desktop_capture_and_input_are_sequential_dispatch_barriers():
    from agent.tool_dispatch_helpers import _plan_tool_batch_segments
    from types import SimpleNamespace
    calls = [SimpleNamespace(function=SimpleNamespace(name='computer_use', arguments=json.dumps({'action': action})))
             for action in ('capture', 'key', 'capture', 'click')]
    assert _plan_tool_batch_segments(calls) == [('sequential', calls)]
