import assert from "node:assert/strict";
import test from "node:test";
import { validateElectronRuntimeOwner } from "./electron-owner-validation.mjs";

const validAdapter = `
export const RUNTIME_EXECUTABLE_NAME = "breadboard-runtime.exe";
class RuntimeProcess {
  #binDir = "C:/bin";
  #executable = path.join(this.#binDir, RUNTIME_EXECUTABLE_NAME);
  start() { spawnRuntime(this.#executable, [], { shell: false, detached: false }); }
  async retryService(serviceId: string): Promise<RuntimeServiceRetryResult> {
    return this.#controlJson(\`/v1/lifecycle/services/\${serviceId}/retry\`, "POST");
  }
  async #stopOnce() {}
  terminateNow(): void {}
}
`;

const validLifecycle = `
import { RuntimeProcess } from "./runtime-process";
class AppLifecycle {
  private runtime = new RuntimeProcess({});
  async run() {
    const ready = await this.runtime.start();
    await this.windows.showDashboard(ready.dashboardUrl);
    this.runtime.snapshot();
  }
  retryChannel = IPC_CHANNELS.retryService;
  async retry(serviceId) { await this.runtime.retryService(serviceId); }
  async shutdown() { await this.runtime.stop(); }
  fatal() { this.runtime.terminateNow(); }
}
`;

test("accepts one fixed Rust owner with status, shutdown, and fatal cleanup", () => {
  const result = validateElectronRuntimeOwner({
    appLifecycleSource: validLifecycle,
    runtimeProcessSource: validAdapter,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, {
    runtimeConstructions: 1,
    runtimeStarts: 1,
    forbiddenLegacyOwners: 0,
  });
});

test("rejects dual ownership and a dashboard URL that bypasses Runtime V2", () => {
  const result = validateElectronRuntimeOwner({
    appLifecycleSource: `
      import { ServiceManager } from "./service-manager";
      import { buildServiceDefinitions, serviceUrls } from "./service-definitions";
      class AppLifecycle {
        services = new ServiceManager();
        async run() { await this.services.startAll(); showDashboard(serviceUrls(config).dashboard); }
      }
    `,
    runtimeProcessSource: validAdapter,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /legacy ServiceManager import/u);
  assert.match(result.errors.join("\n"), /construct exactly one RuntimeProcess/u);
  assert.match(result.errors.join("\n"), /Runtime V2 dashboard URL/u);
  assert.match(result.errors.join("\n"), /startup retry/u);
  assert.ok(result.counts.forbiddenLegacyOwners >= 4);
});

test("rejects an adapter that can launch arbitrary arguments or omits emergency cleanup", () => {
  const result = validateElectronRuntimeOwner({
    appLifecycleSource: validLifecycle,
    runtimeProcessSource: `
      const RUNTIME_EXECUTABLE_NAME = process.env.RUNTIME_NAME;
      spawnRuntime(executable, process.argv, { shell: true, detached: true });
    `,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /fixed executable name/u);
  assert.match(result.errors.join("\n"), /argument-free runtime launch/u);
  assert.match(result.errors.join("\n"), /fatal fixed-root termination/u);
});
