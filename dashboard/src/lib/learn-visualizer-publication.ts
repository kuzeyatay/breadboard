import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findGeneratedVisualBlockById,
  replaceGeneratedVisualBlock,
  loadGeneratedVisualDefinition,
  loadGeneratedVisualManifest,
} from "./generated-visuals.ts";
import { acquireGardenMutationLease } from "./garden-mutation-lease-core.ts";
import {
  createDetachedGardenMutation,
  promoteDetachedGardenMutation,
  disposeDetachedGardenMutation,
} from "./garden-mutation-transaction.ts";

const sha = (value: string | Buffer) =>
  crypto.createHash("sha256").update(value).digest("hex");
const withoutVisuals = (value: string) =>
  value.replace(/```breadboard-generated-visual\r?\n[\s\S]*?\r?\n```/g, "");

export function verifyLearnPagePreservation(
  before: Record<string, string>,
  after: Record<string, string>,
): void {
  const paths = Object.keys(before).sort();
  if (JSON.stringify(paths) !== JSON.stringify(Object.keys(after).sort()))
    throw new Error("The Learn page set changed.");
  for (const relative of paths) {
    if (withoutVisuals(before[relative]) !== withoutVisuals(after[relative]))
      throw new Error(`Lesson prose changed: ${relative}`);
  }
}

function readPages(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".md"))
        result[path.relative(root, file).replaceAll("\\", "/")] =
          fs.readFileSync(file, "utf8");
    }
  }
  visit(path.join(root, "learning"));
  return result;
}

/** One fenced, atomic garden transaction after every replacement has passed. */
export async function publishLearnVisualizerReplacements(input: {
  gardenDir: string;
  stagedGardenDir: string;
  baselineHashes: Record<string, string>;
  receiptPath: string;
  visualizationIds?: string[];
}) {
  const before = readPages(input.gardenDir);
  if (
    JSON.stringify(Object.keys(before).sort()) !==
      JSON.stringify(Object.keys(input.baselineHashes).sort()) ||
    Object.entries(before).some(
      ([file, text]) => sha(text) !== input.baselineHashes[file],
    )
  ) {
    throw new Error(
      "The live lessons changed since generation started; replacements were not published.",
    );
  }
  const indexPath = ".breadboard/visual-index.json";
  const active = JSON.parse(
    fs.readFileSync(path.join(input.gardenDir, indexPath), "utf8"),
  );
  const replacementIndex = JSON.parse(
    fs.readFileSync(path.join(input.stagedGardenDir, indexPath), "utf8"),
  );
  const availableIds = Object.keys(active).filter(
    (id) => active[id].kind === "generated_module",
  );
  const ids = input.visualizationIds ?? availableIds;
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !availableIds.includes(id))
  )
    throw new Error(
      "Replacement selection must contain existing unique visual IDs.",
    );
  const replacements = ids.map((id) => {
    const manifest = loadGeneratedVisualManifest(input.stagedGardenDir, id);
    const definition = loadGeneratedVisualDefinition(input.stagedGardenDir, id);
    const root = path.join(input.stagedGardenDir, ".breadboard", "visuals", id);
    const tests = JSON.parse(
      fs.readFileSync(path.join(root, "tests.json"), "utf8"),
    );
    const critic = JSON.parse(
      fs.readFileSync(path.join(root, "critic.json"), "utf8"),
    );
    if (
      !manifest ||
      !definition?.nativeRuntime ||
      manifest.sourceSkill !== "interactive-visualizer-in-chat" ||
      manifest.version <= active[id].version ||
      tests.passed !== true ||
      critic.approved !== true ||
      replacementIndex[id]?.version !== manifest.version
    )
      throw new Error(`Replacement ${id} is not ready.`);
    const previous = findGeneratedVisualBlockById(
      before[manifest.targetPage] ?? "",
      id,
    );
    if (!previous || previous.version !== active[id].version)
      throw new Error(`Live reference ${id} changed.`);
    return manifest;
  });
  const lease = acquireGardenMutationLease(
    input.gardenDir,
    "native-visualizer-upgrade",
  );
  let mutation: ReturnType<typeof createDetachedGardenMutation> | undefined;
  try {
    mutation = createDetachedGardenMutation(
      input.gardenDir,
      "native-visualizer-upgrade",
    );
    for (const manifest of replacements) {
      const target = path.join(mutation.stagingGardenDir, manifest.targetPage);
      const text = fs.readFileSync(target, "utf8");
      const block = findGeneratedVisualBlockById(text, manifest.id);
      if (!block) throw new Error(`Missing visual reference ${manifest.id}`);
      fs.writeFileSync(
        target,
        replaceGeneratedVisualBlock(text, block, manifest.id, manifest.version),
      );
      fs.cpSync(
        path.join(input.stagedGardenDir, ".breadboard", "visuals", manifest.id),
        path.join(
          mutation.stagingGardenDir,
          ".breadboard",
          "visuals",
          manifest.id,
        ),
        { recursive: true },
      );
      active[manifest.id] = replacementIndex[manifest.id];
    }
    fs.writeFileSync(
      path.join(mutation.stagingGardenDir, indexPath),
      JSON.stringify(active, null, 2) + "\n",
    );
    verifyLearnPagePreservation(before, readPages(mutation.stagingGardenDir));
    const { auditGardenForFinalization } = await import("./garden-finalize.ts");
    const audit = auditGardenForFinalization(
      mutation.stagingGardenDir,
      path.basename(input.gardenDir),
    );
    fs.writeFileSync(
      input.receiptPath + ".audit.json",
      JSON.stringify(audit, null, 2),
    );
    if (!audit.passed)
      throw new Error(
        "The staged garden did not pass its final publication audit.",
      );
    const promotion = await promoteDetachedGardenMutation({
      mutation,
      destinationGardenDir: input.gardenDir,
      lease,
      recoveryOwnerId: `native-visuals-${crypto.randomUUID()}`,
      verifyCandidate: (candidate) => {
        try {
          verifyLearnPagePreservation(before, readPages(candidate));
          return replacements.every(
            (m) => !!loadGeneratedVisualDefinition(candidate, m.id, m.version),
          );
        } catch {
          return false;
        }
      },
    });
    if (!promotion.promoted) throw new Error(promotion.reason);
    verifyLearnPagePreservation(before, readPages(input.gardenDir));
    const receipt = {
      publishedAt: new Date().toISOString(),
      gardenDir: input.gardenDir,
      learnPagesPreserved: Object.keys(before).length,
      proseUnchanged: true,
      visualizers: replacements.map((m) => ({
        id: m.id,
        title: m.title,
        version: m.version,
        previousVersion: m.previousVersion,
        sourceSkill: m.sourceSkill,
      })),
      promotion,
    };
    fs.writeFileSync(input.receiptPath, JSON.stringify(receipt, null, 2));
    return receipt;
  } finally {
    lease.release();
    disposeDetachedGardenMutation(mutation);
  }
}
