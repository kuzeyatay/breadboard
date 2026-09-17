import path from "node:path";
import { existsSync } from "node:fs";

export const PRAXIST_CONTAINER_IMAGE = "breadboard-praxist:local";

export function praxistDockerCommand(): { command: string; args: string[] } {
  const installed = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe");
  return {
    command: process.platform === "win32" && existsSync(installed) ? installed : "docker",
    args: process.platform === "win32" ? ["--host","npipe:////./pipe/dockerDesktopLinuxEngine"] : [],
  };
}
