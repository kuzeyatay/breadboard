import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const quartzRoot = fileURLToPath(new URL("../../quartz/", import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import ContentMeta from './quartz/components/ContentMeta.tsx';
      import { renderToString } from 'preact-render-to-string';
      export function render(fileData, allFiles, folderSlug, options) {
        return renderToString(ContentMeta(options)({
          cfg: { locale: 'en-US' }, fileData, allFiles, folderSlug,
        }));
      }`,
    resolveDir: quartzRoot,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "omit-styles",
      setup(builder) {
        builder.onLoad({ filter: /(?:\.scss|\.inline\.ts)$/ }, () => ({
          contents: "",
          loader: "text",
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(
  compiled,
  compiled.exports,
  createRequire(import.meta.url),
);
const { render } = compiled.exports;
const note = (slug, words) => ({
  slug,
  text: Array(words).fill("word").join(" "),
});

test("folder totals include nested notes once and exclude indexes and sibling folders", () => {
  const folder = "garden/1.-Sharing-One-Physical-Channel";
  const index = note(`${folder}/index`, 900);
  const files = [
    index,
    note(`${folder}/first`, 201),
    note(`${folder}/nested/index`, 700),
    note(`${folder}/nested/second`, 399),
    note(`${folder}/empty`, 0),
    note(`${folder}-extra/third`, 5000),
    note("garden/sibling/third", 5000),
    note("garden/root", 5000),
  ];
  const html = render(index, files, folder);
  assert.match(html, />3 min read total<\/span><span>600 words<\/span>/);
  assert.match(html, />~30 min to handwrite total<\/span>/);
  const nested = render({}, files, `${folder}/nested`);
  assert.match(nested, />2 min read total<\/span><span>399 words<\/span>/);
  assert.match(nested, />~20 min to handwrite total<\/span>/);
});

test("synthetic and empty folder pages still render their totals", () => {
  const populated = render(
    {},
    [note("garden/folder/note", 20)],
    "garden/folder",
  );
  assert.match(populated, />1 min read total<\/span><span>20 words<\/span>/);
  assert.match(populated, />~1 min to handwrite total<\/span>/);
  const empty = render({}, [], "garden/empty");
  assert.match(empty, />0 min read total<\/span><span>0 words<\/span>/);
  assert.match(empty, />~0 min to handwrite total<\/span>/);
});

test("many short notes round the combined reading time only once", () => {
  const files = Array.from({ length: 200 }, (_, index) =>
    note(`garden/folder/note-${index}`, 1),
  );
  const html = render({}, files, "garden/folder");
  assert.match(html, />1 min read total<\/span><span>200 words<\/span>/);
  assert.match(html, />~10 min to handwrite total<\/span>/);
});

test("ordinary notes keep their own estimates and respect the visibility option", () => {
  const file = note("garden/note", 2345);
  const html = render(file, [file, note("garden/other", 5000)]);
  assert.match(html, /<span>12 min read<\/span><span>2,345 words<\/span>/);
  assert.match(html, />~1 hr 58 min to handwrite<\/span>/);
  assert.doesNotMatch(html, /total/);
  assert.equal(render({}, []), "");
  assert.doesNotMatch(
    render(file, [file], undefined, { showReadingTime: false }),
    /words|handwrite/,
  );
});
