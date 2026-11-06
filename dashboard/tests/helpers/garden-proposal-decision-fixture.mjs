import fs from "node:fs";
import ts from "typescript";

// Run the real decision service with the same isolated dependencies used by
// route fixtures. This keeps button tests exercising canonical write ordering
// after the decision logic moved out of the Next route.
export function gardenProposalDecisionFixture(dependencies) {
  const file = new URL("../../src/lib/hermes/proposal-decisions.ts", import.meta.url);
  const tree = ts.createSourceFile("proposal-decisions.ts", fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const handler = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "decideGardenProposal");
  const js = ts.transpileModule(handler.getText(tree).replace("export ", ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js};return decideGardenProposal`)(...Object.values(dependencies));
}
