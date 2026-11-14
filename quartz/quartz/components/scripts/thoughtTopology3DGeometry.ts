/** An orthographic camera keeps the existing map's dot sizes and line weights.
 * All positions and drag deltas are real XYZ coordinates; labels stay upright. */
export type Point3D = { x: number; y: number; z: number }

export class TopologyCamera3D {
  yaw = 0.42
  pitch = -0.26

  project(point: Point3D): Point3D {
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw)
    const cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch)
    const depth = -sy * point.x + cy * point.z
    return {
      x: cy * point.x + sy * point.z,
      y: cp * point.y - sp * depth,
      z: sp * point.y + cp * depth,
    }
  }

  /** Inverse rotation: dragging follows the screen plane at any camera angle. */
  unproject(point: Point3D): Point3D {
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw)
    const cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch)
    const depth = -sp * point.y + cp * point.z
    return {
      x: cy * point.x - sy * depth,
      y: cp * point.y + sp * point.z,
      z: sy * point.x + cy * depth,
    }
  }

  orbit(dx: number, dy: number) {
    this.yaw += dx * 0.006
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch + dy * 0.006))
  }
}

function seededUnit(id: string, channel: string): number {
  let hash = 2166136261
  const value = `${channel}:${id}`
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  // Avalanche the seed so sequential page IDs do not form stripes or slabs.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000
}

type ScatterNode = {
  id: string
  kind: string
  sectorId: string | null
  folderId: string | null
}

/** Fill one round cloud around `center`. Longitude wedges keep each group
 * together; their share of the sphere follows their population, including a
 * single large group. Uniform latitude and cube-root radius fill the volume
 * without poles or box corners. Returns the cloud's radius. */
function fillSphere(
  positions: Map<string, Point3D>,
  members: readonly ScatterNode[],
  center: Point3D,
  groupOf: (node: ScatterNode) => string,
): number {
  const groups = new Map<string, ScatterNode[]>()
  for (const node of members) {
    const key = groupOf(node)
    const group = groups.get(key) ?? []
    group.push(node)
    groups.set(key, group)
  }
  const count = members.length
  // Reserve projected area per node so the existing planar collision/charge
  // forces can settle without flattening dense clouds along the depth axis.
  const extent = Math.max(180, Math.sqrt(count) * 96)
  let start = -Math.PI / 2
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!
    const arc = (Math.PI * 2 * group.length) / count
    for (const node of group) {
      const anchor = node.kind === "folder"
      const longitude = start + arc * (anchor ? 0.5 : seededUnit(node.id, "longitude"))
      const latitude = (seededUnit(node.id, "latitude") * 2 - 1) * (anchor ? 0.35 : 1)
      // Leave a little breathing room around the central name.
      const radius =
        extent * (anchor ? 0.42 : Math.cbrt(0.06 + 0.94 * seededUnit(node.id, "radius")))
      const ring = radius * Math.sqrt(1 - latitude * latitude)
      positions.set(node.id, {
        x: center.x + Math.cos(longitude) * ring,
        y: center.y + latitude * radius,
        z: center.z + Math.sin(longitude) * ring,
      })
    }
    start += arc
  }
  return extent
}

/** Plan a round cloud around the Garden, rather than extruding cached 2D
 * coordinates; top-level folders share the sphere as longitude sectors.
 * Pass visible nodes to fill the sphere after filtering, or the complete scope
 * to retain a cross-section. Personal pins are applied afterwards by the renderer.
 *
 * With `separateSectors` (a library of several Gardens) every top-level folder
 * is a Garden and gets a sphere of its own, laid out exactly like its
 * single-Garden map, and the spheres are packed apart around the library node. */
export function sphericalTopologyPositions(
  nodes: readonly ScatterNode[],
  separateSectors = false,
): Map<string, Point3D> {
  const positions = new Map<string, Point3D>()
  const rest: ScatterNode[] = []
  for (const node of nodes) {
    if (node.kind === "garden") positions.set(node.id, { x: 0, y: 0, z: 0 })
    else rest.push(node)
  }
  const sectorOf = (node: ScatterNode) => node.sectorId ?? node.folderId ?? node.id
  const sectors = new Map<string, ScatterNode[]>()
  if (separateSectors) {
    for (const node of rest) {
      const members = sectors.get(sectorOf(node)) ?? []
      // The Garden's own folder node sits at the centre of its sphere.
      if (node.id !== sectorOf(node)) members.push(node)
      sectors.set(sectorOf(node), members)
    }
  }
  if (sectors.size < 2) {
    if (rest.length > 0) fillSphere(positions, rest, { x: 0, y: 0, z: 0 }, sectorOf)
    return positions
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  // Inside a Garden, wedges follow its own first-level folders.
  const branchOf = (node: ScatterNode) => {
    let current = node
    for (let hops = 0; hops < 16; hops++) {
      const parent = current.folderId ? byId.get(current.folderId) : undefined
      if (!parent || parent.id === node.sectorId) break
      current = parent
    }
    return current.id
  }
  const spheres = [...sectors.entries()]
    .map(([id, members]) => ({ id, members, radius: Math.max(180, Math.sqrt(members.length) * 96) }))
    .sort((a, b) => b.radius - a.radius || (a.id < b.id ? -1 : 1))
  // Largest first, walk an outward spiral in the screen plane and take the
  // first spot that clears every placed sphere by a visible gap. The library
  // node keeps the origin.
  const placed: Array<{ x: number; y: number; radius: number }> = [{ x: 0, y: 0, radius: 0 }]
  for (const sphere of spheres) {
    let center = { x: 0, y: 0, z: 0 }
    for (let step = 0; step < 20000; step++) {
      const distance = sphere.radius * 1.2 + 140 + step * 10
      const angle = step * 0.4
      center = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, z: 0 }
      if (
        placed.every(
          (other) =>
            Math.hypot(center.x - other.x, center.y - other.y) >=
            (sphere.radius + other.radius) * 1.2 + 140,
        )
      )
        break
    }
    placed.push({ x: center.x, y: center.y, radius: sphere.radius })
    positions.set(sphere.id, center)
    if (sphere.members.length > 0) fillSphere(positions, sphere.members, center, branchOf)
  }
  return positions
}
