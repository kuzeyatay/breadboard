export const GBRAIN_NODE_EXECUTABLE = "runtimes/node/node.exe";

export const GBRAIN_NODE_ARGUMENTS = Object.freeze([
  Object.freeze({ kind: "literal", value: "--no-warnings" }),
  Object.freeze({ kind: "literal", value: "--experimental-transform-types" }),
  Object.freeze({ kind: "app-path", path: "gbrain-adapter/src/node-entrypoint.mjs" }),
]);

export const GBRAIN_NODE_INSTALL_PROBE_FILES = Object.freeze([
  Object.freeze({ authority: "runtime-root", path: "runtimes/node/node.exe" }),
  Object.freeze({ authority: "app-root", path: "gbrain-adapter/src/node-entrypoint.mjs" }),
  Object.freeze({ authority: "app-root", path: "gbrain-adapter/src/node-loader.mjs" }),
  Object.freeze({ authority: "app-root", path: "gbrain-adapter/src/node-server.ts" }),
  Object.freeze({ authority: "app-root", path: "gbrain-adapter/src/request-handler.ts" }),
  Object.freeze({ authority: "app-root", path: "gbrain/src/core/engine-factory.ts" }),
  Object.freeze({
    authority: "app-root",
    path: "gbrain-adapter/node_modules/@electric-sql/pglite/package.json",
  }),
  Object.freeze({
    authority: "app-root",
    path: "gbrain/node_modules/@electric-sql/pglite/package.json",
  }),
  Object.freeze({ authority: "app-root", path: "gbrain/node_modules/js-yaml/package.json" }),
  Object.freeze({
    authority: "app-root",
    path: "gbrain/node_modules/@dqbd/tiktoken/package.json",
  }),
  Object.freeze({
    authority: "app-root",
    path: "gbrain/node_modules/web-tree-sitter/package.json",
  }),
  Object.freeze({ authority: "app-root", path: "gbrain/runtime-artifact.json" }),
]);

const EXACT_MODES = Object.freeze(["lean", "hot", "packaged"]);
const EXACT_WORKING_DIRECTORY = Object.freeze({
  kind: "app-subdirectory",
  path: "gbrain-adapter",
});

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateGbrainNodeLaunch(services) {
  const failures = [];
  const gbrainServices = Array.isArray(services)
    ? services.filter((service) => service?.id === "gbrain")
    : [];
  if (gbrainServices.length !== 1) {
    failures.push(`GBrain Node launch requires exactly one gbrain service; found ${gbrainServices.length}`);
    return failures;
  }

  const service = gbrainServices[0];
  const profiles = Array.isArray(service.launchProfiles) ? service.launchProfiles : [];
  if (profiles.length !== 1) {
    failures.push(`GBrain Node launch requires exactly one launch profile; found ${profiles.length}`);
    return failures;
  }

  const profile = profiles[0];
  if (!sameJson(profile.modes, EXACT_MODES)) {
    failures.push("GBrain Node launch profile must cover lean, hot, and packaged modes exactly once");
  }
  if (
    profile.executableAuthority !== "runtime-root" ||
    profile.allowedExecutable !== GBRAIN_NODE_EXECUTABLE
  ) {
    failures.push("GBrain launch must use the pinned bundled Node executable");
  }

  const argumentsList = Array.isArray(profile.arguments) ? profile.arguments : [];
  if (argumentsList.some((argument) =>
    argument?.kind === "literal" &&
    /^--(?:experimental-)?loader(?:=|$)/u.test(argument.value ?? "")
  )) {
    failures.push(
      "GBrain Node launch must register its loader through node-entrypoint.mjs; raw loader arguments are forbidden",
    );
  }
  if (!sameJson(argumentsList, GBRAIN_NODE_ARGUMENTS)) {
    failures.push("GBrain launch arguments must match the reviewed Node entrypoint contract exactly");
  }
  if (profile.environmentSource !== "gbrain") {
    failures.push("GBrain Node launch must use the trusted gbrain environment source");
  }
  if (!sameJson(profile.workingDirectory, EXACT_WORKING_DIRECTORY)) {
    failures.push("GBrain Node launch must use the gbrain-adapter working directory");
  }
  if (
    profile.installProbe?.kind !== "files-present" ||
    !sameJson(profile.installProbe?.files, GBRAIN_NODE_INSTALL_PROBE_FILES)
  ) {
    failures.push("GBrain Node install probe must match the reviewed offline runtime closure exactly");
  }
  if (service.readiness?.path !== "/ready") {
    failures.push("GBrain readiness must fail closed through /ready");
  }
  if (service.readiness?.expectedBodyContains !== '"backend":"gbrain"') {
    failures.push("GBrain readiness must prove the real gbrain backend");
  }

  return failures;
}
