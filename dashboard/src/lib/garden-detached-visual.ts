import { createHash, randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

export const DETACHED_VISUAL_LANGUAGE = "breadboard-detached-visual";
const ID = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;
const PREFIX = "globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(";
const SUFFIX = ");\n";
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Runtime/evidence bytes are not prose, reading time, or knowledge links. */
export function withoutDetachedVisualPayloads(markdown: string): string {
  return markdown.replace(/^(`{3,}|~{3,})([^\r\n]*)\r?\n[\s\S]*?^\1[^\S\r\n]*\r?$/gm,
    (block: string, _fence: string, language: string) => language.trim().split(/\s+/)[0] === DETACHED_VISUAL_LANGUAGE ? "Interactive visualization" : block);
}

interface VisualSnapshot {
  schemaVersion: 1;
  manifest: RecordValue;
  validation: RecordValue;
  tests: RecordValue;
  critic: RecordValue;
  source: string;
  compiled: string;
}

/** Fail the copy before publishing a note with missing or unverified code. */
function validateSnapshot(value: unknown): asserts value is VisualSnapshot {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.manifest) ||
      !record(value.validation) || !record(value.tests) || !record(value.critic) ||
      typeof value.source !== "string" || typeof value.compiled !== "string") {
    throw new Error("The visualization snapshot is incomplete.");
  }
  const manifest = value.manifest;
  if (!ID.test(String(manifest.id)) || !Number.isInteger(manifest.version) || Number(manifest.version) < 1 ||
      manifest.status !== "published" || value.validation.valid !== true ||
      value.tests.passed !== true || value.critic.approved !== true ||
      hash(value.source) !== manifest.sourceHash || hash(value.compiled) !== manifest.compiledHash ||
      !value.compiled.startsWith(PREFIX) || !value.compiled.endsWith(SUFFIX)) {
    throw new Error("The visualization snapshot has not passed its publication checks.");
  }
  const definition: unknown = JSON.parse(value.compiled.slice(PREFIX.length, -SUFFIX.length));
  if (!record(definition) || definition.sdkVersion !== "1.0.0" || typeof definition.title !== "string" || typeof definition.description !== "string") throw new Error("Invalid visualization definition.");
  if (definition.nativeRuntime !== undefined) {
    const runtime = definition.nativeRuntime;
    if (!record(runtime) || runtime.engine !== "breadboard-interactive-visualizer" || runtime.version !== "2.0.0" ||
        runtime.sourceSkill !== "interactive-visualizer-in-chat" || !/^[a-f0-9]{64}$/.test(String(runtime.skillHash)) ||
        typeof runtime.html !== "string" || runtime.html.length > 2_000_000 || !runtime.html.includes('http-equiv="Content-Security-Policy"') ||
        manifest.sourceSkill !== runtime.sourceSkill || manifest.skillHash !== runtime.skillHash || manifest.runtimeEngine !== runtime.engine) {
      throw new Error("The visualization runtime or skill provenance is invalid.");
    }
  } else if (!Array.isArray(definition.controls) || definition.controls.length > 12 ||
      !Array.isArray(definition.outputs) || definition.outputs.length > 16 || !Array.isArray(definition.scenes) || definition.scenes.length > 12) {
    throw new Error("Invalid visualization definition.");
  }
}

function readSnapshot(gardenDir: string, page: string, id: string, version: number): VisualSnapshot {
  const boundary = path.resolve(gardenDir);
  let directory = path.dirname(path.resolve(gardenDir, page));
  while (directory === boundary || directory.startsWith(boundary + path.sep)) {
    const relative = path.join(".breadboard", "visuals", id, "versions", String(version));
    const artifact = path.join(directory, relative);
    if (fs.existsSync(artifact)) {
      let current = boundary;
      for (const part of path.relative(boundary, artifact).split(path.sep)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error("A copied visualization cannot use symbolic links.");
      }
      const read = (name: string): string => {
        const file = path.join(artifact, name);
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error("A copied visualization cannot use symbolic links.");
        return fs.readFileSync(file, "utf8");
      };
      const snapshot = {
        schemaVersion: 1 as const,
        manifest: JSON.parse(read("manifest.json")),
        validation: JSON.parse(read("validation.json")),
        tests: JSON.parse(read("tests.json")),
        critic: JSON.parse(read("critic.json")),
        source: read("source.tsx"), compiled: read("compiled.js"),
      };
      validateSnapshot(snapshot);
      if (snapshot.manifest.id !== id || snapshot.manifest.version !== version) throw new Error("Visualization version identity does not match its reference.");
      return snapshot;
    }
    if (directory === boundary) break;
    directory = path.dirname(directory);
  }
  throw new Error(`Visualization ${id} v${version} is missing; the folder was not copied.`);
}

/** Embed the validated source, compiled runtime, and evidence in the copied
 * Markdown. No shared artifact, Learn identity, or original page is needed. */
export function detachCopiedGardenVisuals(gardenDir: string, sourcePage: string, markdown: string): string {
  const identities = new Map<string, string>();
  const updated = markdown.replace(/^(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)^\1[^\S\r\n]*\r?$/gm,
    (block: string, fence: string, info: string, body: string) => {
      const language = info.trim().split(/\s+/)[0];
      if (language !== DETACHED_VISUAL_LANGUAGE && language !== "breadboard-generated-visual") return block;
      let snapshot: VisualSnapshot;
      if (language === DETACHED_VISUAL_LANGUAGE) {
        const value: unknown = JSON.parse(body);
        validateSnapshot(value);
        if (value.manifest.detached !== true) throw new Error("Invalid detached visualization ownership.");
        snapshot = value;
      } else {
        const id = body.match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1];
        const version = Number(body.match(/^version:\s*(\d+)\s*$/m)?.[1]);
        if (!id || !Number.isInteger(version) || version < 1) throw new Error("Invalid generated visualization reference.");
        snapshot = readSnapshot(gardenDir, sourcePage, id, version);
      }
      const original = snapshot.manifest;
      const id = `visual-copy-${randomUUID()}`;
      identities.set(String(original.id), id);
      const manifest = { ...original, id, version: 1, detached: true,
        copiedFrom: { id: original.id, version: original.version, page: sourcePage, copiedAt: new Date().toISOString() },
      } as RecordValue;
      for (const key of ["targetPage", "targetHeading", "insertionAnchor", "learningUnitId", "previousVersion", "artifactPath"]) delete manifest[key];
      const payload = JSON.stringify({ ...snapshot, manifest }, null, 2);
      if (payload.length > 8_000_000) throw new Error("The visualization snapshot exceeds the reader's size limit.");
      return `${fence}${DETACHED_VISUAL_LANGUAGE}\n${payload}\n${fence}`;
    });
  if (!identities.size) return updated;
  return updated.replace(/^(\uFEFF?---[^\S\r\n]*\r?\n)([\s\S]*?)(\r?\n---)/,
    (_header, start: string, metadata: string, end: string) => `${start}${metadata.replace(/^(visualIds|visuals):([^\n]*(?:\n[ \t]+-[^\n]*)*)/gm,
      (field: string) => field.replace(/[A-Za-z][A-Za-z0-9_-]{1,79}/g, (id: string) => identities.get(id) ?? id))}${end}`);
}
