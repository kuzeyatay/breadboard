import { z } from "zod";
import { objectRecord, objectReference } from "./records.ts";

// Read-only compatibility for retained project records; this host exposes no trash mutations.
const revision = z.number().int().positive().safe();
export const tombstoneRecord = z.strictObject({ schemaVersion: z.literal(1), projectId: z.string().min(1),
  tombstoneId: z.string().min(1), revision, assetId: z.string().min(1),
  assetRef: objectReference.extend({ kind: z.literal("asset"), revision }),
  assetObject: objectRecord.optional(), media: objectRecord.optional(),
  name: z.string(), deletedAt: z.iso.datetime(), restoredAt: z.iso.datetime().optional(), purgeRequestedAt: z.iso.datetime().optional() });
