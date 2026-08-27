// Runtime V2 owns the Stock Analyst Python tree. The dashboard writes a closed,
// private launch profile and acquires the service; it never starts, detaches,
// kills, or inherits a backend process.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dashboardDataDir } from "../runtime-paths.ts";
import { credentialEnv } from "./credentials.ts";
import {
  settingsEnv,
  settingsEnvFile,
  type StockAnalystSettings,
} from "./settings.ts";
import { resolveManagedServiceEndpoint } from "../runtime-v2/managed-service-endpoint.ts";

export interface StockAnalystService {
  readonly url: string;
  readonly model: string;
  readonly startedAt: number;
}

export interface StartOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  settings: StockAnalystSettings;
}

export function effectiveModel(options: StartOptions): string {
  return options.settings.model.trim() || options.model.trim();
}

/**
 * Resolve the endpoint after Runtime has started the already-configured
 * dependency. The disposable run worker may address that service, but it never
 * rewrites its boot profile or acquires process-control authority.
 */
export function preparedService(model: string): StockAnalystService {
  const endpoint = resolveManagedServiceEndpoint("stock-analyst");
  if (!endpoint) {
    throw new Error("The prepared Stock Analyst Runtime service is unavailable.");
  }
  const effective = model.trim();
  if (!effective || Buffer.byteLength(effective, "utf8") > 256 || /[\u0000\r\n]/u.test(effective)) {
    throw new Error("The prepared Stock Analyst model is invalid.");
  }
  return { url: endpoint.url, model: effective, startedAt: Date.now() };
}

export function runtimeServiceConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = env.BREADBOARD_DATA_DIR?.trim()
    ? path.resolve(env.BREADBOARD_DATA_DIR)
    : dashboardDataDir();
  return path.join(root, "runtime", "stock-analyst", "service-config.json");
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

export async function prepareService(
  options: StartOptions,
): Promise<StockAnalystService> {
  const endpoint = resolveManagedServiceEndpoint("stock-analyst");
  if (!endpoint) {
    throw new Error(
      "Stock Analyst is external in bare-dashboard mode; set STOCK_ANALYST_SERVICE_URL to its loopback origin.",
    );
  }
  const model = effectiveModel(options);
  if (!model) throw new Error("Stock Analyst has no model to run on.");
  writePrivateJson(runtimeServiceConfigPath(), {
    schemaVersion: 1,
    serviceId: "stock-analyst",
    environment: {
      LITELLM_MODEL: model.includes("/") ? model : `openai/${model}`,
      OPENAI_BASE_URL: options.baseUrl,
      OPENAI_API_KEY: options.apiKey,
      GENERATION_BACKEND: "litellm",
      GENERATION_FALLBACK_BACKEND: "litellm",
      AGENT_BACKEND: "litellm",
      AGENT_GENERATION_BACKEND: "litellm",
      DSA_RUNTIME_SCHEDULER_SUPPRESS_START: "1",
      SCHEDULE_ENABLED: "false",
      RUN_IMMEDIATELY: "false",
      SCHEDULE_RUN_IMMEDIATELY: "false",
      WEBUI_AUTO_BUILD: "false",
      ADMIN_AUTH_ENABLED: "false",
      ...settingsEnv(options.settings),
      ...credentialEnv(),
    },
    envFileContents: settingsEnvFile(options.settings),
    stateLayout: {
      database: "data/stock_analysis.db",
      logs: "logs",
    },
    bindHost: "127.0.0.1",
  });
  return { url: endpoint.url, model, startedAt: Date.now() };
}

/** Runtime owns service logs; dashboard responses never expose process output. */
export function serviceLog(): string {
  return "";
}
