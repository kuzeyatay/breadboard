import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MANDATORY_RUNTIME_SERVICE_IDS,
  validateMandatoryRuntimeServices,
} from "./mandatory-runtime-services.mjs";
import {
  GBRAIN_NODE_ARGUMENTS,
  GBRAIN_NODE_EXECUTABLE,
  GBRAIN_NODE_INSTALL_PROBE_FILES,
  validateGbrainNodeLaunch,
} from "./gbrain-node-launch-contract.mjs";
import { resolveStagedRuntimeProbePath } from "./runtime-manifest-staging-roots.mjs";

const qaDirectory = import.meta.dirname;
const repoRoot = path.resolve(qaDirectory, "..", "..");
const desktopRoot = path.join(repoRoot, "desktop");
const validator = fs.readFileSync(
  path.join(qaDirectory, "validate-runtime-manifests.mjs"),
  "utf8",
);
const electronBuilder = fs.readFileSync(
  path.join(desktopRoot, "electron-builder.yml"),
  "utf8",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "runtime-v2", "manifests", "services.json"), "utf8"),
);
const workerManifest = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "runtime-v2", "manifests", "workers.json"), "utf8"),
);

function mandatoryService(id) {
  return {
    id,
    requirement: "required",
    launchProfiles: [
      { modes: ["lean", "hot"] },
      { modes: ["packaged"] },
    ],
  };
}

function validMandatoryServices() {
  return MANDATORY_RUNTIME_SERVICE_IDS.map(mandatoryService);
}

test("locks the exact 32 mandatory Runtime V2 service identities including GBrain", () => {
  assert.equal(MANDATORY_RUNTIME_SERVICE_IDS.length, 32);
  assert.equal(new Set(MANDATORY_RUNTIME_SERVICE_IDS).size, 32);
  assert.equal(MANDATORY_RUNTIME_SERVICE_IDS.includes("gbrain"), true);
  assert.deepEqual(validateMandatoryRuntimeServices(validMandatoryServices()), []);
  assert.deepEqual(validateMandatoryRuntimeServices(manifest.services), []);
  assert.match(validator, /validateMandatoryRuntimeServices\(services\)/u);
});

test("GBrain uses one exact bundled-Node launch and fail-closed readiness contract", () => {
  const gbrain = manifest.services.find(({ id }) => id === "gbrain");
  assert.ok(gbrain);
  assert.deepEqual(validateGbrainNodeLaunch(manifest.services), []);
  assert.equal(gbrain.launchProfiles.length, 1);
  const profile = gbrain.launchProfiles[0];
  assert.deepEqual(profile.modes, ["lean", "hot", "packaged"]);
  assert.equal(profile.executableAuthority, "runtime-root");
  assert.equal(profile.allowedExecutable, GBRAIN_NODE_EXECUTABLE);
  assert.deepEqual(profile.arguments, GBRAIN_NODE_ARGUMENTS);
  assert.equal(profile.environmentSource, "gbrain");
  assert.deepEqual(profile.workingDirectory, {
    kind: "app-subdirectory",
    path: "gbrain-adapter",
  });
  assert.deepEqual(profile.installProbe, {
    kind: "files-present",
    files: GBRAIN_NODE_INSTALL_PROBE_FILES,
  });
  assert.equal(gbrain.readiness.path, "/ready");
  assert.equal(gbrain.readiness.expectedBodyContains, '"backend":"gbrain"');
  assert.match(validator, /validateGbrainNodeLaunch\(services\)/u);
});

