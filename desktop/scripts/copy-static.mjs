// Copies non-TypeScript startup assets into dist/ after tsc.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(desktopRoot, "src", "startup");
const targetDir = path.join(desktopRoot, "dist", "startup");
fs.mkdirSync(targetDir, { recursive: true });
for (const file of ["index.html", "startup.css", "breadboard-icon.svg"]) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}
console.log("[copy-static] startup assets copied");
