import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import os from "node:os";
import { pathToFileURL } from "node:url";
import type {
  GeneratedVisualBrowserTestsInput,
  GeneratedVisualBrowserTestResult,
} from "./generated-visuals.ts";
import { isLearnNativeVisualizer } from "./learn-native-visualizer-contract.ts";

/** Runs inside the same opaque, offline bundle used by chat and Quartz. */
export function nativeVisualizerProbe(
  controlIds: string[],
  theme: string,
  expectedWidth = 0,
): string {
  return `
(async()=>{
const checks=[]; const check=(name,passed,detail)=>checks.push({name,passed:!!passed,detail});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
addEventListener('error',event=>check('uncaught runtime error',false,event.message));
addEventListener('unhandledrejection',event=>check('unhandled rejection',false,String(event.reason)));
const scene=()=>Array.from(document.querySelectorAll('#app canvas,#app svg')).filter(node=>!node.closest('button')).map(node=>{if(node.tagName.toLowerCase()==='canvas')return node.toDataURL();const geometry=node.cloneNode(true);geometry.querySelectorAll('text,title,desc').forEach(label=>label.remove());return geometry.outerHTML}).join('');
const playing=button=>button.getAttribute('aria-pressed')==='true';
try {
document.documentElement.dataset.theme=${JSON.stringify(theme)};
dispatchEvent(new CustomEvent('breadboard:themechange',{detail:{theme:${JSON.stringify(theme)}}}));
await wait(150);
check('exact iframe viewport',${expectedWidth === 0 ? "true" : `Math.abs(innerWidth-${expectedWidth})<=1`},String(innerWidth));
const play=document.querySelector('[data-action="play-pause"]'),reset=document.querySelector('[data-action="reset"]');
check('play/pause and reset controls',play&&reset);
if(!play||!reset)throw new Error('Missing simulation transport');
if(matchMedia('(prefers-reduced-motion: reduce)').matches)check('reduced motion starts paused',!playing(play));
if(playing(play))play.click();await wait(80);
const initial=scene();check('primary scene exists',initial.length>50);
play.click();const animatedScenes=[];
for(let sample=0;sample<8;sample++){await wait(100);animatedScenes.push(scene());}
check('animation changes primary scene',new Set(animatedScenes).size>1);
play.click();await wait(80);const paused=scene();await wait(260);
check('pause freezes primary scene',scene()===paused&&!playing(play));
reset.click();if(playing(play))play.click();await wait(100);const resetScene=scene();
reset.click();if(playing(play))play.click();await wait(100);
check('reset is deterministic',scene()===resetScene);
for(const id of ${JSON.stringify(controlIds)}){
reset.click();if(playing(play))play.click();await wait(80);
const input=document.getElementById(id);check('control '+id+' exists',input);if(!input)continue;
// Reset is causal after the simulation has advanced, not at its initial state.
if(input===reset||input.dataset.action==='reset'||/(^|_)reset(_|$)/i.test(id)){
play.click();await wait(350);if(playing(play))play.click();await wait(80);
}
const before=scene();
if(input.tagName==='SELECT'){input.selectedIndex=(input.selectedIndex+1)%input.options.length;input.dispatchEvent(new Event('change',{bubbles:true}));}
else if(input.tagName==='BUTTON')input.click();
else if(input.type==='checkbox'){input.click();}
else{const min=Number(input.min||0),max=Number(input.max||10);input.value=String(Number(input.value)==max?min:max);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
await wait(220);check('control '+id+' changes primary scene',scene()!==before);
}
reset.click();if(playing(play))play.click();await wait(80);
check('no horizontal overflow',document.documentElement.scrollWidth<=innerWidth+2);
check('visible native controls',Array.from(document.querySelectorAll('#app input,#app select,#app button')).every(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=-1&&r.right<=innerWidth+1}));
check('no runtime fallback',!document.querySelector('.viz-fallback'));
}catch(error){check('probe completes',false,String(error));}
document.documentElement.setAttribute('data-native-probe',encodeURIComponent(JSON.stringify(checks)));
parent.postMessage({type:'breadboard-native-browser-probe',checks},'*');
})();`;
}

