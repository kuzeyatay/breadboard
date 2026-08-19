// Vendored from simstudioai/sim (Apache-2.0),
// apps/sim/lib/core/security/input-validation.ts — adapted for Breadboard:
// only the pure validators the vendored tools import, with the ipaddr.js
// private-IP check replaced by the same cheap string checks the Breadboard
// integration executor uses (no DNS, no dependency).

import { createLogger } from "./logger";

const logger = createLogger("InputValidation");

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  sanitized?: string;
}

export interface PathSegmentOptions {
  paramName?: string;
  maxLength?: number;
  allowHyphens?: boolean;
  allowUnderscores?: boolean;
  allowDots?: boolean;
  customPattern?: RegExp;
}

/** Cheap textual test for loopback/private/link-local hosts. No DNS. */
export function isObviouslyInternalHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "::" || hostname === "0.0.0.0") return true;
  if (/^127\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(hostname)) return true; // IPv6 unique-local
  if (/^fe80:/i.test(hostname)) return true; // IPv6 link-local
  if (/^::ffff:(127\.|10\.|192\.168\.|169\.254\.)/i.test(hostname)) return true;
  return false;
}

/** Validates a path segment to prevent path traversal and SSRF attacks. */
export function validatePathSegment(
  value: string | null | undefined,
  options: PathSegmentOptions = {},
): ValidationResult {
  const {
    paramName = "path segment",
    maxLength = 255,
    allowHyphens = true,
    allowUnderscores = true,
    allowDots = false,
    customPattern,
  } = options;

  if (value === null || value === undefined || value === "") {
    return { isValid: false, error: `${paramName} is required` };
  }
  if (value.length > maxLength) {
    return {
      isValid: false,
      error: `${paramName} exceeds maximum length of ${maxLength} characters`,
    };
  }
  if (value.includes("\0") || value.includes("%00")) {
    return { isValid: false, error: `${paramName} contains invalid characters` };
  }

  const pathTraversalPatterns = [
    "..",
    "./",
    ".\\.",
    "%2e%2e",
    "%252e%252e",
    "..%2f",
    "..%5c",
    "%2e%2e%2f",
    "%2e%2e/",
    "..%252f",
  ];
  const lowerValue = value.toLowerCase();
  for (const pattern of pathTraversalPatterns) {
    if (lowerValue.includes(pattern.toLowerCase())) {
      logger.warn("Path traversal attempt detected", { paramName });
      return {
        isValid: false,
        error: `${paramName} contains invalid path traversal sequences`,
      };
    }
  }
  if (value.includes("/") || value.includes("\\")) {
    return { isValid: false, error: `${paramName} cannot contain directory separators` };
  }
  if (customPattern) {
    if (!customPattern.test(value)) {
      return { isValid: false, error: `${paramName} format is invalid` };
    }
    return { isValid: true, sanitized: value };
  }

  let pattern = "^[a-zA-Z0-9";
  if (allowHyphens) pattern += "\\-";
  if (allowUnderscores) pattern += "_";
  if (allowDots) pattern += "\\.";
  pattern += "]+$";
  if (!new RegExp(pattern).test(value)) {
    return {
      isValid: false,
      error: `${paramName} can only contain alphanumeric characters${allowHyphens ? ", hyphens" : ""}${allowUnderscores ? ", underscores" : ""}${allowDots ? ", dots" : ""}`,
    };
  }
  return { isValid: true, sanitized: value };
}

/** Validates that a value belongs to an allowed enum list. */
export function validateEnum<T extends string>(
  value: string | null | undefined,
  allowedValues: readonly T[],
  paramName = "value",
): ValidationResult {
  if (value === null || value === undefined || value === "") {
    return { isValid: false, error: `${paramName} is required` };
  }
  if (!allowedValues.includes(value as T)) {
    return {
      isValid: false,
      error: `${paramName} must be one of: ${allowedValues.join(", ")}`,
    };
  }
  return { isValid: true, sanitized: value };
}

