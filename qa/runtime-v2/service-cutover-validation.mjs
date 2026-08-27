const RUNTIME_OWNER = /(?:breadboard[- ]runtime|runtime v2|rust runtime)/iu;
const INCOMPLETE_STATE =
  /(?:not[_ -]?cut[_ -]?over|legacy|dashboard[_ -](?:direct|owned)|electron[_ -]owned|in[_ -]?process|direct[_ -](?:spawn|launch)|source[_ -]foundation)/iu;
const RETIRED_STATE = /(?:retired|removed|split[_ -](?:into|across))/iu;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function serviceId(runtimeId) {
  return runtimeId.startsWith("service:") ? runtimeId.slice("service:".length) : null;
}

function isRuntimeOwned(entry) {
  return RUNTIME_OWNER.test(text(entry.current_owner));
}

function isCutOver(entry) {
  const state = text(entry.current_state);
  return state.length > 0 && !INCOMPLETE_STATE.test(state);
}

function requireEvidence(entry, errors) {
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
    errors.push(`${entry.runtime_id}: cutover has no authoritative source evidence.`);
  }
  if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
    errors.push(`${entry.runtime_id}: cutover has no verification evidence.`);
  }
}

function requireCoreMemoryEvidence(entry, errors) {
  const baseline = entry.current_memory_baseline_mb;
  const peak = entry.measured_peak_mb;
  if (
    typeof baseline !== "number" ||
    !Number.isFinite(baseline) ||
    baseline < 0 ||
    typeof peak !== "number" ||
    !Number.isFinite(peak) ||
    peak < baseline ||
    text(entry.memory_metric).length === 0
  ) {
    errors.push(
      `${entry.runtime_id}: core service has no valid measured baseline/peak memory evidence.`,
    );
  }
}

/**
 * Validate the non-negotiable service-ownership boundary independently from
 * capability parity. A capability may remain visible while its process is
 * still launched by Next, so registry parity alone cannot prove this cutover.
 */
export function validateServiceCutover({ inventory, serviceManifest }) {
  if (!record(inventory) || !Array.isArray(inventory.entries)) {
    throw new TypeError("Runtime V2 execution inventory is invalid.");
  }
  if (!record(serviceManifest) || !Array.isArray(serviceManifest.services)) {
    throw new TypeError("Runtime V2 service manifest is invalid.");
  }

  const manifestById = new Map();
  const errors = [];
  for (const service of serviceManifest.services) {
    const id = record(service) ? text(service.id) : "";
    if (!id) {
      errors.push("Service manifest contains an entry without an id.");
      continue;
    }
    if (manifestById.has(id)) {
      errors.push(`Service manifest duplicates ${id}.`);
      continue;
    }
    manifestById.set(id, service);
  }

  const rows = [];
  const ownedEntries = inventory.entries.filter((entry) => {
    if (!record(entry)) return false;
    const runtimeId = text(entry.runtime_id);
    return runtimeId.startsWith("service:") || runtimeId.startsWith("schedule:");
  });
  const inventoriedServiceIds = new Set(
    ownedEntries
      .map((entry) => serviceId(text(entry.runtime_id)))
      .filter((id) => id !== null),
  );

  for (const entry of ownedEntries) {
    const errorCountBefore = errors.length;
    const runtimeId = text(entry.runtime_id);
    if (!runtimeId) {
      errors.push("Execution inventory contains a service row without runtime_id.");
      continue;
    }

    const id = serviceId(runtimeId);
    const scheduled = runtimeId.startsWith("schedule:");
    const coordinator = runtimeId === "service:background-coordinator";
    let disposition = "missing";

    if (scheduled) {
      disposition = "native-schedule";
      if (!isRuntimeOwned(entry)) {
        errors.push(`${runtimeId}: scheduled work is not owned by Runtime V2.`);
      }
      if (!isCutOver(entry)) {
        errors.push(`${runtimeId}: scheduled work is still marked not cut over.`);
      }
      requireEvidence(entry, errors);
    } else if (coordinator && RETIRED_STATE.test(text(entry.current_state))) {
      disposition = "retired-after-split";
      if (!isRuntimeOwned(entry)) {
        errors.push(`${runtimeId}: retired coordinator split is not attributed to Runtime V2.`);
      }
      requireEvidence(entry, errors);
    } else if (id) {
      const manifest = manifestById.get(id);
      disposition = manifest ? "runtime-service" : "missing-manifest";
      if (!manifest) {
        errors.push(`${runtimeId}: no trusted Runtime V2 service manifest entry exists.`);
      } else {
        if (entry.classification === "core") {
          if (manifest.startupPolicy !== "eager") {
            errors.push(`${runtimeId}: core service is not registered as eager.`);
          }
          if (manifest.idleTtlMs !== null) {
            errors.push(`${runtimeId}: core service must not declare an idle TTL.`);
          }
          requireCoreMemoryEvidence(entry, errors);
        } else if (entry.classification === "scheduled-service") {
          if (
            manifest.startupPolicy !== "scheduled" &&
            manifest.startupPolicy !== "on-demand"
          ) {
            errors.push(`${runtimeId}: scheduled service is neither scheduled nor on-demand.`);
          }
          if (!Number.isSafeInteger(manifest.idleTtlMs) || manifest.idleTtlMs <= 0) {
            errors.push(`${runtimeId}: scheduled service has no positive idle TTL.`);
          }
        } else {
          if (manifest.startupPolicy !== "on-demand") {
            errors.push(`${runtimeId}: Breadboard-launched service is not genuinely on-demand.`);
          }
          if (!Number.isSafeInteger(manifest.idleTtlMs) || manifest.idleTtlMs <= 0) {
            errors.push(`${runtimeId}: on-demand service has no positive idle TTL.`);
          }
        }
        if (!Array.isArray(manifest.launchProfiles) || manifest.launchProfiles.length === 0) {
          errors.push(`${runtimeId}: service has no trusted launch profile.`);
        }
      }
      if (!isRuntimeOwned(entry)) {
        errors.push(`${runtimeId}: current owner is not Runtime V2.`);
      }
      if (!isCutOver(entry)) {
        errors.push(`${runtimeId}: current state is still marked not cut over.`);
      }
      requireEvidence(entry, errors);
    } else {
      errors.push(`${runtimeId}: service row uses an unsupported runtime id.`);
    }

    rows.push({
      runtimeId,
      classification: entry.classification,
      disposition,
      owner: text(entry.current_owner),
      state: text(entry.current_state),
      complete: errors.length === errorCountBefore,
    });
  }

  for (const id of manifestById.keys()) {
    if (!inventoriedServiceIds.has(id)) {
      errors.push(`service:${id}: trusted manifest entry has no execution-inventory service row.`);
    }
  }

  rows.sort((left, right) => left.runtimeId.localeCompare(right.runtimeId));
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    counts: Object.freeze({
      inventoryServices: rows.length,
      manifestServices: manifestById.size,
      completed: rows.filter((row) => row.complete).length,
    }),
  });
}
