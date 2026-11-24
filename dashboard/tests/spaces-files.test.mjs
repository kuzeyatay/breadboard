import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import sharp from "sharp";
import { blankOfficeFile } from "../src/lib/office/blank.ts";
import { officeKindForName, spacesKindForPath, spacesStudio } from "../src/lib/office/types.ts";
import { gardenFileCapabilities } from "../src/lib/garden-files/types.ts";

test("a new design is a white 1080 px PNG canvas", async () => {
  const meta = await sharp(Buffer.from(await blankOfficeFile("png", "Poster"))).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1080);
});

test("a new whiteboard is an AFFiNE page that opens in edgeless mode", async () => {
  const zip = await JSZip.loadAsync(await blankOfficeFile("affine", "Board", { whiteboard: true }));
  assert.deepEqual(JSON.parse(await zip.file("info.json").async("string")), { format: "breadboard-affine", version: 1, mode: "edgeless" });
  assert.equal(gardenFileCapabilities("Board.affine").editor, "affine");
});

test("images and videos count as Spaces files only inside a Spaces folder", () => {
  assert.equal(spacesKindForPath("photos/cat.png"), null);
  assert.equal(spacesKindForPath("Spaces/Poster.png")?.tab, "designs");
  assert.equal(spacesStudio("Office/Trailer.mp4"), "video");
  assert.equal(spacesKindForPath("notes/Plan.docx")?.tab, "docs");
  assert.equal(officeKindForName("Plan.affine")?.label, "Pages");
});
