export const CALENDAR_CHANGED_EVENT = 'breadboard:calendar:changed';

/** Contents remain in the calendar store; other tabs only receive invalidation. */
export function notifyCalendarChanged() {
  window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT));
  try { window.localStorage.setItem(CALENDAR_CHANGED_EVENT, `${Date.now()}:${Math.random()}`); }
  catch { /* Focus and periodic checks still refresh other views. */ }
}
