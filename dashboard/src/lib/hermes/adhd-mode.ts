// Compatibility for older extensions and active development clients. New
// Breadboard code uses the Concise product name; the exports remain stable.
export {
  DIRECT_MODE_SKILL_SLUG as ADHD_SKILL_SLUG,
  directModeSection as adhdModeSection,
  resetDirectModeCache as resetAdhdModeCache,
} from "./direct-mode.ts";
