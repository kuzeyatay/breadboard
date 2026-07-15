export type LearnBuildStateMode = "legacy" | "shadow" | "canonical";

export function learnBuildStateMode(env: NodeJS.ProcessEnv = process.env): LearnBuildStateMode {
  const value = String(env.LEARN_BUILD_STATE_MODE ?? "legacy").trim().toLowerCase();
  return value === "shadow" || value === "canonical" ? value : "legacy";
}
