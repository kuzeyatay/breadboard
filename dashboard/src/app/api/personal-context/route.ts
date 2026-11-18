import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-helpers";
import { getHermesUserSettings } from "@/lib/hermes/runtime-store";
import { learnedEvidence, recordOutcome, applyEventSuggestion } from "@/lib/personal-context/suggestions";
import { setContextFeedback } from "@/lib/personal-context/learning";
import { isSensitiveMemoryText, durableMemoryExclusionReason } from "@/lib/conversations/memory";
import { forgetDurableMemory, updateDurableMemoryContent } from "@/lib/conversations/memory-inspection";
import { invalidateRecommendations } from "@/lib/recommendations/service";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const user = await requireUserId();
    if (getHermesUserSettings(user).composerSwitches.personalize === false)
      return Response.json({ lessons: [] }, { headers });
    const params = new URL(request.url).searchParams;
    const room = params.get("room");
    if (room) {
      const { roomLessons } = await import("@/lib/personal-context/room");
      const thread = Number(params.get("thread"));
      const practices = roomLessons(
        db,
        user,
        room,
        Number.isSafeInteger(thread) && thread > 0 ? thread : null,
        "",
      );
      return Response.json(
        { prompts: practices.map((p) => "Help me apply our room decision: " + p.title) },
        { headers },
      );
    }
    const slug = params.get("garden") || undefined;
    const evidence = await learnedEvidence(user, slug);
    return Response.json(
      { lessons: evidence.map((e) => ({ title: e.title, lesson: e.lesson })) },
      { headers },
    );
  } catch (e) {
    return routeErrorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUserId(),
      body = await readJsonBody(request, 4096);
    if (getHermesUserSettings(user).composerSwitches.personalize === false)
      return Response.json({ error: "Personalization is off." }, { status: 403 });
    const scope = Number(body.scope);
    if (!Number.isSafeInteger(scope) || scope < 0)
      return Response.json({ error: "Invalid scope." }, { status: 400 });
    const slug = scope
      ? (db.prepare("SELECT slug FROM clusters WHERE id=? AND user_id=?").pluck().get(scope, user) as
          | string
          | undefined)
      : undefined;
    if (scope && !slug) return Response.json({ error: "Garden unavailable." }, { status: 404 });
    const item = (await learnedEvidence(user, slug)).find(
      (e) => e.lesson && e.lesson.key === body.key && e.lesson.basis === body.basis,
    );
    if (!item?.lesson) return Response.json({ error: "This suggestion has changed." }, { status: 409 });
    const { lesson } = item;
    const memory = /^memory:(\d+)$/.exec(lesson.sources[0] ?? "");
    switch (body.action) {
      case "apply":
        if (!lesson.eventId) return Response.json({ error: "Unsupported action." }, { status: 400 });
        applyEventSuggestion(db, user, item);
        break;
      case "accept":
      case "dismiss":
        recordOutcome(db, user, item, body.action === "accept" ? 1 : -1);
        break;
      case "forget":
      case "correct": {
        const value = typeof body.value === "string" ? body.value.trim() : null;
        if (
          body.action === "correct" &&
          (!value ||
            value.length > 300 ||
            isSensitiveMemoryText(value) ||
            durableMemoryExclusionReason(value))
        )
          return Response.json({ error: "Enter a short correction." }, { status: 400 });
        if (memory && body.action === "forget") {
          if (!forgetDurableMemory(user, Number(memory[1])))
            return Response.json({ error: "This memory has changed." }, { status: 409 });
        } else if (memory && value) {
          const result = updateDurableMemoryContent(user, Number(memory[1]), value);
          if (result.status !== "updated")
            return Response.json(
              { error: "Couldn’t apply this correction. Check the memory in Settings." },
              { status: 409 },
            );
        } else setContextFeedback(db, user, scope, lesson.key, body.action === "correct" ? value : null);
        break;
      }
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
    invalidateRecommendations(user);
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return routeErrorResponse(e);
  }
}
