type Event = { type: string; payload: Record<string, unknown> };
/** Only user-facing output events cross into the shared room, never tool logs. */
export function runtimeOutput(events: readonly Event[], previous = "") {
  let body = previous;
  let status: "streaming" | "complete" | "failed" | "aborted" = "streaming";
  for (const event of events) {
    const p = event.payload;
    if (["run.result", "run.completed"].includes(event.type)) {
      const output = [p.result, p.summary, p.answer, p.content, p.text].find(value => typeof value === "string" && value.trim());
      if (typeof output === "string") body = output;
    }
    if (event.type === "run.completed") status = "complete";
    if (["run.failed", "run.aborted"].includes(event.type)) {
      status = event.type === "run.failed" ? "failed" : "aborted";
      const reason = [p.message, p.summary, p.error].find(value => typeof value === "string" && value.trim());
      body = typeof reason === "string" ? reason : status === "aborted" ? "The agent was stopped." : "The agent could not finish.";
    }
  }
  if (status === "complete" && !body.trim()) { body = "The agent finished without a text response. Its files remain in the run's chat."; }
  return { body, status };
}
