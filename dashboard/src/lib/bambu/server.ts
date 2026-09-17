import "server-only";
import db from "../db.ts";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dashboardDataDir } from "../runtime-paths.ts";
import { readConnectedAppTokens, storeConnectedAppTokens } from "../connected-apps/vault.ts";
import { BambuStore, digest } from "./store.ts";
import { BambuJobService } from "./job-service.ts";
import { BambuRuntimeAdapter } from "./runtime-client.ts";
import { configuredHost, configuredPrinter } from "./compatibility.ts";
import { fail } from "./types.ts";
import type { PrinterJobResource } from "../generative-ui/contracts.ts";

const globals = globalThis as typeof globalThis & { bambuService?: BambuJobService };
export const bambuRoot = () => path.join(dashboardDataDir(), "bambu");
export function bambuService(): BambuJobService {
  return globals.bambuService ??= new BambuJobService(new BambuStore(db), path.join(bambuRoot(), "staged"), new BambuRuntimeAdapter(), async printer => {
    const credentials = readConnectedAppTokens(printer.userId, `bambu:${printer.config.id}`);
    if (!credentials) fail("Reconnect this printer in Connections.", "printer_credentials_missing", 409);
    return { id: printer.config.id, host: printer.host, serial: printer.serial, model: printer.config.model, accessCode: credentials.accessToken };
  });
}
export function savePrinter(userId: number, body: Record<string, unknown>) {
  const store = bambuService().store;
  return store.transaction(() => {
    const existing = typeof body.id === "string" ? store.printer(body.id, userId) : null;
    if (existing && store.isLocked(existing.physicalIdentity)) fail("Resolve the printer's active or unconfirmed job before changing its configuration.", "printer_locked");
    const id = existing?.config.id ?? randomUUID();
    const serial = typeof body.serial === "string" && body.serial ? body.serial.trim().toUpperCase() : existing?.serial;
    if (!serial || !/^[A-Z0-9]{8,32}$/.test(serial)) fail("Enter the serial number shown on the printer.", "invalid_serial", 400);
    if (existing && serial !== existing.serial) fail("Create a separate connection for a different physical printer.", "physical_identity_immutable", 400);
    const physicalIdentity = digest(serial);
    const duplicate = store.db.prepare("SELECT id FROM bambu_printers WHERE physical_identity = ?").get(physicalIdentity) as { id: string } | undefined;
    if (duplicate && duplicate.id !== id) fail("This physical printer is already configured. Use its existing connection.", "duplicate_printer");
    const config = configuredPrinter(body, id, (existing?.config.revision ?? 0) + 1);
    config.photo = existing?.config.photo ?? false;
    const accessCode = typeof body.accessCode === "string" ? body.accessCode.trim() : "";
    if ((!existing?.config.configured && !accessCode) || (accessCode && !/^[A-Za-z0-9]{8}$/.test(accessCode))) fail("Enter the eight-character LAN access code.", "invalid_access_code", 400);
    if (accessCode) {
      store.db.prepare(`INSERT INTO nango_connections (user_id, slug, provider, integration_id, connection_id, enabled)
        VALUES (?, ?, 'Breadboard', 'bambu-lan', ?, 1)
        ON CONFLICT(user_id, slug) DO UPDATE SET enabled = 1, updated_at = datetime('now')`).run(userId, `bambu:${id}`, id);
      storeConnectedAppTokens(userId, `bambu:${id}`, { accessToken: accessCode, refreshToken: null, tokenType: "bambu-lan", scope: null, expiresAt: null, raw: {} });
    }
    store.savePrinter({ config, userId, host: body.host ? configuredHost(body.host) : existing?.host ?? configuredHost(body.host), serial, physicalIdentity });
    return config;
  });
}
export function printerResource(job: ReturnType<BambuJobService["create"]>): PrinterJobResource {
  return { schemaVersion: 1, kind: "printer-job", renderer: "bambu-print-card", id: job.resourceId, title: "Bambu Lab print", createdAt: job.createdAt, actions: [], data: { jobId: job.id, runId: job.scope.runId, conversationPublicId: job.scope.conversationPublicId, originatingTurnId: job.scope.originatingTurnId } };
}
export async function savePrinterPhoto(userId: number, id: string, bytes: Buffer) {
  const printer = bambuService().store.printer(id, userId);
  if (bytes.length > 5 * 1024 * 1024) fail("Choose an image smaller than 5 MiB.", "photo_too_large", 400);
  // Decode and re-encode, discard metadata; no SVG/HTML or external image URLs.
  const sharp = (await import("sharp")).default;
  let png: Buffer;
  try { png = await sharp(bytes, { limitInputPixels: 16_000_000, animated: false }).rotate().resize(800,800,{ fit:"inside", withoutEnlargement:true }).png().toBuffer(); }
  catch { fail("Choose a valid PNG, JPEG or WebP printer photo.", "invalid_photo", 400); }
  await fs.mkdir(path.join(bambuRoot(), "photos"), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(bambuRoot(), "photos", `${printer.config.id}.png`), png, { mode: 0o600 });
  const current = bambuService().store.printer(id, userId);
  current.config.photo = true; bambuService().store.savePrinter(current);
}
