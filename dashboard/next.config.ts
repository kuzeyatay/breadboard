import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopBuild = process.env.BREADBOARD_DESKTOP_BUILD === "1";
// Next may evaluate this config after its CLI has moved process.cwd() to the
// surrounding workspace. Derive the project boundary from the config itself;
// otherwise Turbopack and PostCSS resolve dashboard packages from the repo
// root and a failed import can retain an ever-growing compiler graph.
const bundlerRoot = path.dirname(fileURLToPath(import.meta.url));

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
  // Top-level project metadata, local state, and ad-hoc operator files are not
  // standalone program inputs. Keep package.json: Node uses it for module
  // resolution in the generated standalone tree.
  ".claudeignore",
  ".gitignore",
  ".env*",
  "*.md",
  "*.log",
  ".tmp-*",
  "tmp-*",
  "*.db",
  "*.db-shm",
  "*.db-wal",
  "*.sqlite",
  "*.sqlite-shm",
  "*.sqlite-wal",
  "*.sqlite3",
  "*.sqlite3-shm",
  "*.sqlite3-wal",
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
  "*.mp4",
  "*.mov",
  "*.mkv",
  "*.webm",
  "*.avi",
  "*.mp3",
  "*.wav",
  "*.m4a",
  "*.ogg",
  "*.flac",
  "*.lock",
  "*.tsbuildinfo",
  "package-lock.json",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig*",

  // Mutable/runtime-owned and build-only trees. Runtime routes reach these
  // through the opaque filesystem boundary and the desktop supervisor stages
  // any reviewed program dependency separately.
  ".claude/**",
  ".runtime/**",
  ".vercel/**",
  "artifacts/**",
  "cad-projects/**",
  "chat-documents/**",
  "chat-videos/**",
  "database/**",
  "db/**",
  "goal-mode/**",
  "hyperframes-cli/**",
  "hyperframes-runs/**",
  "loopx-goals/**",
  "openscience-cli/**",
  "openscience-state/**",
  "openscience-workspace/**",
  "openwork-runtime/**",
  "runtime-v2/**",
  "openwork-state/**",
  "openwork-workspace/**",
  "postiz/**",
  "video-use/**",
  "undefined/**",
  "tests/**",
  "test-results/**",
  "neumorphic-before/**",
  "neumorphic-after/**",
  "scripts/**",

  // Stale build dirs only. Do not replace these with `.next*/**`: the active
  // desktop distDir (.next-desktop) must remain traceable for server chunks.
  ".next/**",
  ".next-dev/**",
  ".next-memory-*/**",
  ".next-production*/**",
  ".next-stale-*/**",

  // These packages belong only to disposable compiler/renderer workers and
  // are staged from reviewed closures after Next completes its trace.
  "**/node_modules/@embedpdf/pdfium",
  "**/node_modules/@embedpdf/pdfium/**",
  "**/node_modules/@esbuild",
  "**/node_modules/@esbuild/**",
  "**/node_modules/esbuild",
  "**/node_modules/esbuild/**",
  "**/node_modules/three",
  "**/node_modules/three/**",
  "**/node_modules/typescript",
  "**/node_modules/typescript/**",
];

