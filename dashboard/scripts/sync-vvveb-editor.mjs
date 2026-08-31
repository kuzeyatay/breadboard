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
const logoPattern = /\n\s*<div class="logo">[\s\S]*?<\/div>\n/g;
const logoBlocks = editor.match(logoPattern) || [];
if (logoBlocks.length !== 2) {
  throw new Error(`Vvvebjs editor layout changed: expected 2 sidebar logo blocks, found ${logoBlocks.length}.`);
}
editor = editor.replace(logoPattern, "\n");
editor = editor.replace('\n\t\t<input name="file" type="file" class="form-control"/>', "");
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

// Upstream's ImageInput setter references a non-existent global `element`.
// Selecting any ordinary element can render that property and raise before the
// rest of the point-and-click controls load, so keep the vendored copy local.
const inputsPath = path.join(outputRoot, "libs", "builder", "inputs.js");
let inputs = (await fs.readFile(inputsPath, "utf8")).replaceAll("\r\n", "\n");
inputs = replaceOnce(
  inputs,
  "\t\tif (value.indexOf(\"data:image\") == -1) {\n\t\t\telement.querySelector('input[type=\"text\"]').value = value;\n\t\t}",
  "\t\tif (value.indexOf(\"data:image\") == -1) {\n\t\t\tlet input = this.element?.[0]?.querySelector('input[type=\"text\"]');\n\t\t\tif (input) input.value = value;\n\t\t}",
  "ImageInput compatibility patch",
);
const imageInputStart = inputs.indexOf("let ImageInput =");
const imageUploadStart = inputs.indexOf("\tonUpload: function", imageInputStart);
if (imageInputStart < 0 || imageUploadStart < imageInputStart) {
  throw new Error("Vvvebjs ImageInput initializer could not be patched.");
}
inputs = `${inputs.slice(0, imageUploadStart)}\tinit: function(data) {\n\t\treturn this.render(\"imageinput\", data);\n\t},\n\n${inputs.slice(imageUploadStart)}`;
await fs.writeFile(inputsPath, inputs, "utf8");

// SVG graphics do not expose the HTML-only offsetWidth/offsetHeight fields.
// Fall back to their rendered bounds so Vvveb's hover/selection outlines hug
// SVG shapes instead of retaining a stale container-sized rectangle.
const builderPath = path.join(outputRoot, "libs", "builder", "builder.js");
let builder = (await fs.readFile(builderPath, "utf8")).replaceAll("\r\n", "\n");
builder = replaceOnce(
  builder,
  "SelectBox.style.width = ((target.offsetWidth ?? target.clientWidth) + self.selectPadding * 2) + \"px\"; \t\t\t\n\t\t\t\t\t\t\tSelectBox.style.height = ((target.offsetHeight ?? target.clientHeight) + self.selectPadding * 2) + \"px\";",
  "SelectBox.style.width = ((target.offsetWidth || target.clientWidth || target.getBoundingClientRect().width) + self.selectPadding * 2) + \"px\"; \t\t\t\n\t\t\t\t\t\t\tSelectBox.style.height = ((target.offsetHeight || target.clientHeight || target.getBoundingClientRect().height) + self.selectPadding * 2) + \"px\";",
  "scroll selection SVG dimensions",
);
builder = replaceOnce(
  builder,
  "SelectBox.style.width = ((target.offsetWidth ?? target.clientWidth) + self.selectPadding * 2) + \"px\"; \t\t\t\n\t\t\tSelectBox.style.height = ((target.offsetHeight ?? target.clientHeight) + self.selectPadding * 2) + \"px\";",
  "SelectBox.style.width = ((target.offsetWidth || target.clientWidth || target.getBoundingClientRect().width) + self.selectPadding * 2) + \"px\"; \t\t\t\n\t\t\tSelectBox.style.height = ((target.offsetHeight || target.clientHeight || target.getBoundingClientRect().height) + self.selectPadding * 2) + \"px\";",
  "selected SVG dimensions",
);
builder = replaceOnce(
  builder,
  "\t\t\t\tlet height = target.offsetHeight;\n\t\t\t\tlet halfHeight = Math.max(height / 2, 5);\n\t\t\t\tlet width = target.offsetWidth;",
  "\t\t\t\tlet bounds = target.getBoundingClientRect();\n\t\t\t\tlet height = target.offsetHeight || target.clientHeight || bounds.height;\n\t\t\t\tlet halfHeight = Math.max(height / 2, 5);\n\t\t\t\tlet width = target.offsetWidth || target.clientWidth || bounds.width;",
  "highlighted SVG dimensions",
);
await fs.writeFile(builderPath, builder, "utf8");

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
