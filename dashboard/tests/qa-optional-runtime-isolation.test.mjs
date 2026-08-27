import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveAgentReachRoot } from "../src/lib/agent-reach/runtime.ts";
import { resolveCareerOpsRoot } from "../src/lib/career-ops/runtime.ts";
import { resolveDeepTutorRoot } from "../src/lib/deep-tutor/runtime.ts";
import { resolveDeerFlowRoot } from "../src/lib/deer-flow/runtime.ts";
import { resolveLegalRoot } from "../src/lib/legal/runtime.ts";
import { resolveMoneyPrinterRoot } from "../src/lib/money-printer/runtime.ts";
import { resolveOpenMontageRoot } from "../src/lib/openmontage/runtime.ts";
import { resolveResource2SkillRoot } from "../src/lib/resource2skill/runtime.ts";
import { resolveShortsRoot } from "../src/lib/shorts/runtime.ts";
import { resolveShapeRRoot } from "../src/lib/shaper/source.ts";
import { resolveStockAnalystRoot } from "../src/lib/stock-analyst/runtime.ts";
import { resolveSubsAiRoot } from "../src/lib/subsai/runtime.ts";
import { resolveTradingAgentsRoot } from "../src/lib/tradingagents/runtime.ts";
import { resolveVibeTradingRoot } from "../src/lib/vibe-trading/runtime.ts";

test("QA optional runtimes never fall through to installed checkout clones", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-qa-roots-"));
  const missing = path.join(parent, "intentionally-missing");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const cases = [
    ["AGENT_REACH_ROOT", resolveAgentReachRoot],
    ["CAREER_OPS_ROOT", resolveCareerOpsRoot],
    ["DEEP_TUTOR_ROOT", resolveDeepTutorRoot],
    ["DEER_FLOW_ROOT", resolveDeerFlowRoot],
    ["HARVEY_LABS_ROOT", resolveLegalRoot],
    ["MONEY_PRINTER_ROOT", resolveMoneyPrinterRoot],
    ["OPENMONTAGE_ROOT", resolveOpenMontageRoot],
    ["RESOURCE2SKILL_ROOT", resolveResource2SkillRoot],
    ["SHORTS_ROOT", resolveShortsRoot],
    ["SHAPER_ROOT", resolveShapeRRoot],
    ["STOCK_ANALYST_ROOT", resolveStockAnalystRoot],
    ["SUBSAI_ROOT", resolveSubsAiRoot],
    ["TRADINGAGENTS_ROOT", resolveTradingAgentsRoot],
    ["VIBE_TRADING_ROOT", resolveVibeTradingRoot],
  ];

  for (const [key, resolve] of cases) {
    assert.equal(
      resolve({ BREADBOARD_QA_MODE: "1", [key]: missing }),
      null,
      `${key} must not fall back outside the configured QA root`,
    );
  }
});
