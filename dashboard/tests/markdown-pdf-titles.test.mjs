import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderMarkdownToPdf } from "../src/lib/markdown-render/pdf.ts";

test("PDFs print larger folder headings, note titles once, and subordinate content headings", async () => {
  const documents = [
    {
      title: "Old filename", folderTitle: "Sharing One Physical Channel",
      content: "---\ntitle: Why a Shared Channel Needs Access Rules\n---\n\n# Why a **Shared Channel** Needs Access Rules\n\nSeveral users share one communication channel. Access rules determine when each user may transmit.\n\n## Dividing the channel\n\nUsers can be separated by frequency, time, or code.\n\n- Frequency division assigns different frequency bands.\n- Time division assigns different time slots.\n- Code division assigns distinguishable codes.",
    },
    {
      title: "2.1 Traffic Intensity and Trunking",
      folderTitle: "Traffic Load and Blocking Capacity in Shared Communication Networks",
      content: "# Offered load\n\nCalls arrive over time and occupy one of a finite number of channels. The offered load combines the arrival rate with the average holding time.\n\n## A shared pool of channels\n\nA trunk makes a pool of channels available to many users. When every channel is busy, a new call may be blocked.",
    },
    { title: "Markdown note", content: "# A Title from Markdown\n\nA note without frontmatter still keeps its Markdown title." },
  ];
  const bytes = await renderMarkdownToPdf(documents, { title: "MAC Technologies and Fixed Networks" });
  if (process.env.PDF_TITLE_QA_OUTPUT) {
    fs.mkdirSync(path.dirname(process.env.PDF_TITLE_QA_OUTPUT), { recursive: true });
    fs.writeFileSync(process.env.PDF_TITLE_QA_OUTPUT, bytes);
  }
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    assert.equal(pdf.numPages, 3);
    const pageText = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter(item => "str" in item && item.str.trim());
      const text = items.map(item => item.str).join(" ").replace(/\s+/g, " ");
      pageText.push(text);
      for (const item of items) {
        assert.ok(item.transform[4] >= 53, `left edge: ${item.str}`);
        assert.ok(item.transform[4] + item.width <= page.view[2] - 53, `right edge: ${item.str}`);
        assert.ok(item.transform[5] >= 20 && item.transform[5] <= page.view[3] - 35, `vertical bounds: ${item.str}`);
      }
      if (n <= 2) {
        const folder = items.find(item => item.str.startsWith(n === 1 ? "Sharing One" : "Traffic Load"));
        const title = items.find(item => item.str.startsWith(n === 1 ? "Why a Shared" : "2.1 Traffic"));
        const section = items.find(item => item.str.startsWith(n === 1 ? "Dividing" : "Offered"));
        const paragraph = items.find(item => item.str.startsWith(n === 1 ? "Several" : "Calls"));
        assert.ok(folder.height > title.height && title.height > section.height && section.height > paragraph.height);
        assert.ok(folder.transform[5] > title.transform[5]);
      }
    }
    assert.equal(pageText[0].split("Why a Shared Channel Needs Access Rules").length - 1, 1);
    assert.doesNotMatch(pageText[0], /Old filename|title:/);
    assert.match(pageText[1], /Networks 2\.1 Traffic Intensity and Trunking Offered load/);
    assert.equal(pageText[2].split("A Title from Markdown").length - 1, 1);
    assert.doesNotMatch(pageText[2], /Markdown note/);
  } finally { await pdf.destroy(); }
});
