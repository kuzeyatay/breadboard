// Client-side cryptography for Crumbs organizations. Everything here runs on
// the member's own machine: the organization store only ever sees the output.
//
// Each device has two P-256 keys, a signing key (proves who sent a request or a
// message) and an agreement key (receives organization keys). Their public
// halves are published as a `com.breadboard.key` record in the member's own
// AT Protocol account. An organization has one AES-256 key per epoch; an admin
// starts a new epoch whenever someone is removed, and sends the new key to
// every remaining device in an envelope only that device can open.
//
// ponytail: epoch keys, not MLS. Removal is O(devices) per rotation and old
// epochs stay readable by anyone who held their keys. Move to MLS (RFC 9420)
// if organizations grow past a few hundred devices or need forward secrecy.
import { createCipheriv, createDecipheriv, createECDH, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign, verify } from "node:crypto";

export interface PublicJwk { kty: "EC"; crv: "P-256"; x: string; y: string }
export interface PrivateJwk extends PublicJwk { d: string }
export interface DeviceKeys { deviceId: string; signing: PrivateJwk; agreement: PrivateJwk }

const publicHalf = (jwk: PublicJwk): PublicJwk => ({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y });
function generateP256(): PrivateJwk {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  return { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y!, d: jwk.d! };
}

export function generateDeviceKeys(): DeviceKeys {
  return { deviceId: randomBytes(8).toString("hex"), signing: generateP256(), agreement: generateP256() };
}

/** The public record a device publishes in its owner's account. */
export function deviceKeyRecord(keys: DeviceKeys, deviceName: string) {
  return { $type: "com.breadboard.key", signingKey: publicHalf(keys.signing), agreementKey: publicHalf(keys.agreement), name: deviceName.slice(0, 80), createdAt: new Date().toISOString() };
}

export function isPublicJwk(value: unknown): value is PublicJwk {
  const jwk = value as Partial<PublicJwk> | null;
  return !!jwk && jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.x === "string" && typeof jwk.y === "string" && jwk.x.length <= 64 && jwk.y.length <= 64;
}

export function signBytes(key: PrivateJwk, data: Buffer): string {
  return sign("sha256", data, { key: createPrivateKey({ key: { ...key }, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url");
}
export function verifyBytes(key: PublicJwk, data: Buffer, signature: string): boolean {
  try { return verify("sha256", data, { key: createPublicKey({ key: { ...publicHalf(key) }, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")); }
  catch { return false; }
}

/** The `Authorization` header for one request to the organization store. */
export function signRequest(keys: DeviceKeys, did: string, method: string, pathWithQuery: string, body: string, ts = Date.now()): string {
  const message = Buffer.from(`crumbs-auth-v1\n${method}\n${pathWithQuery}\n${ts}\n${createHash("sha256").update(body).digest("hex")}`);
  return `Crumbs ${Buffer.from(JSON.stringify({ did, device: keys.deviceId, ts, sig: signBytes(keys.signing, message) })).toString("base64url")}`;
}

const point = (jwk: PublicJwk) => Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
function open(key: Buffer, sealed: string[], aad: string): Buffer {
  const [iv, tag, body] = sealed;
  if (!iv || !tag || body === undefined) throw new Error("Malformed ciphertext.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
}

export const newEpochKey = () => randomBytes(32);

/** Wrap an organization key so that only `recipient` can open it. */
export function wrapKey(epochKey: Buffer, recipient: PublicJwk, context: string): string {
  const ephemeral = createECDH("prime256v1");
  ephemeral.generateKeys();
  const shared = ephemeral.computeSecret(point(recipient));
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), `crumbs-envelope-v1\n${context}`, 32));
  return ["v1", ephemeral.getPublicKey().toString("base64url"), seal(key, epochKey, context)].join(".");
}
export function unwrapKey(envelope: string, recipient: PrivateJwk, context: string): Buffer {
  const [version, ephemeral, ...sealed] = envelope.split(".");
  if (version !== "v1" || !ephemeral) throw new Error("Unknown envelope version.");
  const mine = createECDH("prime256v1");
  mine.setPrivateKey(Buffer.from(recipient.d, "base64url"));
  const shared = mine.computeSecret(Buffer.from(ephemeral, "base64url"));
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), `crumbs-envelope-v1\n${context}`, 32));
  const epochKey = open(key, sealed, context);
  if (epochKey.length !== 32) throw new Error("Unexpected key length.");
  return epochKey;
}
export const envelopeContext = (orgId: string, epoch: number, did: string, device: string) => `${orgId}\n${epoch}\n${did}\n${device}`;

export function encryptJson(epochKey: Buffer, value: unknown, context: string): string {
  return `v1.${seal(epochKey, Buffer.from(JSON.stringify(value)), context)}`;
}
export function decryptJson<T>(epochKey: Buffer, ciphertext: string, context: string): T {
  const [version, ...sealed] = ciphertext.split(".");
  if (version !== "v1") throw new Error("Unknown ciphertext version.");
  return JSON.parse(open(epochKey, sealed, context).toString("utf8")) as T;
}

/** Lets a member ask the store for one page's messages without naming the page. */
export function pageIndex(epochKey: Buffer, pageUrl: string): string {
  return createHmac("sha256", epochKey).update(`crumbs-page-v1\n${pageUrl}`).digest("hex");
}

export const messageSigningInput = (orgId: string, epoch: number, messageId: string, ciphertext: string) =>
  Buffer.from(`crumbs-message-v1\n${orgId}\n${epoch}\n${messageId}\n${ciphertext}`);
