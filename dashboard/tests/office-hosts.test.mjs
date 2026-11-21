// The built GenOffice hosts (genoffice-host/*.cjs) run the upstream editors in plain Node:
// Markdown saves to disk, a PDF converts to Word/PowerPoint/Excel into exports/, and the
// Slides presenter's audience window is a second page with its own webContents.

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { blankOfficeFile } from "../src/lib/office/blank.ts";

const hostDir = path.join(import.meta.dirname, "..", "genoffice-host");

async function withHost(app, name, bytes, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `office-host-${app}-`));
  const doc = path.join(dir, name);
  fs.writeFileSync(doc, bytes);
  const child = fork(path.join(hostDir, `${app}.cjs`), [], { serialization: "advanced", env: { ...process.env, GENOFFICE_SESSION_DIR: path.join(dir, "session") }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const messages = [], waits = new Map();
  let id = 0;
  const host = {
    messages, dir, doc,
    invoke: (channel, args = [], wc = 0) => new Promise(resolve => { const i = ++id; waits.set(i, resolve); child.send({ type: "invoke", id: i, channel, args, wc }); }),
    send: (channel, args = [], wc = 0) => child.send({ type: "send", channel, args, wc }),
  };
  const ready = new Promise((resolve, reject) => {
    child.on("message", message => {
      messages.push(message);
      if (message.type === "result") { waits.get(message.id)?.(message); waits.delete(message.id); }
      if (message.type === "request") child.send({ type: "answer", id: message.id, value: { response: 0, ok: true } });
      if (message.type === "booted") child.send({ type: "open", path: doc });
      if (message.type === "ready") resolve();
      if (message.type === "failed") reject(new Error(String(message.error)));
    });
  });
  try {
    await ready;
    await run(host);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("Markdown saves to its file", { timeout: 60_000 }, async () => {
  await withHost("markdown", "doc.md", "# Hi\n", async host => {
    const saved = await host.invoke("markdown:save", [{ text: "# Saved\n", imageSources: [], mode: "save" }]);
    assert.ok(saved.ok, saved.error);
    assert.equal(fs.readFileSync(host.doc, "utf8"), "# Saved\n");
  });
});

test("a PDF converts into exports/", { timeout: 90_000 }, async () => {
  await withHost("pdf", "plan.pdf", await blankOfficeFile("pdf", "Plan"), async host => {
    for (const format of ["docx", "pptx", "xlsx"]) assert.ok((await host.invoke("pdf:convert-office", [format])).ok, format);
    assert.deepEqual(fs.readdirSync(path.join(host.dir, "session", "exports")).sort(), ["plan.docx", "plan.pptx", "plan.xlsx"]);
  });
});

test("the presenter's audience window is its own page", { timeout: 90_000 }, async () => {
  await withHost("slides", "deck.pptx", await blankOfficeFile("pptx", "Deck"), async host => {
    host.send("breadboard:screens", [true]);
    assert.ok((await host.invoke("slides:consume-pending-open", [1280])).ok);
    const started = await host.invoke("slides:presenter-start");
    assert.deepEqual(started.value, { audience: true });
    const opened = host.messages.find(message => message.type === "window");
    assert.match(opened.query, /mode=audience/);
    host.send("slides:presenter-sync", [{ idx: 0, epoch: 1 }]);
    const ready = await host.invoke("slides:audience-ready", [], opened.wc);
    assert.equal(ready.value?.epoch, 1, "the audience page gets the presenter's last state");
    assert.ok(host.messages.some(message => message.type === "event" && message.wc === opened.wc && message.channel === "slides:show-sync"));
    await host.invoke("slides:presenter-end");
    assert.ok(host.messages.some(message => message.type === "window-close" && message.wc === opened.wc));
  });
});
