function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function integerValue(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

export interface InteractiveVisualizerConfig {
  enabled: boolean;
  browserTests: boolean;
  threeEnabled: boolean;
  maxAttempts: number;
  maxSourceBytes: number;
  maxBundleBytes: number;
  maxArtifactBytes: number;
  browserScenarioTimeoutMs: number;
  maxThreeObjects: number;
  maxVertices: number;
}

export function interactiveVisualizerConfig(
  env: NodeJS.ProcessEnv = process.env,
): InteractiveVisualizerConfig {
  return {
    enabled: booleanValue(env.INTERACTIVE_VISUALIZER_ENABLED, true),
    browserTests: booleanValue(env.INTERACTIVE_VISUALIZER_BROWSER_TESTS, true),
    threeEnabled: booleanValue(env.INTERACTIVE_VISUALIZER_THREE_ENABLED, true),
    maxAttempts: integerValue(
      env.INTERACTIVE_VISUALIZER_MAX_ATTEMPTS,
      3,
      1,
      3,
    ),
    maxSourceBytes: integerValue(
      env.INTERACTIVE_VISUALIZER_MAX_SOURCE_BYTES,
      80_000,
      20_000,
      250_000,
    ),
    maxBundleBytes: integerValue(
      env.INTERACTIVE_VISUALIZER_MAX_BUNDLE_BYTES,
      1_000_000,
      200_000,
      2_000_000,
    ),
    maxArtifactBytes: integerValue(
      env.INTERACTIVE_VISUALIZER_MAX_ARTIFACT_BYTES,
      2_000_000,
      500_000,
      10_000_000,
    ),
    browserScenarioTimeoutMs: integerValue(
      env.INTERACTIVE_VISUALIZER_BROWSER_TIMEOUT_MS,
      22_000,
      5_000,
      90_000,
    ),
    maxThreeObjects: integerValue(
      env.INTERACTIVE_VISUALIZER_MAX_THREE_OBJECTS,
      256,
      8,
      2_000,
    ),
    maxVertices: integerValue(
      env.INTERACTIVE_VISUALIZER_MAX_VERTICES,
      100_000,
      10_000,
      500_000,
    ),
  };
}

export function interactiveVisualizerAvailable(
  surface: string,
  authenticated: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const config = interactiveVisualizerConfig(env);
  return config.enabled &&
    config.browserTests &&
    authenticated &&
    (surface === "garden_chat" || surface === "dashboard_terminal");
}

