import crypto from "node:crypto";
import { build } from "esbuild";
import ts from "typescript";
import { interactiveVisualizerConfig } from "./interactive-visualizer-config.ts";
import {
  INTERACTIVE_VISUALIZER_THREE_VERSION,
  type InteractiveVisualizerMode,
  type InteractiveVisualizerPlan,
  type InteractiveVisualizerValidation,
} from "./interactive-visualizer-types.ts";

export const CUSTOM_INTERACTIVE_VISUALIZER_SCHEMA_VERSION = 2;
export const CUSTOM_INTERACTIVE_VISUALIZER_RUNTIME_VERSION = "2.0.0";

export interface CustomInteractiveVisualizerManifest {
  schemaVersion: 2;
  artifactType: "interactive-visualizer";
  title: string;
  description: string;
  accessibilityDescription: string;
  mode: InteractiveVisualizerMode;
  entry: "index.html";
  runtime: {
    id: "breadboard-interactive-visualizer";
    version: "2.0.0";
    threeVersion?: string;
  };
}

export interface CustomInteractiveVisualizerPackage {
  schemaVersion: 2;
  manifest: CustomInteractiveVisualizerManifest;
  assumptions: string[];
  limitations: string[];
  sourceReferences: Array<{
    label: string;
    url?: string;
    gardenSlug?: string;
  }>;
  semanticTests: Array<{ name: string; assertion: string }>;
  assets: [];
  files: {
    "index.html": string;
    "styles.css": string;
    "main.js": string;
  };
}

export interface CompiledCustomInteractiveVisualizerPackage {
  package: CustomInteractiveVisualizerPackage | null;
  manifest: CustomInteractiveVisualizerManifest | null;
  plan: InteractiveVisualizerPlan | null;
  validation: InteractiveVisualizerValidation;
  sourceHash: string;
}

