export interface QuartzAssistantSelectionRequest {
  requestId: string;
  text: string;
  pageSlug?: string;
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Validate selected text received from the cross-origin Quartz iframe. */
export function quartzAssistantSelectionRequest(
  value: unknown,
): QuartzAssistantSelectionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "second-brain:assistant-ask-here") return null;

  const requestId =
    typeof record.requestId === "string" ? record.requestId.trim() : "";
  const text =
    typeof record.text === "string" ? record.text.trim().slice(0, 4_000) : "";
  const pageSlug =
    typeof record.pageSlug === "string"
      ? record.pageSlug.trim().slice(0, 400)
      : "";
  if (!OPAQUE_ID.test(requestId) || !text) return null;
  return {
    requestId,
    text,
    ...(pageSlug ? { pageSlug } : {}),
  };
}
