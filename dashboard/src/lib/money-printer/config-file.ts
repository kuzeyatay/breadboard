// Configuring the clone without taking its configuration file away from it.
//
// MoneyPrinterTurbo has no environment overrides worth the name: `config.toml`
// in the checkout is the only way to tell it which model to write with and which
// footage libraries to search, and `root_dir` is derived from the module's own
// path, so the file cannot be pointed somewhere Breadboard owns.
//
// Rewriting the file wholesale would therefore throw away a user's own settings
// — their WebUI provider, their voice, their subtitle style, their comments —
// every time a run started. Instead this module edits the handful of lines
// Breadboard is responsible for and leaves the rest of the file exactly as it
// was, including the comments the project ships it with.
//
// Two decisions are worth stating.
//
// The model is configured through the `oneapi` provider slot rather than
// `openai`. Both speak the same OpenAI-compatible protocol, and `oneapi` is the
// clone's own name for "a gateway that isn't a vendor" — which is exactly what
// ChatMock is. Using it means a user who has their real OpenAI key in
// `openai_api_key` still has it after Breadboard has run.
//
// Footage keys are only written when Breadboard actually holds one. A library
// the user configured in their own config.toml keeps working and is reported as
// available, so entering a key in two places is never required.

import fs from "node:fs";
import path from "node:path";
import { credentialSettings, type FootageCredentialKey } from "./credentials.ts";
import { resolveFfmpeg } from "./runtime.ts";

/** Where the clone reads everything from. Not overridable — see the note above. */
export function configFile(root: string): string {
  return path.join(root, "config.toml");
}

function exampleFile(root: string): string {
  return path.join(root, "config.example.toml");
}

/** Control characters, which a key, a URL or a path never legitimately holds. */
const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/**
 * Escape a string for a TOML basic string. The values here are API keys, URLs
 * and model names rather than prose, but a backslash in a Windows-shaped ffmpeg
 * path would silently become an escape sequence without this, and a stray
 * newline would close the string and take the rest of the file with it.
 */
function tomlString(value: string): string {
  const escaped = value
    .replace(CONTROL_CHARACTERS, "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  return `"${escaped}"`;
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

const SECTION_HEADER = /^\s*\[([^\]]+)\]\s*$/;

function keyAssignment(line: string): string | null {
  const match = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
  return match ? match[1] : null;
}

/**
 * True when a value continues onto the following lines — an array written
 * across several lines, which the project's own comments encourage for key
 * rotation. Replacing only the first line of one of those would leave the tail
 * behind as a syntax error.
 */
function opensMultilineArray(line: string): boolean {
  const value = line.slice(line.indexOf("=") + 1);
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === "\\") index += 1;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "[") depth += 1;
    else if (character === "]") depth -= 1;
    else if (character === "#") break;
  }
  return depth > 0;
}

function closesMultilineArray(line: string): boolean {
  return line.includes("]");
}

/**
 * Replace the given keys inside the `[app]` table, adding any that are not
 * there yet. Every other line of the file — other tables, comments, blank
 * lines, the user's own settings — is returned unchanged.
 *
 * Exported because this is the seam between two projects: the clone's
 * configuration format is not Breadboard's to assume, so a change on either
 * side has to fail a test here rather than silently produce a config file that
 * parses but configures nothing.
 */
