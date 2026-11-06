'use client';

import { useEffect, useRef, useState } from 'react';
import { HoldDictationRecorder, type DictationNotice } from '@/lib/speech/hold-dictation';
import { closeHeldDictationProvider } from '@/lib/speech/dictation-provider-cache';
import { paintDictationLevels, watchDictationLevels } from '@/lib/speech/dictation-levels';
import DictationLiveControl from '@/app/components/dictation-live-control';
import { DictationSession } from '@/lib/speech/dictation-session';
import { requestDictationReply, type DictationScreen } from '@/lib/speech/dictation-reply';

type Bridge = { ready: () => Promise<boolean>; screenContext: (id: number) => Promise<DictationScreen>; report: (notice: DictationNotice) => void; onCommand: (callback: (notice: DictationNotice) => void) => () => void };

export default function DictationPage() {
  const [message, setMessage] = useState('Hold Ctrl + Shift to dictate into the active text field.');
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState<'connecting' | 'transcribing' | null>(null);
  const [drafting, setDrafting] = useState(false);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const bridge = (window as typeof window & { breadboardDictation?: Bridge }).breadboardDictation;
    if (!bridge) return;
    let stopMeter: (() => void) | undefined;
    let activeId: number | undefined, held = false;
    let activeMode: 'dictate' | 'reply' = 'dictate';
    const session = new DictationSession({ report: bridge.report, screen: id => bridge.screenContext(id), reply: requestDictationReply,
      answering: () => { setLoading(null); setDrafting(true); setMessage('Composing a reply for the selected field…'); setRecording(false); },
      recorder: report => new HoldDictationRecorder(report, (next, active) => { setMessage(next); setRecording(active); }, undefined, stream => {
      stopMeter?.(); stopMeter = undefined;
      if (stream) {
        try { stopMeter = watchDictationLevels(stream, rms => paintDictationLevels(bars.current, rms)); }
        catch { /* Meter failure must not interrupt a working recorder. */ }
      }
    }, (id, stage) => {
      if (held && id === activeId && (stage === 'provider-ready' || stage === 'recording-ready')) setLoading(null);
      bridge.report({ type: 'diagnostic', id, message: stage });
    }) });
    const unsubscribe = bridge.onCommand(notice => {
      if (notice.type === 'start' && typeof notice.id === 'number') {
        activeId = notice.id; activeMode = notice.mode ?? 'dictate'; held = true;
        setDrafting(false); setLoading('connecting'); session.start(notice.id, activeMode);
      } else if (notice.type === 'mode' && notice.mode === 'reply' && notice.id === activeId) {
        activeMode = 'reply'; session.promote(notice.id!);
      } else if (notice.type === 'stop' && typeof notice.id === 'number' && notice.id === activeId) {
        held = false; setLoading('transcribing'); setDrafting(false); session.stop(notice.id);
      } else if (notice.type === 'cancel' && (notice.id === undefined || notice.id === activeId)) {
        activeId = undefined; held = false; setLoading(null); setDrafting(false); session.cancel(notice.id); setRecording(false);
      } else if (notice.message) {
        activeId = undefined; held = false; setLoading(null); setDrafting(false); setMessage(notice.message); setRecording(false);
      }
    });
    void bridge.ready()
      .catch(() => setMessage('Dictation could not connect. Restart Breadboard.'));
    const cancel = () => { session.cancel(); void closeHeldDictationProvider(); };
    window.addEventListener('pagehide', cancel);
    return () => { unsubscribe(); cancel(); stopMeter?.(); window.removeEventListener('pagehide', cancel); };
  }, []);
  const loadingLabel = drafting ? 'Drafting reply' : loading === 'transcribing' ? 'Transcribing dictation' : 'Connecting dictation';
  return <main data-cursor-dictation data-recording={recording} role="status" aria-live="polite" aria-label={loading || drafting ? loadingLabel : message}
    style={{ position: 'fixed', inset: 0, zIndex: 2147483647, padding: 8 }}>
    <style>{`html,body{background:transparent!important;overflow:hidden!important}`}</style>
    <DictationLiveControl active cursor loading={Boolean(loading) || drafting} loadingLabel={loadingLabel} levelBarsRef={bars} />
  </main>;
}
