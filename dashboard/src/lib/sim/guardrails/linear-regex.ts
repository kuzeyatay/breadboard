// Vendored from simstudioai/sim (Apache-2.0) — the `LinearRegex`/`compileLinearRegex`
// surface of apps/sim/lib/core/security/linear-regex.ts; reimplemented for Breadboard.
//
// DEVIATION, stated plainly: sim compiles caller-supplied patterns on RE2
// (`re2js`) so that no pattern can backtrack — in sim the pattern is set by one
// tenant and matched on a Node process shared with every other tenant, so
// `a*a*b` against 10k of `a` is a denial of service against everyone else on
// the event loop. Breadboard does not ship `re2js` (nobody on this vendoring
// wave may add a package.json dependency — see PLAN.md's "NOBODY edits
// db.ts/package.json"), and this codebase is single-tenant: a Breadboard user
// who types a catastrophic custom PII pattern into their own Settings panel
// only stalls their own outbound-send request, not another user's. So this
// shim keeps the exact interface `validate_regex.ts` and `local-pii.ts` expect,
// compiled on the built-in `RegExp` engine instead of RE2. It is NOT a ReDoS
// guarantee — a pathological pattern can still hang the event loop here. Callers
// that need a real bound (custom regex run against untrusted remote input, not
// just the owning user's own messages) should vendor sim's actual RE2 module
// and get `re2js` added to package.json rather than trust this shim further.
//
// This file is a second, independent copy of the same shim the chunkers agent
// wrote at src/lib/sim/chunkers/linear-regex.ts — both wave agents hit the same
// "no re2js" constraint on disjoint file territories, so duplication here beats
// a cross-territory import.

export interface LinearRegexOptions {
  ignoreCase?: boolean
}

export interface LinearRegex {
  /** Whether the pattern matches anywhere in `text`. */
  test(text: string): boolean
  /** Index of the first match in `text`, or -1. */
  find(text: string): number
  /** Split `text` around every match (trailing empty segment omitted). */
  split(text: string): string[]
}

/**
 * Compile `pattern` into the {@link LinearRegex} shape.
 *
 * Returns `null` only when `pattern` is not valid ECMAScript regex syntax —
 * unlike sim's RE2 version, this never rejects a pattern for using a construct
 * (lookaround, backreferences) the engine can't represent, since the built-in
 * engine represents all of them. Callers must still treat `null` as "cannot be
 * used" rather than falling back to something unchecked.
 */
export function compileLinearRegex(
  pattern: string,
  options: LinearRegexOptions = {}
): LinearRegex | null {
  let compiled: RegExp
  try {
    compiled = new RegExp(pattern, options.ignoreCase ? "gi" : "g")
  } catch {
    return null
  }
  return {
    test: (text) => {
      compiled.lastIndex = 0
      return compiled.test(text)
    },
    find: (text) => {
      compiled.lastIndex = 0
      const match = compiled.exec(text)
      return match ? match.index : -1
    },
    split: (text) => {
      const source = compiled.source
      const flags = compiled.flags
      const parts = text.split(new RegExp(source, flags))
      // Match RE2's convention: no trailing empty segment.
      if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop()
      return parts
    },
  }
}
