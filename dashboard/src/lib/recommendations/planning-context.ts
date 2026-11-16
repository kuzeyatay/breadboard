import type { RecommendationEvidence } from './types.ts';
import { MONTH_NAMES } from '../calendar/format.ts';

const common = new Set('the and for with from this that meeting review notes work browser breadboard microsoft chrome google edge new tab home calendar today tomorrow lecture session lesson'.split(' '));
export function topicWords(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !common.has(word));
}

export const studyEvent = /\b(?:exam|test|quiz|lab|lecture|class|tutorial|seminar|workshop|course|study|review session)\b/i;
export const meetingEvent = /\b(?:meeting|review|interview|demo|presentation|planning|retrospective|stand[- ]?up|kick[- ]?off|sync|1[: -]1|one[- ]on[- ]one|board call|team call)\b/i;
const travel = /\b(?:trip|flights?|itinerary|hotel|train tickets?)\b/i;
const booking = /\b(?:itinerary|boarding pass|check[- ]in|booking|reservation|booked|confirmed|confirmation|e-ticket)\b/i;
const genericTopic = new Set(('weekly monthly daily team client project planning feedback agenda update interview deadline design course class lab exam workshop tutorial trip flight hotel appointment invitation confirmation confirmed rescheduled conference rehearsal event shift engineering technology department university session sync board call ' +
  'saturday sunday monday tuesday wednesday thursday friday january february march april may june july august september october november december').split(' '));

