// A transcript re-invokes `renderItem` for every mounted row on every scroll
// frame, and the surfaces build the annotations prop as `get(id) ?? []` — a
// fresh array each time. An identity-compared memo therefore re-parsed every
// mounted message through remark/rehype on every frame, which is why a
// table-heavy conversation scrolled like it was underwater while a prose one
// felt fine: the parse and the rebuilt cell tree are the most expensive thing
// a row does, and tables have hundreds of cells.
//
// These tests pin the seams that stop that: both markdown components are
// memoized with a comparator that reads annotations by value, and the panel
// hands them stable callback identities.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const require = module.createRequire(import.meta.url);

const REACT_MEMO = Symbol.for("react.memo");

let ChatMarkdown;
let SelectableAssistantMarkdown;
let chatTextAnnotationsEqual;
let outDirectory;

before(async () => {
  fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), {
    recursive: true,
  });
  outDirectory = fs.mkdtempSync(
    path.join(dashboardRoot, "node_modules", ".cache", "chat-markdown-memo-"),
  );
  const entry = path.join(outDirectory, "entry.jsx");
  fs.writeFileSync(
    entry,
    [
      'export { default as ChatMarkdown, chatTextAnnotationsEqual } from "@/app/components/chat-markdown";',
      'export { SelectableAssistantMarkdown } from "@/app/components/chat-text-selection-ui";',
      "",
    ].join("\n"),
  );
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: path.join(outDirectory, "bundle.cjs"),
    format: "cjs",
    platform: "node",
    target: "node20",
    jsx: "automatic",
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: { "@": path.join(dashboardRoot, "src") },
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    logLevel: "silent",
  });
  ({ ChatMarkdown, SelectableAssistantMarkdown, chatTextAnnotationsEqual } =
    require(path.join(outDirectory, "bundle.cjs")));
});

after(() => {
  if (outDirectory) fs.rmSync(outDirectory, { recursive: true, force: true });
});

const click = () => {};
const select = () => {};
const open = () => {};

test("both assistant markdown components are memoized", () => {
  assert.equal(ChatMarkdown.$$typeof, REACT_MEMO);
  assert.equal(SelectableAssistantMarkdown.$$typeof, REACT_MEMO);
  assert.equal(typeof ChatMarkdown.compare, "function");
  assert.equal(typeof SelectableAssistantMarkdown.compare, "function");
});

test("a fresh empty annotations array does not re-render ChatMarkdown", () => {
  const base = { content: "| a | b |\n| - | - |\n| 1 | 2 |", compact: true, onTextAnnotationClick: click };
  assert.equal(
    ChatMarkdown.compare(
      { ...base, textAnnotations: [] },
      { ...base, textAnnotations: [] },
    ),
    true,
  );
  // The prop defaults to [] inside the component, so absence and emptiness
  // are the same thing to the comparator too.
  assert.equal(
    ChatMarkdown.compare({ ...base, textAnnotations: undefined }, { ...base, textAnnotations: [] }),
    true,
  );
});

test("real changes still re-render ChatMarkdown", () => {
  const annotation = { id: "a1", start: 0, end: 3 };
  const base = { content: "hello", compact: true, onTextAnnotationClick: click, textAnnotations: [] };
  assert.equal(ChatMarkdown.compare(base, { ...base, content: "hello!" }), false);
  assert.equal(ChatMarkdown.compare(base, { ...base, compact: false }), false);
  assert.equal(ChatMarkdown.compare(base, { ...base, onTextAnnotationClick: () => {} }), false);
  assert.equal(ChatMarkdown.compare(base, { ...base, textAnnotations: [annotation] }), false);
  // Equivalent annotations in a rebuilt array are not a change.
  assert.equal(
    ChatMarkdown.compare(
      { ...base, textAnnotations: [annotation] },
      { ...base, textAnnotations: [{ ...annotation }] },
    ),
    true,
  );
  // But a moved or different annotation is.
  assert.equal(
    ChatMarkdown.compare(
      { ...base, textAnnotations: [annotation] },
      { ...base, textAnnotations: [{ ...annotation, end: 4 }] },
    ),
    false,
  );
});

test("SelectableAssistantMarkdown bails out for equivalent rows", () => {
  const base = {
    content: "| a |\n| - |\n| 1 |",
    sourceMessageId: "m-1",
    onSelection: select,
    onOpenAnnotation: open,
  };
  assert.equal(
    SelectableAssistantMarkdown.compare(
      { ...base, annotations: [] },
      { ...base, annotations: [] },
    ),
    true,
  );
  assert.equal(
    SelectableAssistantMarkdown.compare(
      { ...base, annotations: [] },
      { ...base, annotations: [], content: "changed" },
    ),
    false,
  );
  assert.equal(
    SelectableAssistantMarkdown.compare(
      { ...base, annotations: [] },
      { ...base, annotations: [], onOpenAnnotation: () => {} },
    ),
    false,
  );
});

test("annotation equality reads values, not identities", () => {
  assert.equal(chatTextAnnotationsEqual(undefined, []), true);
  assert.equal(chatTextAnnotationsEqual([], []), true);
  assert.equal(
    chatTextAnnotationsEqual(
      [{ id: "x", start: 1, end: 2 }],
      [{ id: "x", start: 1, end: 2 }],
    ),
    true,
  );
  assert.equal(chatTextAnnotationsEqual([{ id: "x", start: 1, end: 2 }], []), false);
  assert.equal(
    chatTextAnnotationsEqual(
      [{ id: "x", start: 1, end: 2 }],
      [{ id: "y", start: 1, end: 2 }],
    ),
    false,
  );
});

test("the panel hands the memoized rows stable callback identities", () => {
  const panel = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "components", "hermes", "agent-runtime-panel.tsx"),
    "utf8",
  );
  assert.match(panel, /const receiveTextSelection = useCallback\(/);
  assert.match(panel, /const openAnnotation = useCallback\(/);
});
