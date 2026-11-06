import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/components/hermes/inline-artifact-cards.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("cards.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const card = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "InlineImageArtifact");
const compiled = ts.transpileModule(card.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const render = vm.runInNewContext(`${compiled}; InlineImageArtifact`, {
  React: { createElement: (type, props, ...children) => ({ type, props, children }) },
  ArtifactImagePreview: "preview",
  ArtifactFileIcon: "icon",
  artifactUrl: (artifact) => `/preview/${artifact.id}`,
  artifactViewerKey: (artifact) => artifact.id,
  artifactDescription: () => "Image",
});

for (const sourceHermesTool of ["artifact_import", "artifact_image_generate", "artifact_image_edit", null]) {
  test(`image artifact from ${sourceHermesTool ?? "an unspecified source"} gets the reveal`, () => {
    const result = render({
      artifact: { id: "image", title: "Image", sourceHermesTool, metadata: {} },
      context: { openId: null },
    });
    const preview = result.children.find((child) => child.type === "preview");
    assert.equal(preview.props.animate, true);
    assert.equal(preview.props.src, "/preview/image");
  });
}
