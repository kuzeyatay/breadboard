// A MATLAB Live Script attached to a chat is read, not shown as its zip bytes.
//
// The failure being pinned: a student attached a lab handout saved as .mlx and
// the model reported it could only see "raw binary data". The file is a zip
// package with a WordprocessingML body inside; every instruction in it was
// there, one part away. The fixture is built here from the same XML the Live
// Editor writes, so what the reader is tested against is readable in a diff.

import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";

const { readMlx, mlxText } = await import("../src/lib/document-structure/mlx.ts");
const { storedFileAttachmentFormat, storedFileIsText } = await import(
  "../src/lib/stored-file-attachments.ts"
);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function paragraph(style, inner, { list = false, section = false } = {}) {
  const props = [
    `<w:pStyle w:val="${style}"/>`,
    list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "",
    section ? "<w:sectPr/>" : "",
  ].join("");
  return `<w:p><w:pPr>${props}</w:pPr>${inner}</w:p>`;
}
const run = (text, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const equation = (latex) =>
  `<w:customXml w:element="equation"><w:r><w:t>${latex}</w:t></w:r></w:customXml>`;

function liveScript(body, { outputs = "" } = {}) {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"));
  zip.addFile(
    "matlab/document.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
  );
  if (outputs) zip.addFile("matlab/output.xml", Buffer.from(outputs));
  return zip.toBuffer();
}

test("a Live Script reads as its prose and code cells, in order", () => {
  const buffer = liveScript(
    [
      paragraph("title", run("Lab 1: Erlang traffic")),
      paragraph("text", run("Answer ") + run("all", "<w:b/>") + run(" questions below.")),
      paragraph("heading", run("Question 1")),
      paragraph("text", run("Compute the blocking probability for ") + equation("A = 10") + run(" Erlangs.")),
      paragraph("text", equation("B(N, A) = \\frac{A^N / N!}{\\sum_{k=0}^{N} A^k / k!}")),
      paragraph("text", run("Report:"), { list: false }),
      paragraph("text", run("the value of B"), { list: true }),
      paragraph("text", run("a plot of B against N"), { list: true }),
      paragraph("code", run("A = 10;")),
      paragraph("code", run("N = 12;")),
      paragraph("code", run("    B = erlangb(A, N)"), { section: true }),
      paragraph("heading", run("Question 2")),
      paragraph("code", run("plot(1:N, B)")),
    ].join(""),
  );

  const structure = readMlx(buffer);
  assert.equal(structure.warnings.length, 0, structure.warnings.join("; "));
  const text = structure.markdown;

  assert.match(text, /^# Lab 1: Erlang traffic/);
  assert.match(text, /Answer \*\*all\*\* questions below\./);
  assert.match(text, /## Question 1/);
  assert.match(text, /probability for \$A = 10\$ Erlangs\./);
  assert.match(text, /\$\$B\(N, A\) = \\frac/, "a paragraph that is only an equation is display math");
  assert.match(text, /- the value of B\n- a plot of B against N/);
  assert.match(
    text,
    /```matlab\nA = 10;\nN = 12;\n    B = erlangb\(A, N\)\n```/,
    "consecutive code paragraphs form one fenced cell and keep their indentation",
  );
  assert.match(text, /## Question 2\n\n```matlab\nplot\(1:N, B\)\n```/, "a section break closes the cell");
  assert.equal(structure.formulas.length, 2);
  assert.equal(structure.formulas[1].display, true);
  assert.equal(structure.summary.formulaCount, 2);
});

test("saved outputs are counted and named, not silently dropped", () => {
  const buffer = liveScript(paragraph("code", run("x = 1")), {
    outputs:
      '<outputArray><outputData id="1">{}</outputData><outputData id="2">{}</outputData></outputArray>',
  });
  const text = mlxText(buffer);
  assert.match(text, /```matlab\nx = 1\n```/);
  assert.match(text, /2 saved outputs from its last run/);
});

test("a file that is not a Live Script says so instead of failing", () => {
  const zip = new AdmZip();
  zip.addFile("readme.txt", Buffer.from("hello"));
  const structure = readMlx(zip.toBuffer());
  assert.equal(structure.markdown, "");
  assert.match(structure.warnings[0], /not a MATLAB Live Script/);

  const garbage = readMlx(Buffer.from("not a zip at all"));
  assert.match(garbage.warnings[0], /could not be opened/);
});

test("MATLAB files are stored attachments: .m as text, .mlx as a package", () => {
  assert.equal(storedFileAttachmentFormat("erlangb-4.m"), "m");
  assert.equal(storedFileIsText("m"), true);
  assert.equal(storedFileAttachmentFormat("Lab_1_Erlang-1.mlx"), "mlx");
  assert.equal(storedFileIsText("mlx"), false);
});
