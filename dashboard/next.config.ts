import type { NextConfig } from "next";
import path from "node:path";

// Mutable data, local secrets, and build state must never be traced into a
// (standalone) build: the desktop package would otherwise ship a snapshot of
// the developer's database and env files as read-only program resources.
// Routes that only touch the garden content folder must not drag the project
// tree into the standalone trace.
const gardenAssetRouteExcludes = [
  '.claudeignore',
  '.env.local',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'db/**',
  'database/**',
  'eslint.config.mjs',
  'next.config.ts',
  'package-lock.json',
  'package.json',
  'postcss.config.mjs',
  'public/**',
  'src/**',
  'tsconfig.json',
  'tsconfig.tsbuildinfo',
];

const dataTraceExcludes = [
  "db/**",
  "database/**",
  "artifacts/**",
  ".env*",
  ".vercel/**",
  // Stale build dirs only — the active desktop distDir (.next-desktop) must
  // stay traceable or the standalone server loses its own chunks.
  ".next/**",
  ".next-dev/**",
  ".next-production/**",
  ".next-production-final/**",
  "tests/**",
  "test-results/**",
  "neumorphic-before/**",
  "neumorphic-after/**",
  "../quartz/content/**",
  "../quartz/public/**",
  "../quartz/.quartz-cache/**",
  "../.runtime/**",
  "../.agents/**",
];

