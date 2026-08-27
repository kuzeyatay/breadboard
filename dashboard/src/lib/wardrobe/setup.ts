// Wardrobe setup is split deliberately: read-only status and identity-photo
// handling stay in product code, while dependency installation is an
// authenticated Runtime V2 managed-setup job.

export { setupStatus, type SetupResult, type SetupStatus } from "./status.ts";
export { saveIdentityPhoto, removeIdentityPhoto } from "./identity-photo.ts";
