import type { AgentOccurrence } from '../calendar/agent-query.ts';
import { parseStamp, toEpochMinutes } from '../calendar/wallclock.ts';
import { recommendationClock } from './clock.ts';
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
  const seen = new Set<number>();
  const selected = [...upcoming, ...recent].filter(event => {
    const series = event.seriesId ?? event.eventId;
    if (seen.has(series)) return false;
    seen.add(series); return true;
  }).slice(0, 8);
  const result: RecommendationEvidence[] = selected.map(event => {
    const status = event.end <= now ? 'recently-ended' : event.start <= now ? 'ongoing' : 'upcoming';
    return { id:id(event),source:'calendar',title:text(event.title),timestamp:event.start,
      calendar:{kind:'event',start:event.start,end:event.end,status,allDay:Boolean(event.allDay)},
      summary:text(`${status}. ${event.allDay ? 'All-day entry.' : ''} Scheduled ${event.start}–${event.end} in ${event.calendar}. ${event.location ? `Location: ${event.location}.` : ''} ${event.description ?? ''} Attendance and completion are unknown.`,800) };
  });
  const timed = upcoming.filter(event => !event.allDay);
  const overlaps: RecommendationEvidence[] = [];
  for (let i=0; i<timed.length && overlaps.length<2; i++) {
    for (let j=i+1; j<timed.length && timed[j].start<timed[i].end && overlaps.length<2; j++) {
      const a=timed[i], b=timed[j];
      // A local mirror can contain the same appointment more than once.
      if (a.title === b.title && a.start === b.start && a.end === b.end) continue;
      const start=a.start>b.start?a.start:b.start, end=a.end<b.end?a.end:b.end;
      overlaps.push({id:`calendar-overlap:${id(a)}:${id(b)}`,source:'calendar',title:`${text(a.title,70)} / ${text(b.title,70)}`,
        summary:`These two scheduled entries overlap from ${start} to ${end}. Review options; neither has been moved.`,
        calendar:{kind:'overlap',start,end},timestamp:start,relatedIds:[id(a),id(b)] });
    }
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
