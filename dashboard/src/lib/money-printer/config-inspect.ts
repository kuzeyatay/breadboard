import fs from "node:fs";
import path from "node:path";
import type { FootageCredentialKey } from "./credentials.ts";

export function configuredFootageSources(root: string): FootageCredentialKey[] {
  let source: string;
  try {
    source = fs.readFileSync(path.join(root, "config.toml"), "utf8");
  } catch {
    return [];
  }
  const found: FootageCredentialKey[] = [];
  for (const [key, setting] of [
    ["pexels", "pexels_api_keys"],
    ["pixabay", "pixabay_api_keys"],
    ["coverr", "coverr_api_keys"],
  ] as const) {
    const match = new RegExp(String.raw`^[ \t]*${setting}\s*=([^\]]*)\]`, "m").exec(source);
    if (match && /"[^"]+"|'[^']+'/.test(match[1])) found.push(key);
  }
  return found;
}
