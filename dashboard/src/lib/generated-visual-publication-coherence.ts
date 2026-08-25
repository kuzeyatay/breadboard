import fs from "node:fs";
import path from "node:path";
import {
  validateVisualSpec,
  type VisualSpec,
} from "./visual-spec.ts";

function readRecord(filePath: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Verify every published pointer for one generated visual resolves to the same
 * immutable version. This is deliberately separate from version validation:
 * a valid v2 directory is not active until Markdown, current.json, the copied
 * top-level manifest, and visual-index.json all agree on v2.
 */
export function generatedVisualPublicationPointersMatch(input: {
  gardenDir: string;
  id: string;
  version: number;
  sourceHash?: string;
  compiledHash?: string;
}): boolean {
  if (!/^[a-z][a-z0-9_-]{1,79}$/i.test(input.id)) return false;
  if (!Number.isInteger(input.version) || input.version < 1) return false;

  const artifactRelativePath = `.breadboard/visuals/${input.id}`;
  const artifactDir = path.join(
    input.gardenDir,
    ".breadboard",
    "visuals",
    input.id,
  );
  const versionManifestRelativePath = `versions/${input.version}/manifest.json`;
  const versionManifest = readRecord(
    path.join(artifactDir, "versions", String(input.version), "manifest.json"),
  );
  const activeManifest = readRecord(path.join(artifactDir, "manifest.json"));
  const current = readRecord(path.join(artifactDir, "current.json"));
  const index = readRecord(
    path.join(input.gardenDir, ".breadboard", "visual-index.json"),
  );
  const indexEntry = index?.[input.id];

  if (
    !versionManifest ||
    !activeManifest ||
    !current ||
    !indexEntry ||
    typeof indexEntry !== "object" ||
    Array.isArray(indexEntry)
  ) {
    return false;
  }
  const visualIndexEntry = indexEntry as Record<string, unknown>;
  const manifestIdentityMatches = (manifest: Record<string, unknown>) =>
    manifest.id === input.id &&
    manifest.version === input.version &&
    (input.sourceHash === undefined || manifest.sourceHash === input.sourceHash) &&
    (input.compiledHash === undefined ||
      manifest.compiledHash === input.compiledHash);

  return (
    manifestIdentityMatches(versionManifest) &&
    manifestIdentityMatches(activeManifest) &&
    activeManifest.sourceHash === versionManifest.sourceHash &&
    activeManifest.compiledHash === versionManifest.compiledHash &&
    current.id === input.id &&
    current.version === input.version &&
    current.manifest === versionManifestRelativePath &&
    visualIndexEntry.id === input.id &&
    visualIndexEntry.kind === "generated_module" &&
    visualIndexEntry.version === input.version &&
    visualIndexEntry.artifactPath === artifactRelativePath &&
    visualIndexEntry.sourceHash === versionManifest.sourceHash &&
    visualIndexEntry.compiledHash === versionManifest.compiledHash
  );
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (!candidate || typeof candidate !== "object") return candidate;
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(value));
}

/** Verify the Markdown block, persisted JSON spec, and index agree exactly. */
export function legacyVisualPublicationPointersMatch(input: {
  gardenDir: string;
  relativeMarkdownPath: string;
  expectedSpec: VisualSpec;
}): boolean {
  if (!/^[a-z0-9_-]{1,80}$/i.test(input.expectedSpec.id)) return false;
  const gardenDir = path.resolve(input.gardenDir);
  const markdownPath = path.resolve(gardenDir, input.relativeMarkdownPath);
  const relative = path.relative(gardenDir, markdownPath);
  if (
    relative === "" ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return false;
  }

  try {
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const pattern = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;
    let embeddedSpec: VisualSpec | null = null;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown)) !== null) {
      const checked = validateVisualSpec(match[1]).spec;
      if (checked?.id !== input.expectedSpec.id) continue;
      if (embeddedSpec) return false;
      embeddedSpec = checked;
    }
    const persistedSpec = validateVisualSpec(
      fs.readFileSync(
        path.join(
          gardenDir,
          ".breadboard",
          "visuals",
          `${input.expectedSpec.id}.json`,
        ),
        "utf8",
      ),
    ).spec;
    const index = readRecord(
      path.join(gardenDir, ".breadboard", "visual-index.json"),
    );
    const indexEntry = index?.[input.expectedSpec.id];
    if (
      !embeddedSpec ||
      !persistedSpec ||
      !indexEntry ||
      typeof indexEntry !== "object" ||
      Array.isArray(indexEntry)
    ) {
      return false;
    }
    const expected = canonicalJson(input.expectedSpec);
    const visualIndexEntry = indexEntry as Record<string, unknown>;
    return (
      canonicalJson(embeddedSpec) === expected &&
      canonicalJson(persistedSpec) === expected &&
      visualIndexEntry.id === input.expectedSpec.id &&
      visualIndexEntry.type === input.expectedSpec.type &&
      visualIndexEntry.title === input.expectedSpec.title &&
      visualIndexEntry.version === input.expectedSpec.version
    );
  } catch {
    return false;
  }
}
