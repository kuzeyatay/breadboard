import fs from "node:fs";
import path from "node:path";
import { discoverModels } from "./client.ts";
import { capabilitiesFor } from "./capabilities.ts";
import { readAceStepSettings, resolveAceStepConfig } from "./config.ts";
import { readSupervisedServiceSnapshot } from "../supervisor-control.ts";
import { preparedAceStep } from "./prepared.ts";
import { musicError } from "../music-producer/errors.ts";
/** Observation only: never acquires a lease, installs, loads, or downloads. */
export async function aceStepStatus(userId: number) {
  const settings = readAceStepSettings(userId);
  const publicSettings = { mode: settings.mode, externalUrl: settings.externalUrl, model: settings.model, keyConfigured: Boolean(settings.apiKey), resonantSlug: settings.resonantSlug ?? "" };
  let resonant = settings.resonantSlug ? "Configured connection is unavailable or no longer approved." : "Not configured. ACE-Step generation remains available.";
  try {
    const config = resolveAceStepConfig(userId);
    if (config.resonantDigest)
      resonant = "Approved local workspace. The MCP connection and capabilities are checked when arranging.";
    let hardware;
    if (config.managed) {
      const prepared = preparedAceStep(config.directory);
      if (!prepared)
        return { state: "missing-models", message: "Prepare or repair ACE-Step and its model explicitly in settings.", settings: publicSettings, resonant };
      hardware = prepared.hardware;
      const snapshot = await readSupervisedServiceSnapshot("acestep");
      if (snapshot?.state === "resource-blocked")
        return { state: "resource-blocked", message: "Runtime cannot admit the model within current memory headroom.", settings: publicSettings, hardware, resonant };
      if (!snapshot)
        return { state: "unavailable", message: "Prepared, but Runtime status is unavailable.", settings: publicSettings, hardware, resonant };
      if (["stopped", "available-but-stopped"].includes(snapshot.state))
        return { state: "stopped", message: "Prepared. The model starts when you generate a track.", settings: publicSettings, hardware, resonant, stoppedGate: fs.existsSync(path.join(config.directory, "generation-receipt.json")) };
      if (!["ready", "busy", "healthy"].includes(snapshot.state))
        return { state: snapshot.state, message: "Runtime provider status: " + snapshot.state, settings: publicSettings, hardware, resonant };
      if (fs.existsSync(path.join(config.directory, "generation-receipt.json")))
        return { state: "busy", message: "A generation is active or draining. Stop collection does not confirm GPU interruption.", settings: publicSettings, hardware, resonant };
    }
    const models = await discoverModels(config);
    if (!models.includes(config.model))
      return { state: "missing-models", message: "The selected model is not loaded on this provider.", models, settings: publicSettings, hardware, resonant };
    return { state: "ready", message: "Ready for one music draft.", capabilities: capabilitiesFor(config.model), models, settings: publicSettings, hardware, resonant };
  }
  catch (error) {
    const failure = musicError(error);
    return { state: failure.message.startsWith("unsupported_model") ? "unsupported" : "unavailable", message: failure.message, settings: publicSettings, resonant };
  }
}
