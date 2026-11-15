// Request signing for the organization store. A member proves who they are
// with a device key whose public half is published as a `com.breadboard.key`
// record in their own AT Protocol account. No passwords and no sessions.
import { createHash, createPublicKey, verify } from "node:crypto";
import { getRecord, isDid } from "./atproto.mjs";
import { COLLECTIONS } from "./targets.mjs";
import { HttpError } from "./http.mjs";

const DEVICE = /^[a-z0-9]{8,32}$/;
const keys = new Map();

export const authMessage = (method, pathWithQuery, ts, raw) =>
  Buffer.from(`crumbs-auth-v1\n${method}\n${pathWithQuery}\n${ts}\n${createHash("sha256").update(raw).digest("hex")}`);

async function signingKey(did, device) {
  const id = `${did}/${device}`;
  const hit = keys.get(id);
  if (hit && hit.expires > Date.now()) return hit.key;
  const record = await getRecord(did, COLLECTIONS.key, device);
  const jwk = record?.value?.signingKey;
  const key = jwk && jwk.kty === "EC" && jwk.crv === "P-256" ? createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" }) : null;
  // A missing key is remembered briefly so a flood of bad requests cannot hammer someone's data server.
  keys.set(id, { key, expires: Date.now() + (key ? 5 * 60_000 : 15_000) });
  if (keys.size > 10000) keys.delete(keys.keys().next().value);
  return key;
}

/** The caller's DID and device, or a 401. */
export async function authenticate({ method, pathWithQuery, raw, headers }) {
  const header = String(headers.authorization ?? "");
  if (!header.startsWith("Crumbs ")) throw new HttpError(401, "Sign in to Crumbs first.");
  let claim;
  try { claim = JSON.parse(Buffer.from(header.slice(7), "base64url").toString("utf8")); } catch { throw new HttpError(401, "Unreadable signature."); }
  if (!isDid(claim?.did) || !DEVICE.test(String(claim.device)) || typeof claim.sig !== "string" || !Number.isFinite(claim.ts)) throw new HttpError(401, "Unreadable signature.");
  if (Math.abs(Date.now() - claim.ts) > 5 * 60_000) throw new HttpError(401, "This request is too old. Check your clock.");
  const key = await signingKey(claim.did, claim.device).catch(() => { throw new HttpError(503, "Could not reach your account's data server."); });
  if (!key || !verify("sha256", authMessage(method, pathWithQuery, claim.ts, raw), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(claim.sig, "base64url"))) throw new HttpError(401, "Signature check failed.");
  return { did: claim.did, device: claim.device };
}
