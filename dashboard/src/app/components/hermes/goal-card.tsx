'use client';

// The composer keeps the conversation's objective, status and controls visible
// across turns. Usage comes from the server's per-run accounting.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CirclePause, CircleAlert, Gauge, Play } from 'lucide-react';
import { formatTokenCount } from '@/lib/chat-token-usage';
import { GOAL_TURN_EVENT, type GoalTurnSnapshot } from '@/lib/goal-turn-activity';

export type GoalCardStatus =
  | 'active'
  | 'paused'
  | 'budget_limited'
  | 'blocked'
  | 'usage_limited'
  | 'complete';

export interface GoalCardState {
  goalId: string;
  objective: string;
  status: GoalCardStatus;
  statusReason?: string;
  turnBudget: number | null;
  tokenBudget: number | null;
  continuationDeferred: boolean;
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
  if (status === 'budget_limited') return 'Goal budget reached';
  if (status === 'blocked') return 'Goal blocked';
  if (status === 'usage_limited') return 'Goal usage limit reached';
  return 'Pursuing goal';
}

function statusTone(status: GoalCardStatus): string {
  if (status === 'complete') return 'text-[var(--botanical)]';
  if (status === 'paused') return 'text-[var(--ink-muted)]';
  if (status === 'budget_limited' || status === 'blocked' || status === 'usage_limited') return 'text-[var(--danger)]';
  return 'text-[var(--ink)]';
}

