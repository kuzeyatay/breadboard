"""Logical-session regressions with real backend/tool dispatch, no native input."""
import json
from collections import Counter

import pytest

from tools.computer_use.cua_backend import CuaDriverBackend
from tools.computer_use import tool

ENDED = 'this session has ended; call start_session explicitly to reuse its label'
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAADUlEQVR4nGNgGAUgAAABCAABgukLHQAAAABJRU5ErkJggg=='

def result(data='', *, error=False, structured=None, image=False):
    return {'isError':error,'data':data,'structuredContent':structured,
            'images':[PNG] if image else [],'image_mime_types':['image/png'] if image else []}

class DriverBoundary:
    """A protocol-level driver: logical expiry is independent of its transport."""
    _started = True
    capabilities_discovered = True

    def __init__(self, backend, expiry='list_windows', times=1):
        self.backend=backend
        self.expiry=expiry
        self.times=times
        self.ended=False
        self.calls=[]
        self.counts=Counter()
        self.start_reply=result('started')
        self.restarted=False
        self.error_text=ENDED
        self.expire_after_click=False
        self.old_screenshot=False

    def supports_capability(self, capability, tool=None):
        return False

    def _has_tool(self, name):
        return self.old_screenshot and name=='screenshot'

    def call_tool(self, name, args, timeout=30):
        self.calls.append((name,dict(args)))
        self.counts[name]+=1
        if name=='start_session':
            assert args=={'session':self.backend._session_id}
            assert self.backend.current_input_target() is None
            assert not self.backend._snapshot_tokens
            if isinstance(self.start_reply,Exception):
                raise self.start_reply
            if self.start_reply.get('isError') is False:
                self.ended=False
                self.restarted=True
            return self.start_reply
        if name==self.expiry and self.times:
            self.times-=1
            self.ended=True
        if self.ended:
            return result(self.error_text,error=True)
        if name=='list_windows':
            return result(structured={'windows':[{'pid':42,'window_id':7,'app_name':'Bambu Studio','title':'Joint test','z_index':1}]})
        if name=='list_apps':
            return result(structured={'apps':[{'name':'Bambu Studio','bundle_id':'com.bambulab.studio','pid':42}]})
        if name in ('get_window_state','screenshot'):
            return result('Bambu Studio - 1 element',image=True,structured={'elements':[
                {'index':0,'role':'Button','label':'Print','bounds':[0,0,2,2],'element_token':'fresh-token'}]})
        if name in ('click','press_key','type_text','set_value'):
            if self.expire_after_click:
                self.ended=True
            return result('input sent',structured={'effect':'unverifiable'})
        raise AssertionError(name)

@pytest.fixture
def setup(monkeypatch):
    backend=CuaDriverBackend()
    backend._active_pid=99
    backend._active_window_id=88
    backend._last_target={'pid':99,'window_id':88}
    backend._last_app='Bambu Studio'
    backend._snapshot_tokens={0:'old-token'}
    backend._target_generation=3
    driver=DriverBoundary(backend)
    backend._session=driver
    monkeypatch.setattr(tool,'_backend',backend)
    tool.clear_input_target_binding()
    yield backend,driver
    tool.clear_input_target_binding()

@pytest.mark.parametrize('action',['list_windows','list_apps'])
def test_read_dispatch_restores_owned_logical_session(setup,action):
    backend,driver=setup
    driver.expiry=action
    out=json.loads(tool.handle_computer_use({'action':action},session_id='test-owner'))
    assert out['count']==1
    assert driver.counts['start_session']==1
    assert driver.counts[action]==2
    assert backend.current_input_target() is None
    assert backend._target_generation>3
    assert not backend._snapshot_tokens
    assert driver._started is True

@pytest.mark.parametrize('expiry',['list_windows','get_window_state','list_apps'])
def test_capture_restarts_whole_observation_once(setup,expiry):
    backend,driver=setup
    driver.expiry=expiry
    # A bundle-ID alias exercises list_apps resolution inside capture.
    app='com.bambulab.studio' if expiry=='list_apps' else 'Bambu Studio'
    capture=backend.capture(mode='ax',app=app)
    assert capture.width==8 and capture.height==8
    assert driver.counts['start_session']==1
    assert driver.counts['list_windows']==2
    assert backend.current_input_target()['pid']==42
    assert backend.current_input_target()['window_id']==7
    assert backend._target_generation>3
    assert 'old-token' not in backend._snapshot_tokens.values()
    assert not any(name in ('click','press_key','type_text') for name,_ in driver.calls)

