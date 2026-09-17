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
  if (/not enough space on the disk|no space left on device|insufficient disk space|os error 112/i.test(raw))
    return { code: "insufficient_disk_space", message: "ACE-Step setup ran out of disk space or could not start. Free space before retrying; a fresh installation needs about 30 GiB for models, dependencies and cache." };
  const connectionErrors: Record<string, string> = {
    provider_http_401: "ACE-Step rejected the API key. Update it in Music Producer settings and test the connection again.",
    provider_http_403: "This API key cannot access ACE-Step. Check the server permissions or use a different key.",
    provider_http_404: "The server does not expose the ACE-Step API. Check the endpoint URL in Music Producer settings.",
    "fetch failed": "Could not reach ACE-Step. Check that the server is running and the endpoint URL is correct.",
  };
  if (connectionErrors[raw]) return { code: raw === "fetch failed" ? "provider_unreachable" : raw, message: connectionErrors[raw] };
  if (raw === "provider_out_of_memory")
    return { code: raw, message: "ACE-Step reported GPU out of memory. Reduce the requested duration or free GPU capacity, then explicitly retry." };
  if (/[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var)\/|Bearer |api.?key\s*[:=]/i.test(raw))
    return { code: "music_failed", message: "Music processing failed. Check the Runtime logs for details." };
  return { code: /^[a-zA-Z0-9_]+$/.test(raw) ? raw : "music_failed", message: raw.slice(0, 1500) };
}