function GoalIcon({ status }: { status: GoalCardStatus }) {
  if (status === 'paused') return <CirclePause className="h-4 w-4" strokeWidth={1.8} />;
  if (status === 'blocked') return <CircleAlert className="h-4 w-4" strokeWidth={1.8} />;
  if (status === 'budget_limited' || status === 'usage_limited') return <Gauge className="h-4 w-4" strokeWidth={1.8} />;
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
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [budgetDraft, setBudgetDraft] = useState('');
  // null while reading; the draft text while the person is rewording the goal.
  const [objectiveDraft, setObjectiveDraft] = useState<string | null>(null);
  const objectiveInput = useRef<HTMLTextAreaElement | null>(null);
  const endpoint = `/api/hermes/sessions/${encodeURIComponent(String(sessionId))}/goal`;
  // Read inside the callbacks rather than in their dependency lists: the
  // endpoint is derived from a prop that changes only when the conversation
  // does, and re-creating every handler on each poll would churn the row.
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;
  const requestVersion = useRef(0);
  const mutating = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    const refresh = () => {
      if (reading || mutating.current || controller.signal.aborted) return;
      reading = true;
      const version = ++requestVersion.current;
      void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((payload: { goal?: GoalCardState | null; turn?: GoalTurnSnapshot | null } | null) => {
        if (!payload || controller.signal.aborted || version !== requestVersion.current) return;
        setGoal(payload.goal ?? null);
        setError(null);
        if (payload.turn) {
          window.dispatchEvent(new CustomEvent(GOAL_TURN_EVENT, {
            detail: { sessionId, turn: payload.turn },
          }));
        }
      })
      .catch((cause: unknown) => {
        // An aborted read is this effect being replaced, not a failure. Any
        // other failure leaves the last known goal on screen: a card that
        // vanishes on one bad poll reads as "the goal was dropped", which is
        // the one thing it must never say by accident.
        if (!controller.signal.aborted && version === requestVersion.current &&
            !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError('The goal could not be refreshed.');
        }
      })
      .finally(() => { reading = false; });
    };
    // A finished turn releases the run slot before the scheduler reserves its
    // successor. Read just after that handoff, then keep the normal poll for
    // slower dispatches and goals resumed from another viewer.
    const handoff = refreshKey === 'completed' ? window.setTimeout(refresh, 250) : null;
    if (handoff === null) refresh();
    // Goals also change through tools, API clients and detached continuation;
    // none of those necessarily changes this viewer's run-state refresh key.
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      if (handoff !== null) window.clearTimeout(handoff);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [endpoint, refreshKey, sessionId]);

  // A goal that is not moving does not need a ticking clock, and a complete one
  // has stopped counting for good.
  const ticking = running && goal?.status === 'active' && goal.tokenBudget == null;
  useEffect(() => {
    setLiveSeconds(0);
    if (!ticking) return;
    const observedAt = Date.now();
    const timer = window.setInterval(() => setLiveSeconds(Math.floor((Date.now() - observedAt) / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking, goal?.goalId, goal?.timeUsedSeconds]);

  const send = useCallback(
    async (init: RequestInit, optimistic?: (current: GoalCardState | null) => GoalCardState | null) => {
      if (mutating.current) return;
      const target = endpointRef.current;
      const version = ++requestVersion.current;
      mutating.current = true;
      // Pause and Abandon show at once; the server's answer then confirms or
      // rolls back. Waiting on the round trip read as a Stop that did nothing.
      const before = goal;
      setBusy(true);
      if (optimistic) setGoal(optimistic(before));
      try {
        const response = await fetch(target, init);
        if (!response.ok) throw new Error('goal_update_failed');
        const payload = (await response.json()) as { goal?: GoalCardState | null };
        if (endpointRef.current === target && version === requestVersion.current) {
          setGoal(payload.goal ?? null);
          setError(null);
        }
      } catch {
        if (endpointRef.current === target && version === requestVersion.current) {
          if (optimistic) setGoal(before);
          setError('That change to the goal did not take.');
        }
      } finally {
        mutating.current = false;
        setBusy(false);
      }
    },
    [goal],
  );

  if (!goal) return null;

  const label = statusLabel(goal.status);
  const tone = statusTone(goal.status);
  const elapsedSeconds = goal.timeUsedSeconds + (ticking ? liveSeconds : 0);

  const patch = (body: Record<string, unknown>) =>
    void send({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, body.status === 'paused'
      ? (current) => (current ? { ...current, status: 'paused' } : current)
      : typeof body.objective === 'string'
        ? (current) => (current ? { ...current, objective: (body.objective as string).trim() } : current)
        : undefined);

  const startEditingObjective = () => {
    if (busy) return;
    setObjectiveDraft(goal.objective);
    window.requestAnimationFrame(() => {
      const input = objectiveInput.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };

  const saveObjective = () => {
    if (objectiveDraft === null) return;
    const next = objectiveDraft.trim();
    if (!next) {
      setError('A goal needs an objective. Abandon it instead to drop it.');
      return;
    }
    if (next.length > 4_000) {
      setError('A goal objective must be at most 4000 characters.');
      return;
    }
    setObjectiveDraft(null);
    if (next === goal.objective) return;
    patch({ objective: next });
  };

  const turnBudget = goal.turnBudget;
  const tokenBudget = goal.tokenBudget ?? null;
  const resumable = goal.status === 'paused' || goal.status === 'blocked' || goal.status === 'usage_limited';
  const usage = tokenBudget === null ? formatElapsed(elapsedSeconds)
    : goal.status === 'complete' ? `${formatTokenCount(goal.tokensUsed)} tokens`
    : `${formatTokenCount(goal.tokensUsed)} / ${formatTokenCount(tokenBudget)} tokens`;
  const primaryAction =
    goal.status === 'complete'
      ? null
      : resumable
        ? { kind: 'resume' as const, label: 'Resume this goal' }
        : goal.status === 'budget_limited'
          ? { kind: 'budget' as const, label: 'Increase the goal budget' }
          : { kind: 'pause' as const, label: 'Pause this goal' };

  const runPrimary = () => {
    if (!primaryAction) return;
    if (primaryAction.kind === 'resume') patch({ status: 'active' });
    else if (primaryAction.kind === 'pause') patch({ status: 'paused' });
    else {
      setExpanded(true);
      setBudgetDraft(tokenBudget === null ? '' : String(tokenBudget));
    }
  };

  const toggleDetails = () => {
    setObjectiveDraft(null);
    setExpanded((open) => {
      if (!open) setBudgetDraft(tokenBudget === null ? '' : String(tokenBudget));
      return !open;
    });
  };

  return (
    <div className="mb-2 border-b border-[var(--line)]" data-goal-card>
        <div className="flex min-h-9 items-center gap-1.5 px-2">
          <span className={`shrink-0 ${tone}`} aria-hidden="true">
            <GoalIcon status={goal.status} />
          </span>
          <span role="status" className={`shrink-0 text-xs font-medium ${tone}`}>{label}</span>
          <button
            type="button"
            className="min-w-0 flex-1 cursor-text truncate rounded-md text-left text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
            title="Click to edit the goal"
            onClick={() => {
              if (!expanded) {
                setExpanded(true);
                setBudgetDraft(tokenBudget === null ? '' : String(tokenBudget));
              }
              startEditingObjective();
            }}
          >
            {goal.objective}
          </button>
          {!resumable && (
            <span className="shrink-0 tabular-nums text-[11px] text-[var(--ink-muted)]">{usage}</span>
          )}
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
              className={primaryAction.kind === 'resume' ? ICON_BUTTON + ' w-auto gap-1 px-1.5 text-xs' : ICON_BUTTON}
              onClick={runPrimary}
              disabled={busy}
              aria-label={primaryAction.label}
              title={primaryAction.label}
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
              {primaryAction.kind === 'resume' ? 'Resume' : null}
            </button>
          ) : null}
          {goal.status === 'active' && !running && onContinue ? (
            <button type="button" className={ICON_BUTTON} onClick={onContinue}
              disabled={busy || continueBlocked} aria-label="Keep working on this goal"
              title={continueBlocked ? 'Send or clear your draft first' : 'Keep working on this goal'}>
              <Play className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
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
                void send({ method: 'DELETE' }, () => null);
              }}
            >
              Abandon
            </button>
          </div>
        ) : null}

        {expanded ? (
          <div className="space-y-1.5 border-t border-[var(--line)] px-2 py-2">
            {goal.status === 'blocked' || goal.status === 'usage_limited' ? (
              <p className="break-words text-xs text-[var(--ink-muted)]">
                {goal.statusReason || (goal.status === 'blocked'
                  ? 'Resume after the blocker is resolved.'
                  : 'Resume when your provider usage is available again.')}
              </p>
            ) : null}
            {objectiveDraft === null ? (
              <button
                type="button"
                className="-mx-1 block w-[calc(100%+0.5rem)] cursor-text whitespace-pre-wrap rounded-md px-1 py-0.5 text-left text-xs leading-relaxed text-[var(--ink)] transition-[background-color] duration-150 ease-out hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed"
                onClick={startEditingObjective}
                disabled={busy}
                title="Click to edit the goal"
                aria-label="Edit the goal objective"
              >
                {goal.objective}
              </button>
            ) : (
              <form
                className="space-y-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveObjective();
                }}
              >
                <textarea
                  ref={objectiveInput}
                  value={objectiveDraft}
                  onChange={(event) => setObjectiveDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setObjectiveDraft(null);
                    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      saveObjective();
                    }
                  }}
                  rows={Math.min(8, Math.max(2, objectiveDraft.split('\n').length))}
                  maxLength={4_000}
                  aria-label="Goal objective"
                  className="block w-full resize-y rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-xs leading-relaxed text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                />
                <div className="flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
                  <span className="min-w-0 flex-1">
                    {goal.status === 'active'
                      ? 'Enter to save. The running turn is redirected to the new goal.'
                      : 'Enter to save, Shift+Enter for a new line.'}
                  </span>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97]"
                    onClick={() => setObjectiveDraft(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 font-medium text-[var(--ink)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97] disabled:opacity-40"
                    disabled={busy || !objectiveDraft.trim()}
                  >
                    Save
                  </button>
                </div>
              </form>
            )}
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-muted)]">
              <div className="flex gap-1"><dt>Tokens</dt><dd>{goal.tokensUsed}{tokenBudget === null ? ' (unlimited)' : ` of ${tokenBudget}`}</dd></div>
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
                  if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed <= 0)) {
                    setError('A token budget is a positive whole number, or blank for unlimited.');
                    return;
                  }
                  patch({ tokenBudget: parsed, ...(turnBudget != null ? { turnBudget: null } : {}) });
                }}
              >
                <label htmlFor={`goal-budget-${goal.goalId}`}>Token budget</label>
                <input
                  id={`goal-budget-${goal.goalId}`}
                  value={budgetDraft}
                  onChange={(event) => setBudgetDraft(event.target.value)}
                  inputMode="numeric"
                  placeholder={tokenBudget === null ? 'unlimited' : String(tokenBudget)}
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