/** Validates an external URL to prevent SSRF (https only, no internal hosts). */
export function validateExternalUrl(
  url: string | null | undefined,
  paramName = "url",
  options: { allowHttp?: boolean } = {},
): ValidationResult {
  if (!url || typeof url !== "string") {
    return { isValid: false, error: `${paramName} is required and must be a string` };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { isValid: false, error: `${paramName} must be a valid URL` };
  }
  const protocol = parsedUrl.protocol;
  if (options.allowHttp) {
    if (protocol !== "https:" && protocol !== "http:") {
      return { isValid: false, error: `${paramName} must use http:// or https:// protocol` };
    }
  } else if (protocol !== "https:") {
    return { isValid: false, error: `${paramName} must use https:// protocol` };
  }
  if (isObviouslyInternalHostname(parsedUrl.hostname)) {
    return { isValid: false, error: `${paramName} cannot point to internal addresses` };
  }
  const blockedPorts = ["22", "23", "25", "3306", "5432", "6379", "27017", "9200"];
  if (parsedUrl.port && blockedPorts.includes(parsedUrl.port)) {
    return { isValid: false, error: `${paramName} uses a blocked port` };
  }
  return { isValid: true };
}

const OKTA_DOMAIN_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9-]*\.(okta|okta-gov|okta-emea|oktapreview|trexcloud)\.com$/;

/** Validates and sanitizes an Okta domain to prevent SSRF. Throws on failure. */
export function validateOktaDomain(rawDomain: string): string {
  const domain = rawDomain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!OKTA_DOMAIN_PATTERN.test(domain)) {
    throw new Error(
      `Invalid Okta domain: "${domain}". Must be a valid Okta domain (e.g., dev-123456.okta.com)`,
    );
  }
  return domain;
}

/** Validates a Monday.com numeric ID (board, item, webhook, workspace, user). */
export function validateMondayNumericId(
  value: string | number | null | undefined,
  paramName = "ID",
): ValidationResult {
  if (value === null || value === undefined || value === "") {
    return { isValid: false, error: `${paramName} is required` };
  }
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) {
    return { isValid: false, error: `${paramName} must be a numeric integer` };
  }
  return { isValid: true, sanitized: str };
}

/** Validates a Supabase project ID so it cannot break out of *.supabase.co. */
export function validateSupabaseProjectId(
  value: string | null | undefined,
  paramName = "projectId",
): ValidationResult {
  if (value === null || value === undefined || value === "") {
    return { isValid: false, error: `${paramName} is required` };
  }
  if (!/^[a-z0-9]+$/.test(value)) {
    return {
      isValid: false,
      error: `${paramName} must contain only lowercase alphanumeric characters`,
    };
  }
  if (value.length < 10 || value.length > 40) {
    return { isValid: false, error: `${paramName} must be between 10 and 40 characters` };
  }
  return { isValid: true, sanitized: value };
}

const WORKDAY_ALLOWED_HOST_SUFFIXES = [".workday.com", ".myworkday.com"] as const;

/** Validates a Workday tenant URL to prevent SSRF attacks. */
export function validateWorkdayTenantUrl(
  url: string | null | undefined,
  paramName = "tenantUrl",
): ValidationResult {
  const urlResult = validateExternalUrl(url, paramName);
  if (!urlResult.isValid) return urlResult;
  const hostname = new URL(url as string).hostname.toLowerCase();
  const isAllowedHost = WORKDAY_ALLOWED_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
  if (!isAllowedHost) {
    return {
      isValid: false,
      error: `${paramName} must be a Workday-hosted domain (e.g., *.workday.com or *.myworkday.com)`,
    };
  }
  return { isValid: true, sanitized: url as string };
}

/** Validates a database identifier (table/column name) against SQL injection. */
export function validateDatabaseIdentifier(
  value: unknown,
  paramName = "identifier",
): ValidationResult {
  if (typeof value !== "string" || value.length === 0) {
    return { isValid: false, error: `${paramName} is required` };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return {
      isValid: false,
      error: `Invalid ${paramName}: must start with a letter or underscore and contain only letters, digits, and underscores`,
    };
  }
  return { isValid: true, sanitized: value };
}
