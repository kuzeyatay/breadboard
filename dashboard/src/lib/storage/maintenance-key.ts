import crypto from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";

/**
 * Idle maintenance used to need a signed-in session, but every launch signs the
 * dashboard out, so on a locked app every idle tick was refused and nothing was
 * ever cleaned (66 idle minutes, zero passes, on a real install).
 *
 * The desktop lifecycle owner writes a fresh random key into the data folder's
 * config directory at each launch and presents it on its idle ticks. Reading
 * that file needs the same account access as reading the database itself, so
 * no new party is trusted. The key grants exactly one thing: an idle `tick` of
 * storage maintenance, which never removes content a person made.
 */
export const MAINTENANCE_KEY_HEADER = "x-breadboard-maintenance-key";
const KEY = /^[a-f0-9]{64}$/u;

export function maintenanceKeyPath(root: string = dashboardDataDir()): string {
  return path.join(root, "config", "storage-maintenance.key");
}

export function desktopMaintenanceAuthorized(request: Request, root: string = dashboardDataDir()): boolean {
  const presented = request.headers.get(MAINTENANCE_KEY_HEADER) ?? "";
  if (!KEY.test(presented)) return false;
  let expected: string;
  try {
    expected = fs.readFileSync(maintenanceKeyPath(root), "utf8").trim();
  } catch {
    return false;
  }
  if (!KEY.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(presented, "utf8"), Buffer.from(expected, "utf8"));
}
