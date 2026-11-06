'use client';

import { useId, useRef, useState } from 'react';
import type { NotificationClarification } from '@/lib/chat-notification-inbox';
import { submitClarificationAnswer } from './hermes/permission-client';
import NotificationReplyComposer, { type NotificationReplyDraft } from './notification-reply-composer';
import styles from './notification-question-reply.module.css';

/** Shared by page banners, the desktop overlay and notification history. */
export default function NotificationQuestionReply({ clarification, onAnswered, onSubmitReply, initialDraft, initialError }: {
  clarification: NotificationClarification;
  onAnswered?: () => void;
  onSubmitReply?: (draft: NotificationReplyDraft) => void;
  initialDraft?: NotificationReplyDraft;
  initialError?: string;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string | null>(initialDraft?.choice ?? null);
  const [answer, setAnswer] = useState(initialDraft?.text ?? '');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const inFlight = useRef(false);
  const message = answer.trim() || selected || '';

  async function submit() {
    if (!message || inFlight.current) return;
    inFlight.current = true;
    if (onSubmitReply) {
      onSubmitReply({ text: answer, choice: selected });
      return;
    }
    setStatus('sending');
    setError(null);
    try {
      await submitClarificationAnswer(clarification.requestId, clarification.sessionId, message);
      setStatus('sent');
      onAnswered?.();
    } catch (failure) {
      inFlight.current = false;
      setStatus('idle');
      setError(failure instanceof Error ? failure.message : 'The answer could not be sent. Try again.');
    }
  }

  if (status !== 'idle') return <p className={styles.sent} role="status">
    {status === 'sent' ? 'Answer sent' : 'Sending answer…'}
  </p>;

  return <form className={styles.form} aria-label="Answer this question"
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>{clarification.choices.length ? 'Choose an option or write an answer' : 'Your answer'}</legend>
      {clarification.choices.length > 0 && <div className={styles.choices}>
        {clarification.choices.map((choice, index) => <label key={`${index}:${choice}`} className={styles.choice}>
          <input type="radio" name={`${id}-choice`} value={choice} checked={selected === choice}
            onChange={() => { setSelected(choice); setAnswer(''); }} />
          <span>{choice}</span>
        </label>)}
      </div>}
      <NotificationReplyComposer id={`${id}-answer`} value={answer} maxLength={20_000}
        label={clarification.choices.length ? 'Or write your own answer' : 'Write your answer'}
        placeholder="Type your answer…" describedBy={error ? `${id}-error` : undefined}
        onChange={value => { setAnswer(value); setSelected(null); }} onSubmit={() => void submit()}
        canSubmit={Boolean(message)} sending={false} sendLabel="Send answer" />
    </fieldset>
    {error && <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
  </form>;
}
