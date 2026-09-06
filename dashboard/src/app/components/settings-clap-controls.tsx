'use client';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { clapSnapshot, clapServerSnapshot, gestureSettings, finishClapTest, loadClapControls, pauseClapControls, saveClapAction, saveClapPreferences, setClapTestMode, subscribeClapControls, updateClapRuntime } from '@/lib/speech/clap/client';
import { DEFAULT_SNAP_ACTION, describeClapAction } from '@/lib/profile/clap-action';
import type { ClapPreferences, GestureControl } from '@/lib/speech/clap/preferences';
import { suggestedClapSensitivity } from '@/lib/speech/clap/calibration';
import MicrophonePermissionHelp from './microphone-permission-help';

const statusLabels = { off: 'Off', requesting: 'Requesting microphone permission…', calibrating: 'Measuring ambient sound…', listening: 'Listening', paused: 'Paused for another audio feature, tab, or window', suspended: 'Audio is suspended. Click Retry to resume.', error: 'Microphone needs attention' };
type WorkflowChoice = { id: string; name: string };
export default function SettingsClapControls({ visible = true, control = 'clap' }: { visible?: boolean; control?: GestureControl }) {
  const state = useSyncExternalStore(subscribeClapControls, clapSnapshot, clapServerSnapshot);
  const binding = gestureSettings(state, control);
  const snap = control === 'snap';
  const title = snap ? 'Finger-snap controls' : 'Clap controls';
  const gestureWord = snap ? 'snap' : 'clap';
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowChoice[]>([]);
  const [selectWorkflow, setSelectWorkflow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingPreferences, setPendingPreferences] = useState<ClapPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedWorkflow = binding.action.action.kind === 'workflow' ? binding.action.action : null;
  const id = useId();
  const testMode = (mode: 'actions' | 'test' | 'calibration') => setClapTestMode(mode, id, control);
  useEffect(() => {
    if (!visible) finishClapTest(id);
    return () => { finishClapTest(id); };
  }, [id, visible]);
  useEffect(() => {
    const controller = new AbortController();
    if (!clapSnapshot().loaded) void loadClapControls(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    const list = () => { void navigator.mediaDevices?.enumerateDevices().then(all => { if (!controller.signal.aborted) setDevices(all.filter(d => d.kind === 'audioinput')); }).catch(() => {}); };
    list(); navigator.mediaDevices?.addEventListener('devicechange', list);
    return () => { controller.abort(); navigator.mediaDevices?.removeEventListener('devicechange', list); };
  }, []);
  useEffect(() => {
    if (state.status !== 'listening') return;
    void navigator.mediaDevices?.enumerateDevices().then(all => setDevices(all.filter(d => d.kind === 'audioinput'))).catch(() => {});
  }, [state.status]);
  useEffect(() => {
    if (!selectWorkflow && !savedWorkflow) return;
    const controller = new AbortController();
    void fetch('/api/workflows/local', { signal: controller.signal }).then(async r => {
      const b = await r.json(); if (!r.ok) throw new Error(b.error || 'Saved workflows could not load.'); return b;
    }).then(b => setWorkflows(b.workflows ?? [])).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [selectWorkflow, savedWorkflow]);
  async function save(patch: Partial<ClapPreferences>, active = binding.active) {
    const preferences = { ...binding.preferences, ...patch };
    // Keep the selected value while saving. Resetting a focused range here can
    // emit a second change event that writes the old value back to the server.
    setPendingPreferences(preferences); setSaving(true); setError(null);
    try { await saveClapPreferences(preferences, active, control); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Settings could not save.'); return false; }
    finally { setPendingPreferences(null); setSaving(false); }
  }
  function toggleListening() {
    if (binding.active) {
      pauseClapControls(control);
      void save({ enabled: false }, false);
    } else {
      // Leave this panel's test mode before enabling its saved action.
      finishClapTest(id);
      void save({ enabled: true }, true);
    }
  }
  async function action(kind: string) {
    if (kind === 'snap-default') {
      setSelectWorkflow(false); setSaving(true); setError(null);
      try { await saveClapAction(DEFAULT_SNAP_ACTION, control); } catch (e) { setError(e instanceof Error ? e.message : 'The action could not save.'); } finally { setSaving(false); }
      return;
    }
    if (kind === 'workflow') { setSelectWorkflow(true); return; }
    if (kind !== 'voice' && kind !== 'dictation') return;
    setSelectWorkflow(false); setError(null); setSaving(true);
    try { await saveClapAction({ prompt: kind === 'voice' ? 'Open the voice assistant' : 'Start dictation', action: { kind } }, control); }
    catch (e) { setError(e instanceof Error ? e.message : 'The action could not save.'); }
    finally { setSaving(false); }
  }
  const p = pendingPreferences ?? binding.preferences;
  const testing = state.mode !== 'actions' && state.testControl === control;
  const status = !testing && !binding.active ? 'off' : binding.pauseReason || (state.mode !== 'actions' && !testing) ? 'paused' : state.status;
  const snapDefault = snap && binding.action.action.kind === 'music' && binding.action.action.trackUri === 'spotify:track:4EsRpVBBKiqOZ67DJj0QHF';
  const ambient = (binding.meter?.audioTime ?? 0) < 2200;
  const calibrated = state.mode === 'calibration' && binding.gestures >= 3;
  const suggested = suggestedClapSensitivity(binding.meter?.noise ?? 0, binding.weakestImpulse ?? 0, p.sensitivity);
  return <section id={`${control}-controls`} className="clap-settings neu-surface-raised" aria-labelledby={`${id}-heading`}>
    <header>
      <div><h3 id={`${id}-heading`}>{title}</h3><p>{snap ? 'Use a finger snap as a shortcut. Detection runs locally.' : 'Use a clap gesture as a shortcut. Detection runs locally.'}</p></div>
      <button type="button" role="switch" className="clap-switch" aria-checked={binding.active}
        aria-labelledby={`${id}-heading`} aria-describedby={`${id}-status`} disabled={!state.loaded || saving}
        onClick={toggleListening}><span aria-hidden="true" /></button>
    </header>
    <p id={`${id}-status`} role="status" className={`clap-status${status === 'off' || status === 'listening' ? ' sr-only' : ''}`}>{status === 'paused' && binding.pauseReason ? binding.pauseReason : statusLabels[status]}</p>
    <div className="clap-fields">
      {!snap && <label htmlFor={`${id}-mic`}>Microphone<select id={`${id}-mic`} value={p.deviceId} disabled={saving} onChange={e => void save({ deviceId: e.target.value })}>
        <option value="">System default</option>
        {p.deviceId && !devices.some(d => d.deviceId === p.deviceId) && <option value={p.deviceId}>Saved microphone unavailable — choose another</option>}
        {devices.filter(d => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
      </select></label>}
      <label htmlFor={`${id}-pattern`}>Gesture<select id={`${id}-pattern`} value={p.pattern} disabled={saving} onChange={e => void save({ pattern: e.target.value as 'single' | 'double' })}>
        <option value="double">{snap ? 'Two snaps' : 'Two claps'}</option><option value="single">{snap ? 'One snap' : 'One clap'}</option>
      </select></label>
    </div>
    {snap && <p className="clap-detail">Uses the microphone selected in Clap controls. Each gesture has its own action. Short clicks and taps can resemble snaps; test in your room before use.</p>}
    <label className="clap-sensitivity" htmlFor={`${id}-sensitivity`}>Sensitivity <output>{Math.round(p.sensitivity * 100)}%</output>
      <input id={`${id}-sensitivity`} type="range" min="0" max="100" step="5" value={p.sensitivity * 100} disabled={saving}
        onChange={e => void save({ sensitivity: Number(e.target.value) / 100 })} />
      <span>Lower rejects more sounds. Higher can hear softer {snap ? 'snaps' : 'claps'}.</span>
    </label>
    <label htmlFor={`${id}-action`}>Action<select id={`${id}-action`} disabled={saving} value={snapDefault && !selectWorkflow ? 'snap-default' : selectWorkflow ? 'workflow' : ['voice', 'dictation', 'workflow'].includes(binding.action.action.kind) ? binding.action.action.kind : 'custom'} onChange={e => void action(e.target.value)}>
      {snap && <option value="snap-default">Play Snap by manifest</option>}
      <option value="dictation">Start dictation</option><option value="voice">Open voice conversation</option><option value="workflow">Review a saved workflow</option>
      {!['voice', 'dictation', 'workflow'].includes(binding.action.action.kind) && <option value="custom">{binding.action.action.kind === 'assistant' ? 'AI agent instruction' : 'Saved profile shortcut'}</option>}
    </select></label>
    {(selectWorkflow || binding.action.action.kind === 'workflow') && <label htmlFor={`${id}-workflow`}>Saved workflow<select id={`${id}-workflow`} value={binding.action.action.kind === 'workflow' ? binding.action.action.workflowId : ''} onFocus={() => setSelectWorkflow(true)} disabled={saving} onChange={e => {
      const choice = workflows.find(w => w.id === e.target.value); if (!choice) return;
      setSaving(true); void saveClapAction({ prompt: `Review and run ${choice.name}`, action: { kind: 'workflow', workflowId: choice.id, name: choice.name } }, control)
        .catch(e => setError(e.message)).finally(() => setSaving(false));
    }}><option value="">Choose a workflow…</option>{savedWorkflow && !workflows.some(w => w.id === savedWorkflow.workflowId) && <option value={savedWorkflow.workflowId}>{savedWorkflow.name}</option>}{workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
    <p className="clap-detail">{describeClapAction(binding.action.action)}</p>
    <label className="clap-checkbox"><input type="checkbox" checked={p.resumeOnStartup} disabled={saving} onChange={e => void save({ resumeOnStartup: e.target.checked })} />Resume listening when Breadboard starts</label>
    <div className="clap-parallel-option">
      <div><p id={`${id}-parallel-label`}>Keep listening in parallel</p><p id={`${id}-parallel-hint`} className="clap-detail">Listen during other audio and in background tabs or windows. Playback may trigger your {gestureWord} action.</p></div>
      <button type="button" role="switch" className="clap-switch" aria-checked={p.allowConcurrentListening}
        aria-labelledby={`${id}-parallel-label`} aria-describedby={`${id}-parallel-hint`} disabled={!state.loaded || saving}
        onClick={() => void save({ allowConcurrentListening: !p.allowConcurrentListening })}><span /></button>
    </div>
    <div className="clap-buttons">
      <button type="button" onClick={() => testMode(testing ? 'actions' : 'test')}>{testing ? 'Finish test' : snap ? 'Test snaps' : 'Test claps'}</button>
      <button type="button" onClick={() => testMode('calibration')}>Calibrate</button>
      {(state.status === 'error' || state.status === 'suspended' || (p.enabled && !binding.active)) && <button type="button" onClick={() => { updateClapRuntime(snap ? { snapActive: false } : { active: false }); void save({ enabled: true }, true); }}>Retry microphone</button>}
    </div>
    {testing && <div className="clap-test" aria-live="polite">
      <strong>{state.mode === 'test' ? 'Test mode — actions are off' : calibrated ? 'Calibration complete' : ambient ? 'Stay quiet for two seconds' : `Make ${p.pattern === 'double' ? `two quick ${gestureWord}s` : `one ${gestureWord}`}, three times`}</strong>
      <p>{calibrated ? `Suggested sensitivity: ${Math.round(suggested * 100)}%, based on the room and your quietest detected ${gestureWord}. Test it again after saving.` : state.mode === 'calibration' ? `${binding.gestures}/3 gestures. Leave two seconds between gestures. If one is missed, raise sensitivity and try again.` : `${binding.gestures} gesture${binding.gestures === 1 ? '' : 's'} detected. No action will run.`}</p>
      <meter aria-label="Microphone sound level" min={0} max={0.15} value={binding.meter?.rms ?? 0} />
      <p className="clap-detail">{binding.meter ? `Signal: ${binding.meter.diagnostic.replaceAll('-', ' ')} · ${binding.meter.accepted} accepted impulses` : 'Waiting for microphone audio…'}</p>
      {calibrated && <button type="button" disabled={saving} onClick={() => { void save({ sensitivity: suggested }).then(saved => { if (saved) testMode('test'); }); }}>Use suggested sensitivity</button>}
    </div>}
    {state.fix && (binding.active || testing) && <MicrophonePermissionHelp fix={state.fix} onRetry={() => { updateClapRuntime(snap ? { snapActive: false } : { active: false }); void save({ enabled: true }, true); }} />}
    {(error || state.issue) && <p role="alert" className="clap-error">{error || state.issue}</p>}
    <p className="clap-detail">Ambient sound stays in local memory and is never recorded or uploaded. Your chosen speech or workflow action uses its usual services. {p.allowConcurrentListening ? 'Parallel listening stays on while Breadboard is running. Device sleep or browser suspension can still pause it.' : 'Listening pauses for recording, voice playback, inactive tabs, and minimized windows.'}</p>
  </section>;
}
