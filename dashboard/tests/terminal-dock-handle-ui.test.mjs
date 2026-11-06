import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

test("the border handle opens fully on click or keyboard and preserves dragging and cancellation", { timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
    import {useRef,useState} from 'react'; import {createRoot} from 'react-dom/client';
    import Handle from './src/app/components/hermes/terminal-dock-handle';
    function Demo() {
      const [height,setHeight]=useState(42), [resizing,setResizing]=useState(false);
      const start=useRef(null); window.resetDock=()=>setHeight(42); window.openCalls=window.openCalls??0;
      return <><section data-terminal-dock style={{position:'fixed',bottom:0,left:0,right:0,height,overflow:'hidden',background:'#e8d7bd'}} />
        <Handle dockStyle={{height}} resizing={resizing} onOpen={()=>{window.openCalls++;setHeight(600)}}
          onResizeStart={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);start.current={y:e.clientY,height};setResizing(true)}}
          onResizeMove={e=>{if(start.current)setHeight(start.current.height+start.current.y-e.clientY)}}
          onResizeEnd={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);start.current=null;setResizing(false)}} />
      </>;
    }
    createRoot(document.getElementById('root')).render(<Demo />);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
  const css = (await postcss([tailwind({ base: root })]).process(
    '@import "tailwindcss" source(none);\n@source "./src/app/components/hermes/terminal-dock-handle.tsx";',
    { from: path.join(root, "terminal-handle-preview.css") },
  )).css;
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route("https://terminal-handle.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://terminal-handle.test");
    await page.addStyleTag({ content: css + ":root{--botanical:#4f6f68;--botanical-hover:#3f5f58;--bb-artifact-dock-width:300px} html[data-artifact-dock=open] [data-terminal-dock],html[data-artifact-dock=open] [data-terminal-handle-position]{right:var(--bb-artifact-dock-width)!important}" });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const handle = page.getByRole("button", { name: "Fully open terminal" });
    const dock = page.locator("[data-terminal-dock]");
    const alignment = async () => {
      const grip = await handle.locator("span").boundingBox(), panel = await dock.boundingBox();
      assert.equal(grip.y + grip.height / 2, panel.y + 2, "the center sits on the inset outline");
      assert.equal(grip.x + grip.width / 2, panel.x + panel.width / 2);
      assert.equal(grip.height, 8);
      assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.getAttribute('aria-label'), {x:grip.x+32,y:grip.y+1}), "Fully open terminal", "the upper half is clickable, not clipped");
    };
    await expect(handle).toBeVisible(); await alignment();
    await handle.click(); await expect(dock).toHaveCSS("height", "600px");
    assert.equal(await page.evaluate(()=>window.openCalls), 1, "the native click does not double-handle pointerup");
    await alignment();

    await page.evaluate(()=>window.resetDock()); await expect(dock).toHaveCSS("height", "42px");
    const box=await handle.boundingBox(), x=box.x+box.width/2, y=box.y+box.height/2;
    await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x,y-120,{steps:8}); await page.mouse.up();
    await expect(dock).toHaveCSS("height", "162px"); await alignment();
    assert.equal(await page.evaluate(()=>window.openCalls),1,"dragging must not trigger full opening");
    await handle.click(); await expect(dock).toHaveCSS("height","600px");
    assert.equal(await page.evaluate(()=>window.openCalls),2,"a click also expands a partially open terminal");

    await page.evaluate(()=>window.resetDock()); await handle.focus(); await page.keyboard.press("Enter");
    await expect(dock).toHaveCSS("height","600px");
    await page.evaluate(()=>window.resetDock()); await page.keyboard.press("Space");
    await expect(dock).toHaveCSS("height","600px");
    assert.equal(await page.evaluate(()=>window.openCalls),4);

    await page.evaluate(()=>window.resetDock()); await expect(dock).toHaveCSS("height","42px");
    await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x,y-30); await page.mouse.move(x,y); await page.mouse.up();
    await expect(dock).toHaveCSS("height","42px");
    assert.equal(await page.evaluate(()=>window.openCalls),4,"returning a drag to its starting point is still a drag");
    await page.mouse.down();
    await handle.dispatchEvent("pointercancel",{pointerId:1,clientX:x,clientY:y,bubbles:true});
    await page.mouse.move(10,10); await page.mouse.up();
    assert.equal(await page.evaluate(()=>window.openCalls),4,"cancelled pointers do not open the terminal");

    await page.evaluate(()=>document.documentElement.dataset.artifactDock='open'); await alignment();
  } finally { await browser.close(); }
});
