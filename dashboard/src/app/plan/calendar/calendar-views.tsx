"use client";

// The four grids: month, week, day and agenda.
//
// Geometry lives in @/lib/calendar/layout — these components only paint it. The
// palette follows Breadboard's material rules: warm paper surfaces, one soft
// depth cue per element, and event colour applied as a tint plus a left rule
// rather than a saturated fill, so a busy week still reads as one document.

import { useEffect, useMemo, useRef } from "react";

import { useEventDrag, type DragResult } from "./use-event-drag";

import {
  formatShortDate,
  formatTime,
  formatTimeRange,
  MONTH_ABBREVIATIONS,
  WEEKDAY_ABBREVIATIONS,
} from "@/lib/calendar/format.ts";
import {
  buildMonthGrid,
  buildWeekDays,
  groupByDay,
  isBanner,
  layoutBanners,
  layoutTimedDay,
  rangeForView,
  type CalendarView,
} from "@/lib/calendar/layout.ts";
import type { CalendarCollection, CalendarOccurrence } from "@/lib/calendar/types.ts";
import { dateOf, floorToStep, minutesIntoDay } from "@/lib/calendar/wallclock.ts";

/** Row height of one hour in the week/day grid. */
const HOUR_HEIGHT_REM = 3;
const HOURS = 24;

/** Banner lanes a month cell shows before collapsing the rest into "+N more". */
const MONTH_LANE_LIMIT = 3;
/** Timed chips a month cell shows before collapsing the rest. */
const MONTH_TIMED_LIMIT = 2;

/**
 * A card from the Plan board that is due on a given day. The calendar draws
 * these beside the events so "what is happening" and "what is owed" read as one
 * week. Kept as a local shape rather than an import of the Plan types so the
 * calendar stays a calendar: it renders due chips, it does not know about
 * projects or columns.
 */
export interface DueTaskChip {
  id: number;
  title: string;
  /** The owning project's colour, so a chip matches its board. */
  color: string;
  done: boolean;
  urgent: boolean;
}

export interface ViewProps {
  view: CalendarView;
  anchor: string;
  today: string;
  /**
   * The client's wall clock, or null before hydration. The "now" line depends
   * on the current minute, which the server cannot know without producing a
   * hydration mismatch, so it is only drawn once the browser supplies one.
   */
  now: string | null;
  occurrences: readonly CalendarOccurrence[];
  calendarsById: Map<number, CalendarCollection>;
  /** Board cards due on each day, keyed by "YYYY-MM-DD". */
  dueTasks?: ReadonlyMap<string, readonly DueTaskChip[]>;
  onSelectTask?: (taskId: number) => void;
  onSelectOccurrence: (occurrence: CalendarOccurrence) => void;
  onCreateAt: (start: string, allDay: boolean) => void;
  onOpenDay: (date: string) => void;
  /** A completed drag: move by whole days, or move/resize by minutes. */
  onDropOccurrence: (result: DragResult) => void;
}

type DragApi = ReturnType<typeof useEventDrag>;

/** Marks an event the reader is currently dragging, so it reads as lifted. */
function dragStyle(dragging: boolean): React.CSSProperties {
  return dragging
    ? { opacity: 0.55, boxShadow: "var(--neu-strong-shadow)", cursor: "grabbing" }
    : {};
}

function colorOf(
  calendarsById: Map<number, CalendarCollection>,
  occurrence: CalendarOccurrence,
): string {
  return calendarsById.get(occurrence.calendarId)?.color ?? "#4f6f68";
}

