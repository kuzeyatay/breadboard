import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MANDATORY_RUNTIME_SERVICE_IDS,
  validateMandatoryRuntimeServices,
} from "./mandatory-runtime-services.mjs";
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

test("locks the exact 33 mandatory Runtime V2 service identities, GBrain removed", () => {
  assert.equal(MANDATORY_RUNTIME_SERVICE_IDS.length, 33);
  assert.equal(new Set(MANDATORY_RUNTIME_SERVICE_IDS).size, 33);
  assert.equal(MANDATORY_RUNTIME_SERVICE_IDS.includes("gbrain"), false);
  assert.deepEqual(validateMandatoryRuntimeServices(validMandatoryServices()), []);
  assert.deepEqual(validateMandatoryRuntimeServices(manifest.services), []);
  assert.match(validator, /validateMandatoryRuntimeServices\(services\)/u);
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
    { kind: "literal", value: "--turbopack" },
    { kind: "literal", value: "--port" },
    { kind: "runtime-value", value: "service-port" },
    { kind: "literal", value: "--hostname" },
    { kind: "literal", value: "127.0.0.1" },
  ]);
  assert.deepEqual(hot?.resourceLimits, {
    estimatedColdStartCommitMb: 3072,
    softCommitLimitMb: 9216,
    hardCommitLimitMb: 11264,
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
  assert.match(validator, /dashboard Hot launch must retain the reviewed bounded Turbopack memory envelope/u);
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
      name: "removed Hermes",
      mutate(services) {
        services.splice(services.findIndex(({ id }) => id === "hermes"), 1);
      },
      expected: /mandatory Runtime V2 service hermes is missing/u,
    },
    {
      name: "optional Hermes",
      mutate(services) {
        services.find(({ id }) => id === "hermes").requirement = "optional";
      },
      expected: /hermes must remain requirement=required/u,
    },
    {
      name: "missing hot profile",
      mutate(services) {
        services.find(({ id }) => id === "hermes").launchProfiles[0].modes = ["lean"];
      },
      expected: /hermes must cover hot mode exactly once; found 0/u,
    },
    {
      name: "duplicate hot profile",
      mutate(services) {
        services.find(({ id }) => id === "hermes").launchProfiles.push({ modes: ["hot"] });
      },
      expected: /hermes must cover hot mode exactly once; found 2/u,
    },
    {
      name: "duplicate service identity",
      mutate(services) {
        services.push(mandatoryService("hermes"));
      },
      expected: /hermes is registered 2 times/u,
    },
    {
      name: "unexpected replacement identity",
      mutate(services) {
        services[services.findIndex(({ id }) => id === "hermes")].id = "replacement";
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
