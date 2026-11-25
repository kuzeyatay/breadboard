import * as path from "node:path";

// Pure Start-menu matching for open_app, kept free of Electron so it is testable.

export const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best Start-menu/Desktop shortcut for a spoken app name, or null. */
export function findShortcut(name: string, shortcuts: readonly string[]): string | null {
  const wanted = normalize(name);
  if (!wanted) return null;
  const words = wanted.split(" ");
  let best: { file: string; score: number } | null = null;
  for (const file of shortcuts) {
    const label = normalize(path.basename(file).replace(/\.(?:lnk|url|appref-ms)$/i, ""));
    if (/\b(?:uninstall|readme|help|documentation|release notes)\b/.test(label)) continue;
    let score = 0;
    if (label === wanted) score = 1_000;
    else if (label.startsWith(wanted)) score = 800 - label.length;
    else if (label.includes(wanted)) score = 600 - label.length;
    else if (words.every((word) => label.includes(word))) score = 400 - label.length;
    else continue;
    // Prefer the newest version when several match ("Studio Pro 10…", "…11.17.0").
    // Read the raw filename: normalize() has already turned "11.17.0" into "11 17 0".
    const version = /(\d+(?:\.\d+)+)/.exec(path.basename(file))?.[1];
    if (version) score += version.split(".").reduce((sum, part, index) => sum + Number(part) / 100 ** index, 0) / 100;
    if (!best || score > best.score) best = { file, score };
  }
  return best?.file ?? null;
}
