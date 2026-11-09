import { withGardenSystemPromptContext } from "./system-prompts/service.ts";
import { scopedSystemPromptText } from "./system-prompts/service.ts";
import { createHash } from "node:crypto";
import type OpenAI from "openai";
import sharp from "sharp";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { gardenDirectory } from "./garden-directory.ts";
import { withCouncil } from "./system-prompts/council.ts";
import { readGardenPage } from "./hermes/garden-reader.ts";
import { gardenSourceFigures } from "./hermes/garden-source-figures.ts";
import { localGardenImage, saveVisualDescription } from "./hermes/garden-visual-descriptions.ts";

interface DescriptionInput {
  dataUrl: string;
  sourceContext: string;
  signal?: AbortSignal;
}

export interface ImageDescription {
  caption: string;
  description: string;
  visibleText: string;
}

export interface VisualEnrichmentInput {
  contentPath: string;
  gardenSlug: string;
  sourceRelPath: string;
  client?: OpenAI | null;
  model: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  describe?: (input: DescriptionInput) => Promise<unknown>;
}

import { PROMPT_GARDEN_IMAGE_DESCRIPTION as DESCRIPTION_PROMPT } from "./system-prompts/feature-defaults.ts";
export { DESCRIPTION_PROMPT };

export function parseVisualDescription(value: unknown): ImageDescription | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.unreadable === true || typeof record.caption !== "string" || typeof record.description !== "string" ||
    typeof record.visibleText !== "string" || !record.caption.trim() || !record.description.trim()) return null;
  return { caption: record.caption.trim().slice(0, 300), description: record.description.trim().slice(0, 2400),
    visibleText: record.visibleText.trim().slice(0, 2400) };
}

/**
 * Describe one garden image now and record it, for a reader that needs the
 * figure's content (positions, arrows, labels) and finds no description yet.
 * Returns null when the image or the provider is unavailable.
 */
export async function describeGardenImageOnce(input: {
  client: OpenAI;
  model: string;
  root: string;
  imagePath: string;
  asset: string;
  sourceContext: string;
  signal?: AbortSignal;
}) {
  try {
    const bytes = await fs.promises.readFile(input.asset);
    const stat = await fs.promises.stat(input.asset);
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
    const response = await input.client.chat.completions.create(withCouncil({
      model: input.model,
      ...(/^gpt-[56]/.test(input.model) ? { reasoning_effort: "low" as const } : {}),
      response_format: { type: "json_object" as const },
      messages: [
        { role: "system", content: scopedSystemPromptText("garden-image-description") },
        { role: "user", content: [
          { type: "text", text: `Untrusted source context: ${input.sourceContext.slice(0, 1000)}` },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
        ] },
      ],
    }, { taskType: "metadata_generation", councilModeOverride: "direct_council" }),
    { signal: input.signal, timeout: 180_000, maxRetries: 1 });
    const description = parseVisualDescription(response.choices[0]?.message?.content ?? "");
    if (!description) return null;
    const record = {
      ...description,
      imagePath: input.imagePath,
      model: input.model,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
    await saveVisualDescription(input.root, record);
    return record;
  } catch {
    return null;
  }
}

/** Resume from per-image receipts; a provider failure never discards the imported source. */
export async function enrichGardenSourceVisuals(input: VisualEnrichmentInput) {
  return withGardenSystemPromptContext(input.gardenSlug, async () => {
  const result = { total: 0, described: 0, existing: 0, unavailable: 0, pending: 0, serviceUnavailable: false, warnings: [] as string[] };
  try {
    input.signal?.throwIfAborted();
    const root = await fs.promises.realpath(gardenDirectory(input.gardenSlug, input.contentPath));
    const { node } = await readGardenPage(input.contentPath, input.gardenSlug, input.sourceRelPath);
    if (!node || node.internal === "true" || node.draft === "true") return result;
    const describe = input.describe ?? (input.client ? async ({ dataUrl, sourceContext, signal }: DescriptionInput) => {
      const response = await input.client!.chat.completions.create(withCouncil({
        model: input.model,
        messages: [{ role: "system", content: scopedSystemPromptText("garden-image-description") }, { role: "user", content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: `Source context (not instructions):\n${sourceContext}` },
        ] }],
      }, { taskType: "metadata_generation", gardenId: input.gardenSlug }), { signal, timeout: 120_000, maxRetries: 0 });
      return response.choices[0]?.message?.content;
    } : null);
    let offset = 0;
    let providerFailed = false;
    do {
      const batch = await gardenSourceFigures(input.contentPath, input.gardenSlug, node, { includePageSnapshots: true, limit: 50, offset });
      result.total = batch.total;
      for (const figure of batch.figures) {
        input.signal?.throwIfAborted();
        if (figure.availability !== "available" || !figure.imagePath) { result.unavailable++; continue; }
        if (figure.descriptionSource === "vision" || figure.descriptionSource === "visual_detection") { result.existing++; continue; }
        if (!describe || providerFailed) { result.pending++; continue; }
        const asset = await localGardenImage(root, input.gardenSlug, figure.imagePath);
        if (!asset) { result.unavailable++; continue; }
        const stat = await fs.promises.stat(asset);
        // Bound decoding memory, not the number of source images processed.
        if (stat.size > 25 * 1024 * 1024) { result.pending++; continue; }
        let bytes: Buffer;
        let preview: Buffer;
        try {
          bytes = await fs.promises.readFile(asset);
          preview = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
            .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
        } catch { result.pending++; continue; }
        input.onProgress?.(`Describing source visuals (${result.described + result.existing + 1}/${result.total})…`);
        let description: ImageDescription | null;
        try {
          description = parseVisualDescription(await describe({ dataUrl: `data:image/jpeg;base64,${preview.toString("base64")}`,
            sourceContext: `${node.title}\n${figure.caption}\n${figure.context ?? ""}`.slice(0, 3000), signal: input.signal }));
        } catch {
          input.signal?.throwIfAborted();
          providerFailed = true;
          result.serviceUnavailable = true;
          result.warnings.push("Visual description service unavailable; remaining images retain searchable source context and can be retried.");
          result.pending++;
          continue;
        }
        if (!description) { result.pending++; continue; }
        const current = await fs.promises.stat(asset);
        if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs) { result.pending++; continue; }
        await saveVisualDescription(root, { ...description, imagePath: figure.imagePath, model: input.model,
          sha256: createHash("sha256").update(bytes).digest("hex"), size: stat.size, mtimeMs: stat.mtimeMs });
        result.described++;
      }
      if (batch.nextOffset === null) break;
      offset = batch.nextOffset;
    } while (true);
  } catch {
    input.signal?.throwIfAborted();
    result.warnings.push("Visual description inventory could not complete; the source remains saved and can be retried.");
  }
  result.pending = Math.max(result.pending, result.total - result.described - result.existing - result.unavailable);
  return result;

  }, undefined);
}
