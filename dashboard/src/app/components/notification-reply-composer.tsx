'use client';

import { lazy, Suspense, useCallback, useLayoutEffect, useRef } from 'react';
import styles from './notification-reply-composer.module.css';

// Keep the input and send action usable while the decorative ring loads.
const MetalSendButton = lazy(() => import('./effects/metal-send-button'));

export interface NotificationReplyDraft {
  text: string;
  choice?: string | null;
}

/** A compact input with the shared chat send button. */
export default function NotificationReplyComposer({ id, value, onChange, onSubmit, label,
  placeholder, canSubmit, sending, sendLabel = 'Send', describedBy, maxLength }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  canSubmit: boolean;
  sending: boolean;
  sendLabel?: string;
  describedBy?: string;
  maxLength?: number;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendDisabled = !canSubmit || sending;
  const resize = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight) || 24;
    const limit = Math.max(lineHeight * 3, Math.min(lineHeight * 10, Math.round(innerHeight * .35)));
    input.style.height = '0px';
    const height = Math.max(lineHeight, input.scrollHeight);
    input.style.height = `${Math.min(height, limit)}px`;
    input.style.overflowY = height > limit ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => { resize(); }, [value, resize]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(input);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [resize]);

  const sendButton = <button type="submit" disabled={sendDisabled} aria-label={sending ? 'Sending…' : sendLabel}
    title={sending ? 'Sending…' : sendLabel} className={styles.send}>
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0-6 6m6-6 6 6" />
    </svg>
  </button>;

  return <div className={styles.composer}
    onPointerDown={event => {
      if (event.button !== 0 || event.defaultPrevented) return;
      const input = inputRef.current;
      if (!input || input.disabled || event.target !== event.currentTarget) return;
      event.preventDefault(); input.focus({ preventScroll: true });
    }}>
    <textarea ref={inputRef} id={id} value={value} rows={1} wrap="soft" maxLength={maxLength}
      disabled={sending} aria-label={label} aria-describedby={describedBy} placeholder={placeholder}
      className={styles.input}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (!sendDisabled) onSubmit();
      }} />
    <Suspense fallback={<div className={styles.sendWrap}>{sendButton}</div>}>
      <MetalSendButton variant="circle" className={styles.sendWrap} disabled={sendDisabled}>
        {sendButton}
      </MetalSendButton>
    </Suspense>
  </div>;
}
