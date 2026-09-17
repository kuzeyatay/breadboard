import { renderThoughtTopology3D } from "./thoughtTopology3DRenderer"
export type { ThoughtTopologyInvestigationRequest } from "./thoughtTopologyRenderer"

/** Every Thought Topology surface uses 3D, including previews and inline maps. */
export async function renderThoughtTopology(
  ...args: Parameters<typeof renderThoughtTopology3D>
): Promise<() => void> {
  args[0].dataset.topologyDimension = "3d"
  return renderThoughtTopology3D(...args)
}
