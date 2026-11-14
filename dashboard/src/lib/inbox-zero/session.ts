// How Breadboard authenticates to the user's own Inbox Zero.
//
// Inbox Zero's API is authenticated by a better-auth session cookie. There is a
// public API-key surface, but it covers rules and statistics only — none of the
// reading, drafting, replying or archiving that makes an email agent worth
// having. The assistant endpoint that does all of that takes a session.
//
// So Breadboard mints one, the same way the app's own mobile sign-in does:
// insert a session row for the account that is already signed in, then present
// it as the signed cookie better-auth expects. The signature is
// `base64url(HMAC-SHA256(authSecret, token))` — `makeSignature` in
// better-auth/crypto, which `apps/web/utils/mobile-auth/session-cookie.ts`
// calls for exactly this purpose.
//
// This is minting a credential against a local service Breadboard already owns
// the secrets for, and it is worth being precise about what it is not: it does
// not create an account, it does not connect a mailbox, and it cannot reach a
// mailbox the user has not signed in and authorised themselves. Everything here
// depends on the user having completed Inbox Zero's own OAuth flow first, in
// their own browser, against their own Google or Microsoft client.

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { composeCommand, run } from "../socials-manager/docker.ts";
import { composeArgs } from "./stack.ts";
import type { InboxZeroConfig, InboxZeroCredentials } from "./config.ts";
import {
  SESSION_COOKIE_NAME,
  type BreadboardGmailGrant,
  type InboxZeroSession,
  type MailboxIdentity,
} from "./contract.ts";

export {
  EMAIL_ACCOUNT_HEADER,
  SESSION_COOKIE_NAME,
  type InboxZeroSession,
  type MailboxIdentity,
} from "./contract.ts";

/** How long a minted session lives. Long enough to outlast a run, short enough
 *  that an abandoned one expires on its own. */
/** psql column separator: a control character no email or id can contain. */
const FIELD_SEPARATOR = "\u001f";

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Run one statement inside the stack's Postgres container.
 *
 * `psql` in the container rather than a Postgres driver on the host: it keeps
 * this integration free of a database dependency it would otherwise need only
 * here, and it works whether or not the port is published.
 */
