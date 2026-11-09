const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../dashboard');
const localRequire = require('node:module').createRequire(path.join(root, 'package.json'));
const postcss = localRequire('postcss');
const tailwind = localRequire('@tailwindcss/postcss');
const { chromium } = localRequire('playwright-core');

async function main() {
  const stylesheet = path.join(root, 'src/app/globals.css');
  const sources = {
    historical: execFileSync('git', ['show', 'HEAD^:dashboard/src/app/globals.css'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }),
    current: fs.readFileSync(stylesheet, 'utf8'),
  };
  const compiled = {};
  for (const [name, source] of Object.entries(sources)) {
    compiled[name] = (await postcss([tailwind({ base: root })]).process(source, { from: stylesheet })).css;
  }
  console.log('Compiled current and historical production stylesheets.');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await page.route('**/*', route => route.abort());
    const layout = `<header class="bb-neu-toolbar breadboard-flower-navbar" style="padding:20px 24px">breadboard · palette verification</header>
      <div style="display:flex;height:calc(100vh - 69px)">
        <aside id="left" class="bb-neu-sidebar-left" style="width:260px;padding:20px 12px">
          <p>New chat</p><p style="margin-top:25px">Uploads</p><p style="margin-top:25px">Search</p><p style="margin-top:25px">Scheduled</p><p style="margin-top:25px">Starred</p><p style="margin:35px 0 12px">Recents</p>
          <div id="selected" class="bb-neu-conversation-row-selected" style="padding:12px;border-radius:9px">Garden chat</div><p style="padding:12px">Terminal chat</p>
        </aside>
        <main id="paper" style="flex:1;padding:40px;background:var(--paper-surface)">
          <h1>Original green surfaces restored</h1><p style="margin-top:20px">Chat and card surfaces keep their warm paper color.</p>
          <div id="canvas" style="background:var(--paper-bg);border:1px solid var(--line);margin-top:32px;padding:24px">App canvas</div>
          <div id="accordion" class="bb-neu-accordion-panel" style="margin-top:16px;padding:24px">Panel recess</div>
          <div id="control" class="neu-inset" style="margin-top:16px;padding:24px">Inset control</div>
          <div id="scrollbar" style="background:var(--bb-scrollbar-track);height:14px;margin-top:20px"></div>
        </main>
        <aside id="right" class="bb-neu-sidebar-right neu-surface-subtle border-l border-gray-800 bg-gray-950" style="width:340px;padding:20px">
          <h2>Knowledge panel</h2><div class="bb-neu-recessed" style="height:300px;border:1px solid var(--line);border-radius:12px;margin-top:25px"></div>
          <div class="bb-neu-accordion" style="padding:18px;margin-top:16px">Documents</div><div class="bb-neu-accordion" style="padding:18px">Links</div><div class="bb-neu-accordion" style="padding:18px">Video &amp; audio</div>
        </aside>
      </div>`;
    const report = {};
    for (const theme of ['light', 'dark']) {
      report[theme] = {};
      for (const variant of ['historical', 'current']) {
        await page.setContent(`<!doctype html><html data-theme="${theme}"><head></head><body>${layout}</body></html>`);
        await page.addStyleTag({ content: compiled[variant] });
        report[theme][variant] = await page.evaluate(() => {
          const targets = { left: '#left', right: '#right', canvas: '#canvas', paper: '#paper', navbar: 'header', selected: '#selected', accordion: '#accordion', control: '#control', scrollbar: '#scrollbar' };
          return Object.fromEntries(Object.entries(targets).map(([name, selector]) => {
            const style = getComputedStyle(document.querySelector(selector));
            return [name, { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, color: style.color, borderColor: style.borderColor }];
          }));
        });
        if (variant === 'current') await page.screenshot({ path: path.join(__dirname, `${theme}-restored.png`) });
      }
      assert.deepEqual(report[theme].current, report[theme].historical, `${theme} material colors must match the historical stylesheet`);
    }
    assert.equal(report.light.current.canvas.backgroundColor, 'rgb(230, 240, 230)');
    assert.equal(report.light.current.paper.backgroundColor, 'rgb(250, 247, 239)');
    assert.equal(report.light.current.navbar.backgroundColor, 'rgb(250, 247, 239)');
    assert.equal(report.dark.current.canvas.backgroundColor, 'rgb(15, 18, 16)');
    fs.writeFileSync(path.join(__dirname, 'rendered-colors.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ result: 'All nine sampled surfaces match historical colors in light and dark modes', lightSidebar: report.light.current.left.backgroundImage, canvas: report.light.current.canvas.backgroundColor }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
