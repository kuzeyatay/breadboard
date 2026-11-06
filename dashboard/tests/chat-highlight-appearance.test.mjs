import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));

test('manual chat highlights keep their fill independently of transparent website overlays', {timeout:60_000}, async t => {
  // Compile the complete stylesheet: the regression came from a selector in an
  // unrelated popup rule, which testing only palette rules would miss.
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'), {from:stylesheet})).css;
  const bundle = await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    alias:{'@':path.join(root,'src')}, define:{'process.env.NODE_ENV':'"production"'},
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import ChatMarkdown from '@/app/components/chat-markdown';
      const passage='A Wien oscillator does not inherently need 12 op-amps.';
      window.opened=[];
      createRoot(document.getElementById('root')).render(<>
        {['blue','green','pink','purple','answer'].map(color=><section key={color} data-color={color}>
          <ChatMarkdown content={'The requirement: '+passage}
            textAnnotations={[{id:color,start:17,end:17+passage.length,quote:passage,kind:color==='answer'?'answer':'highlight',color:color==='answer'?undefined:color}]}
            onTextAnnotationClick={id=>window.opened.push(id)}/>
        </section>)}
      </>);
    `}});
  const executablePath = [chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:700,height:800}});
  await page.setContent('<html><body><div id="root" style="width:340px;margin:40px"></div></body></html>');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await expect(page.locator('mark')).toHaveCount(5);

  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for (const color of ['blue','green','pink','purple','answer']) {
      const mark = page.locator(`[data-color="${color}"] mark`);
      const token = color==='answer'?'--selection-yellow':`--selection-highlight-${color}`;
      const colors = await page.evaluate(token=>{
        const probe=document.createElement('span');document.body.append(probe);
        probe.style.backgroundColor=`var(${token})`;const base=getComputedStyle(probe).backgroundColor;
        probe.style.backgroundColor=`var(${token}-hover)`;const hover=getComputedStyle(probe).backgroundColor;
        probe.remove();return {base,hover};
      },token);
      assert.notEqual(colors.base,'rgba(0, 0, 0, 0)');
      await page.mouse.move(690,790);
      await mark.evaluate(el=>el.blur());
      await expect(mark).toHaveCSS('background-color',colors.base);
      assert.ok(await mark.evaluate(el=>el.getClientRects().length>1),'wrapped selections paint each line');
      await mark.hover();
      await expect(mark).toHaveCSS('background-color',colors.hover);
      await mark.click();
      assert.equal(await page.evaluate(()=>window.opened.at(-1)),color);
      await page.mouse.move(690,790);
      await mark.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(mark).toHaveCSS('background-color',colors.hover);
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>window.opened.at(-1)),color);
      await mark.evaluate(el=>el.blur());
    }
  }
  // Both native overlay documents remain transparent, while their actual
  // highlighted text retains its own color.
  for (const attribute of ['data-breadboard-selection-popup','data-breadboard-inline-answer']) {
    await page.evaluate(attribute=>document.documentElement.setAttribute(attribute,'true'),attribute);
    await expect(page.locator('html')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(page.locator('body')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(page.locator('[data-color="pink"] mark')).toHaveCSS('background-color','rgb(137, 68, 97)');
    await page.evaluate(attribute=>document.documentElement.removeAttribute(attribute),attribute);
  }
  if (process.env.BREADBOARD_HIGHLIGHT_QA_DIR) {
    fs.mkdirSync(process.env.BREADBOARD_HIGHLIGHT_QA_DIR,{recursive:true});
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await expect(page.locator('[data-color="pink"] mark')).toHaveCSS('background-color','rgb(233, 154, 187)');
    await page.screenshot({path:path.join(process.env.BREADBOARD_HIGHLIGHT_QA_DIR,'garden-highlight-colors.png')});
  }
});
