import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

/** Live operator decisions are neither generated output nor build inputs. */
export const LIVE_GARDEN_POLICY_PATHS = [".breadboard/accepted-critic-residues.json"] as const;

export function isLiveGardenPolicyPath(relativePath: string): boolean {
  return LIVE_GARDEN_POLICY_PATHS.some((entry) => entry === relativePath.replace(/\\/g, "/").toLowerCase());
}

/** Called at the final synchronous commit boundary, including rollback. An
 * absent live policy means absent: old retained builds must not resurrect it. */
export function preserveLiveGardenPolicy(liveGarden: string, incomingGarden: string): void {
  for (const relativePath of LIVE_GARDEN_POLICY_PATHS) {
    const source = path.join(liveGarden, relativePath);
    const target = path.join(incomingGarden, relativePath);
    if (!fs.existsSync(source)) {
      fs.rmSync(target, { force: true });
      continue;
    }
    if (!fs.lstatSync(source).isFile()) throw new Error(`Operator policy must be a regular file: ${relativePath}`);
    const bytes = fs.readFileSync(source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}
