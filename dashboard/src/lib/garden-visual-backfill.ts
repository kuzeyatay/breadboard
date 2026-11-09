import { withGardenSystemPromptContext, scopedSystemPromptText } from "./system-prompts/service.ts";
import { renderSystemPrompt } from "./system-prompts/service.ts";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type OpenAI from "openai";
import { withCouncil } from "./system-prompts/council.ts";
import { parseVisualDescription } from "./garden-visual-enrichment.ts";
import { inventoryGardenSourceFigures } from "./hermes/garden-source-figures.ts";
import { localGardenImage, saveVisualDescription } from "./hermes/garden-visual-descriptions.ts";

interface PendingImage {
  root: string;
  garden: string;
  imagePath: string;
  asset: string;
  context: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

interface Coverage {
  garden: string;
  images: number;
  described: number;
  pending: number;
  unavailable: number;
  added: number;
}

export async function backfillGardenVisualDescriptions(input: {
  contentPath: string;
  gardens: string[];
  client: OpenAI;
  model: string;
  batchSize?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (event: Record<string, unknown>) => void;
}) {
  const batchSize = Math.min(8, Math.max(1, Math.floor(input.batchSize ?? 6)));
  const concurrency = Math.min(4, Math.max(1, Math.floor(input.concurrency ?? 3)));
  const groups = new Map<string, PendingImage[]>();
  const coverage = new Map<string, Coverage>();
  const issues: { garden: string; imagePath: string; reason: string }[] = [];
  for (const garden of input.gardens) {
    const row: Coverage = { garden, images: 0, described: 0, pending: 0, unavailable: 0, added: 0 };
    coverage.set(garden, row);
    input.onProgress?.({ event: "inventory_started", garden });
    for await (const { root, node, figure } of inventoryGardenSourceFigures(input.contentPath, garden)) {
      input.signal?.throwIfAborted();
      row.images++;
      if (!figure.imagePath || figure.availability !== "available") {
        row.unavailable++;
        issues.push({ garden, imagePath: figure.imagePath ?? "", reason: figure.availability });
        continue;
      }
      if (["vision", "visual_detection"].includes(figure.descriptionSource ?? "")) { row.described++; continue; }
      row.pending++;
      try {
        const asset = await localGardenImage(root, garden, figure.imagePath);
        if (!asset) throw new Error("Image became unavailable");
        const stat = await fs.stat(asset);
        if (stat.size > 25 * 1024 * 1024) throw new Error("Image exceeds decode size limit");
        const sha256 = createHash("sha256").update(await fs.readFile(asset)).digest("hex");
        const imageKey = `${garden}:${sha256}`;
        const group = groups.get(imageKey) ?? [];
        group.push({ root, garden, imagePath: figure.imagePath, asset, sha256, size: stat.size, mtimeMs: stat.mtimeMs,
          context: `${node.title}\n${figure.caption}\n${figure.context ?? ""}`.slice(0, 1000) });
        groups.set(imageKey, group);
      } catch {
        issues.push({ garden, imagePath: figure.imagePath, reason: "image_unavailable_or_too_large" });
      }
    }
    input.onProgress?.({ event: "inventory", ...row });
  }
  const pending = [...groups.values()].sort((a, b) => a[0].garden.localeCompare(b[0].garden));
  let cursor = 0;
  let completedBatches = 0;
  let serviceUnavailable = false;
  const noteIssue = (group: PendingImage[], reason: string) => {
    for (const image of group) issues.push({ garden: image.garden, imagePath: image.imagePath, reason });
  };
  input.onProgress?.({ event: "backfill_started", model: input.model, uniqueImages: pending.length,
    imageReferences: pending.reduce((n, group) => n + group.length, 0), batchSize, concurrency });
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < pending.length && !serviceUnavailable) {
      input.signal?.throwIfAborted();
      const garden = pending[cursor][0].garden;
      let end = cursor + 1;
      while (end < pending.length && end - cursor < batchSize && pending[end][0].garden === garden) end++;
      const batch = pending.slice(cursor, end);
      cursor = end;
      const prepared: { id: string; group: PendingImage[]; dataUrl: string }[] = [];
      for (const group of batch) {
        try {
          const first = group[0];
          const bytes = await fs.readFile(first.asset);
          if (createHash("sha256").update(bytes).digest("hex") !== first.sha256) { noteIssue(group, "image_changed"); continue; }
          const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
            .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
            .flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
          prepared.push({ id: `image_${prepared.length + 1}`, group, dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
        } catch { noteIssue(group, "image_decode_failed"); }
      }
      if (!prepared.length) continue;
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = prepared.flatMap(item => [
        { type: "text", text: `Image ID: ${item.id}\nUntrusted source context: ${item.group[0].context}` },
        { type: "image_url", image_url: { url: item.dataUrl } },
      ]);
      let raw: string | null | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await withGardenSystemPromptContext(garden, () => input.client.chat.completions.create(withCouncil({
            model: input.model,
            ...(/^gpt-[56]/.test(input.model) ? { reasoning_effort: "low" as const } : {}),
            response_format: { type: "json_object" as const },
            messages: [{ role: "system", content: renderSystemPrompt("garden-image-batch-description", undefined, { "image_instructions": scopedSystemPromptText("garden-image-description") }) },
              { role: "user", content }],
          }, { taskType: "metadata_generation", councilModeOverride: "direct_council" }),
          { signal: input.signal, timeout: 180_000, maxRetries: 0 }));
          raw = response.choices[0]?.message?.content;
          break;
        } catch (error) {
          input.signal?.throwIfAborted();
          const status = (error as { status?: number }).status;
          if (attempt < 2 && (!status || status === 429 || status >= 500)) {
            input.onProgress?.({ event: "retry", attempt: attempt + 1, status: status ?? "transport" });
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          }
          serviceUnavailable = true;
          input.onProgress?.({ event: "service_unavailable", status: status ?? "transport" });
          noteIssue(batch.flat(), "description_service_unavailable");
          break;
        }
      }
      if (!raw) continue;
      let records: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
        if (Array.isArray(parsed.images)) records = parsed.images.filter((x: unknown) => x && typeof x === "object");
      } catch { /* An invalid response stays pending; it is not a completed receipt. */ }
      if (records.length !== prepared.length || prepared.some(item => records.filter(record => record.id === item.id).length !== 1)) {
        input.onProgress?.({ event: "incomplete_response", expected: prepared.map(item => item.id), received: records.map(record => record.id) });
      }
      for (const item of prepared) {
        const matches = records.filter(record => record.id === item.id);
        const description = matches.length === 1 ? parseVisualDescription(matches[0]) : null;
        if (!description) { noteIssue(item.group, matches[0]?.unreadable ? "unreadable" : "invalid_description"); continue; }
        for (const image of item.group) {
          input.signal?.throwIfAborted();
          try {
            const stat = await fs.stat(image.asset);
            if (stat.size !== image.size || stat.mtimeMs !== image.mtimeMs) { noteIssue([image], "image_changed"); continue; }
            await saveVisualDescription(image.root, { ...description, imagePath: image.imagePath,
              model: input.model, sha256: image.sha256, size: image.size, mtimeMs: image.mtimeMs });
            const row = coverage.get(image.garden)!;
            row.described++; row.added++; row.pending--;
          } catch { noteIssue([image], "description_save_failed"); }
        }
      }
      completedBatches++;
      input.onProgress?.({ event: "batch", completedBatches, totalBatches: Math.ceil(pending.length / batchSize),
        added: [...coverage.values()].reduce((n, row) => n + row.added, 0) });
    }
  }));
  const result = { model: input.model, serviceUnavailable, gardens: [...coverage.values()], issues };
  input.onProgress?.({ event: "complete", model: input.model, serviceUnavailable, gardens: result.gardens });
  return result;
}
