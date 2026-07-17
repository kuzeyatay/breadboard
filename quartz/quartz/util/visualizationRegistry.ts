import registryJson from "../../../shared/visualization-renderers.json"

interface TrustedRendererRegistryJson {
  schemaVersion: number
  compatibilityThreshold: number
  renderers: Array<{ id: string }>
}

const registry = registryJson as TrustedRendererRegistryJson

export const TRUSTED_RENDERER_IDS = Object.freeze(
  registry.renderers.map((renderer) => renderer.id),
)

export function isTrustedRendererId(rendererId: string): boolean {
  return TRUSTED_RENDERER_IDS.includes(rendererId)
}
