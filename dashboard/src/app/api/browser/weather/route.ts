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

/** Current weather or a seven-day forecast for a coarse device location or city. */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const requestUrl = new URL(request.url);
    const forecast = requestUrl.searchParams.get("forecast") === "7";
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
    if (forecast) {
      upstreamUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    } else {
      upstreamUrl.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,is_day");
    }
    upstreamUrl.searchParams.set("timezone", "auto");
    upstreamUrl.searchParams.set("forecast_days", forecast ? "7" : "1");
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
      daily?: {
        time?: unknown[];
        weather_code?: unknown[];
        temperature_2m_max?: unknown[];
        temperature_2m_min?: unknown[];
        precipitation_probability_max?: unknown[];
      };
      timezone?: unknown;
    };
    const timezone = typeof payload.timezone === "string" ? payload.timezone.slice(0, 100) : "UTC";
    if (forecast) {
      const daily = payload.daily;
      const dates = Array.isArray(daily?.time) ? daily.time.slice(0, 7) : [];
      const days = dates.flatMap((date, index) => {
        const code = numberValue(daily?.weather_code?.[index]);
        const minC = numberValue(daily?.temperature_2m_min?.[index]);
        const maxC = numberValue(daily?.temperature_2m_max?.[index]);
        const chance = numberValue(daily?.precipitation_probability_max?.[index]);
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || code === null || minC === null || maxC === null) return [];
        return [{
          date,
          code: Math.round(code),
          condition: weatherCondition(Math.round(code)),
          minC: Math.round(minC),
          maxC: Math.round(maxC),
          precipitationChance: chance === null ? null : Math.round(Math.max(0, Math.min(100, chance))),
        }];
      });
      if (days.length !== 7) {
        return NextResponse.json({ error: "Weather returned an incomplete forecast." }, { status: 502 });
      }
      return NextResponse.json({ timezone, days }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    const temperatureC = numberValue(payload.current?.temperature_2m);
    const apparentC = numberValue(payload.current?.apparent_temperature);
    const code = numberValue(payload.current?.weather_code);
    if (temperatureC === null || code === null) {
      return NextResponse.json({ error: "Weather returned an incomplete reading." }, { status: 502 });
    }
    const roundedCode = Math.round(code);
    return NextResponse.json(
      {
        latitude,
        longitude,
        temperatureC: Math.round(temperatureC),
        apparentC: Math.round(apparentC ?? temperatureC),
        code: roundedCode,
        condition: weatherCondition(roundedCode),
        isDay: payload.current?.is_day !== 0,
        timezone,
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
