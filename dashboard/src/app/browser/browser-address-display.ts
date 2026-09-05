/**
 * Keep the idle address bar compact without changing the URL users edit.
 *
 * HTTPS is the ordinary secure case, so browsers omit that scheme until the
 * field is focused. Insecure HTTP remains explicit: hiding it would remove the
 * only warning currently present in the address text.
 */
export function browserAddressDisplayValue(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return value;

    const display = url.href.slice("https://".length);
    return url.pathname === "/" && !url.search && !url.hash
      ? display.replace(/\/$/u, "")
      : display;
  } catch {
    return value;
  }
}
