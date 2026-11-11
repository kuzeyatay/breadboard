import type { Recommendation, RecommendationContext, RecommendationEvidence } from './types.ts';
import { parseExplicitScheduleRequest } from '../schedules/natural-language.ts';
import { parseExplicitHookRequest } from '../hooks/natural-language.ts';

const clean = (value: string, max = 90) => value.replace(/[\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const routineTask = /\b(?:pay|transfer|renew|collect|pick up|buy|take|brush|water|feed|empty)\b/i;
const routineObject = /\b(?:rent|bill|invoice|subscription|payment|groceries|medication|vitamins|teeth|plants|cat|dog|bins|trash)\b/i;
const blocked = /\b(?:failed|declined|blocked|error|dispute|incorrect|missing|cannot|can't|unable|overcharged)\b/i;
const fitness = /\b(?:gym|workout|cardio|upper [ab]|lower [ab]|leg day|strength training|yoga|pilates)\b/i;
const routineEvent = /\b(?:breakfast|lunch|dinner|sleep|commute|shower|medication)\b/i;
const study = /\b(?:exam|test|quiz|lab|lecture|tutorial|seminar|workshop|course|study|review session)\b/i;
const meeting = /\b(?:meeting|review|interview|demo|presentation|planning|retrospective|standup|appointment|session)\b/i;
const projectWork = /\b(?:write|draft|revise|report|essay|research|design|implement|debug|fix|build|study|prepare|analy[sz]e|simulat\w*|derivation|project|presentation|assignment|code)\b/i;

const taskDetails = (item: RecommendationEvidence) => item.summary
  .replace(/^Project:\s*[^.]*\.\s*/i, '').replace(/^Due\s+\d{4}-\d{2}-\d{2}\.\s*/i, '').trim();

export function taskNeedsHelp(item: RecommendationEvidence): boolean {
  const details=taskDetails(item);
  if (routineTask.test(item.title) && routineObject.test(item.title)) return blocked.test(details);
  return projectWork.test(`${item.title} ${details}`) || blocked.test(details);
}

function usableEvent(item: RecommendationEvidence): boolean {
  if (item.calendar?.kind === 'overlap') return true;
  if (fitness.test(item.title)) return /\b(?:sets|reps|training plan|workout plan|exercise list)\b/i.test(item.summary);
  if (routineEvent.test(item.title)) return false;
  return study.test(item.title) || meeting.test(item.title) || /\b(?:agenda|discuss|present|review|prepare|bring|deadline)\b/i.test(item.summary);
}

function usefulSource(item: RecommendationEvidence): boolean {
  if (!item.title.trim() || /^(?:new tab|new chat|home|calendar|plan|breadboard|meeting|task)$/i.test(item.title.trim())) return false;
  if (item.source === 'task') return taskNeedsHelp(item);
  if (item.source === 'calendar') return item.calendar?.kind === 'gap' || usableEvent(item);
  if (item.source === 'screen-time') return false; // Exposure alone supplies no useful action.
  if (item.source === 'schedule' || item.source === 'hook') return automationCandidate(item) !== null || /\bfailed\b|\bran recently\b/.test(item.summary);
  if (item.source === 'gmail' || item.source === 'outlook') {
    return /\b(?:please|could you|can you|feedback|revise|review|confirm|question|request|proposal|reply)\b/i.test(`${item.title} ${item.summary}`);
  }
  return true;
}

/** Citation validity is necessary but does not make a proposed action useful. */
export function usefulRecommendation(card: Recommendation, evidence: readonly RecommendationEvidence[]): boolean {
  const sources = card.sourceIds.map(id => evidence.find(item => item.id === id)).filter((item): item is RecommendationEvidence => Boolean(item));
  if (!sources.length || !sources.some(usefulSource)) return false;
  if (sources.some(item => item.source === 'task' && !taskNeedsHelp(item))) return false;
  if (sources.some(item => item.source === 'calendar' && (!item.calendar || item.calendar.kind === 'event') && !usableEvent(item))) return false;
  if (sources.some(item => item.calendar?.kind === 'gap') && !sources.some(item => item.source === 'recall' || (item.source === 'task' && taskNeedsHelp(item)))) return false;
  if (/\b(?:get .{0,100} moving|help me decide what to do next|suggest something useful|what should I do next)\b/i.test(card.prompt)) return false;
  return true;
}

/** Include every supporting source, so a task used in a calendar plan cannot
 * occupy another card. Overlap evidence also consumes its actual event IDs. */
export function recommendationSubjects(card: Recommendation, known: ReadonlyMap<string, RecommendationEvidence>): string[] {
  return card.sourceIds.flatMap(id => {
    const item = known.get(id);
    return [id, ...(item ? [`title:${item.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`] : []),
      ...(item?.calendar?.kind === 'overlap' ? item.relatedIds ?? [] : [])];
  });
}

export function recommendationPriority(item: RecommendationEvidence, context: RecommendationContext = {}): number {
  let score = { calendar: 40, task: 55, gmail: 65, outlook: 65, recall: 60, 'screen-time': 5, garden: 30, chat: 35,
    memory: 50, schedule: 48, hook: 46, connection: 25 }[item.source];
  // Something the person set up to run without them has broken.
  if ((item.source === 'schedule' || item.source === 'hook') && /\bfailed\b/.test(item.summary)) score = 75;
  if (item.calendar) {
    const now = context.localDate && context.localTime ? `${context.localDate}T${context.localTime}` : null;
    const hours = now ? (Date.parse(`${item.calendar.start}Z`) - Date.parse(`${now}Z`)) / 3_600_000 : 6;
    score = item.calendar.kind === 'overlap' ? 90 : item.calendar.kind === 'gap' ? 45 :
      item.calendar.status === 'recently-ended' ? 45 : hours >= 0 && hours < 3 ? 80 : 55;
  }
  if (context.gardenSlug && context.gardenSlug === item.gardenSlug) score += 25;
  return score;
}

export function recommendationCandidates(item: RecommendationEvidence, evidence: readonly RecommendationEvidence[], context: RecommendationContext = {}) {
  const title = clean(item.title);
  const make = (prompt: string, related?: string) => ({ prompt, sourceIds: [item.id, ...(related ? [related] : [])] });
  if (!usefulSource(item)) return [];
  if (item.calendar?.kind === 'overlap') {
    const when = `${item.calendar.start.slice(11, 16)}–${item.calendar.end.slice(11, 16)}`;
    const date = context.localDate && item.calendar.start.slice(0, 10) !== context.localDate ? ` on ${item.calendar.start.slice(0, 10)}` : '';
    return [make(`Help me resolve the ${when}${date} clash between “${title}”.`),
      make(`Compare ways to handle “${title}”, which overlap ${when}${date}, before changing my calendar.`)];
  }
  if (item.calendar?.kind === 'gap') {
    const work = evidence.find(other => other.source === 'task' && taskNeedsHelp(other)) ?? evidence.find(other => other.source === 'recall' && usefulSource(other));
    return work ? [make(`My calendar has an opening ${title}. Suggest a 25-minute plan for “${clean(work.title, 75)}”.`, work.id)] : [];
  }
  if (item.source === 'calendar') {
    if (fitness.test(item.title)) return [make(`Turn the recorded workout plan for “${title}” into an exercise checklist.`)];
    if (item.calendar?.status === 'recently-ended') return [make(`Help me capture any notes and follow-ups from “${title}”.`)];
    if (item.calendar?.status === 'ongoing' && !item.calendar.allDay) return [make(`Give me a note-taking outline for “${title}”, scheduled now.`)];
    const recall = evidence.find(other => other.source === 'recall' && other.relatedIds?.includes(item.id));
    return [
      ...(recall ? [make(`Use my recent reading on “${clean(recall.title, 65)}” to prepare for “${title}”.`, recall.id)] : []),
      ...(study.test(item.title) ? [make(`Help me prepare for “${title}” with a short review and practice questions.`),
        make(`Quiz me on the key ideas I need for “${title}”.`)] :
        [make(`Build a preparation checklist for “${title}” from the event details and my related notes.`),
          make(`Draft an agenda and questions for “${title}” using its event details.`)]),
    ];
  }
  if (item.source === 'task') {
    if (blocked.test(taskDetails(item))) return [make(`Help me investigate the problem recorded for “${title}”: “${clean(taskDetails(item), 100)}”.`)];
    if (/\b(?:debug|fix|error|bug)\b/i.test(item.title)) return [make(`Help me reproduce and diagnose “${title}” using the task notes.`), make(`List the checks that would confirm a fix for “${title}”.`)];
    if (/\b(?:write|draft|revise|report|essay|presentation)\b/i.test(item.title)) return [make(`Help me outline “${title}” from its requirements.`), make(`Review the requirements for “${title}” and turn them into a drafting checklist.`)];
    return [make(`Plan the setup and checks for “${title}” using its task notes.`), make(`Break “${title}” into a focused work session with a clear result to check.`)];
  }
  if (item.source === 'gmail' || item.source === 'outlook') {
    const request = clean(item.summary.replace(/^From:.*?\.\s*/, ''), 95).replace(/[.!?]+$/, '');
    return [make(`Draft a reply to “${title}”${request ? ` addressing “${request}”` : ''}.`),
      make(`Extract the requested changes and questions from “${title}”.`)];
  }
  if (item.source === 'memory') return [make(`Pick up my work on “${title}”: where does it stand, and what is the next concrete step?`)];
  if (item.source === 'schedule' || item.source === 'hook') {
    const automation = automationCandidate(item);
    if (automation) return [make(automation)];
    const detail = clean(item.summary.replace(/^.*?failed on its last run:\s*/i, ''), 90).replace(/[.!?]+$/, '');
    if (item.source === 'hook') return [make(`Help me fix my “${title}” hook; its last run ended with “${detail}”.`)];
    if (/\bfailed\b/.test(item.summary)) return [make(`Help me find out why my scheduled task “${title}” failed and fix it.`)];
    return [make(`Go over the latest run of my scheduled task “${title}” and pull out anything I should act on.`)];
  }
  if (item.source === 'connection') return [make(connectionPrompt(item.id.slice('connection:'.length), title)),
    make(`Every weekday at 8am, brief me on what's new in ${title} and what needs my attention.`)];
  if (item.source === 'recall') return [make(`Use the passage I was reading in “${title}” to explain its key ideas.`),
    make(`Turn my recent reading on “${title}” into a short recap and practice questions.`)];
  if (item.source === 'chat') return item.summary.trim().length >= 30 ? [make(`Turn my discussion about “${title}” into notes with decisions and any follow-ups.`)] : [];
  if (item.source === 'garden') return [make(`Quiz me on the key ideas in “${title}”, using my garden notes.`),
    make(`Connect the main ideas across my notes in “${title}”.`)];
  return [];
}

const lowerFirst = (value: string) => /^\p{Lu}\p{Ll}/u.test(value) ? value[0].toLocaleLowerCase() + value.slice(1) : value;

/**
 * A question asked by hand again and again, phrased so that sending the card
 * creates the schedule or hook — the composer diverts exactly these shapes —
 * rather than asking about it. Null when no phrasing passes that gate.
 */
export function automationCandidate(item: RecommendationEvidence): string | null {
  const asked = clean(item.title, 150);
  if (item.id.startsWith('repeat-open:')) {
    const direct = `Every weekday at 9am, ${lowerFirst(asked)}`;
    if (parseExplicitScheduleRequest(direct)) return direct;
    // A bare question can still be scheduled; small talk cannot.
    if (!/\?|^(?:what|when|where|which|who|how|is|are|will|do|does|can)\b/i.test(asked)) return null;
    const check = `Every weekday at 9am, check: ${asked}`;
    return parseExplicitScheduleRequest(check) ? check : null;
  }
  if (item.id.startsWith('repeat-follow:')) {
    const hook = `Whenever a chat finishes, ${lowerFirst(asked).replace(/[?.!]+$/, '')}`;
    return parseExplicitHookRequest(hook) ? hook : null;
  }
  return null;
}

/** One concrete read-and-act task per kind of app, for any connection at all. */
export function connectionPrompt(slug: string, name: string): string {
  if (/github|gitlab|bitbucket|linear|jira|asana|clickup|trello|monday|todoist|tasks|basecamp|height|shortcut/.test(slug)) return `Check my ${name} for open items assigned to me and help me pick what to tackle first.`;
  if (/slack|teams|discord|telegram|whatsapp|intercom|zendesk|front|helpscout/.test(slug)) return `Catch me up on what I missed in ${name} and draft replies where someone is waiting on me.`;
  if (/drive|docs|dropbox|box|one-drive|onedrive|share-point|sharepoint|notion|confluence|sheets|airtable|excel|coda|obsidian|evernote/.test(slug)) return `Find what I worked on most recently in ${name} and summarize where I left off.`;
  if (/calendar|calendly|zoom|meet|cal-com/.test(slug)) return `Look at this week in ${name} and help me prepare for what's coming up.`;
  if (/spotify|music|soundcloud|deezer/.test(slug)) return `Use my recent ${name} listening to put together a playlist for my next focus session.`;
  if (/stripe|quickbooks|xero|hubspot|salesforce|square|ramp|plaid|shopify|attio|pipedrive|mailchimp|posthog|sentry|analytics/.test(slug)) return `Summarize what changed in ${name} this week and flag anything that needs my attention.`;
  return `Use my ${name} connection to show me what's new there and what needs my attention.`;
}
