// Breadboard stand-in for sim's hooks/selectors/types.ts (simstudioai/sim, Apache-2.0).
// `SelectorKey` there is a closed union naming every integration dropdown the editor
// can populate (`airtable.bases`, `clickup.lists`, …). Those fetchers are client-side
// UI and were not vendored, so block configs only need the key to stay a string.

export type SelectorKey = string;
