import type { NextConfig } from "next";
import path from "node:path";

// Mutable data, local secrets, and build state must never be traced into a
// (standalone) build: the desktop package would otherwise ship a snapshot of
// the developer's database and env files as read-only program resources.
const dataTraceExcludes = [
  "db/**",
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
  devIndicators: false,
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingExcludes: {
    // Never trace mutable data or local secrets into a (standalone) build:
    // the desktop package would otherwise ship a snapshot of the developer's
    // database and env files as read-only program resources.
    '/*': dataTraceExcludes,
    '/**': dataTraceExcludes,
    '/api/markdown-images': [
      '.claudeignore',
      '.env.local',
      '.gitignore',
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'db/**',
      'eslint.config.mjs',
      'next.config.ts',
      'package-lock.json',
      'package.json',
      'postcss.config.mjs',
      'public/**',
      'src/**',
      'tsconfig.json',
      'tsconfig.tsbuildinfo',
    ],
  },
  outputFileTracingIncludes: {
    '/api/ingest': [
      'node_modules/@napi-rs/canvas/**/*',
      'node_modules/@napi-rs/canvas-win32-x64-msvc/**/*',
    ],
  },
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
    resolveAlias: {
      'pdf-parse': 'pdf-parse/dist/pdf-parse/cjs/index.cjs',
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'pdf-parse': 'pdf-parse/dist/pdf-parse/cjs/index.cjs',
    };
    return config;
  },
};

export default nextConfig;
