import type { Recommendation, RecommendationContext, RecommendationEvidence } from './types.ts';
import { parseExplicitScheduleRequest } from '../schedules/natural-language.ts';
import { parseExplicitHookRequest } from '../hooks/natural-language.ts';
import { bookingMentionsEventDate, eventNotice, eventsConflict, meetingEvent as meeting, mentionsEvent, mentionsEventDate, studyEvent as study, travelBooking, travelEvent } from './planning-context.ts';

const clean = (value: string, max = 90) => value.replace(/[\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const routineTask = /\b(?:pay|transfer|renew|collect|pick up|buy|take|brush|water|feed|empty)\b/i;
const routineObject = /\b(?:rent|bill|invoice|subscription|payment|groceries|medication|vitamins|teeth|plants|cat|dog|bins|trash)\b/i;
const blocked = /\b(?:failed|declined|blocked|error|dispute|incorrect|missing|cannot|can't|unable|overcharged)\b/i;
const fitness = /\b(?:gym|workout|cardio|upper [ab]|lower [ab]|leg day|strength training|yoga|pilates)\b/i;
const routineEvent = /\b(?:breakfast|lunch|dinner|sleep|commute|shower|medication)\b/i;
const logistics = /\b(?:appointment|visit|rehearsal|concert|match|tournament|conference|ceremony|shift|audition|volunteer|pickup)\b/i;
const projectWork = /\b(?:write|draft|revise|report|essay|research|design|implement|debug|fix|build|study|prepare|analy[sz]e|simulat\w*|derivation|project|presentation|assignment|code)\b/i;
const asksForResponse = /\b(?:please|could you|can you|let me know|your (?:reply|response|input|feedback))\b|\?/i;
const automatedSender = /\b(?:no[-_. ]?reply|do[-_. ]?not[-_. ]?reply)\b|\bnotifications@/i;
const requestedChanges = /\b(?:feedback|revis(?:e|ions?)|requested changes)\b/i;

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
  return Boolean(item.calendar?.location) || travelEvent(item) || study.test(item.title) || meeting.test(item.title) || logistics.test(item.title) ||
    /\b(?:agenda|discuss|present|review|prepare|bring|deadline)\b/i.test(item.summary);
}

function usefulSource(item: RecommendationEvidence): boolean {
  if (!item.title.trim() || /^(?:new tab|new chat|home|calendar|plan|breadboard|meeting|task)$/i.test(item.title.trim())) return false;
  if (item.source === 'task') return taskNeedsHelp(item);
  if (item.source === 'calendar') return item.calendar?.kind === 'gap' || usableEvent(item);
  if (item.source === 'screen-time' || item.source === 'garden' || item.source === 'connection') return false;
  if (item.source === 'schedule' || item.source === 'hook') return item.summary.includes('failed on its last run:');
  if (item.source === 'gmail' || item.source === 'outlook') {
    return travelBooking(item) || eventNotice(item) || asksForResponse.test(item.summary) ||
      /\b(?:feedback|revise|review|confirm|question|request|proposal|reply|deadline)\b/i.test(`${item.title} ${item.summary}`);
  }
  return true;
}

/** Citation validity is necessary but does not make a proposed action useful. */
export function usefulRecommendation(card: Recommendation, evidence: readonly RecommendationEvidence[]): boolean {
  const sources = card.sourceIds.map(id => evidence.find(item => item.id === id)).filter((item): item is RecommendationEvidence => Boolean(item));
  // These prompt forms start the scheduler or hook composer when submitted.
  // A suggestion should never turn incidental activity into a new automation.
  if (parseExplicitScheduleRequest(card.prompt) || parseExplicitHookRequest(card.prompt)) return false;
  if (sources.some(item => (item.source === 'hook' || item.source === 'schedule') && !usefulSource(item))) return false;
  if (sources.some(item => item.source === 'garden' && !sources.some(other =>
    other !== item && item.gardenSlug && item.gardenSlug === other.gardenSlug && usefulSource(other)))) return false;
  const mail = sources.filter(item => item.source === 'gmail' || item.source === 'outlook');
  const events = sources.filter(item => item.calendar?.kind === 'event');
  if (mail.length && events.length) {
    const supports = (message: RecommendationEvidence, event: RecommendationEvidence) =>
      mentionsEvent(message, event) || bookingMentionsEventDate(message, event);
    const linked = events.filter(event => mail.some(message => supports(message, event)));
    if (mail.some(message => !linked.some(event => supports(message, event))) ||
      events.some(event => !linked.includes(event) && !linked.some(other => eventsConflict(event, other)))) return false;
  }
  // A model can find meaning in a named event or an informational email in any
  // language. The English action patterns govern the hand-written fallbacks.
  if (!sources.some(item => usefulSource(item) || (item.title.trim() &&
    (item.source === 'gmail' || item.source === 'outlook' || item.calendar?.kind === 'event')))) return false;
  if (sources.some(item => item.source === 'task' && !taskNeedsHelp(item))) return false;
  if (sources.length === 2 && sources.every(item => item.calendar?.kind === 'event') &&
    /\b(?:overlap|clash|double.booked|scheduling conflict)\b/i.test(card.prompt) && !eventsConflict(sources[0], sources[1])) return false;
  if (sources.some(item => item.source === 'calendar' && (!item.calendar || item.calendar.kind === 'event') &&
    (fitness.test(item.title) || routineEvent.test(item.title)) && !usableEvent(item) &&
    !(sources.some(other => eventsConflict(item, other)) && /\b(?:overlap|clash|conflict|reschedule|move)\b/i.test(card.prompt)))) return false;
  if (sources.some(item => item.calendar?.kind === 'gap') && !sources.some(item => item.source === 'recall' || (item.source === 'task' && taskNeedsHelp(item)))) return false;
  if (/\b(?:get .{0,100} moving|help me decide what to do next|suggest something useful|what should I do next)\b/i.test(card.prompt)) return false;
  if (/(?:Telegram|WhatsApp)\s*·|turn my discussion about .+ into notes with decisions/i.test(card.prompt)) return false;
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
  if (item.lesson && item.learnedPriority !== undefined) return item.learnedPriority;
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
  return score;
}

export function recommendationCandidates(item: RecommendationEvidence, evidence: readonly RecommendationEvidence[], context: RecommendationContext = {}) {
  const title = clean(item.title);
  const make = (prompt: string, related?: string) => ({ prompt, sourceIds: [item.id, ...(related ? [related] : [])] });
  if (item.lesson && item.suggestedPrompt) return [make(item.suggestedPrompt)];
  // Times establish a conflict even when neither title looks like an event
  // category. The subject only determines what help to offer.
  if (item.calendar?.kind === 'event') {
    const other = evidence.find(candidate => eventsConflict(item, candidate));
    if (other) {
      const trip = travelEvent(item) ? item : travelEvent(other) ? other : undefined;
      const commitment = trip === item ? other : item;
      if (trip && study.test(commitment.title) && !meeting.test(commitment.title)) return [{
        prompt: `Plan what to prepare or catch up on for “${clean(commitment.title, 65)}” during “${clean(trip.title)}”.`,
        sourceIds: [trip.id, commitment.id],
      }];
      const start = item.calendar.start > other.calendar!.start ? item.calendar.start : other.calendar!.start;
      const end = item.calendar.end < other.calendar!.end ? item.calendar.end : other.calendar!.end;
      const when = start.slice(0, 10) === end.slice(0, 10) ? ` (${start.slice(11, 16)}–${end.slice(11, 16)})` : '';
      return [make(`Help me resolve the overlap between “${title}” and “${clean(other.title, 75)}”${when}.`, other.id)];
    }
  }
  const mail = item.source === 'gmail' || item.source === 'outlook';
  const matches = mail ? evidence.filter(other => mentionsEvent(item, other)) : [];
  const namedEvent = matches.find(event => mentionsEventDate(item, event)) ?? matches[0];
  if (namedEvent && !travelBooking(item)) {
    if (/\b(?:rescheduled|new time|time change|moved to|cancelled|canceled)\b/i.test(`${item.title} ${item.summary}`)) {
      return [make(`Compare the update for “${clean(namedEvent.title, 75)}” with my calendar and flag what changed.`, namedEvent.id)];
    }
    if (eventNotice(item)) return [make(`Check the time and place for “${clean(namedEvent.title, 75)}” against the invitation.`, namedEvent.id)];
    if (requestedChanges.test(`${item.title} ${item.summary}`)) {
      return [make(`Turn the feedback for “${clean(namedEvent.title, 75)}” into a list of changes to discuss.`, namedEvent.id)];
    }
    if (/\bagenda\b/i.test(`${item.title} ${item.summary}`)) {
      return [make(`Pull out the decisions and questions on the agenda for “${clean(namedEvent.title, 75)}”.`, namedEvent.id)];
    }
  }
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
    if (travelEvent(item)) {
      return [make(`Check my calendar for commitments I may need to move around “${title}”.`)];
    }
    if (fitness.test(item.title)) return [make(`Turn the recorded workout plan for “${title}” into an exercise checklist.`)];
    const discussion = study.test(item.title) || meeting.test(item.title);
    if (item.calendar?.status === 'recently-ended') return discussion ? [make(`Help me capture any notes and follow-ups from “${title}”.`)] : [];
    if (discussion && item.calendar?.status === 'ongoing' && !item.calendar.allDay) return [make(`Give me a note-taking outline for “${title}”, scheduled now.`)];
    const recall = evidence.find(other => other.source === 'recall' && other.relatedIds?.includes(item.id));
    if (recall) return [make(`Use my recent reading on “${clean(recall.title, 65)}” to prepare for “${title}”.`, recall.id)];
    if (meeting.test(item.title) && !/\breview session\b/i.test(item.title)) return [make(`Prepare talking points and questions for “${title}”.`)];
    if (study.test(item.title)) return [make(`Help me prepare for “${title}” with a short review and practice questions.`)];
    if (/\b(?:bring|pack|equipment)\b/i.test(item.summary)) return [make(`Make a checklist of what the event notes say to bring to “${title}”.`)];
    const location = item.calendar?.location;
    if (location) {
      if (/https?:|\b(?:online|virtual|remote|zoom|teams|meet|webex)\b/i.test(location)) return [make(`Find the joining details for “${title}”.`)];
      return [make(`Help me plan my arrival at ${clean(location, 70)} for “${title}”.`)];
    }
    return [make(`Check the time, place and anything I need to bring for “${title}”.`)];
  }
  if (item.source === 'task') {
    if (blocked.test(taskDetails(item))) return [make(`Help me investigate the problem recorded for “${title}”: “${clean(taskDetails(item), 100)}”.`)];
    if (/\b(?:debug|fix|error|bug)\b/i.test(item.title)) return [make(`Help me reproduce and diagnose “${title}” using the task notes.`), make(`List the checks that would confirm a fix for “${title}”.`)];
    if (/\b(?:write|draft|revise|report|essay|presentation)\b/i.test(item.title)) return [make(`Help me outline “${title}” from its requirements.`), make(`Review the requirements for “${title}” and turn them into a drafting checklist.`)];
    return [make(`Plan the setup and checks for “${title}” using its task notes.`), make(`Break “${title}” into a focused work session with a clear result to check.`)];
  }
  if (mail) {
    const older = context.localDate && item.timestamp && Date.parse(context.localDate) - Date.parse(item.timestamp) > 14 * 86400_000;
    if (travelBooking(item)) {
      if (/\b(?:cancelled|canceled|refund)\b/i.test(`${item.title} ${item.summary}`)) {
        return [make(`Check what changed in “${title}” and what options the booking provider offers me.`)];
      }
      if (namedEvent && travelEvent(namedEvent)) return [make(`Check the dates and times for “${clean(namedEvent.title, 65)}” against my booking and flag any differences.`, namedEvent.id)];
      const commitment = evidence.find(other => bookingMentionsEventDate(item, other));
      if (commitment) {
        const booking = /^your (?:flight|trip|train|hotel)\b/i.test(title) ? title.replace(/^your /i, 'my ') : `the dates in “${title}”`;
        const action = study.test(commitment.title) && !meeting.test(commitment.title) ? 'make a catch-up plan if they overlap' : 'flag any timing conflict';
        return [make(`Check ${booking} against “${clean(commitment.title, 65)}” and ${action}.`, commitment.id)];
      }
      // Older reservations are context for synthesis. Receipt time alone
      // is insufficient evidence that the trip is still ahead.
      if (older) return [];
      return [make(`Pull the travel dates and times from “${title}” into an itinerary I can check against my calendar.`)];
    }
    if (older) return [];
    if (eventNotice(item)) return [make(`Check the date and details in “${title}” against my schedule.`)];
    if (/\bdeadline\b/i.test(`${item.title} ${item.summary}`)) return [make(`Find the deadline in “${title}” and what I need to do before it.`)];
    if (automatedSender.test(item.sender ?? '')) return [];
    if (/\b(?:please|(?:can|could|would) you)\s+(?:please\s+)?review\b/i.test(item.summary)) {
      return [make(`Help me review “${title}” and draft feedback.`)];
    }
    if (requestedChanges.test(`${title} ${item.summary}`)) return [make(`Pull the requested changes out of “${title}” into a revision checklist.`)];
    if (!asksForResponse.test(item.summary)) return [];
    return [make(`Draft a reply to “${title}” that addresses the sender’s request.`)];
  }
  if (item.source === 'schedule' || item.source === 'hook') {
    const detail = clean(item.summary.replace(/^.*?failed on its last run:\s*/i, ''), 90).replace(/[.!?]+$/, '');
    if (item.source === 'hook') return [make(`Help me fix my “${title}” hook; its last run ended with “${detail}”.`)];
    return [make(`Help me find out why my scheduled task “${title}” failed and fix it.`)];
  }
  if (item.source === 'recall') return [make(`Use the passage I was reading in “${title}” to explain its key ideas.`),
    make(`Turn my recent reading on “${title}” into a short recap and practice questions.`)];
  // Chats and remembered facts need interpretation to establish a next step.
  return [];
}
