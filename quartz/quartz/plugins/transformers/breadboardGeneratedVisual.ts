import crypto from "crypto"
import { generatedVisualHeadingMatches } from "./breadboardGeneratedVisualHeading"
import fs from "fs"
import path from "path"
import type { Code, Root } from "mdast"
import { visit } from "unist-util-visit"
import type { QuartzTransformerPlugin } from "../types"
import type { CSSResource, JSResource } from "../../util/resources"
// @ts-ignore -- Quartz loads *.inline scripts as source text through esbuild.
import generatedVisualScript from "../../components/scripts/breadboardGeneratedVisual.inline"
import generatedVisualStyle from "../../components/styles/breadboardGeneratedVisual.inline.scss"

const LANG = "breadboard-generated-visual"
const DETACHED_LANG = "breadboard-detached-visual"
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/
const COMPILED_PREFIX = "globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze("
const COMPILED_SUFFIX = ");\n"

type Dict = Record<string, unknown>

function isRecord(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function parseBlock(value: string): { id: string; version: number } | null {
  const id = value.match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1] ?? ""
  const version = Number(value.match(/^version:\s*(\d+)\s*$/m)?.[1] ?? 0)
  return ID_PATTERN.test(id) && Number.isInteger(version) && version > 0 ? { id, version } : null
}

function readJson(filePath: string): Dict | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function posix(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "")
}

function nodeText(node: unknown): string {
  if (!isRecord(node)) return ""
  if (typeof node.value === "string") return node.value
  return Array.isArray(node.children) ? node.children.map(nodeText).join("") : ""
}

function findGardenRoot(pagePath: string, id: string, boundary: string): string | null {
  let current = path.dirname(pagePath)
  const resolvedBoundary = path.resolve(boundary)
  for (let depth = 0; depth < 20; depth += 1) {
    if (fs.existsSync(path.join(current, ".breadboard", "visuals", id))) return current
    const parent = path.dirname(current)
    if (parent === current) break
    if (!path.resolve(parent).startsWith(resolvedBoundary) && path.resolve(current) === resolvedBoundary) break
    current = parent
  }
  return null
}

function markInvalid(node: Code, reason: string): void {
  node.data = {
    hProperties: {
      className: ["breadboard-generated-visual-block", "breadboard-generated-visual-invalid"],
      "data-generated-visual-error": reason.slice(0, 500),
    },
  }
  node.value = "This interactive visualization is temporarily unavailable."
}

function validateDefinition(value: unknown): value is Dict {
  if (!isRecord(value) || value.sdkVersion !== "1.0.0") return false
  if (value.nativeRuntime !== undefined) {
    const runtime = value.nativeRuntime
    return isRecord(runtime) && runtime.engine === "breadboard-interactive-visualizer" &&
      runtime.version === "2.0.0" && runtime.sourceSkill === "interactive-visualizer-in-chat" &&
      /^[a-f0-9]{64}$/.test(String(runtime.skillHash)) &&
      typeof runtime.html === "string" && runtime.html.length <= 2_000_000 &&
      runtime.html.includes('http-equiv="Content-Security-Policy"') &&
      typeof value.title === "string" && typeof value.description === "string"
  }
  if (!Array.isArray(value.controls) || !Array.isArray(value.outputs) || !Array.isArray(value.scenes)) return false
  if (value.controls.length > 12 || value.outputs.length > 16 || value.scenes.length > 12) return false
  return typeof value.title === "string" && typeof value.description === "string"
}

/**
 * Verifies generated visualization artifacts during the Quartz build. The
 * compiled file is parsed as a fixed-prefix JSON envelope; it is never loaded
 * as a module and model-authored source is never evaluated.
 */