export function eventNotice(item: RecommendationEvidence): boolean {
  if (item.source !== 'gmail' && item.source !== 'outlook') return false;
  return Boolean(item.calendarAttachment) || /\b(?:invitation|rsvp|rescheduled|appointment reminder|calendar invite|event tickets?)\b/i.test(item.title) ||
    /\b(?:you(?:'re| are) invited|has been rescheduled|appointment (?:is )?confirmed)\b/i.test(item.summary);
}

export function matchesEventTopic(eventTitle: string, title: string, summary: string): boolean {
  const subject = topicWords(eventTitle).filter(word => !genericTopic.has(word) && !/^\d+$/.test(word));
  const headline = new Set(topicWords(title));
  const message = new Set([...headline, ...topicWords(summary)]);
  const matches = subject.filter(word => message.has(word));
  // A course or project code can establish identity on its own. Otherwise
  // require most of the distinctive name, or the whole name in the subject.
  return matches.some(word => word.length >= 4 && /\p{L}/u.test(word) && /\d/.test(word)) ||
    (matches.length >= 2 && matches.length * 2 > subject.length) ||
    (subject.length === 1 && headline.has(subject[0]));
}

export function mentionsEvent(mail: RecommendationEvidence, event: RecommendationEvidence): boolean {
  return event.calendar?.kind === 'event' && event.calendar.status !== 'recently-ended' &&
    matchesEventTopic(event.title, mail.title, mail.summary);
}

export function travelBooking(item: RecommendationEvidence): boolean {
  const content = `${item.title} ${item.summary}`;
  return (item.source === 'gmail' || item.source === 'outlook') && travel.test(content) && booking.test(content);
}

export function travelEvent(item: RecommendationEvidence): boolean {
  return item.calendar?.kind === 'event' && item.calendar.status !== 'recently-ended' && travel.test(item.title) &&
    !studyEvent.test(item.title) && !meetingEvent.test(item.title);
}

export function mentionsEventDate(mail: RecommendationEvidence, event: RecommendationEvidence): boolean {
  if (event.calendar?.kind !== 'event') return false;
  const date = event.calendar.start.slice(0, 10);
  const [year, month, day] = date.split('-').map(Number);
  const name = MONTH_NAMES[month - 1];
  if (!name) return false;
  const content = `${mail.title} ${mail.summary}`;
  if (content.includes(date)) return true;
  // A range must be written as a range. Two unrelated dates (for example
  // the booking deadline and the departure) do not establish a stay.
  for (const range of content.matchAll(/\b(\d{4}-\d\d-\d\d)\s*(?:[–—-]|to|through|until)\s*(\d{4}-\d\d-\d\d)\b/gi)) {
    if (range[1] <= date && date <= range[2]) return true;
  }
  const monthName = `(?:${name}|${name.slice(0, 3)}\\.?)`;
  const days = String.raw`(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)?)?`;
  const optionalYear = String.raw`(?:,?\s+(\d{4})\b)?`;
  for (const pattern of [`${monthName}\\s+${days}`, `${days}\\s+${monthName}`]) {
    for (const match of content.matchAll(new RegExp(`\\b${pattern}\\b${optionalYear}`, 'gi'))) {
      if ((!match[3] || Number(match[3]) === year) && Number(match[1]) <= day && day <= Number(match[2] ?? match[1])) return true;
    }
  }
  return false;
}

export function bookingMentionsEventDate(mail: RecommendationEvidence, event: RecommendationEvidence): boolean {
  return event.calendar?.kind === 'event' && event.calendar.status !== 'recently-ended' && event.calendar.blocksTime !== false &&
    travelBooking(mail) && !/\b(?:cancelled|canceled|refund)\b/i.test(`${mail.title} ${mail.summary}`) && mentionsEventDate(mail, event);
}

type ScheduledEvent = RecommendationEvidence & { calendar: NonNullable<RecommendationEvidence['calendar']> };

function scheduledCommitment(item: RecommendationEvidence): item is ScheduledEvent {
  const event = item.calendar;
  if (event?.kind !== 'event' || event.status === 'recently-ended' || event.blocksTime === false || event.start >= event.end) return false;
  // A date-only entry can be a birthday, holiday or deadline. Treat it as
  // occupying time only when the provider or the entry itself establishes that.
  return !event.allDay || event.blocksTime === true || travelEvent(item) ||
    /\b(?:out of office|annual leave|on[- ]call|shift|conference|retreat|training day)\b/i.test(item.title);
}

const occurrenceKey = (item: RecommendationEvidence) =>
  JSON.stringify([item.title.trim().toLowerCase(), item.calendar?.start, item.calendar?.end]);

export function eventsConflict(a: RecommendationEvidence, b: RecommendationEvidence): boolean {
  if (a.id === b.id || !scheduledCommitment(a) || !scheduledCommitment(b)) return false;
  const left = a.calendar, right = b.calendar;
  return left.start < right.end && right.start < left.end && occurrenceKey(a) !== occurrenceKey(b);
}

export function* calendarConflicts(items: readonly RecommendationEvidence[]) {
  const scheduled = items.filter(scheduledCommitment).sort((a, b) => a.calendar.start.localeCompare(b.calendar.start));
  for (let i = 0; i < scheduled.length; i++) {
    const first = scheduled[i];
    for (let j = i + 1; j < scheduled.length && scheduled[j].calendar.start < first.calendar.end; j++) {
      if (eventsConflict(first, scheduled[j])) yield [first, scheduled[j]] as const;
    }
  }
}

/** Find relationships across all loaded calendars before sampling recurring series. */
export function planningCalendarOrder(events: readonly RecommendationEvidence[], mail: readonly RecommendationEvidence[] = []): RecommendationEvidence[] {
  const free = new Set(events.filter(item => item.calendar?.blocksTime === false).map(occurrenceKey));
  const merged = events.map(item => item.calendar?.kind === 'event' && free.has(occurrenceKey(item))
    ? { ...item, calendar: { ...item.calendar, blocksTime: false } } : item);
  const freeIds = new Set(merged.filter(item => item.calendar?.blocksTime === false).map(item => item.id));
  const priority: RecommendationEvidence[] = [];
  const reserved = new Set<string>();
  for (const [first, second] of calendarConflicts(merged)) {
    const a = first.calendar.seriesId ?? first.id, b = second.calendar.seriesId ?? second.id;
    if (reserved.has(a) || reserved.has(b)) continue;
    priority.push(first, second);
    reserved.add(a);
    reserved.add(b);
    if (priority.length >= 4) break;
  }
  // A synced event and its Google original can share a slot. Distinct dates
  // of a series are considered above, before taking a representative instance.
  const seen = new Set<string>();
  const related: RecommendationEvidence[] = [], dated: RecommendationEvidence[] = [];
  for (const event of merged) {
    const messages = mail.filter(message => mentionsEvent(message, event) || bookingMentionsEventDate(message, event));
    if (messages.some(message => mentionsEventDate(message, event))) dated.push(event);
    else if (messages.length) related.push(event);
  }
  const specific = new Set([...dated, ...priority]);
  return [...dated, ...priority, ...related, ...merged].filter(item => {
    const event = item.calendar;
    if (event?.kind === 'overlap' && item.relatedIds?.some(id => freeIds.has(id))) return false;
    if (event?.kind === 'gap' && merged.some(other => other.calendar?.kind === 'event' && other.calendar.blocksTime !== false &&
      other.calendar.start < event.end && event.start < other.calendar.end)) return false;
    const key = event?.kind === 'event' ? occurrenceKey(item) : item.id;
    if (seen.has(key) || (event?.seriesId && seen.has(event.seriesId) && !specific.has(item))) return false;
    seen.add(key);
    if (event?.seriesId) seen.add(event.seriesId);
    return true;
  });
}
