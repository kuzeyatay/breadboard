/**
 * HTTP byte ranges and validators for documents the viewer reads (IO-02, IO-04).
 *
 * PDF.js only fetches the pages someone is actually looking at when the server
 * says it supports ranges. Without `Accept-Ranges` it downloads the whole file
 * before showing page one — which, for a shelf of textbooks restored into tabs
 * at startup, is tens of megabytes before anything is readable.
 */

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export type RangeRequest =
  | { readonly kind: "whole" }
  | { readonly kind: "range"; readonly range: ByteRange }
  /** A syntactically valid range that falls outside the document: a 416. */
  | { readonly kind: "unsatisfiable" };

/**
 * Parse one `Range` header against a known size.
 *
 * A malformed header is ignored (RFC 9110 says to serve the whole document),
 * and a multi-range request is answered with the whole document rather than a
 * `multipart/byteranges` body — correct, and all PDF.js ever asks for is one
 * range at a time.
 */
export function parseRangeHeader(
  header: string | null,
  size: number,
): RangeRequest {
  if (!header) return { kind: "whole" };
  const match = /^bytes=(.*)$/u.exec(header.trim());
  if (!match) return { kind: "whole" };
  const specs = match[1]!.split(",").map((value) => value.trim());
  if (specs.length !== 1) return { kind: "whole" };
  const spec = specs[0]!;
  const parts = /^(\d*)-(\d*)$/u.exec(spec);
  if (!parts) return { kind: "whole" };
  const [, rawStart, rawEnd] = parts;

  if (rawStart === "" && rawEnd === "") return { kind: "whole" };

  // A suffix range: the last N bytes.
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix)) return { kind: "whole" };
    if (suffix === 0) return { kind: "unsatisfiable" };
    if (size === 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - suffix);
    return { kind: "range", range: { start, end: size - 1 } };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return { kind: "whole" };
  if (size === 0 || start >= size) return { kind: "unsatisfiable" };
  if (rawEnd === "") return { kind: "range", range: { start, end: size - 1 } };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return { kind: "whole" };
  return { kind: "range", range: { start, end: Math.min(end, size - 1) } };
}

/** A validator that changes whenever the bytes do, without hashing them. */
export function documentValidator(input: {
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly revision?: string;
}): string {
  const revision = input.revision ? `-${input.revision}` : "";
  return `"${input.size.toString(16)}-${Math.trunc(input.modifiedAtMs).toString(16)}${revision}"`;
}

/** Whether the client already holds this exact version (`If-None-Match`). */
export function matchesValidator(header: string | null, validator: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === validator || value === `W/${validator}`);
}

/**
 * `If-Range`: a client resuming a range only wants it when its copy is still
 * current. A mismatch means the document changed and it must take the whole
 * thing again.
 */
export function rangeIsStillValid(
  ifRange: string | null,
  validator: string,
): boolean {
  if (!ifRange) return true;
  return ifRange.trim() === validator;
}
