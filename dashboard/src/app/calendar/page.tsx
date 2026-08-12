import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The calendar is a view of /plan now, not a page of its own. This is the
 * forwarding address: bookmarks, the desktop shell's shortcuts and any link
 * written before the move still land on the calendar, carrying whichever week
 * and sub-view they were pointing at.
 */
export default async function CalendarRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const forwarded = new URLSearchParams({ view: "calendar" });
  // /calendar?view=week meant the calendar's own sub-view, which /plan spells
  // `calendarView` because `view` there chooses between board and calendar.
  const calendarView = first("view");
  if (calendarView) forwarded.set("calendarView", calendarView);
  const date = first("date");
  if (date) forwarded.set("date", date);

  redirect(`/plan?${forwarded}`);
}
