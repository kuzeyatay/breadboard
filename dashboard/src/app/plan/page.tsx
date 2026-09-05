import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { isCalendarView, type CalendarView } from "@/lib/calendar/layout.ts";
import { parseDate, todayDate } from "@/lib/calendar/wallclock.ts";
import {
  isPlanBoardScope,
  type PlanBoardScope,
} from "@/lib/plan/board-scope.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { isPlanView, type PlanView } from "@/lib/plan/view.ts";
import PlanClient from "./plan-client";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plan — breadboard",
  description: "Your projects, your board, and your calendar in one place.",
};

/**
 * Plan opens in its own tab from the navbar, so it renders its own shell rather
 * than the dashboard's — the same arrangement the calendar had before it moved
 * in here as a view.
 *
 * Which view, project, date and board scope are read from the query string (the
 * client keeps them there with replaceState) so a reload or a bookmark comes
 * back to the same place.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/plan");

  const userId = Number((session.user as { id?: string }).id);
  const params = await searchParams;
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const planStore = getPlanStore();
  // Creates the default project on a first visit, so the board is never an
  // empty screen with a form on it.
  const projects = planStore.listProjectsEnsuringDefault(userId);
  const labels = planStore.listLabels(userId);

  const requestedProject = Number(first("project"));
  const activeProject =
    projects.find((project) => project.id === requestedProject) ?? projects[0];
  const board = activeProject ? planStore.getBoard(userId, activeProject.id) : null;

  const calendars = getCalendarStore().listCalendarsEnsuringDefault(userId);

  const rawView = first("view");
  const view: PlanView = isPlanView(rawView) ? rawView : "board";
  const rawBoardScope = first("boardScope");
  const boardScope: PlanBoardScope = isPlanBoardScope(rawBoardScope)
    ? rawBoardScope
    : "all";
  const rawCalendarView = first("calendarView");
  const calendarView: CalendarView = isCalendarView(rawCalendarView)
    ? rawCalendarView
    : "month";
  const rawDate = first("date");
  const today = todayDate();
  const anchor = rawDate && parseDate(rawDate) ? rawDate : today;

  return (
    <PlanClient
      initialProjects={projects}
      initialBoard={board}
      initialLabels={labels}
      initialView={view}
      initialBoardScope={boardScope}
      initialCalendars={calendars}
      initialCalendarView={calendarView}
      initialToday={today}
      initialAnchor={anchor}
      showNavbarFlowers={getNavbarFlowers(userId)}
    />
  );
}
