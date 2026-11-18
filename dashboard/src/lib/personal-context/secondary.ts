import { getRecallConfig } from "../recall/config.ts";
import { getRecallSettings } from "../recall/settings.ts";
import { searchRecall } from "../recall/service.ts";
import { screenTimeRecommendationEvidence } from "../screen-time/recommendations.ts";
import { publicPage } from "./browser.ts";
import type { ContextFact } from "./rank.ts";
import type { PersonalQuery } from "./resolve.ts";

export async function secondaryContext(input: PersonalQuery): Promise<ContextFact[]> {
  const query = input.query,
    user = input.userId;
  const readers: Array<Promise<ContextFact[]>> = [];
  const settings = getRecallSettings(user);
  if (
    settings.agentAccess &&
    /\b(viewed|working|left off|screen|looking at|yesterday|recently|earlier)\b/i.test(query)
  ) {
    readers.push(
      screenTimeRecommendationEvidence(user).then((rows) =>
        rows.map((r) => ({
          title: r.title,
          ref: r.id,
          source: "activity",
          detail: r.summary,
          at: Date.parse(r.timestamp ?? "") || 0,
        })),
      ),
    );
    const config = getRecallConfig();
    if (config.enabled && settings.captureEnabled) {
      const terms = query
        .replace(
          /\b(what|where|was|were|did|the|about|from|that|yesterday|recently|earlier|looking|viewed|screen|working|left off|pick up)\b/gi,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim();
      readers.push(
        searchRecall(
          user,
          { query: terms || undefined, limit: 4, contentType: "screen" },
          { forAgent: true, config: { ...config, requestTimeoutMs: 750 } },
        ).then((result) => {
          if (JSON.stringify(getRecallSettings(user)) !== JSON.stringify(settings)) return [];
          return result.hits.map((h) => ({
            title: h.window || h.app || "Viewed screen",
            ref: "recall:" + h.frameId,
            source: "recall",
            detail: h.text.slice(0, 200),
            at: Date.parse(h.timestamp ?? "") || 0,
          }));
        }),
      );
    }
  }
  if (/\b(mail|message|inbox|meeting|invitation|sent|emailed|correspondence)\b/i.test(query)) {
    readers.push(
      import("../recommendations/sources.ts")
        .then((m) => m.connectedContextEvidence(user, query))
        .then((rows) =>
          rows.map((r) => ({
            title: r.title,
            source: "connection",
            ref: publicPage(r.id) || r.id,
            detail: r.summary,
            at: Date.parse(r.timestamp ?? "") || 0,
          })),
        ),
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const found: ContextFact[] = [];
  try {
    await Promise.race([
      Promise.allSettled(
        readers.map((read) =>
          read.then((rows) => {
            found.push(...rows);
          }),
        ),
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
    return found.slice();
  } finally {
    clearTimeout(timer);
  }
}
