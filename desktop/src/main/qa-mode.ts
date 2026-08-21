import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedPaths } from "./path-resolver";
import type { DesktopServiceDefinition } from "./service-manager";
import type { QaServiceProfile } from "./startup-options";

/**
 * The deterministic user-journey profile deliberately excludes integrations
 * that can pull containers/models, install runtimes, open browsers, or depend
 * on external credentials. Broader profiles remain rejected at startup until
 * every optional runtime has an explicit isolated mutable-data contract.
 */
export const QA_CRITICAL_SERVICE_IDS = new Set([
  "chatmock",
  "hermes",
  "quartz",
  "dashboard",
]);

function resolveQaProviderAuthFile(paths: ResolvedPaths): string | undefined {
  const configured = process.env["BREADBOARD_QA_PROVIDER_AUTH_FILE"]?.trim();
  if (!configured) return undefined;
  const resolved = path.resolve(configured);
  let realPath: string;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("not a regular file");
    realPath = fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(
      `BREADBOARD_QA_PROVIDER_AUTH_FILE must name an existing regular file: ${resolved}`,
      { cause: error },
    );
  }
  const relative = path.relative(path.resolve(paths.dataRoot), realPath);
  const insideDataRoot =
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (insideDataRoot) {
    throw new Error(
      `BREADBOARD_QA_PROVIDER_AUTH_FILE must remain outside disposable QA data: ${realPath}`,
    );
  }
  return realPath;
}

