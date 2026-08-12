// Structural and safety validation for a gadget package.
//
// Two jobs, and the second is the one that matters. The first is ordinary shape
// checking so a malformed package cannot be published. The second is enforcing
// that the sandbox stays a sandbox: a gadget's code must not reach the network
// itself, must not try to escape its frame, and must reach Breadboard only
// through the host bridge — because the bridge is where every read is authorized
// and every write is queued. Code that fetches on its own has simply routed
// around the approval model.

import {
  GADGET_BINDING_KINDS,
  GADGET_MAX_BINDINGS,
  GADGET_MAX_FILE_BYTES,
  GADGET_MAX_TOTAL_BYTES,
  GADGET_SCHEMA_VERSION,
  type GadgetBinding,
  type GadgetPackage,
  type GadgetValidation,
} from "./gadget-types.ts";

export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  error: string;
  issues: string[];
}

const BINDING_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const GADGET_FILES = ["index.html", "styles.css", "main.js"] as const;

/**
 * Patterns that would let generated code leave the sandbox or reach the network
 * without passing the bridge. `sandbox="allow-scripts"` already denies same-origin
 * access, so `parent.document` fails at runtime — these are rejected at publish
 * time instead so the failure is a clear message rather than a blank frame.
 */
const ESCAPE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bfetch\s*\(/,
    reason: "calls fetch() directly; network access must go through the host bridge",
  },
  {
    pattern: /\bXMLHttpRequest\b/,
    reason: "uses XMLHttpRequest; network access must go through the host bridge",
  },
  {
    pattern: /\bWebSocket\b/,
    reason: "opens a WebSocket; the sandbox has no direct network access",
  },
  {
    pattern: /\bimportScripts\s*\(/,
    reason: "loads external scripts at runtime",
  },
  {
    pattern: /\b(?:eval|Function)\s*\(\s*(?!\s*\))/,
    reason: "evaluates code built at runtime, which cannot be reviewed",
  },
  {
    pattern: /\bwindow\s*\.\s*(?:top|parent|opener)\b/,
    reason: "reaches for the embedding page",
  },
  {
    pattern: /\bdocument\s*\.\s*cookie\b/,
    reason: "touches cookies",
  },
  {
    pattern: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/,
    reason: "uses browser storage; a gadget persists through its `storage` binding",
  },
  {
    pattern: /<\s*(?:iframe|object|embed|form)\b/i,
    reason: "embeds a nested document or form",
  },
  {
    pattern: /\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i,
    reason: "references an external origin",
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateBindings(raw: unknown, issues: string[]): GadgetBinding[] {
  if (!Array.isArray(raw)) {
    issues.push("manifest.bindings must be an array.");
    return [];
  }
  if (raw.length > GADGET_MAX_BINDINGS) {
    issues.push(`A gadget may declare at most ${GADGET_MAX_BINDINGS} bindings.`);
    return [];
  }
  const seen = new Set<string>();
  const bindings: GadgetBinding[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) {
      issues.push(`bindings[${index}] must be an object.`);
      continue;
    }
    const { name, kind, purpose, writable } = entry;
    if (!isNonEmptyString(name) || !BINDING_NAME.test(name)) {
      issues.push(
        `bindings[${index}].name must be lowercase letters, digits and underscores.`,
      );
      continue;
    }
    if (seen.has(name)) {
      issues.push(`bindings[${index}].name "${name}" is declared twice.`);
      continue;
    }
    if (!GADGET_BINDING_KINDS.includes(kind as never)) {
      issues.push(
        `bindings[${index}].kind "${String(kind)}" is not one of: ${GADGET_BINDING_KINDS.join(", ")}.`,
      );
      continue;
    }
    if (!isNonEmptyString(purpose)) {
      issues.push(`bindings[${index}].purpose is required — the user reads it before granting.`);
      continue;
    }
    if (typeof writable !== "boolean") {
      issues.push(`bindings[${index}].writable must be stated explicitly.`);
      continue;
    }
    seen.add(name);
    bindings.push({ name, kind: kind as GadgetBinding["kind"], purpose, writable });
  }
  return bindings;
}

/**
 * Validate a stored gadget package. Used by the artifact renderer before
 * publication and by anything that reads a gadget back off disk.
 */
export function parseStoredGadget(raw: unknown): ParseResult<GadgetPackage> {
  const issues: string[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, error: "A gadget package must be a JSON object.", issues };
  }
  if (raw.schemaVersion !== GADGET_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${GADGET_SCHEMA_VERSION}.`);
  }
  const manifest = raw.manifest;
  if (!isPlainObject(manifest)) {
    return {
      ok: false,
      error: "A gadget package must contain a manifest.",
      issues,
    };
  }
  if (manifest.artifactType !== "gadget") {
    issues.push('manifest.artifactType must be "gadget".');
  }
  for (const field of ["title", "description", "purpose"] as const) {
    if (!isNonEmptyString(manifest[field])) {
      issues.push(`manifest.${field} is required.`);
    }
  }
  if (manifest.entry !== "index.html") {
    issues.push('manifest.entry must be "index.html".');
  }
  const bindings = validateBindings(manifest.bindings, issues);

  const files = raw.files;
  if (!isPlainObject(files)) {
    return { ok: false, error: "A gadget package must contain its files.", issues };
  }
  let totalBytes = 0;
  for (const file of GADGET_FILES) {
    const content = files[file];
    if (typeof content !== "string") {
      issues.push(`files["${file}"] is required.`);
      continue;
    }
    const bytes = Buffer.byteLength(content, "utf8");
    totalBytes += bytes;
    if (bytes > GADGET_MAX_FILE_BYTES) {
      issues.push(`files["${file}"] exceeds ${GADGET_MAX_FILE_BYTES} bytes.`);
    }
  }
  if (totalBytes > GADGET_MAX_TOTAL_BYTES) {
    issues.push(`The gadget's files total more than ${GADGET_MAX_TOTAL_BYTES} bytes.`);
  }
  const extraFiles = Object.keys(files).filter(
    (name) => !GADGET_FILES.includes(name as (typeof GADGET_FILES)[number]),
  );
  if (extraFiles.length) {
    issues.push(`Unexpected files: ${extraFiles.join(", ")}.`);
  }

  for (const field of ["assumptions", "limitations"] as const) {
    if (!Array.isArray(raw[field]) || (raw[field] as unknown[]).some((v) => !isNonEmptyString(v))) {
      issues.push(`${field} must be an array of non-empty strings.`);
    }
  }

  if (issues.length) {
    return { ok: false, error: "The gadget package is not valid.", issues };
  }
  return {
    ok: true,
    error: "",
    issues,
    value: {
      schemaVersion: GADGET_SCHEMA_VERSION,
      manifest: {
        schemaVersion: GADGET_SCHEMA_VERSION,
        artifactType: "gadget",
        title: manifest.title as string,
        description: manifest.description as string,
        purpose: manifest.purpose as string,
        bindings,
        entry: "index.html",
        runtime: {
          id: "breadboard-gadget",
          version: isPlainObject(manifest.runtime) && isNonEmptyString(manifest.runtime.version)
            ? manifest.runtime.version
            : "1.0.0",
        },
      },
      files: {
        "index.html": files["index.html"] as string,
        "styles.css": files["styles.css"] as string,
        "main.js": files["main.js"] as string,
      },
      assumptions: raw.assumptions as string[],
      limitations: raw.limitations as string[],
    },
  };
}

