'use client';

// The goal card that sits on top of the composer whenever this conversation is
// under a goal.
//
// A goal outlives the turn that created it, which is exactly what makes it easy
// to forget one is running. The card is the standing reminder: the objective,
// how long it has been open, and the three things only the person may do about
// it — abandon it, hold it, or push it forward. The model's one lever,
// completion, is deliberately not here; it has to be earned through the audited
// tool.

import { useCallback, useEffect, useRef, useState } from 'react';

export type GoalCardStatus =
  | 'active'
  | 'paused'
  | 'budget_limited'
  | 'complete';

export interface GoalCardState {
  goalId: string;
  objective: string;
  status: GoalCardStatus;
  turnBudget: number | null;
  turnsUsed: number;
  remainingTurns: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  sessionId: string | number;
  /** Refetch whenever the run state changes — a finished turn moves the counters. */
  refreshKey?: unknown;
  /** A turn is in flight right now, which is what separates running from stalled. */
  running?: boolean;
  /**
   * Push the goal forward with no typing. The host owns the composer draft, so
   * it decides what "continue" sends; the card only asks. Absent means the
   * surface cannot start a turn on its own and the button stays out of reach.
   */
  onContinue?: () => void;
  /** A draft is waiting in the composer, so continuing would talk over it. */
  continueBlocked?: boolean;
}

