import assert from "node:assert/strict";
import test from "node:test";
import { requestsUploadArtifact } from "../src/lib/hermes/artifact-upload-intent.ts";

test("reference attachments and requested new outputs do not authorize copying the input", () => {
  for (const request of [
    "what i was trying to do was to write an intuitive and detailed and no maths introduction to electromagnetic fields and the general misconceptions about the topic and explain electricity, in the attahced pdf are three pages of my notes which, based on this chat, you must write the rest, if a visual is needed , add that to the text you are writing, inside partantheses indicating what the visual should be",
    "Read the attached PDF and explain electricity.",
    "Use the attached PDF to write a report and save the report as an artifact.",
    "Read the uploaded document and save the rewritten document as a PDF.",
    "Create a PDF using these notes.",
    "Add a visual to the explanation based on the attached PDF.",
    "Do not save the attached PDF as an artifact.",
    "Summarize it without copying the uploaded file.",
  ]) assert.equal(requestsUploadArtifact(request, "CamScanner 9.09.2026 10.54.pdf"), false, request);
});

test("explicit requests can preserve original uploads", () => {
  for (const request of [
    "Save CamScanner 9.09.2026 10.54.pdf as an artifact.",
    "Please import the attached PDF.",
    "Keep a copy of the original document.",
    "Save this file.",
    "Make this an artifact.",
    "Add the attachment to my artifacts.",
    "Save it as an artifact.",
  ]) assert.equal(requestsUploadArtifact(request, "CamScanner 9.09.2026 10.54.pdf"), true, request);
});
