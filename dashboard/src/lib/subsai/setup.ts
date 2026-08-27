// The subtitle environment's public result contract. Provisioning is owned by
// the authenticated Runtime V2 managed-setup worker; this module intentionally
// contains no filesystem mutation or subprocess fallback.

export interface SetupResult {
  ok: boolean;
  message: string;
  detail?: string;
}
