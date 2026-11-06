import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function verifyGoogleFlowSource(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const pin = JSON.parse(readFileSync(path.join(root, "scripts", "google-flow-upstream.json"), "utf8"));
  for (const [name, expected] of Object.entries(pin.files)) {
    const actual = createHash("sha256").update(readFileSync(path.join(root, "google-flow-mcp", name))).digest("hex");
    if (actual !== expected) throw new Error(`Pinned Google Flow source differs: ${name}`);
  }
  return pin;
}