const nextConfig: NextConfig = {
  // Desktop packaging builds a self-contained server (node server.js) that the
  // Electron supervisor runs with a bundled Node runtime. Opt-in via env so
  // normal `next build`/`next start` development flows are unchanged.
  ...(desktopBuild ? { output: "standalone" as const } : {}),
  // Allows CI/local validation to build beside a running Windows dev server,
  // whose OneDrive-backed `.next` tree may contain locked reparse points.
  distDir: process.env.BREADBOARD_NEXT_DIST_DIR?.trim() || ".next",
  ...(desktopBuild
    ? { typescript: { tsconfigPath: "tsconfig.desktop.json" } }
    : {}),
  devIndicators: false,
  // Webpack can retire inactive entries; keeping only the immediately active
  // route prevents a long desktop browsing session from retaining the whole
  // application graph. This is deliberately short because the dashboard is a
  // single-window application, not a many-tab web development workspace.
  onDemandEntries: {
    maxInactiveAge: 30_000,
    pagesBufferLength: 1,
  },
  experimental: {
    // Next documents this as a low-risk reduction in webpack's peak memory.
    // The custom webpack hook below is deterministic and is reloaded inside
    // every worker, so each server/edge/client compiler can exit and return its
    // graph before the next compiler starts.
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
    // Do not eagerly retain every route graph in the long-running hot server.
    preloadEntriesOnStart: false,
    // Next 16 enables Turbopack's persistent development cache by default.
    // Breadboard Hot is supervised and uses Webpack, but keep direct `next
    // dev` fallback runs from memory-mapping/restoring multi-hundred-MB SST
    // compiler snapshots from an earlier session.
    turbopackFileSystemCacheForDev: false,
  },
  // PDFKit reads its built-in AFM fonts and ICC profile relative to its own
  // package directory at runtime. Keep it external so Next does not relocate
  // the code into a server chunk while leaving those assets in node_modules.
  // @firecrawl/anydoc loads a platform-specific .node binary through its own
  // index.js, which the bundler cannot follow — keep it external so the require
  // happens at runtime against node_modules.
  serverExternalPackages: [
    '@firecrawl/anydoc',
    'better-sqlite3',
    'pdf-parse',
    'pdfkit',
    'shazamio-core',
  ],
  outputFileTracingExcludes: {
    // Never trace mutable data or local secrets into a (standalone) build:
    // the desktop package would otherwise ship a snapshot of the developer's
    // database and env files as read-only program resources.
    '/*': dataTraceExcludes,
    '/**': dataTraceExcludes,
    'next-server': dataTraceExcludes,
    '/api/markdown-images': gardenAssetRouteExcludes,
    '/api/markdown-videos': gardenAssetRouteExcludes,
  },
  outputFileTracingIncludes: {
    '/api/anydoc/status': [
      'node_modules/@firecrawl/anydoc/**/*',
      'node_modules/@firecrawl/anydoc-win32-x64-msvc/**/*',
    ],
    '/api/pdfjs/\\[\\.\\.\\.path\\]': [
      'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      'node_modules/pdfjs-dist/legacy/build/pdf.mjs.map',
      'node_modules/pdfjs-dist/legacy/build/pdf.sandbox.mjs',
      'node_modules/pdfjs-dist/legacy/build/pdf.sandbox.mjs.map',
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs.map',
      'node_modules/pdfjs-dist/legacy/web/pdf_viewer.css',
      'node_modules/pdfjs-dist/legacy/web/pdf_viewer.mjs',
      'node_modules/pdfjs-dist/legacy/web/pdf_viewer.mjs.map',
      'node_modules/pdfjs-dist/legacy/web/images/**/*',
    ],
    '/api/music-recognition/recognize': [
      'node_modules/shazamio-core/**/*',
    ],
    '/api/hermes/tools/music-recognition': [
      'node_modules/shazamio-core/**/*',
    ],
  },
  outputFileTracingRoot: bundlerRoot,
  turbopack: {
    // Next 16 requires the standalone tracing root and Turbopack root to be
    // identical. Keep both at the dashboard boundary: static shared assets are
    // provisioned beside the installed app and all mutable/service-owned paths
    // cross the opaque runtime filesystem boundary instead of entering either
    // the Rust graph or the deployment trace.
    root: bundlerRoot,
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
    if (isServer && nextRuntime !== 'edge') {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);
      config.externals = [
        (
          { request }: { request?: string },
          callback: (error?: unknown, result?: string) => void,
        ) =>
          request === 'pdf-parse'
            ? callback(undefined, `commonjs ${request}`)
            : callback(),
        ...existing,
      ];
    }
    return config;
  },
};

export default nextConfig;