const EXTERNAL_URL = /(?:https?:|wss?:|file:|ftp:|javascript:|data:)/i;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9/_-]{0,299}$/;
const LOCAL_STYLESHEET_LINK =
  /<link\s+rel\s*=\s*["']stylesheet["']\s+href\s*=\s*["']styles\.css["']\s*\/?>/gi;
const ESCAPE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bfetch\s*\(/, message: "main.js cannot call fetch" },
  { pattern: /\bXMLHttpRequest\b/, message: "main.js cannot use XMLHttpRequest" },
  { pattern: /\bWebSocket\b|\bEventSource\b/, message: "main.js cannot open network streams" },
  { pattern: /\b(?:Worker|SharedWorker|ServiceWorker)\b/, message: "main.js cannot create workers" },
  { pattern: /\bWebAssembly\b/, message: "main.js cannot execute WebAssembly" },
  { pattern: /\b(?:eval|Function)\s*\(/, message: "main.js cannot evaluate generated code" },
  { pattern: /\b(?:import\s*\(|importScripts\s*\(|require\s*\()/, message: "main.js cannot load modules" },
  {
    pattern: /\b(?:window|globalThis|self)\s*(?:(?:\?\.|\.)\s*(?:parent|top|opener)\b|\[\s*["'](?:parent|top|opener)["']\s*\])|(?:^|[^.\w$])(?:parent|top|opener)\s*(?:\?\.|\.|\[)/m,
    message: "main.js cannot reach the embedding page",
  },
  { pattern: /\bpostMessage\s*\(/, message: "main.js cannot send arbitrary host messages" },
  { pattern: /\bdocument\s*\.\s*cookie\b/, message: "main.js cannot access cookies" },
  { pattern: /\b(?:localStorage|sessionStorage|indexedDB|cookieStore|caches)\b/, message: "main.js cannot use browser storage" },
  { pattern: /\b(?:window\s*\.\s*)?(?:open|location)\b/, message: "main.js cannot navigate or open windows" },
  { pattern: /\bnavigator\s*\.\s*(?:sendBeacon|geolocation|mediaDevices|clipboard)\b/, message: "main.js cannot access device capabilities" },
  { pattern: /\b(?:Object|Array|Function)\s*\.\s*prototype\b|\b__proto__\b/, message: "main.js cannot modify prototypes" },
  { pattern: /\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/, message: "main.js contains an unbounded loop" },
];

const BASE_STYLE = `
:root{color-scheme:light dark;--viz-bg:#fbfaf7;--viz-panel:#f1f2f4;--viz-control:#efefed;--viz-control-hover:#e5e5e2;--viz-text:#171717;--viz-muted:#70706e;--viz-line:rgba(20,24,22,.14);--viz-accent:#3157c8;--viz-accent-text:#fff;--viz-font:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
html[data-theme="dark"]{--viz-bg:#0f0f10;--viz-panel:#17181d;--viz-control:#242426;--viz-control-hover:#303033;--viz-text:#f4f4f2;--viz-muted:#aaa9a6;--viz-line:rgba(255,255,255,.14);--viz-accent:#4568d8;--viz-accent-text:#fff}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--viz-bg);color:var(--viz-text);font-family:var(--viz-font)}body{padding:clamp(10px,2.4vw,28px)}button,input,select{font:inherit;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--viz-accent);outline-offset:3px}canvas,svg{display:block;max-width:100%}[hidden]{display:none!important}[data-action]{isolation:isolate;line-height:0}[data-action]>svg{display:block;max-width:55%;max-height:55%;margin:auto}#app{width:100%;max-width:920px;margin:0 auto}#app>*{min-width:0}html[data-presentation="inline"],html[data-presentation="inline"] body{background:transparent}html[data-presentation="inline"] body{padding:4px 0 8px}html[data-presentation="inline"] #app{max-width:none}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedStrings(value: unknown, maximum = 32): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(
    (entry) => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 500,
  );
}

const VISUAL_INTEGRITY_ASSERTION =
  /\b(?:alignment|attached|clipp(?:ed|ing)|connect(?:ed|ion|ivity)?|continu(?:ity|ous)|endpoint|gap|geometry|joint|layout|legib(?:le|ility)|overlap|visual integrity)\b/i;
const LITERAL_CSS_COLOR =
  /#[\da-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\b(?:black|white)\b/i;

function validateThemeColorDeclarations(css: string, errors: string[]): void {
  const declarations = css.matchAll(
    /(?:^|[;{])\s*(color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?-color|outline-color|accent-color|fill|stroke)\s*:\s*([^;}]+)/gim,
  );
  for (const [, property, value] of declarations) {
    if (LITERAL_CSS_COLOR.test(value) && !/var\(\s*--viz-/i.test(value)) {
      errors.push(
        `styles.css ${property} must use a --viz-* host token instead of a fixed light/dark color`,
      );
    }
  }
}

function actionButton(
  html: string,
  action: "play-pause" | "reset",
): { attributes: string; content: string } | null {
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    if (
      new RegExp(`\\bdata-action\\s*=\\s*["']${action}["']`, "i").test(
        match[1],
      )
    ) {
      return { attributes: match[1], content: match[2] };
    }
  }
  return null;
}

function validateTransportButton(
  html: string,
  action: "play-pause" | "reset",
  errors: string[],
): void {
  const button = actionButton(html, action);
  if (!button) return;
  if (!/\baria-label\s*=\s*["'][^"']+["']/i.test(button.attributes)) {
    errors.push(`${action} control requires an accessible aria-label`);
  }
  const icons = [...button.content.matchAll(/<svg\b([^>]*)>/gi)];
  if (icons.length === 0) {
    errors.push(`${action} control must use a small inline SVG icon, not text glyphs`);
  }
  if (icons.length > 1 && !icons.some((icon) => /\bhidden\b/i.test(icon[1]))) {
    errors.push(`${action} control may expose only one state icon at a time`);
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseJavaScript(source: string, errors: string[]): number {
  const file = ts.createSourceFile(
    "main.js",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const diagnostics = (
    file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics ?? [];
  for (const diagnostic of diagnostics) {
    errors.push(
      `main.js syntax error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    );
  }
  let count = 0;
  const visit = (node: ts.Node) => {
    count += 1;
    if (count <= 12_000) ts.forEachChild(node, visit);
  };
  visit(file);
  if (count > 12_000) errors.push("main.js is too structurally complex");
  return count;
}

function validateManifest(
  raw: unknown,
  plan: InteractiveVisualizerPlan,
  errors: string[],
): CustomInteractiveVisualizerManifest | null {
  if (!isRecord(raw)) {
    errors.push("manifest must be an object");
    return null;
  }
  if (raw.schemaVersion !== 2) errors.push("manifest.schemaVersion must be 2");
  if (raw.artifactType !== "interactive-visualizer") {
    errors.push("manifest.artifactType must be interactive-visualizer");
  }
  for (const field of ["title", "description", "accessibilityDescription"] as const) {
    if (typeof raw[field] !== "string" || !raw[field].trim() || raw[field].length > 2_000) {
      errors.push(`manifest.${field} is required and must be bounded`);
    }
  }
  if (!["2d", "3d", "hybrid"].includes(String(raw.mode))) {
    errors.push("manifest.mode must be 2d, 3d, or hybrid");
  } else if (raw.mode !== plan.mode) {
    errors.push("manifest.mode must match the plan");
  }
  if (raw.entry !== "index.html") errors.push("manifest.entry must be index.html");
  if (!isRecord(raw.runtime)) {
    errors.push("manifest.runtime is required");
  } else {
    if (raw.runtime.id !== "breadboard-interactive-visualizer") {
      errors.push("manifest.runtime.id is invalid");
    }
    if (raw.runtime.version !== CUSTOM_INTERACTIVE_VISUALIZER_RUNTIME_VERSION) {
      errors.push(`manifest.runtime.version must be ${CUSTOM_INTERACTIVE_VISUALIZER_RUNTIME_VERSION}`);
    }
    if (
      (raw.mode === "3d" || raw.mode === "hybrid") &&
      raw.runtime.threeVersion !== INTERACTIVE_VISUALIZER_THREE_VERSION
    ) {
      errors.push(`3d and hybrid visualizers must pin Three.js ${INTERACTIVE_VISUALIZER_THREE_VERSION}`);
    }
    if (raw.mode === "2d" && raw.runtime.threeVersion !== undefined) {
      errors.push("2d visualizers must not request Three.js");
    }
  }
  if (EXTERNAL_URL.test(JSON.stringify(raw))) errors.push("manifest contains an external URL");
  return errors.length === 0 ? raw as unknown as CustomInteractiveVisualizerManifest : null;
}

export function isCustomInteractiveVisualizerPackage(value: unknown): boolean {
  return isRecord(value) && value.schemaVersion === CUSTOM_INTERACTIVE_VISUALIZER_SCHEMA_VERSION;
}

export function compileCustomInteractiveVisualizerPackage(
  plan: InteractiveVisualizerPlan,
  raw: unknown,
): CompiledCustomInteractiveVisualizerPackage {
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidate = isRecord(raw) ? raw : {};
  if (candidate.schemaVersion !== 2) errors.push("package.schemaVersion must be 2");
  const manifest = validateManifest(candidate.manifest, plan, errors);
  if (!boundedStrings(candidate.assumptions)) errors.push("package.assumptions must be a bounded string array");
  if (!boundedStrings(candidate.limitations)) errors.push("package.limitations must be a bounded string array");
  if (!Array.isArray(candidate.assets) || candidate.assets.length !== 0) {
    errors.push("package.assets must be empty");
  }
  if (!Array.isArray(candidate.sourceReferences) || candidate.sourceReferences.length > 32) {
    errors.push("package.sourceReferences must be a bounded array");
  } else {
    candidate.sourceReferences.forEach((reference, index) => {
      if (!isRecord(reference) || typeof reference.label !== "string" || !reference.label.trim()) {
        errors.push(`package.sourceReferences[${index}] is invalid`);
        return;
      }
      if (reference.url !== undefined && (typeof reference.url !== "string" || !/^https:\/\/[^\s]+$/i.test(reference.url))) {
        errors.push(`package.sourceReferences[${index}].url must be HTTPS`);
      }
      if (reference.gardenSlug !== undefined && (typeof reference.gardenSlug !== "string" || !IDENTIFIER.test(reference.gardenSlug))) {
        errors.push(`package.sourceReferences[${index}].gardenSlug is invalid`);
      }
    });
  }
  let hasVisualIntegrityAssertion = false;
  if (!Array.isArray(candidate.semanticTests) || candidate.semanticTests.length === 0 || candidate.semanticTests.length > 24) {
    errors.push("package.semanticTests must contain 1-24 assertions");
  } else {
    candidate.semanticTests.forEach((test, index) => {
      if (!isRecord(test) || typeof test.name !== "string" || !test.name.trim() || typeof test.assertion !== "string" || !test.assertion.trim()) {
        errors.push(`package.semanticTests[${index}] is invalid`);
      } else if (
        VISUAL_INTEGRITY_ASSERTION.test(`${test.name} ${test.assertion}`)
      ) {
        hasVisualIntegrityAssertion = true;
      }
    });
    if (!hasVisualIntegrityAssertion) {
      errors.push(
        "package.semanticTests requires a visual-integrity assertion covering layout, legibility, alignment, or connected geometry",
      );
    }
  }

  const files = isRecord(candidate.files) ? candidate.files : {};
  const expected = ["index.html", "main.js", "styles.css"];
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(expected)) {
    errors.push("package.files must contain exactly index.html, styles.css, and main.js");
  }
  const html = typeof files["index.html"] === "string" ? files["index.html"] : "";
  const css = typeof files["styles.css"] === "string" ? files["styles.css"] : "";
  const script = typeof files["main.js"] === "string" ? files["main.js"] : "";
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map((match) => match[1])
    .join("\n");
  const reviewedCss = `${css}\n${inlineCss}`;
  if (!html) errors.push("index.html is required");
  if (!css) errors.push("styles.css is required");
  if (!script) errors.push("main.js is required");
  if (Buffer.byteLength(html, "utf8") > 32_000) errors.push("index.html exceeds 32000 bytes");
  if (Buffer.byteLength(css, "utf8") > 64_000) errors.push("styles.css exceeds 64000 bytes");
  if (Buffer.byteLength(script, "utf8") > 120_000) errors.push("main.js exceeds 120000 bytes");

  if (EXTERNAL_URL.test(html) || EXTERNAL_URL.test(css) || EXTERNAL_URL.test(script)) {
    errors.push("generated files cannot contain external or executable URLs");
  }
  if (!/<(?:main|div|section)\b[^>]*\bid\s*=\s*["']app["']/i.test(html)) {
    errors.push("index.html requires a semantic #app root");
  }
  if (!/<h1\b/i.test(html)) errors.push("index.html requires one visible h1 title");
  if (!/<(?:canvas|svg)\b/i.test(html)) {
    errors.push("index.html requires a primary canvas or SVG visualization");
  }
  if (!/<script\b[^>]*\bsrc\s*=\s*["']main\.js["'][^>]*>\s*<\/script>/i.test(html)) {
    errors.push('index.html must load <script src="main.js"></script>');
  }
  const htmlWithoutLocalStylesheet = html.replace(LOCAL_STYLESHEET_LINK, "");
  if (/<\s*(?:iframe|object|embed|form|base|link|audio|video)\b/i.test(htmlWithoutLocalStylesheet)) {
    errors.push("index.html contains a forbidden embedded or navigational element");
  }
  if (/\son[a-z]+\s*=/i.test(html)) errors.push("index.html cannot contain inline event handlers");
  if (/<script\b(?![^>]*\bsrc\s*=\s*["']main\.js["'])/i.test(html)) {
    errors.push("index.html cannot contain inline scripts");
  }
  if (/@import\b|\burl\s*\(|\bexpression\s*\(|\bbehavior\s*:/i.test(reviewedCss)) {
    errors.push("styles.css cannot import or load external capabilities");
  }
  if (/\bbox-shadow\s*:/i.test(reviewedCss)) {
    errors.push("styles.css must use Gemini-style flat surfaces, not card shadows");
  }
  if (/\b(?:linear|radial|conic)-gradient\s*\(/i.test(reviewedCss)) {
    errors.push("styles.css must use flat fills, not decorative gradients");
  }
  validateThemeColorDeclarations(reviewedCss, errors);
  for (const entry of ESCAPE_PATTERNS) {
    if (entry.pattern.test(script)) errors.push(entry.message);
  }
  const astNodeCount = script ? parseJavaScript(script, errors) : 0;
  if (/<canvas\b/i.test(html) && !/breadboard:themechange/.test(script)) {
    errors.push(
      "Canvas and WebGL visualizers must repaint on breadboard:themechange",
    );
  }
  if (plan.controls.length > 0 && !/<(?:input|button|select)\b/i.test(html)) {
    errors.push("the planned interactions require visible native controls");
  }
  if (plan.animation?.enabled && !/\brequestAnimationFrame\s*\(/.test(script)) {
    errors.push("animated visualizers must use requestAnimationFrame");
  }
  if (plan.animation?.canPause && !/data-action\s*=\s*["']play-pause["']/i.test(html)) {
    errors.push('pausable visualizers require data-action="play-pause"');
  }
  if (plan.animation?.canReset && !/data-action\s*=\s*["']reset["']/i.test(html)) {
    errors.push('resettable visualizers require data-action="reset"');
  }
  if (plan.animation?.canPause) {
    validateTransportButton(html, "play-pause", errors);
    if (!/aria-pressed/i.test(html + script)) {
      errors.push("play-pause control must expose its current state with aria-pressed");
    }
  }
  if (plan.animation?.canReset) {
    validateTransportButton(html, "reset", errors);
  }
  if (!/prefers-reduced-motion/.test(script + reviewedCss) && plan.animation?.enabled) {
    warnings.push("animated visualizer should explicitly respect prefers-reduced-motion");
  }

  const sourceEnvelope = JSON.stringify(candidate);
  const sourceBytes = Buffer.byteLength(sourceEnvelope, "utf8");
  if (sourceBytes > interactiveVisualizerConfig().maxSourceBytes) {
    errors.push(`source package exceeds ${interactiveVisualizerConfig().maxSourceBytes} bytes`);
  }
  const valid = errors.length === 0 && manifest !== null;
  return {
    package: valid ? candidate as unknown as CustomInteractiveVisualizerPackage : null,
    manifest: valid ? manifest : null,
    plan: valid ? plan : null,
    validation: {
      valid,
      checkedAt: new Date().toISOString(),
      astNodeCount,
      sourceBytes,
      imports: [],
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
    },
    sourceHash: sha256(sourceEnvelope),
  };
}

const bootstrapCache = new Map<InteractiveVisualizerMode, string>();

async function customBootstrap(mode: InteractiveVisualizerMode): Promise<string> {
  const cached = bootstrapCache.get(mode);
  if (cached) return cached;
  const three = mode === "2d" ? "" : `import * as THREE from "three";globalThis.THREE=THREE;`;
  const source = `${three}
const protocol="breadboard:interactive-visualizer:v1";
const params=new URLSearchParams(location.search);const channel=params.get("channel")||"standalone";
const send=(type,payload={})=>parent.postMessage({protocol,type,channel,...payload},"*");
document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
addEventListener("message",event=>{const data=event.data;if(event.source!==parent||!data||data.protocol!==protocol||data.channel!==channel)return;if(data.type==="host-theme"&&(data.theme==="light"||data.theme==="dark")){document.documentElement.dataset.theme=data.theme;dispatchEvent(new CustomEvent("breadboard:themechange",{detail:{theme:data.theme}}))}if(data.type==="host-presentation"&&data.presentation==="inline")document.documentElement.dataset.presentation="inline"});
globalThis.__BREADBOARD_VISUALIZER__={mode:${JSON.stringify(mode)},three:${mode === "2d" ? "false" : "true"},send};`;
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "custom-visualizer-bootstrap.ts", loader: "ts" },
    bundle: true,
    write: false,
    minify: true,
    legalComments: "none",
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    logLevel: "silent",
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error("Could not build the custom visualizer bootstrap.");
  bootstrapCache.set(mode, output);
  return output;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scriptSafe(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

export async function bundleCustomInteractiveVisualizer(
  visualizer: CustomInteractiveVisualizerPackage,
): Promise<{ html: string; hash: string }> {
  const mode = visualizer.manifest.mode;
  const bootstrap = await customBootstrap(mode);
  const sourceHtml = visualizer.files["index.html"];
  const documentHead = sourceHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
  const inlineHeadStyles = [...documentHead.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map((match) => match[1])
    .join("\n");
  const documentBody = sourceHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ??
    sourceHtml;
  const body = documentBody
    .replace(LOCAL_STYLESHEET_LINK, "")
    .replace(
      /<script\b[^>]*\bsrc\s*=\s*["']main\.js["'][^>]*>\s*<\/script>/gi,
      "",
    );
  const generated = visualizer.files["main.js"];
  const needsWebgl = mode !== "2d";
  const runner = `
(function(){
  const html=document.documentElement,app=document.getElementById("app");
  let webgl=true;
  if(${needsWebgl}){try{const probe=document.createElement("canvas");webgl=!!(probe.getContext("webgl2")||probe.getContext("webgl"));}catch{webgl=false}}
  if(!webgl){app.replaceChildren(Object.assign(document.createElement("p"),{className:"viz-fallback",textContent:"3D rendering is unavailable on this device."}));}
  else{try{${scriptSafe(generated)}}catch(error){html.dataset.breadboardRuntimeTests="failed";app.replaceChildren(Object.assign(document.createElement("p"),{className:"viz-fallback",textContent:"This visualization could not start."}));console.error(error)}}
  const inspectOverflow=()=>{
    const viewport=html.clientWidth;
    const overflowing=[...document.body.querySelectorAll("*")].some(node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.right>viewport+2||rect.left<-2||(style.overflowX==="visible"&&node.scrollWidth>node.clientWidth+2)});
    html.dataset.breadboardOverflow=overflowing?"true":"false";
  };
  requestAnimationFrame(()=>{
    const visual=app&&app.querySelector("canvas,svg");
    const focusable=app&&app.querySelector("button,input,select,[tabindex]");
    if(!html.dataset.breadboardRuntimeTests)html.dataset.breadboardRuntimeTests=visual?"passed":"failed";
    html.dataset.breadboardInteractionTests=(visual&&(focusable||${visualizer.manifest.mode !== "2d"}))?"passed":"failed";
    inspectOverflow();setTimeout(inspectOverflow,50);
    if(${visualizer.manifest.mode !== "2d"}&&visual)html.dataset.breadboardWebgl="ready";
    const api=globalThis.__BREADBOARD_VISUALIZER__;api.send("ready",{height:html.scrollHeight});
    new ResizeObserver(()=>{inspectOverflow();api.send("resize",{height:html.scrollHeight})}).observe(document.body);
  });
})();`;
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const html = [
    "<!doctype html>",
    '<html lang="en" data-theme="light">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="color-scheme" content="light dark">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<title>${escapeHtml(visualizer.manifest.title)}</title>`,
    `<style>${BASE_STYLE}\n${visualizer.files["styles.css"]}\n${inlineHeadStyles}</style>`,
    "</head><body>",
    body,
    `<script>${scriptSafe(bootstrap)}</script>`,
    `<script>${scriptSafe(runner)}</script>`,
    "</body></html>",
  ].join("");
  if (Buffer.byteLength(html, "utf8") > interactiveVisualizerConfig().maxArtifactBytes) {
    throw new Error("The compiled custom visualizer exceeds the artifact size limit.");
  }
  return { html, hash: sha256(html) };
}
