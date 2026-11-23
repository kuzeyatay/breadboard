import { fileURLToPath } from "node:url";
import { machineDirectory, openBrowser } from "./platform.ts";
import { claimInstance } from "../host/instance.ts";
import { startHost } from "../host/server.ts";

async function launch() {
  const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
  const directory = await machineDirectory();
  const instance = await claimInstance(directory);
  if (!instance) return;
  let host: Awaited<ReturnType<typeof startHost>>;
  try {
    host = await startHost({ ...instance, dist, openBrowser, machineDirectory: directory,
      storageExecutable: fileURLToPath(new URL("../../.cache/local-host/timeline-studio-storage", import.meta.url)) });
  } catch (error) {
    try { await instance.release(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError],
        `Host startup failed: ${error instanceof Error ? error.message : "Unknown error."} Instance cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : "Unknown error."}`);
    }
    throw error;
  }
  try { await instance.publish(host.port); }
  catch (error) { await host.stop(); throw error; }
  const stop = () => { void host.stop().catch(() => {
    console.error("Timeline Studio shutdown failed; instance records were retained for inspection.");
    process.exitCode = 1;
  }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.info("Timeline Studio local service ready. Closing the browser does not stop this service.");
  try { await host.reopen(); } catch {
    // Child-process errors can contain the bootstrap URL. Never print that error.
    console.error("The browser could not be opened. The service is still running; check Chrome and run the launcher again.");
  }
}

void launch().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Timeline Studio startup failed.");
  process.exitCode = 1;
});
