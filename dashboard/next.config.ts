import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingExcludes: {
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
  turbopack: {
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
