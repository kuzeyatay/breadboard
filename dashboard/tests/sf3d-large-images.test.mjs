import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("large PDF screenshots survive current turns, follow-ups and retries without regexp optimization", () => {
  // V8 may execute a regexp without its greedy-loop optimization. The old
  // whole-data-URL capture then exhausted the regexp stack on real PDF views.
  const moduleUrl = new URL("../src/lib/sf3d/images.ts", import.meta.url).href;
  const attachmentsUrl = new URL("../src/lib/chat-attachments.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types", "--no-regexp-optimization", "--input-type=module", "-e",
    `
      import assert from "node:assert/strict";
      import {
        decodeImageAttachment, reconstructableFromAttachments,
        reconstructableImages, renderImageTo3dContext,
      } from ${JSON.stringify(moduleUrl)};
      import { chatMessageAttachments, normalizeChatMessageAttachments,
        reusableChatAttachments } from ${JSON.stringify(attachmentsUrl)};
      const bytes = Buffer.alloc(4 * 1024 * 1024, 0xab);
      const base64 = bytes.toString("base64");
      const attachment = { type: "image", name: "Current PDF view.png",
        dataUrl: "data:image/png;base64," + base64 };
      const history = [{ role: "user", metadata: JSON.stringify({ attachments: [attachment] }) },
        { role: "assistant", metadata: null }];
      for (let retry = 0; retry < 3; retry++) {
        const saved = chatMessageAttachments([attachment]);
        const restored = normalizeChatMessageAttachments(JSON.parse(JSON.stringify(saved)));
        const reused = reusableChatAttachments(restored);
        assert.equal(reused[0].dataUrl, attachment.dataUrl);
        const current = reconstructableFromAttachments(reused);
        const previous = reconstructableImages(history);
        assert.deepEqual(current[0].bytes, bytes);
        assert.deepEqual(previous[0].bytes, bytes);
        assert.equal(previous[0].carriedForward, true);
        assert.match(renderImageTo3dContext(previous), /Current PDF view.png/);
      }
      // Unicode whitespace forces the two-byte string path. Keep whitespace
      // acceptance, exact decoded bytes, and rejection of an invalid tail.
      assert.deepEqual(decodeImageAttachment({ ...attachment,
        dataUrl: "  DATA:IMAGE/PNG;BASE64," + base64.slice(0, 4) + "\\u202f\\n" + base64.slice(4) + "  "
      }).bytes, bytes);
      assert.equal(decodeImageAttachment({ ...attachment, dataUrl: attachment.dataUrl + "!" }), null);
      assert.equal(decodeImageAttachment({ ...attachment, dataUrl: "data:image/png;base64," }), null);
      assert.equal(decodeImageAttachment({ ...attachment, dataUrl: "data:image/gif;base64," + base64 }), null);
    `,
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.stack ?? result.stderr ?? result.stdout);
});
