/** Translate legacy web capability names to the Hermes names used at execution. */
export function hermesToolAccess(tools: Record<string, boolean> = {}): Record<string, boolean> {
  const access = { ...tools };
  for (const [native, legacy] of [["web_search", "websearch"], ["web_extract", "webfetch"]]) {
    if (access[native] === undefined && typeof tools[legacy] === "boolean") access[native] = tools[legacy];
  }
  return access;
}
