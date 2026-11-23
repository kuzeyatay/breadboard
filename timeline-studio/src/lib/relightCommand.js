import { normalizeCinematicDepth } from "./depthOfField.js";

export const RELIGHT_PROPERTY_SCHEMA = Object.freeze({
  ...Object.fromEntries(Object.entries({ x: [-1, 1], y: [-1, 1], strength: [0, 1], range: [0.1, 1], softness: [0, 1], distance: [1, 4] })
    .map(([key, [minimum, maximum]]) => [key, { type: "number", minimum, maximum }])),
  color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
});

export function validateRelightPatch(operation) {
  const fail = () => { throw Object.assign(new Error("Invalid relighting parameters"), { code: "INVALID_ARGUMENT" }); };
  if (operation.enabled !== undefined && typeof operation.enabled !== "boolean") fail();
  if (operation.quality !== undefined && !["fast", "balanced", "quality"].includes(operation.quality)) fail();
  if (operation.enabled === undefined && operation.light === undefined && operation.quality === undefined) fail();
  if (operation.light !== undefined) {
    if (!operation.light || typeof operation.light !== "object" || Array.isArray(operation.light) || !Object.keys(operation.light).length) fail();
    for (const [key, value] of Object.entries(operation.light)) {
      const rule = RELIGHT_PROPERTY_SCHEMA[key];
      if (!rule || (rule.type === "number" ? typeof value !== "number" || !Number.isFinite(value) || value < rule.minimum || value > rule.maximum
        : typeof value !== "string" || !new RegExp(rule.pattern).test(value))) fail();
    }
  }
}

export function applyRelightPatch(project, operation) {
  validateRelightPatch(operation);
  const main = (project.visualSegments || []).find((clip) => clip.id === operation.clipId);
  const overlay = (project.visualOverlaySegments || []).find((clip) => clip.id === operation.clipId);
  const clip = main || overlay;
  if (!clip) throw Object.assign(new Error("Visual clip not found"), { code: "CLIP_NOT_FOUND" });
  if (!["image", "video"].includes(clip.type)) throw Object.assign(new Error("Unsupported relighting source"), { code: "UNSUPPORTED_MEDIA_TYPE" });
  if (project.trackLocks?.[main ? "image" : "overlay"]) throw Object.assign(new Error("Track is locked"), { code: "BROWSER_EDIT_TRACK_LOCKED" });
  const effect = normalizeCinematicDepth(clip.cinematicDepth);
  clip.cinematicDepth = { ...effect, output: "relight", quality: operation.quality ?? effect.quality, enabled: operation.enabled ?? effect.enabled,
    relight: { ...effect.relight, ...operation.light } };
}
