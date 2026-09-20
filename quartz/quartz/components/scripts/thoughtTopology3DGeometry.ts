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

/** Plan a round cloud around the Garden, rather than extruding cached 2D
 * coordinates. Longitude sectors keep folders together; their share of the
 * sphere follows their population, including a single large folder. Uniform
 * latitude and cube-root radius fill the volume without poles or box corners.
 * Pass the complete scope before filtering so toggles and previews use the
 * same homes. Personal pins are applied afterwards by the renderer. */
export function sphericalTopologyPositions(nodes: readonly ScatterNode[]): Map<string, Point3D> {
  const positions = new Map<string, Point3D>()
  const sectors = new Map<string, ScatterNode[]>()
  let count = 0
  for (const node of nodes) {
    if (node.kind === "garden") {
      positions.set(node.id, { x: 0, y: 0, z: 0 })
      continue
    }
    const key = node.sectorId ?? node.folderId ?? node.id
    const members = sectors.get(key) ?? []
    members.push(node)
    sectors.set(key, members)
    count += 1
  }
  // Reserve projected area per node so the existing planar collision/charge
  // forces can settle without flattening dense clouds along the depth axis.
  const extent = Math.max(180, Math.sqrt(count) * 96)
  let start = -Math.PI / 2
  for (const key of [...sectors.keys()].sort()) {
    const members = sectors.get(key)!
    const arc = (Math.PI * 2 * members.length) / count
    for (const node of members) {
      const anchor = node.kind === "folder"
      const longitude = start + arc * (anchor ? 0.5 : seededUnit(node.id, "longitude"))
      const latitude = (seededUnit(node.id, "latitude") * 2 - 1) * (anchor ? 0.35 : 1)
      // Leave a little breathing room around the central Garden name.
      const radius =
        extent * (anchor ? 0.42 : Math.cbrt(0.06 + 0.94 * seededUnit(node.id, "radius")))
      const ring = radius * Math.sqrt(1 - latitude * latitude)
      positions.set(node.id, {
        x: Math.cos(longitude) * ring,
        y: latitude * radius,
        z: Math.sin(longitude) * ring,
      })
    }
    start += arc
  }
  return positions
}
