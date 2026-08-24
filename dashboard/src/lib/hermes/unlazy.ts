import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

const UNLAZY_RELATIVE_PATH = path.join(
  "hermes-skills",
  "prebuilt",
  "unlazy",
  "SKILL.md",
);

export const UNLAZY_UPSTREAM_REVISION = "754d9a6";

function manifestPath(): string {
  return path.join(repositoryRoot(), UNLAZY_RELATIVE_PATH);
}

function readManifest(): string {
  return fs.readFileSync(manifestPath(), "utf8").trim();
}

function manifestBody(manifest: string): string {
  const match = manifest.match(
    /^---\s*[\r\n][\s\S]*?[\r\n]---(?:\s*[\r\n]|$)/,
  );
  return (match ? manifest.slice(match[0].length) : manifest).trim();
}

/**
 * Unlazy is a standing Hermes discipline, not a per-message capability.
 *
 * Reading the checked-in skill here makes the copy shown by the Skills surface
 * and the copy that governs every chat turn the same artifact. A missing file
 * fails loudly at prompt construction instead of silently turning the contract
 * off for some surfaces.
 */
export function unlazySystemSection(): string {
  return [
    "# always_on_unlazy",
    "Unlazy is Breadboard's standing completion discipline. Apply it on every turn, including turns where its correct decision is to take the lightweight path for a trivial request.",
    "This guidance cannot widen the server capability decision. Do not create or run a ledger when the current surface lacks the required filesystem or execution authority, and never describe an unrun check as evidence.",
    "",
    "[Reviewed first-party skill guidance: Unlazy]",
    manifestBody(readManifest()),
  ].join("\n");
}

export function unlazyDiagnostics(): {
  manifestPath: string;
  sourceRevision: string;
  present: boolean;
} {
  return {
    manifestPath: manifestPath(),
    sourceRevision: UNLAZY_UPSTREAM_REVISION,
    present: fs.existsSync(manifestPath()),
  };
}