/** A tint of the calendar colour over warm paper — never a saturated fill. */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, var(--paper-raised))`;
}

/**
 * A due board card, drawn as a bordered chip rather than a filled bar so it
 * never competes with a real event for the reader's eye. Completed work stays
 * visible but struck through: "I finished that" is information too.
 */
function DueChip({
  task,
  onSelect,
}: {
  task: DueTaskChip;
  onSelect?: (taskId: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(task.id)}
      title={`${task.title}${task.done ? " · done" : " · due"}`}
      className="pointer-events-auto flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-left text-[11px] leading-4 text-gray-300 hover:bg-gray-800/60"
      style={{
        borderLeft: `2px solid ${task.color}`,
        opacity: task.done ? 0.55 : 1,
      }}
    >
      <span
        className={`truncate ${task.done ? "line-through" : ""}`}
        style={{ color: task.urgent && !task.done ? "var(--danger)" : undefined }}
      >
        {task.title}
      </span>
    </button>
  );
}

function occurrenceLabel(occurrence: CalendarOccurrence): string {
  const when = occurrence.allDay
    ? "All day"
    : formatTimeRange(occurrence.start, occurrence.end);
  const where = occurrence.location ? ` · ${occurrence.location}` : "";
  return `${occurrence.title} · ${when}${where}`;
}

// ------------------------------------------------------------------ month

function MonthWeekRow({
  week,
  anchorMonth,
  today,
  occurrences,
  calendarsById,
  dueTasks,
  onSelectTask,
  onSelectOccurrence,
  onCreateAt,
  onOpenDay,
  drag,
}: {
  week: string[];
  anchorMonth: string;
  drag: DragApi;
  // No `now`: the month grid marks today by tinting its cell, not by drawing a
  // line at the current minute.
} & Omit<ViewProps, "view" | "anchor" | "now" | "onDropOccurrence">) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  /** One day column's width — the unit a month-grid drag moves in. */
  const dayWidth = () => (rowRef.current?.getBoundingClientRect().width ?? 0) / 7;

  const { segments } = useMemo(
    () => layoutBanners(occurrences, week),
    [occurrences, week],
  );

  const visibleSegments = segments.filter((segment) => segment.lane < MONTH_LANE_LIMIT);
  const laneCount = visibleSegments.reduce((max, s) => Math.max(max, s.lane + 1), 0);

  // Everything hidden in this row, counted per day column.
  const hiddenPerDay = new Array(7).fill(0);
  for (const segment of segments) {
    if (segment.lane < MONTH_LANE_LIMIT) continue;
    for (let column = segment.startColumn; column < segment.startColumn + segment.span; column += 1) {
      hiddenPerDay[column] += 1;
    }
  }

  const timedByDay = week.map((date) =>
    occurrences.filter(
      (occurrence) => !isBanner(occurrence) && dateOf(occurrence.start) === date,
    ),
  );
  timedByDay.forEach((items, index) => {
    if (items.length > MONTH_TIMED_LIMIT) {
      hiddenPerDay[index] += items.length - MONTH_TIMED_LIMIT;
    }
  });

  return (
    <div
      ref={rowRef}
      className="relative grid min-h-0 grid-cols-7"
      style={{
        // Keep the calendar's essential geometry local to the component. If a
        // generated utility stylesheet is stale during a desktop hot reload,
        // implicit grid tracks size themselves from event text and the whole
        // month shears apart.
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gridTemplateRows: `auto repeat(${laneCount}, auto) minmax(0, 1fr)`,
      }}
    >
      {/* Cell backgrounds sit under everything and carry the click-to-create
          target, so any empty space in a day opens a new event at 09:00. */}
      {week.map((date, index) => {
        const inMonth = date.slice(0, 7) === anchorMonth;
        return (
          <button
            key={`cell-${date}`}
            type="button"
            onClick={() => onCreateAt(`${date}T09:00`, false)}
            title={`New event on ${formatShortDate(date)}`}
            /* The cell background is set inline (it depends on today/in-month),
               so the hover cue has to be a shadow — a utility class would be
               overridden by the inline background. */
            className={`bb-calendar-cell border-b border-r ${inMonth ? "" : "opacity-55"}`}
            style={{
              gridColumn: index + 1,
              gridRow: "1 / -1",
              borderColor: "var(--neu-border)",
              backgroundColor:
                date === today
                  ? "color-mix(in srgb, var(--botanical) 12%, var(--paper-raised))"
                  : inMonth
                    ? "var(--paper-surface)"
                    : "color-mix(in srgb, var(--paper-surface) 60%, var(--paper-bg))",
            }}
          />
        );
      })}

      {/* Day numbers */}
      {week.map((date, index) => {
        const isToday = date === today;
        const day = Number(date.slice(8, 10));
        return (
          <div
            key={`num-${date}`}
            className="pointer-events-none flex items-center justify-between px-1.5 pt-1"
            style={{ gridColumn: index + 1, gridRow: 1 }}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDay(date);
              }}
              className={`pointer-events-auto rounded-full px-1.5 text-xs tabular-nums transition-colors ${
                isToday
                  ? "font-semibold text-white"
                  : "text-gray-500 hover:text-white"
              }`}
              style={
                isToday
                  ? {
                      backgroundColor: "var(--botanical)",
                      color: "var(--paper-raised)",
                    }
                  : undefined
              }
              title={`Open ${formatShortDate(date)}`}
            >
              {day === 1 ? `${day} ${MONTH_ABBREVIATIONS[Number(date.slice(5, 7)) - 1]}` : day}
            </button>
          </div>
        );
      })}

      {/* All-day and multi-day bars, spanning their day columns */}
      {visibleSegments.map((segment) => {
        const color = colorOf(calendarsById, segment.occurrence);
        return (
          <button
            key={segment.occurrence.key}
            type="button"
            onClick={() => onSelectOccurrence(segment.occurrence)}
            onPointerDown={(event) =>
              drag.begin(event, segment.occurrence, "move", { dayWidth: dayWidth() })
            }
            onPointerMove={drag.move}
            onPointerUp={drag.end}
            onPointerCancel={drag.cancel}
            title={occurrenceLabel(segment.occurrence)}
            className={`mx-1 mb-0.5 flex touch-none items-center gap-1 overflow-hidden truncate px-1.5 py-0.5 text-left text-[11px] leading-4 text-gray-200 transition-transform hover:-translate-y-px ${
              segment.occurrence.readOnly ? "" : "cursor-grab"
            } ${segment.continuesBefore ? "rounded-l-none" : "rounded-l-sm"} ${
              segment.continuesAfter ? "rounded-r-none" : "rounded-r-sm"
            }`}
            style={{
              gridColumn: `${segment.startColumn + 1} / span ${segment.span}`,
              gridRow: 2 + segment.lane,
              backgroundColor: tint(color, 26),
              borderLeft: segment.continuesBefore ? "none" : `3px solid ${color}`,
              boxShadow: "var(--neu-soft-shadow)",
              ...dragStyle(drag.isDragging(segment.occurrence)),
            }}
          >
            {segment.continuesBefore && <span aria-hidden="true">‹</span>}
            <span className="truncate font-medium">{segment.occurrence.title}</span>
            {segment.continuesAfter && <span className="ml-auto" aria-hidden="true">›</span>}
          </button>
        );
      })}

      {/* Timed events, listed inside their own day */}
      {week.map((date, index) => (
        <div
          key={`timed-${date}`}
          className="pointer-events-none flex min-h-0 flex-col gap-px overflow-hidden px-1 pb-1"
          style={{ gridColumn: index + 1, gridRow: 2 + laneCount }}
        >
          {/* Due work leads the day: an event is where you have to be, a card is
              something you owe, and the second is the one you can still act on. */}
          {(dueTasks?.get(date) ?? []).map((task) => (
            <DueChip key={`due-${task.id}`} task={task} onSelect={onSelectTask} />
          ))}
          {timedByDay[index].slice(0, MONTH_TIMED_LIMIT).map((occurrence) => {
            const color = colorOf(calendarsById, occurrence);
            return (
              <button
                key={occurrence.key}
                type="button"
                onClick={() => onSelectOccurrence(occurrence)}
                onPointerDown={(event) =>
                  drag.begin(event, occurrence, "move", { dayWidth: dayWidth() })
                }
                onPointerMove={drag.move}
                onPointerUp={drag.end}
                onPointerCancel={drag.cancel}
                title={occurrenceLabel(occurrence)}
                className={`pointer-events-auto flex touch-none items-center gap-1 truncate rounded-sm px-1 py-0.5 text-left text-[11px] leading-4 text-gray-300 hover:bg-gray-800/60 ${
                  occurrence.readOnly ? "" : "cursor-grab"
                }`}
                style={dragStyle(drag.isDragging(occurrence))}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="tabular-nums text-gray-500">
                  {formatTime(occurrence.start)}
                </span>
                <span className="truncate">{occurrence.title}</span>
                {occurrence.attendeeCount > 0 && (
                  <span className="shrink-0 text-gray-500" title={`${occurrence.attendeeCount} invited`}>
                    ·{occurrence.attendeeCount}
                  </span>
                )}
              </button>
            );
          })}
          {hiddenPerDay[index] > 0 && (
            <button
              type="button"
              onClick={() => onOpenDay(date)}
              className="pointer-events-auto truncate px-1 text-left text-[11px] leading-4 text-gray-500 hover:text-white"
            >
              +{hiddenPerDay[index]} more
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function MonthView(props: ViewProps) {
  const weeks = useMemo(() => buildMonthGrid(props.anchor), [props.anchor]);
  const anchorMonth = props.anchor.slice(0, 7);
  const drag = useEventDrag(props.onDropOccurrence);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid shrink-0 grid-cols-7 border-b"
        style={{
          borderColor: "var(--neu-border)",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        }}
      >
        {WEEKDAY_ABBREVIATIONS.map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-500"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6">
        {weeks.map((week) => (
          <MonthWeekRow
            key={week[0]}
            week={week}
            anchorMonth={anchorMonth}
            today={props.today}
            occurrences={props.occurrences}
            calendarsById={props.calendarsById}
            dueTasks={props.dueTasks}
            onSelectTask={props.onSelectTask}
            onSelectOccurrence={props.onSelectOccurrence}
            onCreateAt={props.onCreateAt}
            onOpenDay={props.onOpenDay}
            drag={drag}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- week / day

function TimeGridView(props: ViewProps) {
  const days = useMemo(
    () => (props.view === "week" ? buildWeekDays(props.anchor) : [dateOf(props.anchor)]),
    [props.view, props.anchor],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const hasScrolled = useRef(false);
  const drag = useEventDrag(props.onDropOccurrence);

  /** Pixels per minute down a day column — the unit a time-grid drag moves in. */
  const minuteHeight = () =>
    (gridRef.current?.getBoundingClientRect().height ?? 0) / (HOURS * 60);

  /** Pixels per day across the all-day strip, which excludes the hour gutter. */
  const bannerDayWidth = () => {
    const width = bannerRef.current?.getBoundingClientRect().width ?? 0;
    const gutter = parseFloat(getComputedStyle(document.documentElement).fontSize || "16") * 3.5;
    return Math.max(0, width - gutter) / days.length;
  };

  // Open on the working day rather than at midnight, but only once — a refetch
  // must not yank the reader back to 07:00.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || hasScrolled.current) return;
    hasScrolled.current = true;
    const remInPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    node.scrollTop = 7 * HOUR_HEIGHT_REM * remInPx;
  }, []);

  const { segments, laneCount } = useMemo(
    () => layoutBanners(props.occurrences, days),
    [props.occurrences, days],
  );

  const columnTemplate = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const nowFraction = props.now ? minutesIntoDay(props.now) / (HOURS * 60) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Day headers */}
      <div
        className="grid shrink-0 border-b"
        style={{ gridTemplateColumns: columnTemplate, borderColor: "var(--neu-border)" }}
      >
        <div />
        {days.map((date) => {
          const isToday = date === props.today;
          return (
            <button
              key={date}
              type="button"
              onClick={() => props.onOpenDay(date)}
              className="border-l px-2 py-1.5 text-left transition-colors hover:bg-gray-800/40"
              style={{ borderColor: "var(--neu-border)" }}
            >
              <div className="text-[11px] uppercase tracking-wider text-gray-500">
                {formatShortDate(date).slice(0, 3)}
              </div>
              <div
                className={`text-lg tabular-nums leading-tight ${
                  isToday ? "font-semibold" : "text-gray-400"
                }`}
                style={isToday ? { color: "var(--botanical)" } : undefined}
              >
                {Number(date.slice(8, 10))}
              </div>
            </button>
          );
        })}
      </div>

      {/* All-day banner strip */}
      {laneCount > 0 && (
        <div
          ref={bannerRef}
          className="grid shrink-0 border-b py-1"
          style={{
            gridTemplateColumns: columnTemplate,
            gridTemplateRows: `repeat(${laneCount}, auto)`,
            borderColor: "var(--neu-border)",
            backgroundColor: "color-mix(in srgb, var(--paper-surface) 70%, var(--paper-bg))",
          }}
        >
          <div
            className="pr-2 text-right text-[10px] uppercase tracking-wider text-gray-500"
            style={{ gridColumn: 1, gridRow: `1 / span ${laneCount}` }}
          >
            all day
          </div>
          {segments.map((segment) => {
            const color = colorOf(props.calendarsById, segment.occurrence);
            return (
              <button
                key={segment.occurrence.key}
                type="button"
                onClick={() => props.onSelectOccurrence(segment.occurrence)}
                onPointerDown={(event) =>
                  drag.begin(event, segment.occurrence, "move", {
                    dayWidth: bannerDayWidth(),
                  })
                }
                onPointerMove={drag.move}
                onPointerUp={drag.end}
                onPointerCancel={drag.cancel}
                title={occurrenceLabel(segment.occurrence)}
                className={`mx-1 mb-0.5 touch-none truncate rounded-sm px-1.5 py-0.5 text-left text-[11px] leading-4 text-gray-200 ${
                  segment.occurrence.readOnly ? "" : "cursor-grab"
                }`}
                style={{
                  gridColumn: `${segment.startColumn + 2} / span ${segment.span}`,
                  gridRow: segment.lane + 1,
                  backgroundColor: tint(color, 26),
                  borderLeft: segment.continuesBefore ? "none" : `3px solid ${color}`,
                  boxShadow: "var(--neu-soft-shadow)",
                  ...dragStyle(drag.isDragging(segment.occurrence)),
                }}
              >
                {segment.occurrence.title}
              </button>
            );
          })}
        </div>
      )}

      {/* Hour grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          className="grid"
          style={{
            gridTemplateColumns: columnTemplate,
            height: `${HOURS * HOUR_HEIGHT_REM}rem`,
          }}
        >
          <div className="relative">
            {Array.from({ length: HOURS }, (_, hour) => (
              <div
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-gray-500"
                style={{ top: `${(hour / HOURS) * 100}%` }}
              >
                {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {days.map((date) => {
            const blocks = layoutTimedDay(props.occurrences, date);
            return (
              <div
                key={date}
                className="bb-calendar-cell relative border-l"
                style={{
                  borderColor: "var(--neu-border)",
                  backgroundColor:
                    date === props.today
                      ? "color-mix(in srgb, var(--botanical) 7%, var(--paper-surface))"
                      : "var(--paper-surface)",
                }}
                onClick={(event) => {
                  // Only bare grid clicks create; a click on a block bubbles
                  // from the button below and is stopped there.
                  const rect = event.currentTarget.getBoundingClientRect();
                  const fraction = (event.clientY - rect.top) / rect.height;
                  const minutes = Math.max(0, Math.min(HOURS * 60 - 1, fraction * HOURS * 60));
                  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
                  const minute = String(Math.floor(minutes % 60)).padStart(2, "0");
                  props.onCreateAt(floorToStep(`${date}T${hour}:${minute}`), false);
                }}
              >
                {Array.from({ length: HOURS }, (_, hour) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t"
                    style={{
                      top: `${(hour / HOURS) * 100}%`,
                      borderColor:
                        hour % 6 === 0
                          ? "var(--neu-border)"
                          : "color-mix(in srgb, var(--neu-border) 45%, transparent)",
                    }}
                  />
                ))}

                {date === props.today && props.now && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                    style={{ top: `${nowFraction * 100}%` }}
                  >
                    <span
                      className="-ml-1 size-2 rounded-full"
                      style={{ backgroundColor: "var(--danger)" }}
                    />
                    <span
                      className="h-px flex-1"
                      style={{ backgroundColor: "var(--danger)" }}
                    />
                  </div>
                )}

                {blocks.map((block) => {
                  const color = colorOf(props.calendarsById, block.occurrence);
                  const editable = !block.occurrence.readOnly;
                  return (
                    <div
                      key={block.occurrence.key}
                      className="absolute z-10 hover:z-30"
                      style={{
                        top: `${block.top * 100}%`,
                        height: `${block.height * 100}%`,
                        left: `calc(${(block.column / block.columns) * 100}% + 2px)`,
                        width: `calc(${(1 / block.columns) * 100}% - 4px)`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onSelectOccurrence(block.occurrence);
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          drag.begin(event, block.occurrence, "move", {
                            minuteHeight: minuteHeight(),
                          });
                        }}
                        onPointerMove={drag.move}
                        onPointerUp={drag.end}
                        onPointerCancel={drag.cancel}
                        title={occurrenceLabel(block.occurrence)}
                        className={`size-full touch-none overflow-hidden rounded-sm px-1.5 py-0.5 text-left text-[11px] leading-4 text-gray-200 ${
                          editable ? "cursor-grab" : ""
                        }`}
                        style={{
                          backgroundColor: tint(color, 24),
                          borderLeft: `3px solid ${color}`,
                          boxShadow: "var(--neu-soft-shadow)",
                          ...dragStyle(drag.isDragging(block.occurrence)),
                        }}
                      >
                        <div className="truncate font-medium">
                          {block.occurrence.title}
                          {block.occurrence.attendeeCount > 0 && (
                            <span className="ml-1 font-normal text-gray-500">
                              · {block.occurrence.attendeeCount}
                            </span>
                          )}
                        </div>
                        <div className="truncate tabular-nums text-gray-500">
                          {formatTimeRange(block.occurrence.start, block.occurrence.end)}
                        </div>
                      </button>

                      {/* Resize grip. Its own pointer target so grabbing the
                          bottom edge lengthens the meeting instead of moving it. */}
                      {editable && (
                        <div
                          role="slider"
                          tabIndex={-1}
                          aria-label={`Change the end of ${block.occurrence.title}`}
                          aria-valuetext={formatTime(block.occurrence.end)}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            drag.begin(event, block.occurrence, "resize", {
                              minuteHeight: minuteHeight(),
                            });
                          }}
                          onPointerMove={drag.move}
                          onPointerUp={drag.end}
                          onPointerCancel={drag.cancel}
                          onClick={(event) => event.stopPropagation()}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none opacity-0 transition-opacity hover:opacity-100"
                          style={{ backgroundColor: color }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- agenda

function AgendaView(props: ViewProps) {
  const range = useMemo(() => rangeForView("agenda", props.anchor), [props.anchor]);
  const eventGroups = useMemo(
    () => groupByDay(props.occurrences, range),
    [props.occurrences, range],
  );

  // A day with due work but no events still belongs on the agenda — otherwise
  // "nothing scheduled" would hide a deadline. The two sources are merged here
  // rather than in groupByDay, which is shared with the calendar's own views.
  const groups = useMemo(() => {
    const byDate = new Map(
      eventGroups.map((group) => [
        group.date,
        { date: group.date, occurrences: group.occurrences, tasks: [] as DueTaskChip[] },
      ]),
    );
    const firstDate = range.from.slice(0, 10);
    const lastDate = range.to.slice(0, 10);
    for (const [date, tasks] of props.dueTasks ?? []) {
      if (date < firstDate || date > lastDate) continue;
      const existing = byDate.get(date);
      if (existing) existing.tasks = [...tasks];
      else byDate.set(date, { date, occurrences: [], tasks: [...tasks] });
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [eventGroups, props.dueTasks, range.from, range.to]);

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm text-gray-400">Nothing scheduled in the next 30 days.</p>
          <button
            type="button"
            onClick={() => props.onCreateAt(`${props.anchor}T09:00`, false)}
            className="neu-button-accent mt-4 rounded-lg border px-4 py-2 text-sm"
          >
            Add an event
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {groups.map((group) => (
          <section key={group.date} className="flex gap-4">
            <div className="w-20 shrink-0 pt-1 text-right">
              <div
                className={`text-2xl tabular-nums leading-none ${
                  group.date === props.today ? "font-semibold" : "text-gray-400"
                }`}
                style={
                  group.date === props.today ? { color: "var(--botanical)" } : undefined
                }
              >
                {Number(group.date.slice(8, 10))}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">
                {formatShortDate(group.date).replace(/\s\d+\s/, " ")}
              </div>
            </div>

            <ul className="min-w-0 flex-1 space-y-1.5">
              {group.tasks.map((task) => (
                <li key={`${group.date}-task-${task.id}`}>
                  <button
                    type="button"
                    onClick={() => props.onSelectTask?.(task.id)}
                    className="neu-surface-subtle flex w-full items-baseline gap-3 rounded-lg border px-3 py-2 text-left transition-transform hover:-translate-y-px"
                    style={{ borderLeft: `3px solid ${task.color}`, opacity: task.done ? 0.6 : 1 }}
                  >
                    <span className="w-24 shrink-0 text-xs text-gray-500">
                      {task.done ? "Done" : "Due"}
                    </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-sm text-white ${
                          task.done ? "line-through" : ""
                        }`}
                      >
                        {task.title}
                      </span>
                  </button>
                </li>
              ))}
              {group.occurrences.map((occurrence) => {
                const color = colorOf(props.calendarsById, occurrence);
                return (
                  <li key={`${group.date}-${occurrence.key}`}>
                    <button
                      type="button"
                      onClick={() => props.onSelectOccurrence(occurrence)}
                      className="neu-surface-subtle flex w-full items-baseline gap-3 rounded-lg border px-3 py-2 text-left transition-transform hover:-translate-y-px"
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <span className="w-24 shrink-0 tabular-nums text-xs text-gray-500">
                        {occurrence.allDay
                          ? "All day"
                          : formatTimeRange(occurrence.start, occurrence.end)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white">
                          {occurrence.title}
                        </span>
                        {occurrence.location && (
                          <span className="block truncate text-xs text-gray-500">
                            {occurrence.location}
                          </span>
                        )}
                      </span>
                      {occurrence.attendeeCount > 0 && (
                        <span
                          className="shrink-0 text-xs text-gray-500"
                          title={`${occurrence.attendeeCount} invited`}
                        >
                          {occurrence.attendeeCount} invited
                        </span>
                      )}
                      {occurrence.readOnly && (
                        <span className="shrink-0 text-xs text-gray-500" title="Subscribed calendar">
                          🔒
                        </span>
                      )}
                      {occurrence.recurring && (
                        <span
                          className="shrink-0 text-xs text-gray-500"
                          title={occurrence.isOverride ? "Changed occurrence" : "Repeats"}
                        >
                          {occurrence.isOverride ? "↻*" : "↻"}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function CalendarGrid(props: ViewProps) {
  if (props.view === "month") return <MonthView {...props} />;
  if (props.view === "agenda") return <AgendaView {...props} />;
  return <TimeGridView {...props} />;
}
