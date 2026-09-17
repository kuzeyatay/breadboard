import type { CreateGeneratedVisualizationInput } from "./generated-visuals.ts";

type Runners = Pick<
  CreateGeneratedVisualizationInput,
  "compilerRunner" | "browserTestRunner"
>;
let installed: Runners | undefined;

/** Installed only by the admitted, disposable Learn worker. */
export function installLearnVisualizationRunners(runners: Runners): void {
  if (installed)
    throw new Error("Learn visualization runners are already installed.");
  installed = runners;
}

function required(): Runners {
  if (!installed)
    throw new Error(
      "Learn visualization compilation requires its admitted disposable worker.",
    );
  return installed;
}

export const compileLearnGardenVisualization: Runners["compilerRunner"] = (
  ...args
) => required().compilerRunner(...args);
export const testLearnGardenVisualization: Runners["browserTestRunner"] = (
  ...args
) => required().browserTestRunner(...args);
