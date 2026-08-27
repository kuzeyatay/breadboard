// Read-only status for the MatrAIx setup panel. Environment installation is a
// closed Runtime V2 job and never runs in the dashboard process.

import path from "node:path";
import { externalRuntimePathExists } from "../external-runtime-filesystem.ts";
import { matraixCatalog } from "./catalog.ts";
import {
  MATRAIX_DEV_POOL,
  MATRAIX_PRODUCTION_POOL,
  matraixAvailability,
  matraixVenv,
  productionPoolPresent,
  resolveMatraixRoot,
} from "./runtime.ts";

export interface MatraixPoolStatus {
  pool: string;
  label: string;
  personas: number;
  present: boolean;
}

export interface MatraixSetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  python: { found: boolean; path: string; version: string; venv: string };
  pools: MatraixPoolStatus[];
  productionPoolCommand: string;
}

const PRODUCTION_POOL_COMMAND = [
  "huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release",
  "--repo-type dataset",
  `--local-dir ${MATRAIX_PRODUCTION_POOL}/release`,
].join(" ");

export function setupStatus(env: NodeJS.ProcessEnv = process.env): MatraixSetupStatus {
  const availability = matraixAvailability(env);
  const root = availability.root ?? resolveMatraixRoot(env);
  const catalog = availability.available ? matraixCatalog(MATRAIX_DEV_POOL) : null;
  const pools: MatraixPoolStatus[] = [
    {
      pool: MATRAIX_DEV_POOL,
      label: "Development sample",
      personas: catalog?.count ?? 0,
      present: Boolean(root) && externalRuntimePathExists(path.join(root ?? "", MATRAIX_DEV_POOL)),
    },
    {
      pool: MATRAIX_PRODUCTION_POOL,
      label: "Persona 1M release",
      personas: 0,
      present: Boolean(root) && productionPoolPresent(root ?? ""),
    },
  ];
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: Boolean(root), path: root ?? "" },
    python: {
      found: Boolean(availability.python),
      path: availability.python ?? "",
      version: availability.pythonVersion,
      venv: matraixVenv(),
    },
    pools,
    productionPoolCommand: PRODUCTION_POOL_COMMAND,
  };
}
