import { parseDate, parseStamp } from '../calendar/wallclock.ts';
import type { RecommendationContext } from './types.ts';

/** Calendar rows are local wall clocks; never interpret them in the server's zone. */
export function recommendationClock(context: RecommendationContext, now = new Date()): RecommendationContext {
  let timeZone: string | undefined;
  try {
    if (context.timeZone) {
      new Intl.DateTimeFormat('en', { timeZone: context.timeZone }).format(now);
      timeZone = context.timeZone;
    }
  } catch { /* Invalid browser zone falls back to the validated local clock. */ }
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}), year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(now);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const time = `${part('hour')}:${part('minute')}`;
  const localDate = !timeZone && parseDate(context.localDate) ? context.localDate! : date;
  const localTime = !timeZone && parseStamp(`${localDate}T${context.localTime}`) ? context.localTime! : time;
  return { ...context, timeZone, localDate, localTime };
}
