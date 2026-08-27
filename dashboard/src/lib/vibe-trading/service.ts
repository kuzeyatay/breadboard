// Runtime V2 is the sole owner of the Vibe Trading Python tree. The dashboard
// writes one bounded, private launch profile before acquiring the service and
// then talks only to the Runtime-injected authenticated loopback endpoint.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dashboardDataDir } from "../runtime-paths.ts";
import { credentialEnv } from "./credentials.ts";
import { settingsEnv, type VibeTradingSettings } from "./settings.ts";
import { resolveManagedServiceEndpoint } from "../runtime-v2/managed-service-endpoint.ts";

export interface VibeTradingService {
  readonly url: string;
  readonly apiKey: string;
  readonly model: string;
  readonly startedAt: number;
}

export interface StartOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
  settings: VibeTradingSettings;
}

export function effectiveModel(options: StartOptions): string {
  return options.settings.model.trim() || options.model.trim();
}

export function runtimeServiceConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = env.BREADBOARD_DATA_DIR?.trim()
    ? path.resolve(env.BREADBOARD_DATA_DIR)
    : dashboardDataDir();
  return path.join(root, "runtime", "vibe-trading", "service-config.json");
}

function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }
}

/**
 * The Runtime launcher consumes this closed profile. No path, token or raw
 * environment value is returned to the renderer.
 */
export async function prepareService(options: StartOptions): Promise<VibeTradingService> {
  const endpoint = resolveManagedServiceEndpoint("vibe-trading");
  if (!endpoint) {
    throw new Error(
      "Vibe Trading is external in bare-dashboard mode; configure its loopback endpoint and bearer.",
    );
  }
  const model = effectiveModel(options);
  if (!model) throw new Error("Vibe Trading has no model to run on.");
  writePrivateJson(runtimeServiceConfigPath(), {
    schemaVersion: 1,
    serviceId: "vibe-trading",
    environment: {
      LANGCHAIN_PROVIDER: "openai",
      LANGCHAIN_MODEL_NAME: model,
      LANGCHAIN_REASONING_EFFORT: options.reasoningEffort,
      OPENAI_BASE_URL: options.baseUrl,
      OPENAI_API_BASE: options.baseUrl,
      OPENAI_API_KEY: options.apiKey,
      ENABLE_SESSION_RUNTIME: "true",
      VIBE_TRADING_ENABLE_SHELL_TOOLS: "0",
      ...settingsEnv(options.settings),
      ...credentialEnv(),
    },
    bindHost: "127.0.0.1",
    serviceAuthentication: "runtime-injected",
  });
  return {
    url: endpoint.url,
    apiKey: endpoint.apiKey,
    model,
    startedAt: Date.now(),
  };
}

/** Runtime owns service logs; dashboard responses never expose process output. */
export function serviceLog(): string {
  return "";
}
