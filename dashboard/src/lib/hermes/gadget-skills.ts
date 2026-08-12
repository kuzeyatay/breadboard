export const GENERATE_GADGET_SKILL = "generate-gadget";

/** True for an artifact that is a gadget, whatever produced it. */
export function isGadgetArtifact(artifact: {
  renderer: string;
  kind?: string;
}): boolean {
  return artifact.renderer === "gadget";
}

/** Prefill text for the composer when the user reopens a gadget to change it. */
export function gadgetCommandForArtifact(artifact: { renderer?: string }): string {
  return artifact.renderer === "gadget" ? `/${GENERATE_GADGET_SKILL} ` : "";
}
