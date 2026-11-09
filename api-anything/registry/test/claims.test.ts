/**
 * Ops learned signed in, claimed by fingerprint: the body is asked for only once installs on enough
 * distinct networks hold the same op, only from one of them, only in its anonymous form, and it keeps its
 * name only if as many chose it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { anonymous, fingerprintText, nameHashText } from "../../src/registry-api.js";
import { OperationSchema } from "../../src/spec.js";
import { evidence, install, op, registry, send, site } from "./helpers.js";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const signedIn = OperationSchema.parse(op({ learnedLoggedIn: true, description: "Charles's reading list" }));
const anon = anonymous(signedIn);
const fingerprint = sha(fingerprintText(site.name, anon));
const claimOf = (name = signedIn.name) => ({
  site: { name: site.name, domain: site.domain },
  fingerprint,
  nameHash: sha(nameHashText(name)),
});
const bare = { name: site.name, domain: site.domain, baseUrl: site.baseUrl };
const answer = (operation: unknown = anon) => ({
  site: { ...bare, description: "Charles's books" },
  operation,
  evidence: { ...evidence, learnedLoggedIn: true, cleanReplay: "skipped" },
  claim: fingerprint,
});

test("the body is asked for once three installs on three networks claim the same fingerprint, and only of them", async () => {
  const { env } = registry();
  const [a, b, c, d] = [install(), install(), install(), install()];
  const first = await send(env, "POST", "/v1/claims", { as: a, ip: "198.51.100.7", body: claimOf() });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.body.wanted, []);
  assert.equal(
    (await send(env, "POST", "/v1/versions", { as: a, body: answer() })).status,
    422,
    "one claim is not enough",
  );
  await send(env, "POST", "/v1/claims", { as: b, ip: "192.0.2.44", body: claimOf() });
  const third = await send(env, "POST", "/v1/claims", { as: c, ip: "203.0.113.80", body: claimOf() });
  assert.deepEqual(third.body.wanted, [{ site: site.name, fingerprint, named: true }]);
  assert.deepEqual((await send(env, "GET", "/v1/claims", { as: a })).body.wanted, [
    { site: site.name, fingerprint, named: true },
  ]);
  assert.deepEqual(
    (await send(env, "GET", "/v1/claims", { as: d })).body.wanted,
    [],
    "a stranger is asked for nothing",
  );
  const stranger = await send(env, "POST", "/v1/versions", { as: d, ip: "198.18.0.9", body: answer() });
  assert.equal(stranger.status, 422);
  assert.match(stranger.body.reasons[0], /did not claim/);

  const r = await send(env, "POST", "/v1/versions", { as: a, ip: "198.51.100.7", body: answer() });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.status, "review", "a login op still waits for a maintainer");
  assert.ok(r.body.reasons.some((x: string) => /3 installs on distinct networks hold this exact op/.test(x)));
  const stored = env.DB as unknown as { prepare(s: string): { first<T>(): Promise<T> } };
  const row = await stored
    .prepare("SELECT operation, claim FROM versions")
    .first<{ operation: string; claim: string }>();
  assert.equal(row.claim, fingerprint);
  assert.equal(JSON.parse(row.operation).name, signedIn.name, "three installs gave it this name");
  const siteRow = await stored.prepare("SELECT description FROM sites").first<{ description: string | null }>();
  assert.equal(siteRow.description, null, "the uploader's words about the site stay home");
  assert.deepEqual(
    (await send(env, "GET", "/v1/claims", { as: b })).body.wanted,
    [],
    "an answered claim is asked for no more",
  );
});

test("three installs on one network are one voice", async () => {
  const { env } = registry();
  for (let i = 0; i < 3; i++)
    await send(env, "POST", "/v1/claims", { as: install(), ip: "198.51.100.7", body: claimOf() });
  const a = install();
  const r = await send(env, "POST", "/v1/claims", { as: a, ip: "198.51.100.7", body: claimOf() });
  assert.deepEqual(r.body.wanted, []);
});

test("an answer must be the anonymous op the fingerprint names, and a name one person chose does not go out", async () => {
  const { env } = registry();
  const [a, b, c] = [install(), install(), install()];
  await send(env, "POST", "/v1/claims", { as: a, ip: "198.51.100.7", body: claimOf("charlesList") });
  await send(env, "POST", "/v1/claims", { as: b, ip: "192.0.2.44", body: claimOf() });
  const asked = await send(env, "POST", "/v1/claims", { as: c, ip: "203.0.113.80", body: claimOf("myBooks") });
  // asked for, but under no name of this install's: three installs did not agree on one
  assert.deepEqual(asked.body.wanted, [{ site: site.name, fingerprint, named: false }]);
  const worded = await send(env, "POST", "/v1/versions", { as: a, ip: "198.51.100.7", body: answer(signedIn) });
  assert.match(worded.body.reasons[0], /anonymous form/);
  const other = anonymous(
    OperationSchema.parse(op({ learnedLoggedIn: true, match: { host: "www.example.com", path: "/api/find" } })),
  );
  const wrong = await send(env, "POST", "/v1/versions", { as: a, ip: "198.51.100.7", body: answer(other) });
  assert.match(wrong.body.reasons[0], /does not hash/);
  const r = await send(env, "POST", "/v1/versions", {
    as: a,
    ip: "198.51.100.7",
    body: answer({ ...anon, name: "charlesList" }),
  });
  assert.equal(r.status, 201, r.text);
  const stored = env.DB as unknown as { prepare(s: string): { first<T>(): Promise<T> } };
  const row = await stored.prepare("SELECT operation FROM versions").first<{ operation: string }>();
  assert.equal(JSON.parse(row.operation).name, `op_${fingerprint.slice(0, 8)}`);
});

test("a claim under a name bound to another domain, or one that names no domain of its own, is refused", async () => {
  const { env } = registry();
  await send(env, "POST", "/v1/versions", { as: install(), body: { site, operation: op(), evidence } });
  const taken = await send(env, "POST", "/v1/claims", {
    as: install(),
    body: { ...claimOf(), site: { name: site.name, domain: "evil.example.net" } },
  });
  assert.equal(taken.status, 409);
  const squat = await send(env, "POST", "/v1/claims", {
    as: install(),
    body: { ...claimOf(), site: { name: "amazon", domain: "example.org" } },
  });
  assert.equal(squat.status, 422);
});
