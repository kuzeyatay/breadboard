export interface QuartzTopologyInvestigationRequest {
  requestId: string;
  clusterSlug: string;
  nodeSlug: string;
  label: string;
  prompt: string;
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const GARDEN_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

/** Validate the read-only investigation handoff from the Quartz iframe. */
export function quartzTopologyInvestigationRequest(
  value: unknown,
): QuartzTopologyInvestigationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "second-brain:assistant-investigate-topology") {
    return null;
  }
  const requestId = boundedText(record.requestId, 128);
  const clusterSlug = boundedText(record.clusterSlug, 128);
  const nodeSlug = boundedText(record.nodeSlug, 400);
  const label = boundedText(record.label, 240);
  const prompt = boundedText(record.prompt, 1_600);
  if (
    !OPAQUE_ID.test(requestId) ||
    !GARDEN_SLUG.test(clusterSlug) ||
    !nodeSlug ||
    !label ||
    !prompt
  ) {
    return null;
  }
  const normalizedNodeSlug = nodeSlug
    .replace(/^garden:/, "")
    .replace(/^\/+|\/+$/g, "");
  if (
    normalizedNodeSlug !== clusterSlug &&
    !normalizedNodeSlug.startsWith(`${clusterSlug}/`)
  ) {
    return null;
  }
  return { requestId, clusterSlug, nodeSlug, label, prompt };
}
