// This import graph belongs exclusively to the admitted disposable worker.
import { compileGardenVisualization } from "./generated-visual-compiler.ts";
import { runGeneratedVisualBrowserTestsLocally } from "./generated-visual-browser-tests.ts";
import { installLearnVisualizationRunners } from "./learn-visualization-runners.ts";

export function installLearnVisualizationWorker(): void {
  installLearnVisualizationRunners({
    compilerRunner: compileGardenVisualization,
    browserTestRunner: runGeneratedVisualBrowserTestsLocally,
  });
}