def test_legacy_screenshot_expiry_restores_without_input(setup):
    backend,driver=setup
    driver.old_screenshot=True
    driver.expiry='screenshot'
    capture=backend.capture(mode='vision',app='Bambu Studio')
    assert capture.width==8
    assert driver.counts['screenshot']==2
    assert driver.counts['start_session']==1

def test_pure_focus_selection_recovers_without_raising(setup):
    backend,driver=setup
    assert backend.focus_app('Bambu Studio',raise_window=True).ok
    assert [name for name,_ in driver.calls]==['list_windows','start_session','list_windows']
    assert backend.current_input_target()['window_id']==7

@pytest.mark.parametrize('reply',[result('denied',error=True),{},RuntimeError('unavailable')])
def test_failed_or_unacknowledged_start_stays_error(setup,reply):
    backend,driver=setup
    driver.start_reply=reply
    out=json.loads(tool.handle_computer_use({'action':'list_windows'},session_id='test-owner'))
    assert 'error' in out
    assert driver.counts['start_session']==1
    assert driver.counts['list_windows']==1
    assert backend.current_input_target() is None

def test_repeat_expiry_is_bounded_and_disarmed(setup):
    backend,driver=setup
    driver.times=2
    out=json.loads(tool.handle_computer_use({'action':'capture','mode':'ax','app':'Bambu Studio'},session_id='test-owner'))
    assert 'error' in out
    assert driver.counts['start_session']==1
    assert driver.counts['list_windows']==2
    assert backend.current_input_target() is None

@pytest.mark.parametrize('message',['permission denied','this session has ended; approval denied','provider timed out'])
def test_other_errors_are_not_restored_or_hidden(setup,message):
    backend,driver=setup
    driver.expiry='list_apps'
    driver.error_text=message
    out=json.loads(tool.handle_computer_use({'action':'list_apps'},session_id='test-owner'))
    assert 'error' in out
    assert driver.counts['start_session']==0
    assert driver.counts['list_apps']==1

def test_foreign_session_is_never_restored(setup):
    backend,driver=setup
    with pytest.raises(RuntimeError):
        backend._call_capture_tool('list_windows',{'session':'other-owner'})
    assert driver.counts['start_session']==0

@pytest.mark.parametrize('name',['click','press_key','type_text','set_value'])
def test_input_expiry_never_replays_or_restores(setup,name):
    backend,driver=setup
    driver.expiry=name
    action=backend._action(name,{'pid':99,'window_id':88})
    assert not action.ok
    assert driver.counts[name]==1
    assert driver.counts['start_session']==0
    assert backend.current_input_target() is None
    assert not backend._snapshot_tokens

def test_capture_after_recovery_does_not_repeat_input(setup):
    backend,driver=setup
    driver.expiry='never'
    driver.expire_after_click=True
    out=tool._dispatch(backend,'click',{'element':0,'capture_after':True})
    assert driver.counts['click']==1
    assert driver.counts['start_session']==1
    assert driver.counts['get_window_state']==2
    assert backend.current_input_target()['pid']==99
    assert out is not None

def test_working_session_does_not_restart(setup):
    backend,driver=setup
    driver.expiry='never'
    assert backend.list_apps()[0]['pid']==42
    assert driver.counts['start_session']==0
    assert driver.counts['list_apps']==1

def test_restored_same_window_invalidates_pending_input_binding(setup,monkeypatch):
    backend,driver=setup
    backend._active_pid=42
    backend._active_window_id=7
    args={'action':'click','element':0,'delivery_mode':'foreground','bring_to_front':True}
    assert tool.bind_input_target(args,'test-owner')=={'pid':42,'window_id':7}
    # A later observer restores the session while this approval is pending.
    backend.capture(mode='ax',app='Bambu Studio')
    monkeypatch.setattr(tool,'_approval_callback',lambda *_:'approve_once')
    out=json.loads(tool.handle_computer_use(args,session_id='test-owner'))
    assert out['code']=='input_target_changed'
    assert driver.counts['click']==0
    assert driver.counts['start_session']==1
