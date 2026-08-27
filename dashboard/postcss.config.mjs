import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const dashboardNodeModules = path.join(dashboardRoot, "node_modules");

// Tailwind resolves CSS package imports from PostCSS's `from` directory,
// which Turbopack can report at the surrounding repository root. Its Node
// resolver explicitly accepts one additional absolute module root through
// NODE_PATH. Pin that root before Next lazily loads @tailwindcss/postcss.
// This is separate from `base`, which controls candidate scanning.
process.env.NODE_PATH = dashboardNodeModules;

const config = {
  plugins: {
    // Keep candidate discovery inside the dashboard even when the compiler
    // worker itself has the surrounding repository as its working directory.
    "@tailwindcss/postcss": { base: dashboardRoot },
  },
};

export default config;