/**
 * The publication gate: structure plus the sandbox-containment rules. Called
 * before a package is ever written, so a gadget that would have to break
 * containment to work never becomes an artifact in the first place.
 */
export function validateGadgetPackage(raw: unknown): {
  validation: GadgetValidation;
  value?: GadgetPackage;
} {
  const checkedAt = new Date().toISOString();
  const parsed = parseStoredGadget(raw);
  if (!parsed.ok || !parsed.value) {
    return {
      validation: {
        valid: false,
        checkedAt,
        sourceBytes: 0,
        errors: parsed.issues.length ? parsed.issues : [parsed.error],
        warnings: [],
      },
    };
  }
  const gadget = parsed.value;
  const errors: string[] = [];
  const warnings: string[] = [];
  let sourceBytes = 0;

  for (const file of GADGET_FILES) {
    const content = gadget.files[file];
    sourceBytes += Buffer.byteLength(content, "utf8");
    for (const { pattern, reason } of ESCAPE_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`${file} ${reason}.`);
      }
    }
  }

  // A binding the code never calls is a permission the user was asked for and
  // did not need. A call to a binding that was never declared is worse: the
  // bridge would reject it at runtime, so the gadget is broken as written.
  const declared = new Set(gadget.manifest.bindings.map((binding) => binding.name));
  const script = gadget.files["main.js"];
  for (const name of declared) {
    if (!new RegExp(`\\bhost\\s*\\.\\s*${name}\\b`).test(script)) {
      warnings.push(`Binding "${name}" is declared but never used.`);
    }
  }
  for (const match of script.matchAll(/\bhost\s*\.\s*([a-z][a-z0-9_]*)\b/g)) {
    const name = match[1];
    if (name === "ready" || name === "log") continue;
    if (!declared.has(name)) {
      errors.push(`main.js calls host.${name}, which the manifest does not declare.`);
    }
  }

  // Writing through a binding the manifest marked read-only would be denied by
  // the bridge. Catching it here turns a runtime rejection into a build error.
  for (const binding of gadget.manifest.bindings) {
    if (binding.writable) continue;
    if (new RegExp(`\\bhost\\s*\\.\\s*${binding.name}\\s*\\.\\s*act\\b`).test(script)) {
      errors.push(
        `main.js writes through "${binding.name}", which is declared read-only.`,
      );
    }
  }

  if (!/<\s*script\b[^>]*\bsrc\s*=\s*["']main\.js["']/i.test(gadget.files["index.html"])) {
    errors.push('index.html must load its script with <script src="main.js">.');
  }

  return {
    validation: {
      valid: errors.length === 0,
      checkedAt,
      sourceBytes,
      errors,
      warnings,
    },
    value: errors.length === 0 ? gadget : undefined,
  };
}
