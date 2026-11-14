// Breadboard's own Gmail connection, packaged for Inbox Zero.
//
// Without this the user had to create a second Google OAuth client and sign in
// to Inbox Zero separately, even though Breadboard already held a working Gmail
// grant. Inbox Zero now adopts that grant (and the client it was issued to).

import "server-only";

import { connectedAppOAuthClient, connectedAppTokensFor } from "../connected-apps/broker.ts";
import type { BreadboardGmailGrant } from "./contract.ts";

/** The user's Gmail grant, or null when Gmail is not connected in Breadboard. */
export async function breadboardGmailGrant(userId: number): Promise<BreadboardGmailGrant | null> {
  let client: { clientId: string; clientSecret: string | null };
  let tokens: Awaited<ReturnType<typeof connectedAppTokensFor>>;
  try {
    client = connectedAppOAuthClient("gmail");
    tokens = await connectedAppTokensFor(userId, "gmail");
  } catch {
    return null; // not connected, or no Google client configured
  }
  if (!client.clientSecret) return null;
  // `sub` is what better-auth keys a Google account on, so a later sign-in in
  // Inbox Zero's own UI lands on the same account instead of a duplicate.
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const profile = (await response.json()) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const sub = text(profile.sub);
  const email = text(profile.email);
  if (!sub || !email) return null;
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    sub,
    email,
    name: text(profile.name),
    picture: text(profile.picture),
  };
}
