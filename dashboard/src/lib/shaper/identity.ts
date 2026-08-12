// Formsmith is Breadboard's image-to-3D surface for Meta's ShapeR runtime.
// It takes a typed request rather than prose: one image is the complete input.

export const FORMSMITH_COMMAND = "/agents:formsmith";
export const FORMSMITH_AGENT_ID = "formsmith";
export const FORMSMITH_AGENT_NAME = "Formsmith";

export const FORMSMITH_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
export const FORMSMITH_IMAGE_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  ...FORMSMITH_IMAGE_EXTENSIONS,
].join(",");
export const MAX_FORMSMITH_IMAGE_BYTES = 20 * 1024 * 1024;

export interface FormsmithRequest {
  uploadId: string;
  filename: string;
  sizeBytes: number;
}

export type FormsmithRequestResult =
  | { ok: true; request: FormsmithRequest }
  | { ok: false; error: string };

const UPLOAD_ID = /^[a-f0-9]{32}$/;

export function validateFormsmithRequest(value: unknown): FormsmithRequestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Choose a picture to reconstruct." };
  }
  const candidate = value as Record<string, unknown>;
  const uploadId = typeof candidate.uploadId === "string" ? candidate.uploadId.trim() : "";
  const filename = typeof candidate.filename === "string" ? candidate.filename.trim() : "";
  const sizeBytes = Math.round(Number(candidate.sizeBytes));
  if (!UPLOAD_ID.test(uploadId)) {
    return { ok: false, error: "That picture upload is not valid." };
  }
  if (!filename || filename.length > 200) {
    return { ok: false, error: "That picture name is not valid." };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FORMSMITH_IMAGE_BYTES) {
    return { ok: false, error: "That picture size is not valid." };
  }
  return { ok: true, request: { uploadId, filename, sizeBytes } };
}

/** A pasted bare command selects the form; trailing prose is deliberately rejected. */
export function isFormsmithCommand(value: string): boolean {
  return /^\/agents:formsmith\s*$/i.test(value.trim());
}

export function formsmithUserMessage(request: FormsmithRequest): string {
  return `${FORMSMITH_COMMAND} ${request.filename}`;
}

export function formsmithRunLabel(request: FormsmithRequest): string {
  return `Reconstruct ${request.filename}`;
}