async function psql(
  config: InboxZeroConfig,
  credentials: InboxZeroCredentials,
  sql: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[][]> {
  const compose = await composeCommand(env);
  if (!compose) throw new Error("no_compose_command");
  const [command, ...leading] = compose;
  const result = await run(
    command,
    [
      ...leading,
      ...composeArgs(config),
      "exec",
      "-T",
      "-e",
      `PGPASSWORD=${credentials.postgresPassword}`,
      "db",
      "psql",
      "-U",
      "postgres",
      "-d",
      "inboxzero",
      "-At",
      "-F",
      FIELD_SEPARATOR,
      "-c",
      sql,
    ],
    { cwd: config.cloneRoot, timeoutMs: 30_000, env },
  );
  if (result.code !== 0) {
    throw new Error(`psql_failed: ${result.stderr.trim().slice(0, 400)}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => line.split(FIELD_SEPARATOR));
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The mailbox this agent works on: the account the user connected.
 *
 * When more than one is connected the oldest wins, because it is the one they
 * signed in with first and the one every other surface defaults to. Naming a
 * different one is a setting, not a guess to make per run.
 */
export async function resolveMailbox(
  config: InboxZeroConfig,
  credentials: InboxZeroCredentials,
  preferredEmail?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MailboxIdentity | null> {
  const rows = await psql(
    config,
    credentials,
    `SELECT ea.id, ea.email, ea."userId", a.provider
       FROM "EmailAccount" ea
       JOIN "Account" a ON a.id = ea."accountId"
      ORDER BY ea."createdAt" ASC`,
    env,
  );
  if (!rows.length) return null;
  const wanted = preferredEmail?.trim().toLowerCase();
  const row =
    (wanted ? rows.find((candidate) => candidate[1]?.toLowerCase() === wanted) : undefined) ??
    rows[0];
  const [emailAccountId, email, userId, provider] = row;
  if (!emailAccountId || !userId) return null;
  return { emailAccountId, email: email ?? "", userId, provider: provider ?? "" };
}

/** Every mailbox connected to this instance, for the settings panel. */
export async function listMailboxes(
  config: InboxZeroConfig,
  credentials: InboxZeroCredentials,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Array<{ email: string; provider: string }>> {
  const rows = await psql(
    config,
    credentials,
    `SELECT ea.email, a.provider
       FROM "EmailAccount" ea
       JOIN "Account" a ON a.id = ea."accountId"
      ORDER BY ea."createdAt" ASC`,
    env,
  );
  return rows.map(([email, provider]) => ({ email: email ?? "", provider: provider ?? "" }));
}

/**
 * Connect Breadboard's Gmail grant as an Inbox Zero mailbox, exactly as its own
 * Google sign-in would have: a User, a better-auth Account (provider `google`,
 * providerAccountId = Google `sub`) and the EmailAccount bound to it.
 *
 * Tokens go in as plaintext; Inbox Zero's `decryptToken` passes plaintext
 * through and re-encrypts on its first refresh. An existing mailbox keeps its
 * own tokens (Inbox Zero refreshes them) until the Breadboard grant changes
 * scope — i.e. the user reconnected Gmail with more permissions — or the
 * account was marked disconnected; then the newer grant replaces them.
 */
export async function seedGoogleMailbox(
  config: InboxZeroConfig,
  credentials: InboxZeroCredentials,
  grant: BreadboardGmailGrant,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const email = grant.email.trim().toLowerCase();
  const text = (value: string | null) => (value ? quote(value) : "NULL");
  const expiresAt = grant.expiresAt ? quote(new Date(grant.expiresAt).toISOString()) : "now()";
  await psql(
    config,
    credentials,
    `UPDATE "Account" SET
       access_token = ${quote(grant.accessToken)},
       refresh_token = COALESCE(${text(grant.refreshToken)}, refresh_token),
       expires_at = ${expiresAt},
       scope = ${text(grant.scope)},
       "disconnectedAt" = NULL,
       "updatedAt" = now()
     WHERE provider = 'google' AND "providerAccountId" = ${quote(grant.sub)}
       AND (scope IS DISTINCT FROM ${text(grant.scope)} OR "disconnectedAt" IS NOT NULL)`,
    env,
  );
  await psql(
    config,
    credentials,
    `WITH u AS (
       INSERT INTO "User" (id, email, name, image, "emailVerified", "createdAt", "updatedAt")
       SELECT ${quote(randomUUID())}, ${quote(email)}, ${text(grant.name)}, ${text(grant.picture)}, true, now(), now()
        WHERE NOT EXISTS (SELECT 1 FROM "EmailAccount" WHERE lower(email) = ${quote(email)})
       ON CONFLICT (email) DO UPDATE SET "updatedAt" = now()
       RETURNING id
     ), a AS (
       INSERT INTO "Account" (id, "userId", provider, type, "providerAccountId", access_token,
                              refresh_token, expires_at, scope, token_type, "createdAt", "updatedAt")
       SELECT ${quote(randomUUID())}, u.id, 'google', 'oidc', ${quote(grant.sub)}, ${quote(grant.accessToken)},
              ${text(grant.refreshToken)}, ${expiresAt}, ${text(grant.scope)}, 'Bearer', now(), now()
         FROM u
       ON CONFLICT (provider, "providerAccountId") DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, "Account".refresh_token),
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         "disconnectedAt" = NULL,
         "updatedAt" = now()
       RETURNING id, "userId"
     )
     INSERT INTO "EmailAccount" (id, email, name, image, "userId", "accountId", "createdAt", "updatedAt")
     SELECT ${quote(randomUUID())}, ${quote(email)}, ${text(grant.name)}, ${text(grant.picture)}, a."userId", a.id, now(), now()
       FROM a
     ON CONFLICT DO NOTHING`,
    env,
  );
}

/** The cookie value better-auth will accept for this session token. */
export function signSessionToken(token: string, authSecret: string): string {
  const signature = createHmac("sha256", authSecret).update(token).digest("base64url");
  return `${token}.${signature}`;
}

/**
 * Mint a session for the connected mailbox and return the cookie to send with
 * it. Returns null when no mailbox is connected yet — the caller turns that into
 * the one instruction that actually helps: finish signing in.
 */
export async function mintSession(input: {
  config: InboxZeroConfig;
  credentials: InboxZeroCredentials;
  preferredEmail?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<InboxZeroSession | null> {
  const env = input.env ?? process.env;
  const identity = await resolveMailbox(
    input.config,
    input.credentials,
    input.preferredEmail,
    env,
  );
  if (!identity) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const now = new Date().toISOString();
  await psql(
    input.config,
    input.credentials,
    `INSERT INTO "Session" (id, "sessionToken", "userId", expires, "createdAt", "updatedAt", "userAgent")
       VALUES (${quote(randomUUID())}, ${quote(token)}, ${quote(identity.userId)},
               ${quote(expiresAt.toISOString())}, ${quote(now)}, ${quote(now)}, 'Breadboard')`,
    env,
  );

  return {
    cookie: `${SESSION_COOKIE_NAME}=${signSessionToken(token, input.credentials.authSecret)}`,
    identity,
    expiresAt,
  };
}

/**
 * Drop the sessions Breadboard minted. Called when the agent is disconnected, so
 * turning it off actually revokes the access rather than only hiding the button.
 */
export async function revokeMintedSessions(
  config: InboxZeroConfig,
  credentials: InboxZeroCredentials,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const rows = await psql(
    config,
    credentials,
    `WITH removed AS (DELETE FROM "Session" WHERE "userAgent" = 'Breadboard' RETURNING 1)
       SELECT count(*) FROM removed`,
    env,
  );
  return Number(rows[0]?.[0] ?? 0) || 0;
}
