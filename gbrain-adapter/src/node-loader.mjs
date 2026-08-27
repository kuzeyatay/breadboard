import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const JS_YAML_SHIM_URL = "breadboard-gbrain-node:js-yaml";
const MARKDOWN_MODULE_URL = new URL(
  "../../gbrain/src/core/markdown.ts",
  import.meta.url,
).href;
const WASM_ASSET_ROOT = fs.realpathSync(
  fileURLToPath(new URL("../../gbrain/src/assets/wasm/", import.meta.url)),
);

// These are the only vendored modules in the adapter's dependency graph that
// deliberately use Bun's ESM `require()` compatibility. Node gets a
// module-relative createRequire only for these exact files; arbitrary source is
// never rewritten.
const REQUIRE_COMPAT_MODULE_URLS = new Set(
  [
    "../../gbrain/src/core/chunkers/code.ts",
    "../../gbrain/src/core/content-sanity-literals.ts",
    "../../gbrain/src/core/contextual-retrieval-service.ts",
    "../../gbrain/src/core/model-config.ts",
    "../../gbrain/src/core/pglite-engine.ts",
    "../../gbrain/src/core/search/embedding-column.ts",
  ].map((relativePath) => new URL(relativePath, import.meta.url).href),
);

const REQUIRE_PRELUDE_MARKER = "__breadboardGbrainCreateRequire";

function sourceText(source) {
  if (typeof source === "string") return source;
  if (source == null) return null;
  return Buffer.from(source).toString("utf8");
}

function allowedWasmAsset(url) {
  if (!url.startsWith("file:")) return null;

  let candidate;
  try {
    candidate = fs.realpathSync(fileURLToPath(url));
  } catch {
    return null;
  }

  const relative = path.relative(WASM_ASSET_ROOT, candidate);
  const insideRoot =
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
  if (!insideRoot || path.extname(candidate).toLowerCase() !== ".wasm") {
    return null;
  }

  return candidate;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "js-yaml" && context.parentURL === MARKDOWN_MODULE_URL) {
    return { shortCircuit: true, url: JS_YAML_SHIM_URL };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === JS_YAML_SHIM_URL) {
    return {
      format: "module",
      shortCircuit: true,
      source: [
        'import { createRequire } from "node:module";',
        `const yaml = createRequire(${JSON.stringify(MARKDOWN_MODULE_URL)})("js-yaml");`,
        "export const safeLoad = yaml.safeLoad;",
        "export default yaml;",
      ].join("\n"),
    };
  }

  if (context.importAttributes?.type === "file") {
    const assetPath = allowedWasmAsset(url);
    if (!assetPath) {
      throw new Error(
        "GBrain's Node loader refused a type=file import outside the vendored WASM asset root.",
      );
    }
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(assetPath)};`,
    };
  }

  const loaded = await nextLoad(url, context);
  if (!REQUIRE_COMPAT_MODULE_URLS.has(url)) return loaded;

  const source = sourceText(loaded.source);
  if (source == null || !/\brequire\s*\(/u.test(source)) return loaded;
  if (source.includes(REQUIRE_PRELUDE_MARKER)) {
    // Node may request the same URL again under a second import-attribute
    // identity and return the already-transformed source from its loader cache.
    // The exact marker is therefore an idempotence fence, not a reason to add a
    // second lexical `require` declaration.
    return loaded;
  }

  return {
    ...loaded,
    source:
      `import { createRequire as ${REQUIRE_PRELUDE_MARKER} } from "node:module";\n` +
      `const require = ${REQUIRE_PRELUDE_MARKER}(import.meta.url);\n` +
      source,
  };
}
