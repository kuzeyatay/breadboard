import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addGardenLink,
  deleteGardenLink,
  readGardenLinks,
} from "../src/lib/garden-links.ts";

describe("garden links", () => {
  test("stores, reads, normalizes, and deletes saved links", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-links-"));
    const gardenSlug = "test-garden";
    fs.mkdirSync(path.join(root, gardenSlug), { recursive: true });

    const link = addGardenLink(root, gardenSlug, {
      title: "Reference",
      url: "example.com/course",
    });

    assert.equal(link.title, "Reference");
    assert.equal(link.url, "https://example.com/course");

    const links = readGardenLinks(root, gardenSlug);
    assert.equal(links.length, 1);
    assert.equal(links[0].id, link.id);

    const upgraded = addGardenLink(root, gardenSlug, {title:"Whole website",url:link.url,sourceSlug:"full-site",sourceRelPath:"sources/full-site.md"});
    assert.equal(upgraded.id,link.id);
    assert.equal(readGardenLinks(root,gardenSlug).length,1);
    assert.equal(readGardenLinks(root,gardenSlug)[0].sourceRelPath,"sources/full-site.md");

    assert.equal(deleteGardenLink(root, gardenSlug, link.id), true);
    assert.deepEqual(readGardenLinks(root, gardenSlug), []);
  });
});
