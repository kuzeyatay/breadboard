const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { translationDocumentScript } = require("../../dist/main/browser-translation-dom.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 900, height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const page = window.webContents;
  const run = code => page.executeJavaScriptInIsolatedWorld(1004, [{ code }]);
  const translate = (operation, payload) => run(translationDocumentScript("fixtureTranslation", operation, payload));
  const html = `<!doctype html><style>p{height:50px;margin:0}</style><body>
    ${Array.from({ length: 160 }, (_, i) => `<p id="p${i}">Texto ${i}</p>`).join("")}
    <p id="inline">Visita <a href="#">nuestro sitio</a> ahora.</p>
    <textarea>Private draft</textarea><p translate="no">Keep original</p>
    <div id="reveal" hidden>Texto oculto</div><div id="shadow"></div></body>`;
  await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await run(`globalThis.scans = 0;
    const treeWalker = document.createTreeWalker.bind(document);
    document.createTreeWalker = (...args) => { if(args[0] === document.body) scans++; return treeWalker(...args); };
    document.getElementById('shadow').attachShadow({mode:'open'}).innerHTML='<span>Texto sombra</span>';
    document.getElementById('p80').scrollIntoView();`);
  const first = await translate("collect", { initial: true });
  assert.equal(first.length, 8, "first request is small enough to return quickly");
  assert.equal(first[0].text, "Texto 80", "reading position takes priority over the top of the document");
  assert.ok(first.every(segment => segment.context === ""), "complete sentences are not duplicated as context");
  await translate("apply", first.map(segment => ({ id: segment.id, text: `English ${segment.text}` })));
  assert.equal(await run("fixtureTranslation.dirty"), false, "translation writes do not dirty the whole page");
  assert.equal(await run("scans"), 1);
  await run("document.getElementById('p80').firstChild.data = 'Actualizado'");
  assert.equal(await run("fixtureTranslation.dirty"), true, "live site edits still trigger collection");
  const next = await translate("collect");
  assert.equal(next.length, 40, "later requests retain the throughput of full batches");
  assert.ok(next.some(segment => segment.text === "Actualizado"));
  assert.equal(await run("scans"), 2);
  const all = [...first, ...next];
  await translate("apply", next.map(segment => ({ id: segment.id, text: `English ${segment.text}` })));
  for (let attempt = 0; attempt < 20; attempt++) {
    const batch = await translate("collect");
    if (!batch.length) break;
    all.push(...batch);
    await translate("apply", batch.map(segment => ({ id: segment.id, text: `English ${segment.text}` })));
  }
  assert.equal(await run("scans"), 2, "finishing the page does not rescan after every result");
  assert.equal(all.filter(segment => /^Texto \d+$/.test(segment.text)).length, 160, "offscreen content is also translated");
  const fragments = all.filter(segment => ["Visita ", "nuestro sitio", " ahora."].includes(segment.text));
  assert.equal(fragments.length, 3);
  assert.ok(fragments.every(segment => segment.context === "Visita nuestro sitio ahora."), "inline context stays in the source language");
  assert.ok(all.some(segment => segment.text === "Texto sombra"));
  assert.ok(!JSON.stringify(all).includes("Private draft"));
  assert.ok(!JSON.stringify(all).includes("Keep original"));
  assert.ok(!JSON.stringify(all).includes("Texto oculto"));
  await run("document.getElementById('reveal').hidden = false");
  const revealed = await translate("collect");
  assert.deepEqual(revealed.map(segment => segment.text), ["Texto oculto"]);
  await translate("restore");
  assert.equal(await run("document.getElementById('p80').textContent"), "Actualizado", "restore preserves live edits");
  assert.equal(await run("document.getElementById('p81').textContent"), "Texto 81");
  assert.equal(await run("document.getElementById('inline').textContent"), "Visita nuestro sitio ahora.");
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
