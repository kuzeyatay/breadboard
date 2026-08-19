// Vendored from simstudioai/sim (Apache-2.0) — the `LinearRegex` interface of
// apps/sim/lib/core/security/linear-regex.ts; reimplemented for Breadboard.
//
// DEVIATION, stated plainly: sim compiles caller-supplied split patterns on
// RE2 (`re2js`) so that no pattern can backtrack — in sim the pattern arrives
// from a tenant, and `a*a*b` against 10k of `a` is a denial of service against
// every other tenant on the event loop. Breadboard does not ship `re2js`, and
// the chunkers are this module's only consumer: their patterns come from
// Breadboard's own code, never from an untrusted tenant. So the pattern
// compiles on the built-in engine instead, behind the same interface, and
// `RegexChunker` keeps sim's 500-character pattern cap. If a route ever lets a
// user type the pattern, vendor sim's RE2 module and add the `re2js`
// dependency rather than widening this shim.
//
// One behavioural consequence of the engine swap is a capability, not a gap:
// the built-in engine implements lookaround natively, so the lookaround-split
// reconstruction sim needs (`compileLookaroundSplit`) is here simply another
// compile — and negative lookaround, which RE2 cannot represent at all, works.

export interface LinearRegexOptions {
  ignoreCase?: boolean
}

export interface LinearRegex {
  /** Whether the pattern matches anywhere in `text`. */
  test(text: string): boolean
  /** Index of the first match in `text`, or -1. */
  find(text: string): number
  /**
   * Split `text` around every match.
   *
   * Follows `String.prototype.split` except that a trailing empty segment is
   * omitted — sim's RE2 drops it, and every caller here discards empties
   * anyway, so the two engines agree on what the caller sees.
   */
  split(text: string): string[]
}

/**
 * Compile `pattern` into the {@link LinearRegex} shape.
 *
 * Returns `null` when the pattern is not valid ECMAScript regex syntax, which
 * is the same contract callers already handle for sim's "RE2 cannot represent
 * this" answer.
 */
export function compileLinearRegex(
  pattern: string,
  options: LinearRegexOptions = {}
): LinearRegex | null {
  const caseFlag = options.ignoreCase ? 'i' : ''
  let scanner: RegExp
  try {
    // Non-global, so `test`/`exec` keep no `lastIndex` between calls and one
    // instance is reusable across a caller's scan.
    scanner = new RegExp(pattern, caseFlag)
  } catch {
    return null
  }
  return {
    test: (text) => scanner.test(text),
    find: (text) => {
      const match = scanner.exec(text)
      return match ? match.index : -1
    },
    split: (text) => {
      const segments = text.split(new RegExp(pattern, `g${caseFlag}`))
      if (segments.length > 1 && segments[segments.length - 1] === '') {
        segments.pop()
      }
      return segments
    },
  }
}

/**
 * Sim's recovery path for lookaround *split* idioms on an engine without
 * lookaround. The built-in engine has lookaround, so this is the same compile —
 * kept as its own export so `RegexChunker`'s fallback chain reads exactly as it
 * does in sim.
 */
export function compileLookaroundSplit(
  pattern: string,
  options: LinearRegexOptions = {}
): LinearRegex | null {
  return compileLinearRegex(pattern, options)
}
