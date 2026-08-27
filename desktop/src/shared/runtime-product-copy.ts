const RUNTIME_V2_LABEL = /\bRuntime V2\b/gi;

/** Keep the implementation version out of user-facing Runtime copy. */
export function runtimeProductText(value: string): string {
  return value.replace(RUNTIME_V2_LABEL, (match) =>
    match.startsWith("r") ? "runtime" : "Runtime",
  );
}

/** Apply the product label to plain diagnostic/state payloads before display. */
export function runtimeProductCopy<T>(value: T): T {
  if (typeof value === "string") return runtimeProductText(value) as T;
  if (Array.isArray(value)) return value.map(runtimeProductCopy) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, runtimeProductCopy(entry)]),
    ) as T;
  }
  return value;
}
