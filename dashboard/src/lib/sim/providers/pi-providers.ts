// Breadboard stand-in for sim's providers/pi-providers.ts (simstudioai/sim, Apache-2.0).
// Pi is sim's embedded coding-agent product; its executor handlers (executor/handlers/pi)
// were deliberately not vendored — they pull typebox, @earendil-works/* and ssh2. No model
// is Pi-supported here, so the Pi-only subblocks stay hidden.

export function isPiSupportedModel(_providerId: string, _model: string): boolean {
  return false;
}
