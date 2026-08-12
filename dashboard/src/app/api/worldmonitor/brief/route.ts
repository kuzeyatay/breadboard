import { NextResponse } from "next/server";

import { buildSnapshot } from "@/lib/worldmonitor/aggregate";
import { chatmockFor, generateBrief } from "@/lib/worldmonitor/chatmock";
import { measuredContext } from "@/lib/worldmonitor/climate";
import { FEED_PANELS, panelLabel } from "@/lib/worldmonitor/feeds";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function scopeLabel(panels: string[]): string {
  if (panels.length === 0) return "global coverage across all panels";
  return panels.map(panelLabel).join(", ");
}

/**
 * The situational read at the top of the dashboard, written by ChatMock over
 * the current window. The snapshot is rebuilt here rather than accepted from
 * the client: what the model summarises has to be what the server actually
 * fetched, or a page could ask for a brief about headlines it invented.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => ({}));

    const panels: string[] = Array.isArray(body.panels)
      ? body.panels.filter(
          (panel: unknown): panel is string =>
            typeof panel === "string" && panel in FEED_PANELS,
        )
      : [];

    const snapshot = await buildSnapshot({ panels, perPanelLimit: 6 });
    if (snapshot.items.length === 0) {
      return NextResponse.json(
        { error: "No headlines in the current window to brief on." },
        { status: 503 },
      );
    }

    const ctx = chatmockFor(request, userId, {
      model: body.model,
      reasoningEffort: body.reasoningEffort,
    });
    const brief = await generateBrief(
      ctx,
      snapshot.items,
      scopeLabel(panels),
      await measuredContext(),
    );
    if (!brief.text) {
      return NextResponse.json(
        { error: "The model returned an empty brief." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      brief: brief.text,
      model: brief.model,
      basedOn: snapshot.items.slice(0, 24).map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        level: item.threat.level,
      })),
      escalation: snapshot.escalation,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
