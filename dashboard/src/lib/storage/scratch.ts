import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { randomUUID } from "node:crypto";
import { dashboardDataDir } from "../runtime-paths.ts";
import { managedPath, allocatedBytes } from "./filesystem.ts";
import { DAY_MS } from "./policy.ts";

const MARKER = ".breadboard-disposable.json";
const OWNERS = new Set(["presentation-render", "metafile-render"]);
interface Receipt { version: number; owner: string; nonce: string; pid: number; createdAt: number; released: boolean }

/** Only reconstructible rendering intermediates use this API. Editor drafts,
 * workspace outputs and recovery checkpoints do not belong in scratch storage. */
export function createDisposableScratch(owner: "presentation-render" | "metafile-render"): string {
  const root=path.join(dashboardDataDir(),"runtime-v2","temp","storage-scratch");
  fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,`${owner}-`));
  const receipt:Receipt={version:1,owner,nonce:randomUUID(),pid:process.pid,createdAt:Date.now(),released:false};
  fs.writeFileSync(path.join(directory,MARKER),JSON.stringify(receipt),{flag:"wx",mode:0o600});
  return directory;
}

export function releaseDisposableScratch(directory: string): void {
  const marker=path.join(directory,MARKER);
  const receipt=JSON.parse(fs.readFileSync(marker,"utf8")) as Receipt;
  if(receipt.version!==1 || !OWNERS.has(receipt.owner) || receipt.pid!==process.pid) throw new Error("Scratch ownership changed");
  receipt.released=true;
  fs.writeFileSync(marker,JSON.stringify(receipt));
}

function alive(pid: number): boolean {
  try { process.kill(pid,0); return true; }
  catch(error) { return (error as NodeJS.ErrnoException).code!=="ESRCH"; }
}

export async function cleanScratch(root: string, shouldYield: () => boolean, now=Date.now()) {
  const relativeRoot=path.join("runtime-v2","temp","storage-scratch");
  let directory:string;
  try {directory=await managedPath(root,relativeRoot);} catch {return {filesRemoved:0,bytesReleased:0};}
  let filesRemoved=0,bytesReleased=0;
  const entries=await fs.promises.opendir(directory);
  try {
    for await(const entry of entries) {
      if(shouldYield()) break;
      if(!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const relative=path.join(relativeRoot,entry.name);
      try {
        const marker=await managedPath(root,path.join(relative,MARKER));
        const receipt=JSON.parse(await fs.promises.readFile(marker,"utf8")) as Receipt;
        if(receipt.version!==1 || !OWNERS.has(receipt.owner) || !Number.isSafeInteger(receipt.pid) || receipt.pid<=0
          || !Number.isFinite(receipt.createdAt) || receipt.createdAt>now-7*DAY_MS || (!receipt.released && alive(receipt.pid))) continue;
        const stack=[relative];
        while(stack.length && !shouldYield()) {
          const next=stack.pop()!;
          const target=await managedPath(root,next), stat=await fs.promises.lstat(target,{bigint:true});
          if(stat.isDirectory()) {
            const children=await fs.promises.readdir(target,{withFileTypes:true});
            const remaining=children.filter(child=>child.name!==MARKER);
            if(!remaining.length) {
              // The marker is last, so an interrupted sweep remains recognizable.
              if(next===relative) await fs.promises.unlink(marker);
              await fs.promises.rmdir(target);
            } else {
              stack.push(next);
              for(const child of remaining) {
                if(child.isSymbolicLink()) throw new Error("Redirected scratch entry");
                stack.push(path.join(next,child.name));
              }
            }
          } else if(stat.isFile()) {
            await fs.promises.unlink(target);filesRemoved++;
            if(stat.nlink===BigInt(1)) bytesReleased+=allocatedBytes(stat);
          }
        }
      } catch { /* Inaccessible, active or unrecognized contents remain intact. */ }
    }
  } finally { await entries.close().catch(()=>{}); }
  return {filesRemoved,bytesReleased};
}
