import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";
import {
  patentDisclosureCommandText,
} from "../src/lib/hermes/patent-disclosure-intent.ts";
import {
  PATENT_DISCLOSURE_GUIDE_TOOL,
  patentDisclosureGuidanceSelected,
} from "../src/lib/hermes/patent-disclosure-access.ts";
import {
  PATENT_DISCLOSURE_SKILL,
  PATENT_DISCLOSURE_UPSTREAM_COMMIT,
  PatentDisclosureSourceError,
  listPatentDisclosureGuidance,
  readPatentDisclosureGuidance,
} from "../src/lib/hermes/patent-disclosure-source.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import {
  listApprovedSkills,
  listFirstPartySkills,
} from "../src/lib/hermes/skills.ts";
import { assertPinnedCleanCheckout } from "../../desktop/scripts/pinned-source-checkout.mjs";

test("a delegated research report mentioning claims is not a patent request", () => {
  const text = "Review the scientific evidence and explain which claims about hypertrophy hold up.";
  const result = patentDisclosureCommandText({
    text,
    surface: "garden_chat",
    authenticated: true,
    internalContinuation: true,
  });
  assert.deepEqual(result, { text, automatic: false });
});
import {
  isPatentDisclosurePackageFile,
  PATENT_DISCLOSURE_REQUIRED_FILES,
  PATENT_DISCLOSURE_UPSTREAM_COMMIT as PACKAGED_PATENT_DISCLOSURE_COMMIT,
} from "../../desktop/scripts/patent-disclosure-package.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sourceRoot = path.join(repositoryRoot, PATENT_DISCLOSURE_SKILL);
test("Patent Disclosure is a ready first-party skill on authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === PATENT_DISCLOSURE_SKILL,
    );
    assert.ok(skill, `patent-disclosure-skill missing from ${surface}`);
    assert.equal(skill.classification, "eligible_general");
    assert.equal(skill.availability, "ready");
    assert.ok(skill.enabled && skill.healthy);
    assert.ok(skill.instructions.includes(PATENT_DISCLOSURE_UPSTREAM_COMMIT));
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      "patent_disclosure_guide",
      "workspace_list",
      "workspace_read",
      "workspace_write",
      "workspace_patch",
      "workspace_search",
      "office_run",
      "office_export",
      "artifact_import",
      "artifact_image_generate",
    ]);
    assert.ok(
      listApprovedSkills(surface).some(
        (candidate) => candidate.slug === PATENT_DISCLOSURE_SKILL,
      ),
      `patent-disclosure-skill is not approved on ${surface}`,
    );
  }
  assert.equal(
    listApprovedSkills("quartz_ai").some(
      (candidate) => candidate.slug === PATENT_DISCLOSURE_SKILL,
    ),
    false,
    "anonymous Quartz must not receive workspace-backed patent guidance",
  );
});

test("patent_disclosure_guide is registered only on authenticated chat surfaces", async () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.ok(allowedToolsForSurface(surface).includes(PATENT_DISCLOSURE_GUIDE_TOOL));
  }
  assert.equal(
    allowedToolsForSurface("quartz_ai").includes(PATENT_DISCLOSURE_GUIDE_TOOL),
    false,
  );

  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    chatmockBaseUrl: "http://127.0.0.1:8765/v1",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  const capabilities = await adapter.listCapabilities();
  assert.ok(capabilities.tools.includes(PATENT_DISCLOSURE_GUIDE_TOOL));
  adapter.dispose();

  assert.equal(
    patentDisclosureGuidanceSelected({
      allowedTools: [PATENT_DISCLOSURE_GUIDE_TOOL],
      selectedConditionalSkills: [PATENT_DISCLOSURE_SKILL],
    }),
    true,
  );
  assert.equal(
    patentDisclosureGuidanceSelected({
      allowedTools: [PATENT_DISCLOSURE_GUIDE_TOOL],
      selectedConditionalSkills: [],
    }),
    false,
  );
  assert.equal(
    patentDisclosureGuidanceSelected({
      allowedTools: [],
      selectedConditionalSkills: [PATENT_DISCLOSURE_SKILL],
    }),
    false,
  );
});