test("GBrain launch validation rejects Bun, raw loaders, closure drift, and liveness-only readiness", async (t) => {
  const cases = [
    {
      name: "Bun executable regression",
      mutate(service) {
        service.launchProfiles[0].allowedExecutable = "runtimes/bun/bun.exe";
      },
      expected: /pinned bundled Node executable/u,
    },
    {
      name: "raw absolute loader regression",
      mutate(service) {
        service.launchProfiles[0].arguments = [
          { kind: "literal", value: "--experimental-loader" },
          { kind: "literal", value: "C:\\Breadboard\\gbrain-adapter\\src\\node-loader.mjs" },
          { kind: "app-path", path: "gbrain-adapter/src/node-server.ts" },
        ];
      },
      expected: /raw loader arguments are forbidden/u,
    },
    {
      name: "argument ordering drift",
      mutate(service) {
        service.launchProfiles[0].arguments.reverse();
      },
      expected: /arguments must match the reviewed Node entrypoint contract exactly/u,
    },
    {
      name: "missing runtime dependency proof",
      mutate(service) {
        service.launchProfiles[0].installProbe.files =
          service.launchProfiles[0].installProbe.files.filter(
            ({ path: filePath }) => filePath !== "gbrain/node_modules/js-yaml/package.json",
          );
      },
      expected: /install probe must match the reviewed offline runtime closure exactly/u,
    },
    {
      name: "health endpoint used as readiness",
      mutate(service) {
        service.readiness.path = "/health";
      },
      expected: /readiness must fail closed through \/ready/u,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const services = structuredClone(manifest.services);
      const gbrain = services.find(({ id }) => id === "gbrain");
      assert.ok(gbrain);
      scenario.mutate(gbrain);
      assert.match(validateGbrainNodeLaunch(services).join("\n"), scenario.expected);
    });
  }
});