export function prepareQaServiceDefinitions(
  definitions: DesktopServiceDefinition[],
  paths: ResolvedPaths,
  profile: QaServiceProfile,
): DesktopServiceDefinition[] {
  if (!paths.qaMode) return definitions;

  const providerAuthFile = resolveQaProviderAuthFile(paths);

  return definitions
    .filter((definition) => QA_CRITICAL_SERVICE_IDS.has(definition.id))
    .map((definition) => {
      const env: Record<string, string> = {
        ...definition.env,
        BREADBOARD_QA_MODE: "1",
      };

      // The normal development definitions intentionally point at the
      // checkout. QA keeps development code/hot reload, but all mutable
      // dashboard and Postiz data must use the disposable user-data tree.
      if (definition.id === "dashboard" || definition.id === "postiz") {
        env["BREADBOARD_DATA_DIR"] = paths.dataRoot;
      }
      const councilLedgerDir = path.join(
        paths.dataRoot,
        "chatmock",
        "council-runs",
      );
      if (definition.id === "dashboard") {
        const optionalSources = path.join(
          paths.dataRoot,
          "runtime",
          "qa-optional-sources",
        );
        const optionalState = path.join(
          paths.dataRoot,
          "runtime",
          "qa-optional-state",
        );
        const source = (name: string): string => path.join(optionalSources, name);
        const state = (name: string): string => path.join(optionalState, name);
        env["BREADBOARD_DEVELOPMENT_DASHBOARD_DIR"] = "";
        env["NEXT_TELEMETRY_DISABLED"] = "1";
        env["PYTHONDONTWRITEBYTECODE"] = "1";
        env["BREADBOARD_TELEGRAM_ENABLED"] = "false";
        env["BREADBOARD_WHATSAPP_ENABLED"] = "false";
        env["SOCIALS_MANAGER_MODE"] = "disabled";
        env["SOCIALS_MANAGER_AUTOSTART_DOCKER"] = "false";
        env["INBOX_ZERO_MODE"] = "disabled";
        env["INBOX_ZERO_AUTOSTART_DOCKER"] = "false";
        // Dashboard Learn-event readers and ChatMock must resolve the same
        // disposable ledger or trace lookup diverges from the chat writer.
        env["COUNCIL_LEDGER_DIR"] = councilLedgerDir;
        env["COMFYUI_ENABLED"] = "false";
        env["COMFYUI_MANAGED"] = "false";
        env["COMFYUI_AUTOSTART"] = "false";
        env["COMFYUI_ENV_DIR"] = path.join(
          paths.dataRoot,
          "runtime",
          "comfyui-venv",
        );
        env["COMFYUI_RUNTIME_DIR"] = path.join(
          paths.dataRoot,
          "runtime",
          "comfyui",
        );
        env["BREADBOARD_IFIXAI_MODE"] = "off";
        // The humanizer is a multi-gigabyte opt-in with a user-downloaded
        // checkpoint. QA must never load it, never download it, and never read
        // a developer's installed copy — so it is turned off and its home is
        // pointed at disposable state, which makes `/api/humanizer/status`
        // answer "unavailable" deterministically.
        env["HUMANIZER_MODE"] = "disabled";
        env["BREADBOARD_HUMANIZER_HOME"] = state("humanizer");
        env["HF_HUB_OFFLINE"] = "1";

        // Optional dashboard-launched integrations are not part of the
        // critical profile. Point both their program/setup targets and every
        // known mutable store at disposable locations so a developer's
        // installed checkout cannot make a probe silently become stateful.
        Object.assign(env, {
          AGENT_BROWSER_HOME: state("agent-browser"),
          AGENT_REACH_ROOT: source("agent-reach"),
          ARIS_ROOT: source("aris"),
          AUDIO_ANALYZER_ROOT: source("audio-analyzer"),
          AUDIO_ANALYZER_BIN_DIR: state("audio-analyzer-bin"),
          BOOK_TO_SKILL_ROOT: source("book-to-skill"),
          BREADBOARD_CAD_HOME: state("cad"),
          BREADBOARD_GOAL_HOME: state("goal-mode"),
          BREADBOARD_GOAL_ROOT: source("goal"),
          BREADBOARD_LOOPX_HOME: state("loopx"),
          BREADBOARD_LOOPX_ROOT: source("loopx"),
          BREADBOARD_OMH_ROOT: source("omh"),
          BREADBOARD_PREMORTEM_ROOT: source("premortem"),
          BREADBOARD_SOLIDWORKS_HOME: state("solidworks"),
          CAREER_OPS_ROOT: source("career-ops"),
          // Settings/login, serving, and usage must share one account home.
          CHATGPT_LOCAL_HOME: path.join(paths.dataRoot, "runtime", "codex"),
          CHATMOCK_USAGE_HOME: path.join(paths.dataRoot, "runtime", "codex"),
          DEEP_TUTOR_HOME_ROOT: state("deep-tutor"),
          DEEP_TUTOR_ROOT: source("deep-tutor"),
          DEER_FLOW_ROOT: source("deer-flow"),
          DEER_FLOW_STATE_DIR: state("deer-flow"),
          GBRAIN_HOME: state("gbrain"),
          HF_HOME: state("huggingface"),
          HYPERFRAMES_CLI_ROOT: source("hyperframes-cli"),
          HYPERFRAMES_ROOT: source("hyperframes"),
          HYPERFRAMES_WORKSPACE_ROOT: state("hyperframes-workspaces"),
          HARVEY_LABS_ROOT: source("legal"),
          INBOX_ZERO_ROOT: source("inbox-zero"),
          LEGAL_AGENT_STATE_DIR: state("legal"),
          MONEY_PRINTER_CREDENTIALS_FILE: path.join(
            state("money-printer"),
            "credentials.json",
          ),
          MONEY_PRINTER_ROOT: source("money-printer"),
          OPENCODE_ROOT: source("opencode"),
          OPENMONTAGE_ROOT: source("openmontage"),
          OPENMONTAGE_WORKSPACE_ROOT: state("openmontage-workspaces"),
          OPENPLANTER_ROOT: source("openplanter"),
          OPENSCIENCE_CLI_ROOT: source("openscience-cli"),
          OPENSCIENCE_ROOT: source("openscience"),
          OPENSCIENCE_STATE_ROOT: state("openscience"),
          OPENSCIENCE_WORKSPACE_ROOT: state("openscience-workspaces"),
          OPENWORK_ROOT: source("openwork"),
          OPENWORK_SERVER_RUNTIME_ROOT: state("openwork-server-runtime"),
          OPENWORK_SERVER_STATE_ROOT: state("openwork-server-state"),
          OPENWORK_WORKSPACE_ROOT: state("openwork-workspaces"),
          PAPER_TRADER_DATABASE_PATH: path.join(state("paper-trader"), "arena.db"),
          PAPER_TRADER_HOME: state("paper-trader"),
          PAPER_TRADER_ROOT: source("paper-trader"),
          PENECHO_ROOT: source("penecho"),
          PENECHO_STATE_DIR: state("penecho"),
          RECALL_HOME: state("recall"),
          RESOURCE2SKILL_ROOT: source("resource2skill"),
          RESOURCE2SKILL_VENV: state("resource2skill-venv"),
          RESOURCE2SKILL_WORKSPACE_ROOT: state("resource2skill-workspaces"),
          RUFLO_ROOT: source("ruflo"),
          SF3D_ROOT: source("sf3d"),
          SF3D_VENV: state("sf3d-venv"),
          SHAPER_ROOT: source("shaper"),
          SHORTS_ROOT: source("shorts"),
          STOCK_ANALYST_CREDENTIALS_FILE: path.join(
            state("stock-analyst"),
            "credentials.json",
          ),
          STOCK_ANALYST_HOME: state("stock-analyst"),
          STOCK_ANALYST_ROOT: source("stock-analyst"),
          SUBSAI_ROOT: source("subsai"),
          TRADINGAGENTS_CREDENTIALS_FILE: path.join(
            state("tradingagents"),
            "credentials.json",
          ),
          TRADINGAGENTS_ROOT: source("tradingagents"),
          VIBE_TRADING_CREDENTIALS_FILE: path.join(
            state("vibe-trading"),
            "credentials.json",
          ),
          VIBE_TRADING_HOME: state("vibe-trading"),
          VIBE_TRADING_ROOT: source("vibe-trading"),
          VIDEO_USE_ROOT: source("video-use"),
          VOICEBOX_STATUS_PATH: path.join(state("voicebox"), "startup-status.json"),
          WATERMARKS_REMOVER_ROOT: source("watermarks-remover"),
        });
      }
      if (definition.id === "chatmock") {
        env["COUNCIL_LEDGER_DIR"] = councilLedgerDir;
        if (providerAuthFile) {
          // ChatMock reads this existing session directly and is forbidden to
          // refresh it in place. The QA CODEX_HOME remains disposable for all
          // other ChatMock state and account-management writes.
          env["CHATMOCK_AUTH_FILE"] = providerAuthFile;
          env["CHATMOCK_AUTH_READ_ONLY"] = "1";
        }
      }
      if (definition.id === "hermes") {
        // Hermes normally treats the checkout as a development fallback: it
        // loads and sanitizes hermes-agent/.env and may repair the shared venv
        // when update markers exist. It can also load machine-wide managed
        // policy independent of HERMES_HOME. All are forbidden in disposable QA.
        env["HERMES_QA_ISOLATED"] = "1";
        env["HERMES_MANAGED_DIR"] = path.join(
          paths.dataRoot,
          "runtime",
          "hermes-managed",
        );
        env["HERMES_DASHBOARD_FILES_ROOT"] = path.join(
          paths.dataRoot,
          "runtime",
          "hermes-files",
        );
        env["HERMES_DISABLE_LAZY_INSTALLS"] = "1";
      }

      return {
        ...definition,
        env,
        // Every run has a fresh, physically copied Next workspace so it cannot
        // share the checkout's lock or cache. A cold Windows compile can exceed
        // the normal development budget under parallel host load; keep the QA
        // wait bounded without changing production startup behavior.
        ...(definition.id === "dashboard"
          ? {
              startupTimeoutMs: Math.max(definition.startupTimeoutMs, 300_000),
              healthCheck: definition.healthCheck?.type === "http"
                ? {
                    ...definition.healthCheck,
                    timeoutMs: Math.max(definition.healthCheck.timeoutMs, 15_000),
                  }
                : undefined,
            }
          : {}),
      };
    });
}
