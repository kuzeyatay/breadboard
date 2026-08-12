export const PROMPT_CATEGORIES = [
  "Custom",
  "Summary",
  "Study",
  "Analysis",
  "Writing",
] as const;

export interface SavePromptInput {
  title: string;
  category: string;
  content: string;
}

export interface SavedPromptResult {
  id: string;
  title: string;
  category: string;
  content: string;
}

type FetchPrompt = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function suggestedPromptTitle(content: string): string {
  const withoutCommand = content
    .replace(/^(?:\/[a-z0-9][a-z0-9_.:-]*(?:\s+|$))+/i, "")
    .trim();
  const source = withoutCommand || content.trim().replace(/^\/+/, "");
  const firstLine = source.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return (words || "Saved prompt").slice(0, 80);
}

export async function savePromptToCatalog(
  input: SavePromptInput,
  fetchPrompt: FetchPrompt = fetch,
): Promise<SavedPromptResult> {
  const title = input.title.trim();
  const content = input.content.trim();
  const category = input.category.trim() || "Custom";
  if (!title) throw new Error("Give this prompt a title.");
  if (!content) throw new Error("The prompt cannot be empty.");

  const response = await fetchPrompt("/api/hermes/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, category, content }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    prompt?: SavedPromptResult;
    message?: string;
    error?: string;
  };
  if (!response.ok || !payload.prompt) {
    throw new Error(
      payload.message ?? payload.error ?? "The prompt could not be saved.",
    );
  }
  return payload.prompt;
}