export function patchAppTable(source: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  if (pending.size === 0) return source;

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const output: string[] = [];

  let section = "";
  let appSectionEnd = -1;
  let skippingArrayTail = false;

  for (const line of lines) {
    if (skippingArrayTail) {
      // The head of this assignment has already been replaced; drop the rest of
      // the old array rather than leaving its closing bracket orphaned.
      if (closesMultilineArray(line)) skippingArrayTail = false;
      continue;
    }

    const header = SECTION_HEADER.exec(line);
    if (header) {
      if (section === "app") appSectionEnd = output.length;
      section = header[1].trim();
      output.push(line);
      continue;
    }

    const key = section === "app" ? keyAssignment(line) : null;
    if (key && pending.has(key)) {
      output.push(`${key} = ${pending.get(key)}`);
      pending.delete(key);
      if (opensMultilineArray(line)) skippingArrayTail = true;
      continue;
    }
    output.push(line);
  }
  if (section === "app") appSectionEnd = output.length;

  if (pending.size === 0) return output.join(eol);

  const additions = [...pending].map(([key, value]) => `${key} = ${value}`);
  if (appSectionEnd < 0) {
    // No `[app]` table at all: a config file this different is not one to guess
    // about, so the table is appended rather than woven into what is there.
    return [...output, "", "[app]", ...additions].join(eol);
  }
  // Trailing blank lines belong after the additions, not before them, or every
  // run would push the next table one line further down the file.
  let insertAt = appSectionEnd;
  while (insertAt > 0 && output[insertAt - 1].trim() === "") insertAt -= 1;
  output.splice(insertAt, 0, ...additions);
  return output.join(eol);
}

/**
 * The footage libraries the user configured in the clone themselves.
 *
 * Read so that someone who already had a Pexels key in their own config.toml is
 * never asked for it a second time, and so a run does not fall back to local
 * footage while a perfectly good key sits in the file.
 */
export function configuredFootageSources(root: string): FootageCredentialKey[] {
  let source: string;
  try {
    source = fs.readFileSync(configFile(root), "utf8");
  } catch {
    return [];
  }
  const found: FootageCredentialKey[] = [];
  for (const [key, setting] of [
    ["pexels", "pexels_api_keys"],
    ["pixabay", "pixabay_api_keys"],
    ["coverr", "coverr_api_keys"],
  ] as const) {
    // A configured library is one whose list holds at least one non-empty
    // string; the file ships with every list present and empty.
    const match = new RegExp(String.raw`^[ \t]*${setting}\s*=([^\]]*)\]`, "m").exec(source);
    if (match && /"[^"]+"|'[^']+'/.test(match[1])) found.push(key);
  }
  return found;
}

export interface ConfigureInput {
  root: string;
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  baseUrl: string;
  apiKey: string;
  /** The model the clone writes scripts and search terms with. */
  model: string;
}

/**
 * The settings Breadboard owns, as the TOML they become. Split out from writing
 * so the service can fingerprint them and restart only when they really change —
 * the clone loads this file once, at import, and no later.
 */
export function ownedSettings(input: ConfigureInput): Record<string, string> {
  const ffmpeg = resolveFfmpeg();
  return {
    llm_provider: tomlString("oneapi"),
    oneapi_base_url: tomlString(input.baseUrl),
    oneapi_api_key: tomlString(input.apiKey),
    oneapi_model_name: tomlString(input.model),
    ...(ffmpeg ? { ffmpeg_path: tomlString(ffmpeg) } : {}),
    ...Object.fromEntries(
      Object.entries(credentialSettings()).map(([setting, values]) => [
        setting,
        tomlStringArray(values),
      ]),
    ),
  };
}

/**
 * Write the clone's config.toml with Breadboard's settings merged in, creating
 * it from the project's own example first when the user has never run it.
 *
 * Returns the settings that were written, for the service's fingerprint.
 */
export function writeMoneyPrinterConfig(input: ConfigureInput): Record<string, string> {
  const target = configFile(input.root);
  let existing = "";
  try {
    existing = fs.readFileSync(target, "utf8");
  } catch {
    // The clone copies the example on first import too; doing it here means the
    // file exists to be patched before the service ever starts.
    try {
      existing = fs.readFileSync(exampleFile(input.root), "utf8");
    } catch {
      existing = "";
    }
  }

  const settings = ownedSettings(input);
  const patched = patchAppTable(existing, settings);
  // Written through a sibling temporary file so a crash mid-write cannot leave
  // the user with a config.toml that parses halfway.
  const temporary = `${target}.breadboard.tmp`;
  fs.writeFileSync(temporary, patched.endsWith("\n") ? patched : `${patched}\n`, "utf8");
  fs.renameSync(temporary, target);
  return settings;
}
