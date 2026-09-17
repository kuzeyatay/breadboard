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

function signedHash(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return ((hash >>> 0) / 0xffffffff) * 2 - 1
}

/** Related pages occupy the same depth neighborhood. IDs make the depth
 * independent of filtering, ordering, and the force simulation's settling. */
export function topologyNodeDepth(
  node: {
    id: string
    kind: string
    sectorId: string | null
    folderId: string | null
  },
  spread: number,
): number {
  if (node.kind === "garden") return 0
  const sector = node.sectorId ?? node.folderId ?? node.id
  return spread * (signedHash(sector) * 0.8 + signedHash(node.id) * 0.35)
}

/** The planned layout is a disc; a depth that ignores where a node sits in it
 * extrudes that disc into a slab, which reads as a rotating rectangle. Scaling
 * the depth by the sphere cap over the node's planned radius keeps rim nodes
 * shallow and central nodes deep, so the cloud rounds out without moving any
 * planned x/y. Returns the depth multiplier in [floor, 1]. */
export function sphericalDepthFactor(
  node: { x: number; y: number },
  layoutRadius: number,
  floor = 0.22,
): number {
  if (!(layoutRadius > 0)) return 1
  const ratio = Math.min(1, Math.hypot(node.x, node.y) / layoutRadius)
  return floor + (1 - floor) * Math.sqrt(1 - ratio * ratio)
}
