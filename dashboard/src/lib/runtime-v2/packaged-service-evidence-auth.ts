import { timingSafeEqual } from "node:crypto";

export const PACKAGED_SERVICE_EVIDENCE_TOKEN_PATTERN = /^[0-9a-f]{64}$/iu;

function canonicalPort(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  if (!/^[1-9]\d{0,4}$/u.test(text)) return null;
  const port = Number(text);
  return port <= 65_535 && String(port) === text ? text : null;
}

export function authorizedPackagedServiceEvidenceRequest(
  request: Pick<Request, "headers" | "url">,
  expectedToken: string,
  expectedPort: string | undefined,
): boolean {
  const port = canonicalPort(expectedPort);
  if (!port || !PACKAGED_SERVICE_EVIDENCE_TOKEN_PATTERN.test(expectedToken)) return false;

  // With Next's standalone server and trustHostHeader disabled, Request.url uses
  // an internal placeholder hostname. The HTTP Host header still contains the
  // exact listener target. Runtime V2 binds that listener to IPv4 loopback and
  // supplies its canonical port, so require both values instead of trusting the
  // placeholder URL hostname.
  let protocol: string;
  try {
    protocol = new URL(request.url).protocol;
  } catch {
    return false;
  }
  const expectedHost = `127.0.0.1:${port}`;
  if (protocol !== "http:" || request.headers.get("host") !== expectedHost) return false;

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (
    supplied.length !== expectedToken.length ||
    !PACKAGED_SERVICE_EVIDENCE_TOKEN_PATTERN.test(supplied)
  ) {
    return false;
  }
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expectedToken, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