test("hot dashboard uses the physical source tree while mutable data stays independently rooted", () => {
  const dashboard = manifest.services.find(({ id }) => id === "dashboard");
  assert.ok(dashboard);
  const hot = dashboard.launchProfiles.find(({ modes }) => modes.includes("hot"));
  const lean = dashboard.launchProfiles.find(({ modes }) => modes.includes("lean"));
  const packaged = dashboard.launchProfiles.find(({ modes }) => modes.includes("packaged"));
  assert.deepEqual(hot?.modes, ["hot"]);
  assert.deepEqual(hot?.workingDirectory, {
    kind: "app-subdirectory",
    path: "dashboard",
  });
  assert.deepEqual(hot?.arguments, [
    { kind: "app-path", path: "dashboard/scripts/runtime-v2-hot-dashboard.mjs" },
    { kind: "literal", value: "dev" },
    { kind: "literal", value: "--webpack" },
    { kind: "literal", value: "--port" },
    { kind: "runtime-value", value: "service-port" },
    { kind: "literal", value: "--hostname" },
    { kind: "literal", value: "127.0.0.1" },
  ]);
  assert.deepEqual(hot?.resourceLimits, {
    estimatedColdStartCommitMb: 3072,
    softCommitLimitMb: 6144,
    hardCommitLimitMb: 8192,
  });
  assert.deepEqual(hot?.installProbe, {
    kind: "files-present",
    files: [
      { authority: "runtime-root", path: "runtimes/node/node.exe" },
      { authority: "app-root", path: "dashboard/scripts/runtime-v2-hot-dashboard.mjs" },
      { authority: "app-root", path: "dashboard/node_modules/next/dist/bin/next" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(hot), /runtime-v2-dashboard\.mjs/u);
  assert.deepEqual(lean?.workingDirectory, {
    kind: "app-subdirectory",
    path: "dashboard",
  });
  assert.deepEqual(packaged?.workingDirectory, {
    kind: "app-subdirectory",
    path: "dashboard",
  });
  assert.match(validator, /validateHotDashboardLaunch\(services\)/u);
  assert.match(validator, /dashboard Hot launch must enter Next dev through the dotenv-shadow launcher/u);
  assert.match(validator, /dashboard Hot launch must retain the reviewed bounded Webpack memory envelope/u);
  assert.match(validator, /dashboard Hot install probe must prove only Node, its Hot launcher, and Next/u);
});

test("every launch estimate leaves headroom below its hard commit limit", () => {
  for (const worker of workerManifest.workers) {
    assert.ok(
      worker.estimatedColdStartCommitMb < worker.hardCommitLimitMb,
      `${worker.kind} cold-start estimate must remain below its hard commit limit`,
    );
  }
  for (const service of manifest.services) {
    for (const profile of service.launchProfiles) {
      assert.ok(
        profile.resourceLimits.estimatedColdStartCommitMb <
          profile.resourceLimits.hardCommitLimitMb,
        `${service.id} ${profile.modes.join("/")} cold-start estimate must remain below its hard commit limit`,
      );
    }
  }
  assert.match(
    validator,
    /profile\.resourceLimits\.estimatedColdStartCommitMb\s*>=\s*profile\.resourceLimits\.hardCommitLimitMb/u,
  );
  assert.match(
    validator,
    /worker\.estimatedColdStartCommitMb\s*>=\s*worker\.hardCommitLimitMb/u,
  );
});

test("rejects removal, downgrade, identity drift, and lost or duplicate hot coverage", async (t) => {
  const cases = [
    {
      name: "removed GBrain",
      mutate(services) {
        services.splice(services.findIndex(({ id }) => id === "gbrain"), 1);
      },
      expected: /mandatory Runtime V2 service gbrain is missing/u,
    },
    {
      name: "optional GBrain",
      mutate(services) {
        services.find(({ id }) => id === "gbrain").requirement = "optional";
      },
      expected: /gbrain must remain requirement=required/u,
    },
    {
      name: "missing hot profile",
      mutate(services) {
        services.find(({ id }) => id === "gbrain").launchProfiles[0].modes = ["lean"];
      },
      expected: /gbrain must cover hot mode exactly once; found 0/u,
    },
    {
      name: "duplicate hot profile",
      mutate(services) {
        services.find(({ id }) => id === "gbrain").launchProfiles.push({ modes: ["hot"] });
      },
      expected: /gbrain must cover hot mode exactly once; found 2/u,
    },
    {
      name: "duplicate service identity",
      mutate(services) {
        services.push(mandatoryService("gbrain"));
      },
      expected: /gbrain is registered 2 times/u,
    },
    {
      name: "unexpected replacement identity",
      mutate(services) {
        services[services.findIndex(({ id }) => id === "gbrain")].id = "replacement";
      },
      expected: /unexpected Runtime V2 service identity replacement/u,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const services = structuredClone(validMandatoryServices());
      scenario.mutate(services);
      assert.match(validateMandatoryRuntimeServices(services).join("\n"), scenario.expected);
    });
  }
});

test("manifest runtime-root probes follow the package's split immutable roots", () => {
  const runtimeRoot = path.join(desktopRoot, "build-resources");
  const binRoot = path.join(desktopRoot, "resources", "bin");

  assert.equal(
    resolveStagedRuntimeProbePath(runtimeRoot, binRoot, "bin/voicebox-server.exe"),
    path.join(binRoot, "voicebox-server.exe"),
  );
  assert.equal(
    resolveStagedRuntimeProbePath(runtimeRoot, binRoot, "runtimes/node/node.exe"),
    path.join(runtimeRoot, "runtimes", "node", "node.exe"),
  );
  assert.throws(
    () => resolveStagedRuntimeProbePath(runtimeRoot, binRoot, "../resources/bin/tool.exe"),
    /stay within its authority/u,
  );
  assert.match(
    validator,
    /resolveStagedRuntimeProbePath\(stagedRuntimeRoot, stagedBinRoot, relative\)/u,
  );
  assert.doesNotMatch(
    validator,
    /existingRegularFile\(stagedRuntimeRoot, file\.path/u,
  );
  assert.match(electronBuilder, /- from: resources\/bin\s+to: bin/u);
});

test("generated Python service receipts are packaged-only install proofs", () => {
  for (const serviceId of ["cad", "colpali", "humanizer"]) {
    const service = manifest.services.find(({ id }) => id === serviceId);
    assert.ok(service, `${serviceId} service must remain registered`);
    assert.equal(service.launchProfiles.length, 2);
    const development = service.launchProfiles.find(({ modes }) => modes.includes("hot"));
    const packaged = service.launchProfiles.find(({ modes }) => modes.includes("packaged"));
    assert.deepEqual(development?.modes, ["lean", "hot"]);
    assert.deepEqual(packaged?.modes, ["packaged"]);
    const receipt = `${serviceId}-service/runtime-artifact.json`;
    assert.equal(
      development.installProbe.files.some(
        (file) => file.authority === "app-root" && file.path === receipt,
      ),
      false,
      `${serviceId} development must not claim a generated packaged receipt`,
    );
    assert.equal(
      packaged.installProbe.files.some(
        (file) => file.authority === "app-root" && file.path === receipt,
      ),
      true,
      `${serviceId} packaged mode must prove its staged receipt`,
    );
  }
});
