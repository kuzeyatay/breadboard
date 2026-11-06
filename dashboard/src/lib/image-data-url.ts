const IMAGE_HEADER = /^data:(image\/(?:jpeg|png|webp|gif));base64,/i;
const INVALID_BASE64_CHARACTER = /[^a-z0-9+/=\s]/i;

/** Browser/server image validation without a payload-sized regexp capture. */
export function parseImageDataUrl(dataUrl: string): { mimeType: string; payload: string } | null {
  const header = IMAGE_HEADER.exec(dataUrl);
  if (!header) return null;
  const payload = dataUrl.slice(header[0].length);
  // PDF screenshots can contain megabytes of base64. A quantified match over
  // all of it can exhaust V8's regexp stack when the regexp is unoptimized.
  // Searching for a single invalid character needs no payload-sized backtracking.
  if (!payload || INVALID_BASE64_CHARACTER.test(payload)) return null;
  return { mimeType: header[1]!.toLowerCase(), payload };
}
