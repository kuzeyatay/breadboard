import type { BuildSkillResult } from "./builder.ts";
import type { DocumentSkillProgress } from "./types.ts";

/** Keep long model calls connected while the shared build runs independently. */
export function createDocumentSkillProgressStream(
  build: (report: (progress: DocumentSkillProgress) => void) => Promise<BuildSkillResult>,
  keepAliveMs = 15_000,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let connected = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        if (connected) controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      send({ type: "heartbeat" });
      timer = setInterval(() => send({ type: "heartbeat" }), keepAliveMs);
      // A closed viewer releases its timer but never cancels the shared build.
      void (async () => {
        try {
          const result = await build((progress) => send({ type: "progress", ...progress }));
          send({
            type: "done", done: true, cached: result.cached, warnings: result.warnings,
            skill: {
              slug: result.record.slug, title: result.record.title,
              status: result.record.status, chapterCount: result.record.chapterCount,
              sourceTokens: result.record.sourceTokens,
            },
          });
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : "The document skill could not be built" });
        } finally {
          clearInterval(timer);
          if (connected) controller.close();
          connected = false;
        }
      })();
    },
    cancel() {
      connected = false;
      clearInterval(timer);
    },
  });
}
