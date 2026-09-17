import fs from "node:fs";
import path from "node:path";

/** Quartz's installed template cannot import from the development repository. */
export function stageQuartzHighlightAssets(repoRoot, quartzTarget) {
  const scripts = path.join(quartzTarget, "quartz", "components", "scripts");
  for (const name of ["text-highlight-client.ts", "text-highlight-types.ts"]) {
    fs.copyFileSync(path.join(repoRoot, "dashboard", "src", "lib", name), path.join(scripts, name));
  }
  const target = path.join(scripts, "highlighter.inline.ts");
  const source = fs.readFileSync(target, "utf8");
  const developmentImport = "../../../../dashboard/src/lib/text-highlight-client";
  if (!source.includes(developmentImport)) throw new Error("Quartz highlight persistence import was not staged");
  fs.writeFileSync(target, source.replace(developmentImport, "./text-highlight-client"));
}
