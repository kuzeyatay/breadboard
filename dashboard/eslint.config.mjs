import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    // Every compiler/benchmark build uses a .next-prefixed directory. Keeping
    // only the default two names here made whole-dashboard lint traverse stale
    // webpack/turbopack output and retain several gigabytes of generated code.
    ".next*/**",
    // Mutable application state, QA output, managed checkouts, and browser
    // profiles live beside the dashboard in development. None is dashboard
    // source, and browser bundles in particular make an unscoped lint retain
    // gigabytes of generated JavaScript.
    ".runtime/**",
    ".vercel/**",
    ".claude/**",
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
    // Compiled capture helper, speech environment and model cache, demonstration
    // recordings, and each learned workflow's compiled form. Created on demand.
    "runtime/**",
    "openwork-state/**",
    "openwork-workspace/**",
    "postiz/**",
    "public/genoffice-editor/**",
    "test-results/**",
    "undefined/**",
    "video-use/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Byte-identical upstream source; validated by the GenOffice drift test.
    "src/vendor/genoffice/**",
  ]),
]);

export default eslintConfig;
