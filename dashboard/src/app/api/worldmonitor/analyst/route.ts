import { NextResponse } from "next/server";

import { buildSnapshot } from "@/lib/worldmonitor/aggregate";
import { chatmockFor, streamAnalystAnswer, type AnalystTurn } from "@/lib/worldmonitor/chatmock";
import { measuredContext } from "@/lib/worldmonitor/climate";
import { FEED_PANELS, panelLabel } from "@/lib/worldmonitor/feeds";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function parseHistory(value: unknown): AnalystTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        return null;
      }
      return { role, content: content.trim() } satisfies AnalystTurn;
    })
    .filter((turn): turn is AnalystTurn => Boolean(turn?.content));
}

/**
 * Ask the analyst. The answer streams as plain text, grounded only in the
 * window the server just fetched — the prompt tells the model to say so when
 * the context does not cover the question rather than answer from memory.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => ({}));

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json({ error: "A question is required" }, { status: 400 });
    }

    const panels: string[] = Array.isArray(body.panels)
      ? body.panels.filter(
          (panel: unknown): panel is string =>
            typeof panel === "string" && panel in FEED_PANELS,
        )
      : [];

    const snapshot = await buildSnapshot({ panels, perPanelLimit: 6 });
    const ctx = chatmockFor(request, userId, {
      model: body.model,
      reasoningEffort: body.reasoningEffort,
    });

    const stream = await streamAnalystAnswer(ctx, {
      question,
      history: parseHistory(body.history),
      items: snapshot.items,
      escalation: snapshot.escalation,
      scopeLabel: panels.length
        ? panels.map(panelLabel).join(", ")
        : "global coverage across all panels",
      measured: await measuredContext(),
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Worldmonitor-Model": ctx.model,
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