test("the guidance bridge serves the routed text tree and refuses executable or escaping paths", () => {
  const env = { BREADBOARD_PATENT_DISCLOSURE_ROOT: sourceRoot };
  const files = listPatentDisclosureGuidance(env);
  for (const required of [
    "SKILL.md",
    "prompts/disclosure/intake.md",
    "prompts/disclosure/invention/disclosure_builder.md",
    "prompts/reader/patent_plain_reader.md",
    "prompts/oa/respond_office_action.md",
    "references/schemas/figure_plan.schema.yaml",
  ]) {
    assert.ok(files.includes(required), `${required} is absent from the guidance index`);
    const opened = readPatentDisclosureGuidance(required, env);
    assert.equal(opened.path, required);
    assert.ok(opened.bytes > 0);
    assert.ok(opened.guidance.length > 0);
  }
  assert.equal(files.some((file) => file.startsWith("tools/")), false);
  assert.equal(files.some((file) => /\.(?:jpg|png|py)$/iu.test(file)), false);

  for (const denied of [
    "../README.md",
    "/etc/passwd",
    "C:/Windows/win.ini",
    "tools/shared/md_to_docx.py",
    "assets/obsidian/patents.base.yaml",
    "prompts/../../README.md",
  ]) {
    assert.throws(
      () => readPatentDisclosureGuidance(denied, env),
      (error) =>
        error instanceof PatentDisclosureSourceError &&
        ["patent_guidance_path_denied", "patent_guidance_path_invalid"].includes(error.code),
      denied,
    );
  }
});

test("the shipped router names every upstream workflow and its immutable boundary", () => {
  const shipped = listFirstPartySkills("dashboard_terminal").find(
    (candidate) => candidate.slug === PATENT_DISCLOSURE_SKILL,
  )?.instructions ?? "";
  for (const marker of [
    PATENT_DISCLOSURE_UPSTREAM_COMMIT,
    "Mode A — disclosure",
    "Mode B — plain-language patent reading",
    "Mode C — policy/examination evolution",
    "Mode D — office-action assistance",
    "patent_disclosure_guide",
    "does not execute the clone's Python",
    "freedom-to-operate conclusion",
  ]) {
    assert.ok(shipped.includes(marker), `shipped skill lost ${marker}`);
  }
});

test("clear patent tasks auto-select the skill without stealing adjacent requests", () => {
  const select = (text, priorMessages) => patentDisclosureCommandText({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });
  for (const text of [
    "帮我写一份发明专利交底书",
    "从这个项目里挖掘专利点",
    "做一下实用新型专利查新",
    "读专利 CN123456789A，解释权利要求",
    "根据审查意见通知书起草答复",
    "prepare an invention disclosure for this mechanism",
    "run a prior-art search for this scheduler",
    "analyze the claims in this patent",
    "draft an office action response",
  ]) {
    const selected = select(text);
    assert.equal(selected.automatic, true, `should select: ${text}`);
    assert.ok(selected.text.startsWith(`/${PATENT_DISCLOSURE_SKILL} `));
  }
  for (const text of [
    "what is a patent?",
    "design a desk lamp",
    "search for recent AI news",
    "review this repository's disclosure component",
    "draw a system architecture diagram",
    "/office create a report",
  ]) {
    assert.equal(select(text).automatic, false, `should not select: ${text}`);
  }
  assert.equal(
    select("继续成稿并导出", [
      { role: "assistant", content: "交底书预览完成，figure_plan.yaml 还有一项待确认。" },
    ]).automatic,
    true,
  );
  assert.equal(
    patentDisclosureCommandText({
      text: "write a patent disclosure",
      surface: "quartz_ai",
      authenticated: false,
    }).automatic,
    false,
  );
  assert.equal(
    patentDisclosureCommandText({
      text: "prepare an invention disclosure",
      surface: "garden_chat",
      authenticated: true,
    }).automatic,
    true,
  );
});

test("desktop packaging accepts the pinned guidance closure and rejects executable inputs", () => {
  assert.equal(
    PACKAGED_PATENT_DISCLOSURE_COMMIT,
    PATENT_DISCLOSURE_UPSTREAM_COMMIT,
  );
  assert.equal(
    assertPinnedCleanCheckout({
      label: "Patent Disclosure skill",
      sourceRoot,
      expectedCommit: PATENT_DISCLOSURE_UPSTREAM_COMMIT,
      allowVendoredSnapshot: true,
    }),
    PATENT_DISCLOSURE_UPSTREAM_COMMIT,
  );
  for (const required of PATENT_DISCLOSURE_REQUIRED_FILES) {
    assert.equal(isPatentDisclosurePackageFile(required), true, required);
  }
  for (const denied of [
    "tools/shared/md_to_docx.py",
    "tools/run.sh",
    "assets/example.png",
    "outputs/disclosure.docx",
    "prompts/unsafe.exe",
  ]) {
    assert.equal(isPatentDisclosurePackageFile(denied), false, denied);
  }
});