/** An opaque iframe provides the exact CSS viewport despite Chromium's
 * minimum top-level window size on Windows. It matches the garden host. */
export function nativeVisualizerBrowserDocument(
  html: string,
  width: number,
  height: number,
  theme: string,
): string {
  const escaped = html
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;color-scheme:${theme === "dark" ? "dark" : "light"};background:${theme === "dark" ? "#0f0f10" : "#fbfaf7"}}iframe{display:block;border:0;width:${width}px;height:${height}px}</style></head><body><iframe id="simulation" sandbox="allow-scripts" srcdoc="${escaped}"></iframe><script>
const frame=document.getElementById('simulation');
const send=()=>{for(const message of [{type:'host-theme',theme:${JSON.stringify(theme)}},{type:'host-presentation',presentation:'inline'}])frame.contentWindow.postMessage({protocol:'breadboard:interactive-visualizer:v1',channel:'standalone',...message},'*')};
frame.addEventListener('load',send);
addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;const data=event.data;if(data?.type==='breadboard-native-browser-probe'){document.documentElement.setAttribute('data-native-probe',encodeURIComponent(JSON.stringify(data.checks)))}else if(data?.protocol==='breadboard:interactive-visualizer:v1'&&(data.type==='ready'||data.type==='resize')&&Number.isFinite(data.height)){frame.style.height=Math.max(300,Math.min(4800,data.height+4))+'px';if(data.type==='ready')send()}});
</script></body></html>`;
}

export async function runLearnNativeVisualizerBrowserTests(
  input: GeneratedVisualBrowserTestsInput,
): GeneratedVisualBrowserTestResult {
  input = { ...input, outputDir: path.resolve(input.outputDir) };
  if (!isLearnNativeVisualizer(input.definition))
    throw new Error("Invalid native skill envelope.");
  fs.mkdirSync(input.outputDir, { recursive: true });
  const profiles = fs.mkdtempSync(path.join(os.tmpdir(), "bb-native-visual-"));
  const browserPages = path.join(profiles, "pages");
  const browserCaptures = path.join(profiles, "captures");
  fs.mkdirSync(browserPages, { recursive: true });
  fs.mkdirSync(browserCaptures, { recursive: true });
  const tests: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const scenarios = [
    { name: "desktop-light", size: "1280,900", theme: "light", reduced: false },
    { name: "desktop-dark", size: "1280,900", theme: "dark", reduced: false },
    { name: "mobile-light", size: "375,850", theme: "light", reduced: false },
    { name: "reduced-motion", size: "1280,900", theme: "light", reduced: true },
  ];
  let screenshotCreated = false;
  try {
    for (const scenario of scenarios) {
      input.signal?.throwIfAborted();
      const profilePath = path.join(profiles, scenario.name);
      const [width, height] = scenario.size.split(",").map(Number);
      const htmlPath = path.join(input.outputDir, `${scenario.name}.html`);
      const browserHtmlPath = path.join(browserPages, `${scenario.name}.html`);
      // Chromium's dump-DOM virtual clock can advance timers without compositor
      // frames. Drive RAF from the same clock for deterministic simulation
      // assertions. The separate, uninstrumented preview uses the real RAF.
      const frameClock =
        "<script>window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);</script>";
      const source = input.definition.nativeRuntime.html
        .replace("<head>", `<head>${frameClock}`)
        .replace(
          "</body>",
          `<script>${nativeVisualizerProbe(input.definition.nativeRuntime.controlIds, scenario.theme, width)}</script></body>`,
        );
      const browserDocument = nativeVisualizerBrowserDocument(
        source,
        width,
        height,
        scenario.theme,
      );
      // Keep the persisted document beside the visual for diagnostics, but do
      // not ask Chromium to open it there. Learn staging paths can exceed the
      // Windows path limit even though Node can write them; Edge then renders
      // its ERR_FILE_NOT_FOUND page and the probe appears to have timed out.
      fs.writeFileSync(htmlPath, browserDocument);
      fs.writeFileSync(browserHtmlPath, browserDocument);
      const mobilePreviewPath = path.join(input.outputDir, "mobile-preview.png");
      const mobilePreview =
        scenario.name === "mobile-light"
          ? path.join(browserCaptures, "mobile-preview.png")
          : null;
      const args = [
        "--headless=new",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-first-run",
        "--hide-scrollbars",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        // Keep the opaque iframe on Chromium's virtual test clock. This only
        // disables its separate renderer allocation, not the iframe sandbox.
        "--disable-features=IsolateSandboxedIframes",
        `--user-data-dir=${profilePath}`,
        `--window-size=${scenario.size}`,
        ...(scenario.reduced ? ["--force-prefers-reduced-motion"] : []),
        "--virtual-time-budget=6500",
        "--dump-dom",
        ...(mobilePreview ? [`--screenshot=${mobilePreview}`] : []),
        pathToFileURL(browserHtmlPath).href,
      ];
      const result = await input.browserRunner({
        executable: input.browserExecutable,
        args,
        slug: scenario.name,
        profilePath,
        timeoutMs: input.timeoutMs ?? 35_000,
      });
      const output = String(result.stdout ?? "");
      const encoded = output.match(/data-native-probe="([^"]+)"/)?.[1];
      if (!encoded) {
        tests.push({
          name: `${scenario.name}: animation probe completed`,
          passed: false,
          detail: output.slice(-300),
        });
        continue;
      }
      const checks = JSON.parse(decodeURIComponent(encoded)) as typeof tests;
      tests.push(
        ...checks.map((check) => ({
          ...check,
          name: `${scenario.name}: ${check.name}`,
        })),
      );
      if (mobilePreview) {
        const mobilePreviewCreated =
          result.cleanupConfirmed === true &&
          fs.existsSync(mobilePreview) &&
          fs.statSync(mobilePreview).size > 0;
        if (mobilePreviewCreated) fs.copyFileSync(mobilePreview, mobilePreviewPath);
        tests.push({
          name: "mobile-light: review screenshot",
          passed: mobilePreviewCreated,
        });
      }
      if (scenario.name === "desktop-light") {
        const previewPath = path.join(input.outputDir, "preview.png");
        const previewHtml = path.join(input.outputDir, "preview.html");
        const browserPreviewPath = path.join(browserCaptures, "preview.png");
        const browserPreviewHtml = path.join(browserPages, "preview.html");
        const previewProfile = path.join(profiles, "preview");
        const previewDocument = nativeVisualizerBrowserDocument(
          input.definition.nativeRuntime.html,
          width,
          height,
          scenario.theme,
        );
        fs.writeFileSync(previewHtml, previewDocument);
        fs.writeFileSync(browserPreviewHtml, previewDocument);
        const preview = await input.browserRunner({
          executable: input.browserExecutable,
          args: args
            .filter((arg) => arg !== "--dump-dom")
            .slice(0, -1)
            .map((arg) =>
              arg.startsWith("--user-data-dir=")
                ? `--user-data-dir=${previewProfile}`
                : arg,
            )
            .concat(
              `--screenshot=${browserPreviewPath}`,
              pathToFileURL(browserPreviewHtml).href,
            ),
          slug: "native-preview",
          profilePath: previewProfile,
          timeoutMs: input.timeoutMs ?? 35_000,
        });
        screenshotCreated =
          (preview.status === 0 || preview.completion === "observed_capture") &&
          preview.cleanupConfirmed === true &&
          fs.existsSync(browserPreviewPath) &&
          fs.statSync(browserPreviewPath).size > 0;
        if (screenshotCreated) fs.copyFileSync(browserPreviewPath, previewPath);
        fs.writeFileSync(
          path.join(input.outputDir, "preview-process.json"),
          JSON.stringify({
            status: preview.status,
            completion: preview.completion,
            cleanupConfirmed: preview.cleanupConfirmed,
            error: preview.error,
            stderr: String(preview.stderr ?? "").slice(-1000),
          }),
        );
      }
    }
    tests.push({ name: "native visual preview", passed: screenshotCreated });
  } finally {
    // The observed browser runner returns only after its owned process has exited.
    fs.rmSync(profiles, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
  return {
    tests,
    browser: {
      executable: input.browserExecutable,
      viewports: scenarios.map((s) => s.name),
      screenshotCreated,
    },
  };
}
