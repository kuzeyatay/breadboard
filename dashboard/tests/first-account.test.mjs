// One account per computer: made once on first launch with a name and a
// password or PIN, then a lock screen. Skipping the password at startup is a
// desktop-only choice.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const helper = read("src/lib/first-account.ts");
const auth = read("src/lib/auth-options.ts");
const registerRoute = read("src/app/api/register/route.ts");
const loginPage = read("src/app/auth/login/page.tsx");
const loginForm = read("src/app/auth/login/login-form.tsx");
const desktopEnv = fs.readFileSync(path.join(root, "..", "desktop/src/main/service-definitions.ts"), "utf8");

test("invite codes are gone", () => {
  assert.ok(!fs.existsSync(path.join(root, "src/lib/invites.ts")));
  assert.ok(!fs.existsSync(path.join(root, "src/app/api/invites")));
  assert.doesNotMatch(registerRoute, /invite/i);
  assert.doesNotMatch(desktopEnv, /INVITE_CODE/);
});

test("only the first account signs in, with its password or, when allowed, without one", () => {
  assert.match(helper, /FROM users ORDER BY id LIMIT 1/);
  assert.match(auth, /const user = localOwner\(\)/);
  assert.match(auth, /credentials\?\.auto === '1'\) \{\s*\/\/[^\n]*\n\s*if \(askPasswordAtStartup\(user\.id\)\) return null;/);
  assert.match(auth, /bcrypt\.compare\(credentials\.password, user\.password_hash\)/);
});

test("skipping the password is desktop only and on by default", () => {
  assert.match(helper, /process\.env\.BREADBOARD_LOCAL_ACCOUNT !== '1'\) return true;/);
  assert.match(helper, /askPasswordAtStartup !== false/);
  assert.match(desktopEnv, /BREADBOARD_LOCAL_ACCOUNT: "1"/);
  assert.doesNotMatch(read("../DEPLOYMENT-UBUNTU.md"), /BREADBOARD_LOCAL_ACCOUNT/, "hosted guides never set it");
});

test("a second account cannot be made, even by two setups racing", () => {
  assert.match(registerRoute, /db\.transaction\(\(\) => \{\s*if \(countUsers\(\) > 0\) return false;/);
  assert.match(registerRoute, /status: 409/);
});

test("the login page sets up a new computer and locks an existing one", () => {
  assert.match(loginPage, /if \(!owner\) return <SetupForm \/>/);
  assert.match(loginPage, /auto=\{!askPasswordAtStartup\(owner\.id\)\}/);
  assert.match(loginForm, /signIn\('credentials', \{ auto: '1'/);
  assert.doesNotMatch(loginForm, /email/i);
});
