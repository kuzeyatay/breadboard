import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { weatherCondition } from "@/lib/weather/forecast.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

function coordinate(value: string | null, minimum: number, maximum: number): number | null {
  if (!value || value.length > 24) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? Math.round(parsed * 100) / 100
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Current weather for a consented coarse device location or a selected city. */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const requestUrl = new URL(request.url);
    const latitude = coordinate(requestUrl.searchParams.get("latitude"), -90, 90);
    const longitude = coordinate(requestUrl.searchParams.get("longitude"), -180, 180);
    if (latitude === null || longitude === null) {
      return NextResponse.json(
        { error: "A valid coarse location is required." },
        { status: 400 },
      );
    }

    const upstreamUrl = new URL(WEATHER_ENDPOINT);
    upstreamUrl.searchParams.set("latitude", String(latitude));
    upstreamUrl.searchParams.set("longitude", String(longitude));
    upstreamUrl.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,weather_code,is_day",
    );
    upstreamUrl.searchParams.set("timezone", "auto");
    upstreamUrl.searchParams.set("forecast_days", "1");
    const response = await fetch(upstreamUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Weather is temporarily unavailable." }, { status: 502 });
    }
    const payload = (await response.json()) as {
      current?: {
        temperature_2m?: unknown;
        apparent_temperature?: unknown;
        weather_code?: unknown;
        is_day?: unknown;
      };
      timezone?: unknown;
    };
    const temperatureC = numberValue(payload.current?.temperature_2m);
    const apparentC = numberValue(payload.current?.apparent_temperature);
    const code = numberValue(payload.current?.weather_code);
    if (temperatureC === null || code === null) {
      return NextResponse.json({ error: "Weather returned an incomplete reading." }, { status: 502 });
    }
    const roundedCode = Math.round(code);
    return NextResponse.json(
      {
        temperatureC: Math.round(temperatureC),
        apparentC: Math.round(apparentC ?? temperatureC),
        code: roundedCode,
        condition: weatherCondition(roundedCode),
        isDay: payload.current?.is_day !== 0,
        timezone: typeof payload.timezone === "string" ? payload.timezone.slice(0, 100) : "UTC",
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
