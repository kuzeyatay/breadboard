// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/guardrails/validate_regex.ts,
// adapted for Breadboard: `@sim/logger` → console, `compileLinearRegex` from the
// local shim (./linear-regex.ts — see its header for the RE2-vs-built-in deviation),
// `getErrorMessage` inlined.

/**
 * Validate if input matches regex pattern
 */
export interface ValidationResult {
  passed: boolean
  error?: string
}

/** Result of validating a regex pattern's syntax and safety (independent of any input). */
export interface RegexPatternValidation {
  valid: boolean
  error?: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import { compileLinearRegex } from "./linear-regex.ts"

/**
 * Validate a custom pattern's syntax before it is persisted. Syntax only,
 * deliberately — see sim's original docstring on why a catastrophic-backtracking
 * screen (`safe-regex2`-style) was removed: it has false negatives (passes
 * `(a|a)*b`) and false positives (rejects valid lookbehind/optional-group
 * patterns), so it blocks valid rules and stops nothing. `compileLinearRegex`
 * at match time is the real (if, on Breadboard's built-in-engine shim, only
 * partial — see ./linear-regex.ts) mitigation.
 */
export function validateRegexPattern(pattern: string): RegexPatternValidation {
  if (pattern.length === 0) {
    return { valid: false, error: "Pattern cannot be empty" }
  }
  try {
    new RegExp(pattern)
  } catch (error) {
    return { valid: false, error: `Invalid regex: ${getErrorMessage(error)}` }
  }
  return { valid: true }
}

/**
 * Match `inputStr` against a caller-defined guardrail `pattern`, compiled
 * through {@link compileLinearRegex} rather than the built-in engine directly.
 */
export function validateRegex(inputStr: string, pattern: string): ValidationResult {
  try {
    new RegExp(pattern)
  } catch (error) {
    return { passed: false, error: `Invalid regex pattern: ${getErrorMessage(error)}` }
  }

  const regex = compileLinearRegex(pattern)
  if (!regex) {
    console.warn("[ValidateRegex] Guardrail regex uses syntax that failed to compile; failing closed", {
      pattern,
    })
    return {
      passed: false,
      error: "Regex pattern could not be compiled. Rewrite it and try again.",
    }
  }

  if (regex.test(inputStr)) {
    return { passed: true }
  }
  return { passed: false, error: "Input does not match regex pattern" }
}
