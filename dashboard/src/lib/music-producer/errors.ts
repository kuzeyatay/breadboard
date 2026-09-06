import { SupervisorResourceExhaustedError, RuntimeJobControlError } from "../supervisor-control.ts";
import { ZodError } from "zod";
/** Never echo native paths, connection secrets, or arbitrary upstream exception bodies. */
export function musicError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof SupervisorResourceExhaustedError || (error instanceof RuntimeJobControlError && error.code === "BREADBOARD_RESOURCE_EXHAUSTED"))
    return { code: "BREADBOARD_RESOURCE_EXHAUSTED", message: "Runtime cannot admit this generation within current memory headroom. Free resources and explicitly retry." };
  if (error instanceof ZodError)
    return { code: "invalid_music_request", message: error.issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ').slice(0, 1200) };
  const raw = error instanceof Error ? error.message : "Music generation failed.";
  if (raw === "provider_out_of_memory")
    return { code: raw, message: "ACE-Step reported GPU out of memory. Reduce the requested duration or free GPU capacity, then explicitly retry." };
  if (/[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var)\/|Bearer |api.?key\s*[:=]/i.test(raw))
    return { code: "music_failed", message: "Music processing failed. Check the Runtime logs for details." };
  return { code: /^[a-zA-Z0-9_]+$/.test(raw) ? raw : "music_failed", message: raw.slice(0, 1500) };
}
