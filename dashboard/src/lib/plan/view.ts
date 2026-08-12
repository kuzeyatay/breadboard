// Which of Plan's two views is showing.
//
// This lives in lib, not beside the client component, for the same reason
// `CalendarView` lives in ../calendar/layout.ts: the server page parses it out
// of the query string before it renders. A Server Component that imports a
// value from a `"use client"` module gets a client reference, not the function
// — calling it throws "Attempted to call isPlanView() from the server".

export type PlanView = "board" | "calendar";

export function isPlanView(value: unknown): value is PlanView {
  return value === "board" || value === "calendar";
}
