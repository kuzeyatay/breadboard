/** Shared by uploads, imports and the viewer, including pre-viewer artifacts. */
export const SPICE_EXTENSIONS = new Set([".cir", ".ckt", ".sp", ".spice", ".net"]);

export function isSpiceFilename(filename: string): boolean {
  return SPICE_EXTENSIONS.has(filename.match(/\.[^.\\/]+$/)?.[0].toLowerCase() ?? "");
}

export function isSpiceNetlistArtifact(artifact: { renderer: string; filename: string }): boolean {
  return artifact.renderer === "spice-netlist" || isSpiceFilename(artifact.filename) || isCircuitProjectFilename(artifact.filename);
}

export function isCircuitProjectFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".bbcir");
}

export const MAX_NETLIST_BYTES = 2 * 1024 * 1024;
