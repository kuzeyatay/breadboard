import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addProfile, preferProfile, profileRows, profileStore, rememberProfile, restProfile, servingProfile } from "../scripts/claude-profiles.mjs";
import { resumeOptions } from "../scripts/claude-accounts-cli.mjs";
import { validateManagedSetupRequest } from "../scripts/runtime-v2-managed-setup-executor.mjs";

test("new logins become preferred, quota rests are shared, and the preferred login returns after reset", async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bb-claude-profiles-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const status = id => ({ loggedIn: true, email: id === "default" ? "one@example.test" : "two@example.test" });
  const named = await addProfile(root, () => {}, status);
  assert.equal(servingProfile(root), named);
  const reset = Date.now() + 300000;
  restProfile(root, named, reset);
  assert.equal(servingProfile(root, reset - 1), "default");
  assert.equal(servingProfile(root, reset), named);
  assert.equal(profileRows(root)[0].id, named);
  restProfile(root, "default", reset);
  assert.equal(servingProfile(root, reset - 1), null);
  preferProfile(root, "default");
  assert.equal(servingProfile(root, reset), "default");
  rememberProfile(root, "default", { loggedIn: false });
  assert.equal(servingProfile(root, reset), named);
  assert.throws(() => preferProfile(root, "default"), /signed out/);
});

test("cancelled and repeated logins leave the existing account and its profile directory intact", async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bb-claude-login-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const status = () => ({ loggedIn: true, email: "one@example.test" });
  assert.equal(await addProfile(root, () => {}, status), "default");
  await assert.rejects(addProfile(root, () => { throw Error("cancelled"); }, status), /cancelled/);
  assert.deepEqual(profileRows(root).map(row => row.id), ["default"]);
  assert.deepEqual(readdirSync(profileStore(root)).sort(), ["default.json", "preferred.json"]);
});

test("the account worker accepts only profile IDs and only for targeted account commands", () => {
  const command = { protocolVersion: 1, operation: "claude-code", action: "logout", profile: "default" };
  assert.deepEqual(validateManagedSetupRequest(command), command);
  for (const patch of [{ profile: "../another" }, { action: "remove" }, { operation: "comfyui" }]) {
    assert.throws(() => validateManagedSetupRequest({ ...command, ...patch }), /invalid/);
  }
});

test("resume preserves permission, model and tool settings without submitting the original prompt twice", () => {
  const help = "  -p, --print                     Print response\n  --model <model>                 Model\n  --tools <tools...>              Tools\n  --permission-mode <mode>        Mode\n  -r, --resume [session]          Resume";
  assert.deepEqual(resumeOptions(["-p", "run once", "--model", "sonnet", "-r", "old", "--permission-mode", "plan", "--tools", ""], help),
    ["-p", "--model", "sonnet", "--permission-mode", "plan", "--tools", ""]);
  assert.throws(() => resumeOptions(["--new-permission-mode", "read-only"], help), /unrecognized/);
});
