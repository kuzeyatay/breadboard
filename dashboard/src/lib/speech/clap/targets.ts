type SpeechAction = 'dictation' | 'voice';
export interface ClapTarget {
  element: () => HTMLTextAreaElement | null;
  eligible: () => boolean;
  start: (action: SpeechAction) => boolean;
  voice: boolean;
  identity: () => string;
}
type Registry = { targets: Set<ClapTarget>; openers: Set<{ open: () => void; priority: number }>; last?: ClapTarget };
function registry(): Registry {
  const g = globalThis as typeof globalThis & { __breadboardClapTargets?: Registry };
  return g.__breadboardClapTargets ??= { targets: new Set(), openers: new Set() };
}
export function registerClapTarget(target: ClapTarget) {
  registry().targets.add(target);
  const focus = () => { if (target.element() === document.activeElement) registry().last = target; };
  document.addEventListener('focusin', focus);
  return () => { registry().targets.delete(target); document.removeEventListener('focusin', focus); };
}
export function registerClapDock(open: () => void, priority = 0) {
  const opener = { open, priority }; registry().openers.add(opener);
  return () => { registry().openers.delete(opener); };
}
function select(action: SpeechAction): ClapTarget | undefined {
  const targets = [...registry().targets].filter(t => t.eligible() && (action !== 'voice' || t.voice) && Boolean(t.element()?.getClientRects().length) && !t.element()?.closest('[inert],[hidden],[aria-hidden="true"]'));
  return targets.find(t => t.element() === document.activeElement) ??
    (registry().last && targets.includes(registry().last!) ? registry().last : targets.length === 1 ? targets[0] : undefined);
}
export async function dispatchClapSpeech(action: SpeechAction, signal: AbortSignal, options: { waitForTarget?: boolean } = {}): Promise<boolean> {
  const path = location.href;
  let target = select(action);
  // Only the single explicitly registered dock on THIS route may open.
  const opened = new Set<() => void>();
  for (let i = 0; !target && i < (options.waitForTarget ? 500 : 75) && !signal.aborted && location.href === path; i++) {
    const openers = [...registry().openers];
    const priority = Math.max(...openers.map(o => o.priority));
    const eligibleOpeners = openers.filter(o => o.priority === priority);
    const opener = eligibleOpeners.length === 1 ? eligibleOpeners[0].open : null;
    if (opener && !opened.has(opener)) { opened.add(opener); opener(); }
    if (!options.waitForTarget && !opener) break;
    await new Promise(resolve => setTimeout(resolve, 40)); target = select(action);
  }
  if (!target || signal.aborted || location.href !== path) return false;
  const identity = target.identity();
  // The exact same registration, route and conversation must still own the draft.
  if (!registry().targets.has(target) || !target.eligible() || target.identity() !== identity) return false;
  return target.start(action);
}