export const BreadboardGeneratedVisuals: QuartzTransformerPlugin = () => ({
  name: "BreadboardGeneratedVisuals",
  markdownPlugins(ctx) {
    return [
      () => (tree: Root, file) => {
        visit(tree, "code", (node: Code, index, parent) => {
          if (node.lang !== LANG && node.lang !== DETACHED_LANG) return
          const detached = node.lang === DETACHED_LANG
          let snapshot: Dict | null = null
          if (detached) {
            try {
              const value: unknown = node.value.length <= 8_000_000 ? JSON.parse(node.value) : null
              if (isRecord(value) && value.schemaVersion === 1 && isRecord(value.manifest) &&
                  value.manifest.detached === true && typeof value.source === "string" && typeof value.compiled === "string") snapshot = value
            } catch { /* Invalid inline snapshots fail closed below. */ }
          }
          const inlineManifest = snapshot && isRecord(snapshot.manifest) ? snapshot.manifest : null
          const block = detached
            ? inlineManifest && ID_PATTERN.test(String(inlineManifest.id)) && Number.isInteger(inlineManifest.version) && Number(inlineManifest.version) > 0
              ? { id: String(inlineManifest.id), version: Number(inlineManifest.version) } : null
            : parseBlock(node.value)
          if (!block) {
            markInvalid(node, "invalid generated visualization reference")
            return
          }

          const filePath = String(file.data.filePath ?? "")
          const gardenRoot = !detached && filePath ? findGardenRoot(filePath, block.id, ctx.argv.directory) : null
          if (!detached && !gardenRoot) {
            markInvalid(node, "generated visualization artifact was not found")
            return
          }

          const artifactDir = gardenRoot ? path.join(
            gardenRoot,
            ".breadboard",
            "visuals",
            block.id,
            "versions",
            String(block.version),
          ) : ""
          const evidence = (name: string): Dict | null => detached
            ? snapshot && isRecord(snapshot[name]) ? snapshot[name] as Dict : null
            : readJson(path.join(artifactDir, `${name}.json`))
          const manifest = evidence("manifest")
          const validation = evidence("validation")
          const tests = evidence("tests")
          const critic = evidence("critic")
          if (!manifest || !validation || !tests || !critic) {
            markInvalid(node, "generated visualization evidence is incomplete")
            return
          }
          if (
            manifest.id !== block.id ||
            manifest.version !== block.version ||
            manifest.status !== "published" ||
            validation.valid !== true ||
            tests.passed !== true ||
            critic.approved !== true
          ) {
            markInvalid(node, "generated visualization has not passed its publication gates")
            return
          }

          // A detached snapshot is owned by the Markdown that physically
          // contains it. Linked Learn artifacts retain their exact page,
          // heading, and insertion-anchor constraints.
          if (!detached) {
            const relativePage = posix(path.relative(gardenRoot!, filePath))
            if (!relativePage.startsWith("learning/") || posix(String(manifest.targetPage ?? "")) !== relativePage) {
              markInvalid(node, "generated visualization is referenced from an unauthorized page")
              return
            }

            const siblings = parent && Array.isArray(parent.children) ? parent.children : []
            const before = typeof index === "number" ? siblings.slice(0, index) : []
            const precedingHeading = [...before].reverse().find((candidate) => candidate.type === "heading")
            if (!generatedVisualHeadingMatches({
              targetHeading: String(manifest.targetHeading ?? ""),
              precedingHeading: precedingHeading ? nodeText(precedingHeading) : null,
              pageTitle: String(file.data.frontmatter?.title ?? ""),
            })) {
              markInvalid(node, "generated visualization heading constraint does not match")
              return
            }
            const insertionAnchor = String(manifest.insertionAnchor ?? "")
            const anchorFound = insertionAnchor.length > 0 && before.some(
              (candidate) => candidate.type === "html" && nodeText(candidate).includes(insertionAnchor),
            )
            if (!anchorFound) {
              markInvalid(node, "generated visualization insertion anchor is missing")
              return
            }
          }

          let compiled = ""
          let source = ""
          try {
            compiled = detached ? String(snapshot!.compiled) : fs.readFileSync(path.join(artifactDir, "compiled.js"), "utf8")
            source = detached ? String(snapshot!.source) : fs.readFileSync(path.join(artifactDir, "source.tsx"), "utf8")
          } catch {
            markInvalid(node, "generated visualization source or compiled artifact is missing")
            return
          }
          if (sha256(compiled) !== manifest.compiledHash || sha256(source) !== manifest.sourceHash) {
            markInvalid(node, "generated visualization artifact hash does not match")
            return
          }
          if (!compiled.startsWith(COMPILED_PREFIX) || !compiled.endsWith(COMPILED_SUFFIX)) {
            markInvalid(node, "generated visualization compiler envelope is invalid")
            return
          }

          let definition: unknown
          try {
            definition = JSON.parse(compiled.slice(COMPILED_PREFIX.length, -COMPILED_SUFFIX.length))
          } catch {
            markInvalid(node, "generated visualization definition is invalid JSON")
            return
          }
          if (!validateDefinition(definition)) {
            markInvalid(node, "generated visualization definition schema is invalid")
            return
          }
          if (isRecord(definition.nativeRuntime) &&
              (manifest.sourceSkill !== definition.nativeRuntime.sourceSkill ||
               manifest.skillHash !== definition.nativeRuntime.skillHash ||
               manifest.runtimeEngine !== definition.nativeRuntime.engine)) {
            markInvalid(node, "native visualization skill provenance does not match")
            return
          }

          node.data = {
            hProperties: {
              className: ["breadboard-generated-visual-block"],
              "data-generated-visual-definition": JSON.stringify(definition),
              "data-generated-visual-manifest": JSON.stringify({
                id: block.id,
                version: block.version,
                title: manifest.title,
                description: manifest.description,
                sourceAnchorIds: manifest.sourceAnchorIds,
                previousVersion: manifest.previousVersion,
                detached,
              }),
            },
          }
          node.value = `Interactive visualization: ${String(manifest.title ?? block.id)}`
        })
      },
    ]
  },
  externalResources() {
    const js: JSResource[] = [{ script: generatedVisualScript, loadTime: "afterDOMReady", contentType: "inline" }]
    const css: CSSResource[] = [{ content: generatedVisualStyle, inline: true }]
    return { js, css }
  },
})
