import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const sourceRoot = path.join(repositoryRoot, "Vvvebjs");
const bridgeRoot = path.join(dashboardRoot, "src", "vendor", "vvveb");
const outputRoot = path.join(dashboardRoot, "public", "vvveb-editor");

const requiredSource = path.join(sourceRoot, "editor.html");
try {
  await fs.access(requiredSource);
} catch {
  throw new Error(`Vvvebjs is unavailable at ${sourceRoot}. Clone givanz/Vvvebjs there before syncing.`);
}

function replaceOnce(value, search, replacement, label) {
  const index = value.indexOf(search);
  if (index < 0) throw new Error(`Vvvebjs editor layout changed: ${label} was not found.`);
  return value.slice(0, index) + replacement + value.slice(index + search.length);
}

let editor = (await fs.readFile(requiredSource, "utf8")).replaceAll("\r\n", "\n");
editor = replaceOnce(editor, "<title>VvvebJs</title>", "<title>Breadboard visual HTML editor</title>", "title");
editor = replaceOnce(
  editor,
  '<link href="css/editor.css" rel="stylesheet">',
  '<link href="css/editor.css" rel="stylesheet">\n  <link href="breadboard-editor.css" rel="stylesheet">',
  "editor stylesheet",
);
editor = replaceOnce(
  editor,
  '<iframe src="" id="iframe1">',
  '<iframe src="" id="iframe1" sandbox="allow-same-origin" allow="" referrerpolicy="no-referrer">',
  "document iframe",
);
editor = editor
  .replace('  <script src="demo/landing/sections/sections.js"></script>\n', "")
  .replace('  <script src="demo/landing/styles/styles.js"></script>\n', "")
  .replace('  <script src="libs/builder/plugin-ai-assistant.js"></script>\n', "")
  .replace(
    /  <!-- media gallery -->[\s\S]*?  <script src="libs\/builder\/plugin-media\.js"><\/script>\n/,
    "",
  );
editor = replaceOnce(
  editor,
  '  <script>\n\tlet renameUrl',
  '  <script src="breadboard-bridge.js"></script>\n  <script>\n\tlet renameUrl',
  "editor initialization script",
);

const initStart = editor.indexOf("\tlet defaultPages = {");
const scriptEnd = editor.indexOf("</script>", initStart);
const initEndMarker = "\tVvveb.Breadcrumb.init();\n";
const initEndStart = editor.lastIndexOf(initEndMarker, scriptEnd);
if (initStart < 0 || scriptEnd < 0 || initEndStart < initStart) {
  throw new Error("Vvvebjs editor initialization block could not be isolated.");
}
const initEnd = initEndStart + initEndMarker.length;
editor = `${editor.slice(0, initStart)}\tBreadboardVvveb.init();\n${editor.slice(initEnd)}`;

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });
for (const directory of ["css", "fonts", "img", "js", "libs"]) {
  await fs.cp(path.join(sourceRoot, directory), path.join(outputRoot, directory), {
    recursive: true,
    force: true,
  });
}
await fs.mkdir(path.join(outputRoot, "resources"), { recursive: true });
await fs.copyFile(
  path.join(sourceRoot, "resources", "google-fonts.json"),
  path.join(outputRoot, "resources", "google-fonts.json"),
);
await Promise.all([
  fs.writeFile(path.join(outputRoot, "index.html"), editor, "utf8"),
  fs.writeFile(
    path.join(outputRoot, "blank.html"),
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Page</title></head><body></body></html>\n",
    "utf8",
  ),
  fs.copyFile(path.join(sourceRoot, "LICENSE"), path.join(outputRoot, "LICENSE")),
  fs.copyFile(path.join(sourceRoot, "favicon.ico"), path.join(outputRoot, "favicon.ico")),
  fs.copyFile(path.join(bridgeRoot, "breadboard-bridge.js"), path.join(outputRoot, "breadboard-bridge.js")),
  fs.copyFile(path.join(bridgeRoot, "breadboard-editor.css"), path.join(outputRoot, "breadboard-editor.css")),
]);

console.log(`[vvveb] Visual editor synced to ${outputRoot}`);
