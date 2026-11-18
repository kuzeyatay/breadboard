import { normalizeAssistantModelId } from "./ai-models.ts";
import { localChatmockBaseUrl } from "./chatmock-server.ts";

export interface ChatmockModel {
  id: string;
  object: "model";
  owned_by: string;
  reasoning_efforts: string[];
  name?: string;
}

/** The gateway owns model availability; the runtime can address its concrete ids. */
export async function loadChatmockModelCatalog(
  baseUrl = process.env.CHATMOCK_BASE_URL?.trim() || localChatmockBaseUrl(),
): Promise<ChatmockModel[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Model catalog returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.data)) throw new Error("Invalid model catalog");
  return payload.data.flatMap((row: unknown): ChatmockModel[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = normalizeAssistantModelId(item.id);
    if (!id || ["none", "default", "chat", "auto"].includes(id)) return [];
    return [{
      id,
      object: "model",
      owned_by: typeof item.owned_by === "string" ? item.owned_by : "chatmock",
      reasoning_efforts: Array.isArray(item.reasoning_efforts)
        ? item.reasoning_efforts.filter((value): value is string => typeof value === "string") : [],
      ...(typeof item.name === "string" ? { name: item.name } : {}),
    }];
  });
}
