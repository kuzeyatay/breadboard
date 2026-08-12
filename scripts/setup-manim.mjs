import { spawnSync } from "node:child_process";

const image = process.env.MANIM_DOCKER_IMAGE?.trim() || "manimcommunity/manim:v0.20.1";
const docker = process.env.MANIM_DOCKER_BIN?.trim() || "docker";
const checkOnly = process.argv.includes("--check");

function run(args, options = {}) {
  return spawnSync(docker, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

const server = run(["version", "--format", "{{.Server.Version}}"]);
if (server.status !== 0) {
  console.error("Docker is not available. Install or start Docker Desktop, then retry.");
  process.exit(1);
}

let inspect = run(["image", "inspect", image]);
if (inspect.status !== 0 && checkOnly) {
  console.error(`The pinned Manim image is not installed: ${image}`);
  process.exit(1);
}
if (inspect.status !== 0) {
  console.log(`Pulling ${image}…`);
  const pull = run(["pull", image], { stdio: "inherit", encoding: undefined });
  if (pull.status !== 0) process.exit(pull.status ?? 1);
  inspect = run(["image", "inspect", image]);
}
if (inspect.status !== 0) {
  console.error(`Docker could not inspect ${image} after setup.`);
  process.exit(1);
}

const version = run(["run", "--rm", "--network", "none", image, "manim", "--version"]);
if (version.status !== 0) {
  console.error(version.stderr || "The Manim image did not start.");
  process.exit(version.status ?? 1);
}
console.log((version.stdout || "Manim is ready.").trim());
