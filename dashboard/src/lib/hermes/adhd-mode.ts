// Compatibility for older extensions and active development clients. New
// Breadboard code uses the Direct-mode names.
export {
  DIRECT_MODE_SKILL_SLUG as ADHD_SKILL_SLUG,
  directModeSection as adhdModeSection,
  resetDirectModeCache as resetAdhdModeCache,
} from "./direct-mode.ts";
