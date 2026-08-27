export const MANDATORY_RUNTIME_SERVICE_IDS = Object.freeze([
  "chatmock",
  "dashboard",
  "hermes",
  "gbrain",
  "comfyui",
  "telegram-gateway",
  "whatsapp-gateway",
  "openwork",
  "openscience",
  "money-printer",
  "wardrobe",
  "penecho",
  "vlm-ocr",
  "recall",
  "mem0-semantic-engine",
  "local-mcp-broker",
  "postiz-coordinator",
  "inbox-zero-stack",
  "spotify-playback",
  "cliproxy",
  "quartz",
  "ui-tars",
  "cad",
  "solidworks-mcp",
  "colpali",
  "humanizer",
  "voicebox",
  "scriberr",
  "deep-research",
  "deer-flow",
  "vibe-trading",
  "stock-analyst",
]);

const mandatoryIds = new Set(MANDATORY_RUNTIME_SERVICE_IDS);

function hotModeOccurrences(service) {
  if (!Array.isArray(service?.launchProfiles)) return 0;
  return service.launchProfiles.reduce((total, profile) => {
    if (!Array.isArray(profile?.modes)) return total;
    return total + profile.modes.filter((mode) => mode === "hot").length;
  }, 0);
}

export function validateMandatoryRuntimeServices(services) {
  if (!Array.isArray(services)) {
    return Object.freeze(["mandatory Runtime V2 services must be an array"]);
  }

  const errors = [];
  const servicesById = new Map();
  for (const service of services) {
    if (typeof service?.id !== "string") continue;
    const registered = servicesById.get(service.id) ?? [];
    registered.push(service);
    servicesById.set(service.id, registered);
  }

  if (services.length !== MANDATORY_RUNTIME_SERVICE_IDS.length) {
    errors.push(
      `mandatory Runtime V2 service identity set must contain exactly ${MANDATORY_RUNTIME_SERVICE_IDS.length} services; found ${services.length}`,
    );
  }

  for (const id of MANDATORY_RUNTIME_SERVICE_IDS) {
    const registered = servicesById.get(id) ?? [];
    if (registered.length === 0) {
      errors.push(`mandatory Runtime V2 service ${id} is missing`);
      continue;
    }
    if (registered.length !== 1) {
      errors.push(`mandatory Runtime V2 service ${id} is registered ${registered.length} times`);
    }
    if (registered.some((service) => service.requirement !== "required")) {
      errors.push(`mandatory Runtime V2 service ${id} must remain requirement=required`);
    }
    const hotCount = registered.reduce(
      (total, service) => total + hotModeOccurrences(service),
      0,
    );
    if (hotCount !== 1) {
      errors.push(
        `mandatory Runtime V2 service ${id} must cover hot mode exactly once; found ${hotCount}`,
      );
    }
  }

  for (const id of servicesById.keys()) {
    if (!mandatoryIds.has(id)) {
      errors.push(`unexpected Runtime V2 service identity ${id}`);
    }
  }

  return Object.freeze(errors);
}
