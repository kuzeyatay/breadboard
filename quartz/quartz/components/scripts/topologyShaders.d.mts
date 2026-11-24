type Node = { id: string; kind: string; x: number; y: number; z: number }
type Edge = { id: string; source: string; target: string; structural?: boolean; strength: number; opacity?: number }
type Point = { x: number; y: number }
export function createMapShaders<T extends Node>(canvas: HTMLCanvasElement, context: WebGL2RenderingContext, light?: boolean): {
  setNodes(nodes: T[], tone: (node: T) => number): void
  setLines(nodes: T[], edges: Edge[], tone: (node: T) => number, focus: Set<string> | null): void
  updatePositions(nodes: T[], edges: Edge[]): void
  resize(width: number, height: number): void
  draw(camera: {yaw: number; pitch: number}, center: Point, pan: Point, scale: number, zoom: number,
    item: { id: string } | null, colors: number[][], ink: number[]): void
  dispose(): void
}
