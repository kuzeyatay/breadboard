import { NextResponse } from "next/server";
import { RouteError } from "../server-auth.ts";
import { SupervisorResourceExhaustedError } from "../supervisor-control.ts";
import { musicError } from "./errors.ts";
export function musicRouteError(error: unknown) {
  const failure = musicError(error);
  const status = error instanceof RouteError ? error.status : error instanceof SupervisorResourceExhaustedError || failure.code === "BREADBOARD_RESOURCE_EXHAUSTED" ? 503 : 400;
  return NextResponse.json({ ok: false, error: failure.message, code: failure.code }, { status });
}
