// Feature flags and storage locations for the mem0 semantic-memory layer.
//
// Hybrid recall is on by default because it rides the same keyless local
// embedding backend as every other retriever (see lib/embeddings.ts) and
// degrades truthfully to the deterministic lexical ranker whenever that
// backend — or the vendored mem0 package — is unavailable. Turn extraction
// costs an LLM call after every completed turn, so it is opt-in.
//
//   BREADBOARD_MEM0=off             turn the whole semantic layer off
//   BREADBOARD_MEM0_EXTRACTION=on   extract candidate memories after turns
//   BREADBOARD_MEM0_LLM_MODEL=...   extraction model (default: ChatMock's
//                                   "default" sentinel, the global background
//                                   model)

import crypto from "node:crypto";
import path from "node:path";
import { databaseDir } from "../runtime-paths.ts";
import {
  embeddingFingerprint,
  embeddingSettings,
  type EmbeddingSettings,
} from "../embeddings.ts";

export interface Mem0Config {
  enabled: boolean;
  extractionEnabled: boolean;
  llmModel: string;
  embedding: EmbeddingSettings;
  /** Identifies the vector space the index was built in (model@dimension). */
  fingerprint: string;
  /** Directory holding mem0's own SQLite files. */
  dataDir: string;
  /**
   * Vector-store file, named by fingerprint: vectors from two embedding
   * models are not comparable and mem0 hard-throws on a width mismatch, so a
   * model change must open a fresh file rather than corrupt an existing one.
   */
  vectorStorePath: string;
  historyPath: string;
}

export function mem0Config(env: NodeJS.ProcessEnv = process.env): Mem0Config {
  const flag = (env.BREADBOARD_MEM0 ?? "").trim().toLowerCase();
  const embedding = embeddingSettings(env);
  const enabled =
    flag !== "off" && flag !== "0" && flag !== "false" && Boolean(embedding.model);
  const extraction = (env.BREADBOARD_MEM0_EXTRACTION ?? "").trim().toLowerCase();
  const fingerprint = embeddingFingerprint(
    embedding.model || "none",
    embedding.dimension || 0,
  );
  const dataDir = path.join(databaseDir(), "mem0");
  const spaceTag = crypto
    .createHash("sha256")
    .update(fingerprint)
    .digest("hex")
    .slice(0, 12);
  return {
    enabled,
    extractionEnabled:
      enabled && (extraction === "on" || extraction === "1" || extraction === "true"),
    llmModel: env.BREADBOARD_MEM0_LLM_MODEL?.trim() || "default",
    embedding,
    fingerprint,
    dataDir,
    vectorStorePath: path.join(dataDir, `vector-store-${spaceTag}.db`),
    historyPath: path.join(dataDir, "history.db"),
  };
}
