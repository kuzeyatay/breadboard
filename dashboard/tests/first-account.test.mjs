// A fresh desktop install creates its first account without an invite code and
// lands signed in. Hosted deployments (no BREADBOARD_OPEN_FIRST_ACCOUNT) keep
// the invite-only flow untouched.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const helper = read("src/lib/first-account.ts");
const registerRoute = read("src/app/api/register/route.ts");
const registerPage = read("src/app/auth/register/page.tsx");
const registerForm = read("src/app/auth/register/register-form.tsx");
const loginPage = read("src/app/auth/login/page.tsx");
const loginForm = read("src/app/auth/login/login-form.tsx");
const authClient = read("src/lib/auth-client.ts");
const desktopEnv = fs.readFileSync(path.join(root, "..", "desktop/src/main/service-definitions.ts"), "utf8");

test("the open first account is gated on the desktop flag and an empty users table", () => {
  assert.match(helper, /process\.env\.BREADBOARD_OPEN_FIRST_ACCOUNT !== '1'\) return false/);
  assert.match(helper, /SELECT COUNT\(\*\) AS count FROM users/);
  assert.match(desktopEnv, /BREADBOARD_OPEN_FIRST_ACCOUNT: "1"/, "the desktop shell opts in");
  assert.doesNotMatch(read("../DEPLOYMENT-UBUNTU.md"), /BREADBOARD_OPEN_FIRST_ACCOUNT/, "hosted guides never set it");
});

test("the register API waives the invite only for that first account, and re-checks inside the transaction", () => {
  assert.match(registerRoute, /const openFirstAccount = !normalizedInviteCode && firstAccountOpen\(\)/);
  assert.match(registerRoute, /if \(!normalizedInviteCode && !openFirstAccount\)/, "everyone else still needs a code");
  assert.match(registerRoute, /db\.transaction\(\(\) => \{\s*if \(openFirstAccount && countUsers\(\) > 0\)/, "two first accounts cannot race in");
});

test("both auth pages ask the server first, and the forms stay client components", () => {
  assert.match(loginPage, /if \(firstAccountOpen\(\)\) redirect\('\/auth\/register'\)/);
  assert.match(registerPage, /<RegisterForm firstAccount=\{firstAccountOpen\(\)\} \/>/);
  assert.match(loginForm, /^'use client';/);
  assert.match(registerForm, /^'use client';/);
  assert.doesNotMatch(loginForm + registerForm, /@\/lib\/db/, "the database never reaches the browser bundle");
});

test("the first-account form drops the invite field and signs in straight after creating the account", () => {
  assert.match(registerForm, /\{!firstAccount && <div>\s*<label\s+htmlFor="inviteCode"/);
  assert.match(registerForm, /signIn\('credentials', \{ email, password, redirect: false, callbackUrl \}\)/);
  assert.match(registerForm, /await completeSignIn\(callbackUrl\)/);
  assert.doesNotMatch(registerForm, /registered=true/, "no detour through the sign-in form");
  assert.match(authClient, /export async function completeSignIn\(callbackUrl: string\)/);
  assert.match(loginForm, /await completeSignIn\(callbackUrl\)/, "login shares the same post-sign-in step");
});
