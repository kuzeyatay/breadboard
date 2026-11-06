import fs from "node:fs";
import path from "node:path";

/** Quartz's installed template cannot import from the development repository. */
export function stageQuartzHighlightAssets(repoRoot, quartzTarget) {
  const scripts = path.join(quartzTarget, "quartz", "components", "scripts");
  for (const name of ["text-highlight-client.ts", "text-highlight-types.ts", "text-highlight-transport.ts", "quartz-chat-link.ts", "chat-text-selection.ts", "page-understanding-types.ts", "markdown-page-export.ts", "pdf-download-client.ts"]) {
    fs.copyFileSync(path.join(repoRoot, "dashboard", "src", "lib", name), path.join(scripts, name));
  }
  const target = path.join(scripts, "highlighter.inline.ts");
  const source = fs.readFileSync(target, "utf8");
  const developmentImport = "../../../../dashboard/src/lib/text-highlight-client";
  if (!source.includes(developmentImport)) throw new Error("Quartz highlight persistence import was not staged");
  fs.writeFileSync(target, source.replace(developmentImport, "./text-highlight-client")
    .replace("../../../../dashboard/src/lib/quartz-chat-link", "./quartz-chat-link")
    .replace("../../../../dashboard/src/lib/chat-text-selection", "./chat-text-selection"));
  for (const name of ["pageUnderstanding.inline.ts", "explorer.inline.ts"]) {
    const file = path.join(scripts, name);
    const contents = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, contents.replace("../../../../dashboard/src/lib/page-understanding-types", "./page-understanding-types"));
  }
  const pageExports = path.join(scripts, "pageExports.inline.ts");
  fs.writeFileSync(pageExports, fs.readFileSync(pageExports, "utf8")
    .replace("../../../../dashboard/src/lib/markdown-page-export", "./markdown-page-export"));
}
