import type { BreadboardWindowTheme } from "./window-options";

/**
 * The native canvas visible before an external page's first paint.
 *
 * Light pages start on browser white instead of Breadboard's warm paper. Once
 * the page paints, its own CSS and account-level appearance are authoritative:
 * the shell must not invert or recolour arbitrary site content.
 */
export function browserPageBackgroundColor(theme: BreadboardWindowTheme): string {
  return theme === "dark" ? "#0b0c0a" : "#ffffff";
}
