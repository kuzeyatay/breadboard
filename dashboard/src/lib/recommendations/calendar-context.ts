import type { AgentOccurrence } from '../calendar/agent-query.ts';
import { parseStamp, toEpochMinutes } from '../calendar/wallclock.ts';
import { recommendationClock } from './clock.ts';
import { calendarConflicts } from './planning-context.ts';
import { cleanRecommendationText as text, type RecommendationContext, type RecommendationEvidence } from './types.ts';

const minutes = (stamp: string) => { const parsed = parseStamp(stamp); return parsed ? toEpochMinutes(parsed) : NaN; };
const id = (event: AgentOccurrence) => `calendar:${event.eventId}:${event.start}`;

/** Use expanded instances from Breadboard's Calendar, including edited series.
 * Only a complete agenda can establish a gap; an empty/truncated read cannot. */
export function calendarRecommendationEvidence(events: readonly AgentOccurrence[], context: RecommendationContext, complete: boolean): RecommendationEvidence[] {
  const clock = recommendationClock(context);
  const now = `${clock.localDate}T${clock.localTime}`;
  const nowMinute = minutes(now);
  const valid = events.filter(event => Number.isFinite(minutes(event.start)) && minutes(event.end) > minutes(event.start))
    .sort((a,b) => a.start.localeCompare(b.start));
  const relevant = valid.filter(event => minutes(event.end) > nowMinute - 120);
  const upcoming = relevant.filter(event => event.end > now);
  const recent = relevant.filter(event => event.end <= now && !event.allDay);
  // Keep instances until collection merges Google calendars and booking mail.
  // The second occurrence of a weekly class may be the one that conflicts.
  const result = [...upcoming, ...recent].map((event): RecommendationEvidence => {
    const status = event.end <= now ? 'recently-ended' : event.start <= now ? 'ongoing' : 'upcoming';
    return { id:id(event),source:'calendar',title:text(event.title),timestamp:event.start,
      calendar:{kind:'event',start:event.start,end:event.end,status,allDay:Boolean(event.allDay),location:text(event.location,180) || undefined,seriesId:`local:${event.seriesId ?? event.eventId}`},
      summary:text(`${status}. ${event.allDay ? 'All-day entry.' : ''} Scheduled ${event.start}–${event.end} in ${event.calendar}. ${event.location ? `Location: ${event.location}.` : ''} ${event.description ?? ''} Attendance and completion are unknown.`,800) };
  });
  const timed = upcoming.filter(event => !event.allDay);
  const overlaps: RecommendationEvidence[] = [];
  for (const [a, b] of calendarConflicts(result.filter(item => !item.calendar?.allDay))) {
    const start = b.calendar.start, end = a.calendar.end < b.calendar.end ? a.calendar.end : b.calendar.end;
    overlaps.push({id:`calendar-overlap:${a.id}:${b.id}`,source:'calendar',title:`${text(a.title,70)} / ${text(b.title,70)}`,
      summary:`These two scheduled entries overlap from ${start} to ${end}. Review options; neither has been moved.`,
      calendar:{kind:'overlap',start,end},timestamp:start,relatedIds:[a.id,b.id] });
    if (overlaps.length === 2) break;
  }
  // Suggest a real opening today only within a bounded daytime window. This
  // describes the calendar, not the user's availability or working hours.
  if (complete && valid.length && !upcoming.some(event => event.allDay && event.start <= `${clock.localDate}T23:59`)) {
    const start = now > `${clock.localDate}T08:00` ? now : `${clock.localDate}T08:00`;
    const end = `${clock.localDate}T20:00`;
    let cursor = start;
    const today = timed.filter(event => event.end > start && event.start < end);
    for (const event of [...today, {start:end,end}]) {
      const boundary=event.start<end?event.start:end;
      if (minutes(boundary)-minutes(cursor)>=25) {
        result.push({id:`calendar-gap:${cursor}:${boundary}`,source:'calendar',title:`${cursor.slice(11)}–${boundary.slice(11)} today`,
          summary:`No scheduled entries in the loaded Breadboard Calendar between ${cursor} and ${boundary}. This is not proof of availability. Offer a short focus plan for an actual task or recently viewed topic, subject to the user's choice.`,
          calendar:{kind:'gap',start:cursor,end:boundary},timestamp:cursor});
        break;
      }
      if(event.end>cursor) cursor=event.end;
    }
  }
  return [...overlaps.slice(0,1), ...result.filter(item=>item.calendar?.kind==='event').slice(0,2),
    ...result.filter(item=>item.calendar?.kind==='gap'), ...overlaps.slice(1), ...result.filter(item=>item.calendar?.kind==='event').slice(2)];
}