/** "2d 4h 39m 6s" — the leading zero units are dropped, seconds always shown. */
function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds % 60}s`);
  return parts.join(' ');
}

function statusLabel(status: GoalCardStatus): string {
  if (status === 'complete') return 'Goal complete';
  if (status === 'paused') return 'Goal paused';
  if (status === 'budget_limited') return 'Goal out of turns';
  return 'Pursuing goal';
}

/**
 * Complete is the only state that earns the accent. An active goal remains a
 * pursuit between turns, so it reads in ordinary ink while the play or pause
 * button says whether work is in flight right now.
 */
function statusTone(status: GoalCardStatus): string {
  if (status === 'complete') return 'text-[var(--botanical)]';
  if (status === 'paused') return 'text-[var(--ink-muted)]';
  if (status === 'budget_limited') return 'text-[var(--danger)]';
  return 'text-[var(--ink)]';
}

function GoalIcon({ status }: { status: GoalCardStatus }) {
  if (status === 'complete') {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    );
  }
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ICON_BUTTON =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-40';

export default function GoalCard({
  sessionId,
  refreshKey,
  running = false,
  onContinue,
  continueBlocked = false,
}: Props) {
  const [goal, setGoal] = useState<GoalCardState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [budgetDraft, setBudgetDraft] = useState('');
  const endpoint = `/api/hermes/sessions/${encodeURIComponent(String(sessionId))}/goal`;
  // Read inside the callbacks rather than in their dependency lists: the
  // endpoint is derived from a prop that changes only when the conversation
  // does, and re-creating every handler on each poll would churn the row.
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((payload: { goal?: GoalCardState | null } | null) => {
        if (!payload) return;
        setGoal(payload.goal ?? null);
        setError(null);
      })
      .catch((cause: unknown) => {
        // An aborted read is this effect being replaced, not a failure. Any
        // other failure leaves the last known goal on screen: a card that
        // vanishes on one bad poll reads as "the goal was dropped", which is
        // the one thing it must never say by accident.
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError('The goal could not be refreshed.');
        }
      });
    return () => controller.abort();
  }, [endpoint, refreshKey]);

  // A goal that is not moving does not need a ticking clock, and a complete one
  // has stopped counting for good.
  const ticking = goal !== null && goal.status === 'active';
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  const send = useCallback(
    async (init: RequestInit) => {
      setBusy(true);
      try {
        const response = await fetch(endpointRef.current, init);
        if (!response.ok) throw new Error('goal_update_failed');
        const payload = (await response.json()) as { goal?: GoalCardState | null };
        setGoal(payload.goal ?? null);
        setError(null);
      } catch {
        setError('That change to the goal did not take.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (!goal) return null;

  const label = statusLabel(goal.status);
  const tone = statusTone(goal.status);
  const createdAt = Date.parse(goal.createdAt);
  const updatedAt = Date.parse(goal.updatedAt);
  // Wall-clock since the goal was set, which is what someone means by "how long
  // has this been open". It freezes once the goal stops moving, so a paused
  // goal does not quietly accumulate hours nobody worked.
  const elapsedSeconds = Number.isFinite(createdAt)
    ? ((ticking ? now : Number.isFinite(updatedAt) ? updatedAt : now) - createdAt) / 1_000
    : goal.timeUsedSeconds;

  const patch = (body: Record<string, unknown>) =>
    void send({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const turnBudget = goal.turnBudget;
  const primaryAction =
    goal.status === 'complete'
      ? null
      : goal.status === 'paused'
        ? { kind: 'resume' as const, label: 'Resume this goal' }
        : goal.status === 'budget_limited'
          ? { kind: 'budget' as const, label: 'Give this goal more turns' }
          : running
            ? { kind: 'pause' as const, label: 'Pause this goal' }
            : { kind: 'continue' as const, label: 'Keep working on this goal' };

  const primaryDisabled =
    busy ||
    (primaryAction?.kind === 'continue' && (!onContinue || continueBlocked));

  const runPrimary = () => {
    if (!primaryAction) return;
    if (primaryAction.kind === 'resume') patch({ status: 'active' });
    else if (primaryAction.kind === 'pause') patch({ status: 'paused' });
    else if (primaryAction.kind === 'continue') onContinue?.();
    else {
      setExpanded(true);
      setBudgetDraft(turnBudget === null ? '' : String(turnBudget + 10));
    }
  };

  const toggleDetails = () => {
    setExpanded((open) => {
      if (!open) setBudgetDraft(turnBudget === null ? '' : String(turnBudget));
      return !open;
    });
  };

  return (
    <div className="border-b border-[var(--line)]">
        <div className="flex min-h-9 items-center gap-1.5 px-2">
          <span className={`shrink-0 ${tone}`}>
            <GoalIcon status={goal.status} />
          </span>
          <span className={`shrink-0 text-xs font-medium ${tone}`}>{label}</span>
          <span
            className="min-w-0 flex-1 truncate text-xs text-[var(--ink-muted)]"
            title={goal.objective}
          >
            {goal.objective}
          </span>
          <span className="shrink-0 tabular-nums text-[11px] text-[var(--ink-muted)]">
            {formatElapsed(elapsedSeconds)}
          </span>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={() => setConfirmingAbandon((open) => !open)}
            disabled={busy}
            aria-label="Abandon this goal"
            title="Abandon this goal"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
          {primaryAction ? (
            <button
              type="button"
              className={ICON_BUTTON}
              onClick={runPrimary}
              disabled={primaryDisabled}
              aria-label={primaryAction.label}
              title={
                primaryAction.kind === 'continue' && continueBlocked
                  ? 'Send or clear your draft first'
                  : primaryAction.label
              }
            >
              {primaryAction.kind === 'pause' ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                </svg>
              ) : primaryAction.kind === 'budget' ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" />
                </svg>
              )}
            </button>
          ) : null}
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={toggleDetails}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide goal detail' : 'Show goal detail'}
            title={expanded ? 'Hide goal detail' : 'Show goal detail'}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              {expanded ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              )}
            </svg>
          </button>
        </div>

        {confirmingAbandon ? (
          <div className="flex items-center gap-2 border-t border-[var(--line)] px-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 text-[var(--ink-muted)]">
              Abandon this goal? The conversation carries on without it.
            </span>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[var(--ink-muted)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97]"
              onClick={() => setConfirmingAbandon(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 font-medium text-[var(--danger)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97]"
              disabled={busy}
              onClick={() => {
                setConfirmingAbandon(false);
                void send({ method: 'DELETE' });
              }}
            >
              Abandon
            </button>
          </div>
        ) : null}

        {expanded ? (
          <div className="space-y-1.5 border-t border-[var(--line)] px-2 py-2">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink)]">
              {goal.objective}
            </p>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-muted)]">
              <div className="flex gap-1">
                <dt>Turns</dt>
                <dd className="tabular-nums text-[var(--ink)]">
                  {goal.turnBudget === null
                    ? `${goal.turnsUsed} (unlimited)`
                    : `${goal.turnsUsed} of ${goal.turnBudget}`}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>Working time</dt>
                <dd className="tabular-nums text-[var(--ink)]">
                  {formatElapsed(goal.timeUsedSeconds)}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>Set</dt>
                <dd className="text-[var(--ink)]">
                  {new Date(goal.createdAt).toLocaleString()}
                </dd>
              </div>
            </dl>
            {goal.status === 'complete' ? null : (
              <form
                className="flex items-center gap-2 text-[11px] text-[var(--ink-muted)]"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = budgetDraft.trim();
                  const parsed = trimmed === '' ? null : Number(trimmed);
                  if (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)) {
                    setError('A turn budget is a whole number of turns, or blank for unlimited.');
                    return;
                  }
                  // Lifting a ceiling is only ever asked for by someone who
                  // wants the work to carry on, so the goal comes off the
                  // budget stop in the same request.
                  patch({ turnBudget: parsed, status: 'active' });
                }}
              >
                <label htmlFor={`goal-budget-${goal.goalId}`}>Turn budget</label>
                <input
                  id={`goal-budget-${goal.goalId}`}
                  value={budgetDraft}
                  onChange={(event) => setBudgetDraft(event.target.value)}
                  inputMode="numeric"
                  placeholder={goal.turnBudget === null ? 'unlimited' : String(goal.turnBudget)}
                  className="w-20 rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                />
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 font-medium text-[var(--ink)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97] disabled:opacity-40"
                  disabled={busy}
                >
                  Set
                </button>
              </form>
            )}
          </div>
        ) : null}

        {error ? (
          <p className="border-t border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--danger)]">{error}</p>
        ) : null}
    </div>
  );
}
