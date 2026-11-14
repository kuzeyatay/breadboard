// Lets a video import the engine's component library as "@kit" from any job
// or project folder under this runtime.
import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: { ...(config.resolve?.alias ?? {}), "@kit": path.join(process.cwd(), "kit") },
  },
}));
