"use client";

export interface AssistantModelCatalogRow {
  id?: unknown;
  reasoning_efforts?: unknown;
  [key: string]: unknown;
}

let cachedRows: AssistantModelCatalogRow[] | null = null;
let inFlight: Promise<AssistantModelCatalogRow[]> | null = null;

/** One request shared by every mounted model picker and intelligence control. */
export async function loadAssistantModelCatalog(
  options: { force?: boolean } = {},
): Promise<AssistantModelCatalogRow[]> {
  if (inFlight) return inFlight;
  if (!options.force && cachedRows) return cachedRows;
  const request = fetch("/api/models", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Models could not be loaded.");
      const data = await response.json().catch(() => ({}));
      const rows: AssistantModelCatalogRow[] = Array.isArray(data?.data) ? data.data : [];
      cachedRows = rows;
      return rows;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = request;
  return request;
}

export function invalidateAssistantModelCatalog(): void {
  cachedRows = null;
}