const nextConfig: NextConfig = {
  // Desktop packaging builds a self-contained server (node server.js) that the
  // Electron supervisor runs with a bundled Node runtime. Opt-in via env so
  // normal `next build`/`next start` development flows are unchanged.
  ...(process.env.BREADBOARD_DESKTOP_BUILD === "1" ? { output: "standalone" as const } : {}),
  // Allows CI/local validation to build beside a running Windows dev server,
  // whose OneDrive-backed `.next` tree may contain locked reparse points.
  distDir: process.env.BREADBOARD_NEXT_DIST_DIR?.trim() || ".next",
  ...(process.env.BREADBOARD_DESKTOP_BUILD === "1"
    ? { typescript: { tsconfigPath: "tsconfig.desktop.json" } }
    : {}),
  devIndicators: false,
  experimental: {
    // Next documents this as a low-risk reduction in webpack's peak memory.
    // webpackBuildWorker is intentionally omitted: this repository has a
    // custom webpack function, which is the incompatible case Next calls out.
    webpackMemoryOptimizations: true,
    // Do not eagerly retain every route graph in the long-running hot server.
    preloadEntriesOnStart: false,
  },
  // PDFKit reads its built-in AFM fonts and ICC profile relative to its own
  // package directory at runtime. Keep it external so Next does not relocate
  // the code into a server chunk while leaving those assets in node_modules.
  // @firecrawl/anydoc loads a platform-specific .node binary through its own
  // index.js, which the bundler cannot follow — keep it external so the require
  // happens at runtime against node_modules.
  // mem0ai's OSS bundle statically imports better-sqlite3 and bare-requires a
  // handful of optional NLP packages inside try/catch. Keeping it external
  // leaves those requires to run against node_modules at runtime, where the
  // catch can do its job, instead of failing the bundler's static resolution.
  serverExternalPackages: [
    '@embedpdf/pdfium',
    '@firecrawl/anydoc',
    'better-sqlite3',
    'esbuild',
    'mem0ai',
    'pdf-parse',
    'pdfkit',
    'three',
  ],
  outputFileTracingExcludes: {
    // Never trace mutable data or local secrets into a (standalone) build:
    // the desktop package would otherwise ship a snapshot of the developer's
    // database and env files as read-only program resources.
    '/*': dataTraceExcludes,
    '/**': dataTraceExcludes,
    '/api/markdown-images': gardenAssetRouteExcludes,
    '/api/markdown-videos': gardenAssetRouteExcludes,
  },
  outputFileTracingIncludes: {
    '/*': [
      'node_modules/@embedpdf/pdfium/**/*',
      'node_modules/esbuild/**/*',
      'node_modules/@esbuild/win32-x64/**/*',
      'node_modules/three/**/*',
    ],
    '/api/ingest': [
      'node_modules/@napi-rs/canvas/**/*',
      'node_modules/@napi-rs/canvas-win32-x64-msvc/**/*',
      'node_modules/@firecrawl/anydoc/**/*',
      'node_modules/@firecrawl/anydoc-win32-x64-msvc/**/*',
    ],
    '/api/anydoc/status': [
      'node_modules/@firecrawl/anydoc/**/*',
      'node_modules/@firecrawl/anydoc-win32-x64-msvc/**/*',
    ],
  },
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
    resolveAlias: {
      // Turbopack does not implement Windows absolute-path imports. Aliases are
      // resolved from the Next project directory, so keep local targets
      // project-relative and reserve absolute paths for webpack below.
      'breadboard-learn-status-runtime': process.env.NODE_ENV === 'production'
        ? './src/lib/learn-status-runtime.production.ts'
        : './src/lib/learn-status-runtime.dev.ts',
      'breadboard-learn-operation-runtime': process.env.NODE_ENV === 'production'
        ? './src/lib/learn-operation-runtime.production.ts'
        : './src/lib/learn-operation-runtime.dev.ts',
      '@genoffice/docx-engine': './src/vendor/genoffice/docx-engine/src/index.ts',
      '@genoffice/font-metrics': './src/vendor/genoffice/font-metrics/src/index.ts',
      '@genoffice/i18n': './src/vendor/genoffice/i18n/src/index.ts',
      '@genoffice/pdf2docx': './src/vendor/genoffice/pdf2docx/src/index.ts',
      '@genoffice/pptx-engine/background-promote': './src/vendor/genoffice/pptx-engine/src/background-promote.ts',
      '@genoffice/pptx-engine/identity': './src/vendor/genoffice/pptx-engine/src/identity.ts',
      '@genoffice/pptx-engine/table-grid': './src/vendor/genoffice/pptx-engine/src/table-grid.ts',
      '@genoffice/pptx-engine': './src/vendor/genoffice/pptx-engine/src/index.ts',
      '@genoffice/pptx-render/preset-geometry': './src/vendor/genoffice/pptx-render/src/preset-geometry.ts',
      '@genoffice/pptx-render': './src/vendor/genoffice/pptx-render/src/index.ts',
      '@genoffice/ui': './src/vendor/genoffice/ui/src/index.ts',
      'pdf-parse': 'pdf-parse/dist/pdf-parse/cjs/index.cjs',
    },
  },
  webpack: (config, { dev, isServer, nextRuntime }) => {
    // Next's webpack filesystem cache does not consistently include tsconfig's
    // path mappings in its build dependencies. A removed mapping can otherwise
    // keep resolving to its old file across a full `next dev` restart. Treat the
    // resolver configuration as a cache input so runtime aliases cannot revive
    // a stale, fail-closed implementation.
    if (
      config.cache &&
      typeof config.cache === 'object' &&
      config.cache.type === 'filesystem'
    ) {
      const buildDependencies = config.cache.buildDependencies ?? {};
      config.cache.buildDependencies = {
        ...buildDependencies,
        config: Array.from(
          new Set([
            ...(buildDependencies.config ?? []),
            path.resolve(process.cwd(), 'tsconfig.json'),
          ]),
        ),
      };
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      'breadboard-learn-status-runtime$': path.resolve(
        process.cwd(),
        'src/lib',
        dev ? 'learn-status-runtime.dev.ts' : 'learn-status-runtime.production.ts',
      ),
      'breadboard-learn-operation-runtime$': path.resolve(
        process.cwd(),
        'src/lib',
        dev ? 'learn-operation-runtime.dev.ts' : 'learn-operation-runtime.production.ts',
      ),
      '@genoffice/docx-engine': path.resolve(process.cwd(), 'src/vendor/genoffice/docx-engine/src/index.ts'),
      '@genoffice/font-metrics': path.resolve(process.cwd(), 'src/vendor/genoffice/font-metrics/src/index.ts'),
      '@genoffice/i18n': path.resolve(process.cwd(), 'src/vendor/genoffice/i18n/src/index.ts'),
      '@genoffice/pdf2docx': path.resolve(process.cwd(), 'src/vendor/genoffice/pdf2docx/src/index.ts'),
      '@genoffice/pptx-engine/background-promote': path.resolve(process.cwd(), 'src/vendor/genoffice/pptx-engine/src/background-promote.ts'),
      '@genoffice/pptx-engine/identity': path.resolve(process.cwd(), 'src/vendor/genoffice/pptx-engine/src/identity.ts'),
      '@genoffice/pptx-engine/table-grid': path.resolve(process.cwd(), 'src/vendor/genoffice/pptx-engine/src/table-grid.ts'),
      '@genoffice/pptx-engine': path.resolve(process.cwd(), 'src/vendor/genoffice/pptx-engine/src/index.ts'),
      '@genoffice/pptx-render/preset-geometry': path.resolve(process.cwd(), 'src/vendor/genoffice/pptx-render/src/preset-geometry.ts'),
      '@genoffice/pptx-render': path.resolve(process.cwd(), 'src/vendor/genoffice/pptx-render/src/index.ts'),
      '@genoffice/ui': path.resolve(process.cwd(), 'src/vendor/genoffice/ui/src/index.ts'),
      'pdf-parse': 'pdf-parse/dist/pdf-parse/cjs/index.cjs',
    };
    // `serverExternalPackages` is not sufficient on its own for the packages
    // below. `pdf-parse` is aliased to its Node CJS entry so server routes do
    // not select the browser export; without an explicit external, webpack
    // follows that alias and tries to parse pdf.js's WASM binary as JavaScript.
    //
    // mem0ai has a separate junction-related resolution problem:
    // mem0ai is a `file:` dependency, so node_modules/mem0ai is a junction and
    // the resolver follows it to <repo>/mem0/mem0-ts — a path with no
    // node_modules segment, which is exactly what that check looks for. When it
    // misses, the whole OSS bundle is compiled inline and the ~20 optional
    // provider SDKs it bare-imports (oracledb, redis, weaviate-client, the AWS
    // and Google and Azure clients, …) fail to resolve. That is not a warning:
    // it fails the compilation that instrumentation.ts belongs to, so the server
    // listens but answers /api/health with a 500 and the desktop supervisor
    // times out on "Breadboard workspace could not start".
    //
    // Matching on the request rather than the resolved path makes it
    // unconditional. Server compilers only — the browser never imports mem0.
    if (isServer && nextRuntime !== 'edge') {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);
      config.externals = [
        (
          { request }: { request?: string },
          callback: (error?: unknown, result?: string) => void,
        ) =>
          request === 'pdf-parse' ||
          request === 'mem0ai' ||
          request?.startsWith('mem0ai/')
            ? callback(undefined, `commonjs ${request}`)
            : callback(),
        ...existing,
      ];
    }
    return config;
  },
};

export default nextConfig;
