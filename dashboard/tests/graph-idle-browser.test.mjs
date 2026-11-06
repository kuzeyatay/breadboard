import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const quartz = path.resolve(import.meta.dirname, "../../quartz");
const graphFile = path.join(quartz, "quartz/components/scripts/graph.inline.ts");

test("real Pixi graph rests when settled, redraws for interactions, and pauses offscreen", { timeout: 60000 }, async t => {
  const bundle = await build({entryPoints:[graphFile], bundle:true, write:false, platform:"browser", format:"iife",
    plugins:[{name:"graph-test-observation", setup(builder) {
      builder.onLoad({filter:/[/\\]graph\.inline\.ts$/}, () => {
        let contents = fs.readFileSync(graphFile, "utf8");
        const anchor = "graph.appendChild(app.canvas)";
        assert.equal(contents.split(anchor).length, 2);
        contents = contents.replace(anchor, `${anchor}
          window.testGraph = {app,simulation,draws:0};
          const draw = app.renderer.render.bind(app.renderer);
          app.renderer.render = (...args) => { window.testGraph.draws++; return draw(...args); };
        `);
        contents += '\nwindow.mountGraph = async () => { window.graphCleanup = await renderGraph(document.querySelector(".graph-container"), "demo/note-0"); };';
        return {contents, loader:"ts"};
      });
    }}],
  });
  const browser = await chromium.launch({headless:true, ...(process.platform === "win32" ? {channel:"msedge"} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1000,height:800}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const index = Object.fromEntries(Array.from({length:80}, (_,i) => [`demo/note-${i}`, {
    title:`Note ${i}`, tags:[], links:[`demo/note-${(i+1)%80}`], content:"", slug:`demo/note-${i}`,
  }]));
  const cfg = {mode:"links",drag:true,zoom:true,depth:-1,scope:"all",clickToNavigate:false,scale:1,
    repelForce:1.25,centerForce:0.08,linkDistance:120,fontSize:0.72,opacityScale:1,showTags:true,
    removeTags:[],focusOnHover:true,enableRadial:false};
  await page.route("http://localhost:53162/**", route => route.fulfill({contentType:"text/html",body:`<!doctype html>
    <style>:root{--secondary:#284b63;--tertiary:#84a59d;--gray:#888888;--light:#ffffff;--lightgray:#cccccc;--dark:#222222;--darkgray:#444444;--bodyFont:Arial}body{margin:0}.graph-container{width:600px;height:400px}</style>
    <div class="graph"><div class="graph-container" data-cfg='${JSON.stringify(cfg)}'></div></div>
    <script>const fetchData=Promise.resolve(${JSON.stringify(index)});window.addCleanup=()=>{};window.spaNavigate=()=>{};</script>`}));
  await page.goto("http://localhost:53162/demo/note-0");
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(() => mountGraph());
  await page.waitForFunction(() => testGraph.draws > 0);
  // Advance the real simulation deterministically rather than waiting for its
  // several-second decay. The production tick listener must request the draw.
  await page.evaluate(() => {
    testGraph.simulation.stop().tick(400).alpha(0);
    testGraph.simulation.on("tick.render")();
  });
  const rest = async () => {
    await page.waitForTimeout(350); // permit the longest (200ms) interaction tween to finish
    const count = await page.evaluate(() => testGraph.draws);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => testGraph.draws), count, "settled graph must not redraw");
    return count;
  };
  let count = await rest();
  await page.evaluate(() => document.querySelector(".graph-container").dispatchEvent(new CustomEvent("graph-search", {detail:{query:"Note 2"}})));
  await page.waitForFunction(previous => testGraph.draws > previous, count);
  count = await rest();
  const searchRingVisible = await page.evaluate(() => testGraph.app.stage.children.find(c => c.zIndex === 2).children.some(c => c.alpha === 0.95));
  assert.equal(searchRingVisible, true, "search highlights are drawn");
  // Trigger the real Pixi hover handlers, including the opacity tween's final state.
  await page.evaluate(() => {
    const node = testGraph.app.stage.children.find(c => c.zIndex === 2).children.find(c => c.label === "demo/note-0");
    node.emit("pointerover", {target:node});
  });
  await page.waitForFunction(previous => testGraph.draws > previous, count);
  count = await rest();
  await page.mouse.move(300,200);
  await page.mouse.wheel(0,-100);
  await page.waitForFunction(() => testGraph.app.stage.scale.x !== 1);
  assert.ok(await rest() > count, "zoom redraws the graph");
  // Real IntersectionObserver should stop both the renderer and the simulation.
  await page.evaluate(() => {
    testGraph.simulation.alpha(1).restart();
    document.querySelector(".graph-container").style.marginTop = "1500px";
  });
  await page.waitForTimeout(150);
  const hidden = await page.evaluate(() => ({draws:testGraph.draws,alpha:testGraph.simulation.alpha()}));
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => ({draws:testGraph.draws,alpha:testGraph.simulation.alpha()})), hidden);
  await page.evaluate(() => document.querySelector(".graph-container").style.marginTop = "0");
  await page.waitForFunction(previous => testGraph.draws > previous && testGraph.simulation.alpha() < 1, hidden.draws);
  await page.evaluate(() => {graphCleanup(); window.cleanupDraws = testGraph.draws;});
  await page.waitForTimeout(200);
  assert.equal(await page.locator("canvas").count(), 0);
  assert.equal(await page.evaluate(() => testGraph.draws), await page.evaluate(() => cleanupDraws));
  assert.deepEqual(errors, []);
});
