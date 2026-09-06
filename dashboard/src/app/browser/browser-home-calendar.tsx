"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import OverflowMarquee from "@/app/components/overflow-marquee";
import type { CalendarCollection, CalendarOccurrence } from "@/lib/calendar/types";
import { formatShortDate, formatTimeRange, monthAbbreviation } from "@/lib/calendar/format";
import { addDays, dateOf, nowStamp, startOfDay, todayDate } from "@/lib/calendar/wallclock";
import { BrowserSketchOutline } from "./browser-home-widgets";
import { DockPopover } from "./browser-dock-popovers";
import styles from "./browser-dock-popovers.module.css";

export default function BrowserHomeCalendar({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [occurrences, setOccurrences] = useState<CalendarOccurrence[]>([]);
  const [now, setNow] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let disposed = false;
    let request: AbortController | null = null;

    async function refresh() {
      if (document.visibilityState === "hidden") return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const options = { cache: "no-store" as const, signal: controller.signal };
      const today = todayDate();
      setNow(nowStamp());
      try {
        const calendarsResponse = await fetch("/api/calendar/calendars", options);
        if (!calendarsResponse.ok) throw new Error("Calendar unavailable");
        const { calendars } = await calendarsResponse.json() as { calendars: CalendarCollection[] };
        const visibleIds = calendars.filter((calendar) => calendar.visible).map((calendar) => calendar.id);
        let nextOccurrences: CalendarOccurrence[] = [];
        if (visibleIds.length > 0) {
          const params = new URLSearchParams({
            from: today,
            to: dateOf(addDays(startOfDay(today), 6)),
            calendarIds: visibleIds.join(","),
          });
          const response = await fetch(`/api/calendar/events?${params}`, options);
          if (!response.ok) throw new Error("Calendar unavailable");
          const body = await response.json() as { occurrences: CalendarOccurrence[] };
          if (!Array.isArray(body.occurrences)) throw new Error("Calendar unavailable");
          nextOccurrences = body.occurrences;
        }
        if (disposed || controller.signal.aborted) return;
        setOccurrences(nextOccurrences);
        setStatus("ready");
      } catch {
        if (disposed || controller.signal.aborted) return;
        setStatus("error");
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      request?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [retry]);

  const today = now ? dateOf(now) : null;
  const upcoming = now ? occurrences
    .filter((event) => event.end >= now)
    .sort((left, right) => left.start.localeCompare(right.start)) : [];
  const next = upcoming[0];
  const date = next ? (today && dateOf(next.start) < today ? today : dateOf(next.start)) : today;
  const calendarHref = (date: string | null) => `/plan?${new URLSearchParams({ view: "calendar", calendarView: "day", ...(date ? { date } : {}) })}`;
  const dayLabel = (date: string | null) => date && today
    ? date === today ? "Today" : date === dateOf(addDays(startOfDay(today), 1)) ? "Tomorrow" : formatShortDate(date)
    : "";
  const eventTime = next?.allDay ? "All day" : next ? formatTimeRange(next.start, next.end) : "";
  const happeningNow = next && !next.allDay && now && next.start <= now;

  return (
    <DockPopover
      panel="calendar"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button ref={cardRef} type="button" className="browser-home-calendar" aria-label="Open calendar widget">
          <BrowserSketchOutline targetRef={cardRef} index={3} />
          <span className="browser-home-calendar-heading">
            <CalendarDays size={14} aria-hidden="true" />
            <span>Calendar</span>
            <ChevronUp size={14} aria-hidden="true" />
          </span>
          <span className="browser-home-calendar-event" aria-busy={status === "loading"}>
            <span className="browser-home-calendar-date" aria-hidden="true">
              <span>{date ? monthAbbreviation(date) : "—"}</span>
              <strong>{date ? Number(date.slice(8, 10)) : "—"}</strong>
            </span>
            <span className="browser-home-calendar-copy">
              <OverflowMarquee className="browser-home-calendar-when">{happeningNow ? "Now" : next ? dayLabel(date) : "This week"}{eventTime && ` · ${eventTime}`}</OverflowMarquee>
              <strong title={next?.title}>
                <OverflowMarquee>{status === "error" ? "Couldn’t load events" : status === "loading" ? "Your upcoming events" : next?.title ?? "No upcoming events"}</OverflowMarquee>
              </strong>
              <OverflowMarquee className="browser-home-calendar-detail">{status === "error" ? "Open to try again" : next?.location || "View upcoming events"}</OverflowMarquee>
            </span>
          </span>
        </button>
      }
    >
      {status === "error" ? (
        <div role="status">
          <p className={styles.note}>Couldn’t load events.</p>
          <button type="button" className={styles.action} onClick={() => { setStatus("loading"); setRetry((value) => value + 1); }}>Try again</button>
        </div>
      ) : status === "loading" ? (
        <p className={styles.note} role="status">Loading your upcoming events…</p>
      ) : upcoming.length ? (
        <ul className={styles.calendarEvents} aria-label="Upcoming events">
          {upcoming.map((event) => {
            const eventDate = today && dateOf(event.start) < today ? today : dateOf(event.start);
            const isNow = !event.allDay && now && event.start <= now;
            return (
              <li key={event.key}>
                <Link href={calendarHref(eventDate)} className={styles.calendarEvent} onClick={() => onOpenChange(false)}>
                  <span className={styles.calendarDate} aria-hidden="true">
                    <span>{monthAbbreviation(eventDate)}</span>
                    <strong>{Number(eventDate.slice(8, 10))}</strong>
                  </span>
                  <span className={styles.calendarCopy}>
                    <small>{isNow ? "Now" : dayLabel(eventDate)} · {event.allDay ? "All day" : formatTimeRange(event.start, event.end)}</small>
                    <strong>{event.title}</strong>
                    {event.location && <small>{event.location}</small>}
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.note} role="status">No upcoming events this week.</p>
      )}
      <footer className={styles.footer}>
        <span>Next 7 days</span>
        <Link href={calendarHref(date)} onClick={() => onOpenChange(false)}>Open full calendar ↗</Link>
      </footer>
    </DockPopover>
  );
}
