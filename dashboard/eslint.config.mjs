import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-desktop/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Byte-identical upstream source; validated by the GenOffice drift test.
    "src/vendor/genoffice/**",
  ]),
]);

export default eslintConfig;
