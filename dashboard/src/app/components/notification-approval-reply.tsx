'use client';

import { useRef, useState } from 'react';
import type { NotificationApproval } from '@/lib/chat-notification-inbox';
import { submitPermissionDecision, type PermissionDecision } from './hermes/permission-client';
import styles from './notification-approval-reply.module.css';

const SENT_LABEL: Record<PermissionDecision, string> = {
  once: 'Allowed',
  always: 'Allowed for this chat',
  reject: 'Denied',
};

/**
 * Allow / Deny for a runtime approval card, from a notification: the turn that
 * raised it resumes without anyone opening the chat. Shared by the notification
 * center and the page toast, like the question reply.
 */
export default function NotificationApprovalReply({ approval, onAnswered }: {
  approval: NotificationApproval;
  onAnswered?: () => void;
}) {
  const [sent, setSent] = useState<PermissionDecision | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function decide(decision: PermissionDecision) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await submitPermissionDecision(approval.requestId, approval.sessionId, decision);
      setSent(decision);
      onAnswered?.();
    } catch (failure) {
      inFlight.current = false;
      setError(failure instanceof Error ? failure.message : 'Your choice was not sent. Try again.');
    } finally {
      setSending(false);
    }
  }

  if (sent) return <p className={styles.sent} role="status">{SENT_LABEL[sent]}</p>;

  return <div className={styles.form} role="group" aria-label="Answer this approval">
    {approval.command && <pre className={styles.command}>{approval.command}</pre>}
    <div className={styles.actions}>
      <button type="button" className={`${styles.button} ${styles.allow}`} disabled={sending}
        onClick={() => void decide('once')}>Allow</button>
      {approval.allowSession && <button type="button" className={styles.button} disabled={sending}
        onClick={() => void decide('always')}>Allow for this chat</button>}
      <button type="button" className={styles.button} disabled={sending}
        onClick={() => void decide('reject')}>Deny</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
