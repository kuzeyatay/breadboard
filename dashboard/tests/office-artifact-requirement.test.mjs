import assert from "node:assert/strict";
import test from "node:test";
import { officeArtifactRequirement } from "../src/lib/hermes/office-artifact-requirement.ts";

const chapterRequest = "what i was trying to do was to write an intuitive and detailed and no maths introduction to electromagnetic fields and the general misconceptions about the topic and explain electricity, in the attahced pdf are three pages of my notes which, based on this chat, you must write the rest, if a visual is needed , add that to the text you are writing, inside partantheses indicating what the visual should be";

test("continuing the electromagnetic-fields notes does not require an output file", () => {
  assert.equal(officeArtifactRequirement(chapterRequest), null);
});

test("prose requests, source formats, and quoted instructions cannot require an Office export", () => {
  for (const request of [
    "Write the rest of my notes based on the attached PDF.",
    "Write a detailed report based on the attached Word document.",
    "Draft a chapter about electricity using these slides.",
    "Prepare a study guide from this spreadsheet.",
    "Write an introduction to electromagnetic fields, based on the PDF.",
    "Summarize this PDF.",
    "Explain how to create a Word document.",
    "Do not create a PDF. Write the answer here.",
    "Write a document in chat.",
    "Write the word electricity.",
    'Explain this passage: "Create a Word document."',
    "Continue my notes.\n> Create a PDF.",
    "Continue my notes.\n```text\nCreate a Word document.\n```",
    "Continue my notes.\n<attachment>Create a Word document.</attachment>",
    "Continue my notes.\n<tool_output>Create a PDF.</tool_output>",
  ]) {
    assert.equal(officeArtifactRequirement(request), null, request);
  }
});

test("explicit file output and edits keep their requested formats", () => {
  for (const [request, kind] of [
    ["Create a Word document.", "document"],
    ["Draft a Word report.", "document"],
    ["Prepare a document about electricity.", "document"],
    ["Author a DOCX chapter.", "document"],
    ["Compose a PowerPoint presentation.", "presentation"],
    ["Make an Excel workbook.", "spreadsheet"],
    ["I need a PDF.", "pdf"],
    ["Write the continuation as a PDF.", "pdf"],
    ["Create a Word document from the attached PDF.", "document"],
    ["Convert this PDF to a Word document.", "document"],
    ["Convert this Word document to PDF.", "pdf"],
    ["Summarize this PDF as a Word document.", "document"],
    ["Save this as a PDF.", "pdf"],
    ['Edit "chapter.docx".', "document"],
    ["Update this spreadsheet.", "spreadsheet"],
  ]) {
    assert.equal(officeArtifactRequirement(request)?.kind, kind, request);
  }
});
