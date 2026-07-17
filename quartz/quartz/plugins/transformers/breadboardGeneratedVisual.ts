import crypto from "crypto"
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

function normalizeHeading(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
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
          if (node.lang !== LANG) return
          const block = parseBlock(node.value)
          if (!block) {
            markInvalid(node, "invalid generated visualization reference")
            return
          }

          const filePath = String(file.data.filePath ?? "")
          const gardenRoot = filePath ? findGardenRoot(filePath, block.id, ctx.argv.directory) : null
          if (!gardenRoot) {
            markInvalid(node, "generated visualization artifact was not found")
            return
          }

          const artifactDir = path.join(
            gardenRoot,
            ".breadboard",
            "visuals",
            block.id,
            "versions",
            String(block.version),
          )
          const manifest = readJson(path.join(artifactDir, "manifest.json"))
          const validation = readJson(path.join(artifactDir, "validation.json"))
          const tests = readJson(path.join(artifactDir, "tests.json"))
          const critic = readJson(path.join(artifactDir, "critic.json"))
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

          const relativePage = posix(path.relative(gardenRoot, filePath))
          if (!relativePage.startsWith("learning/") || posix(String(manifest.targetPage ?? "")) !== relativePage) {
            markInvalid(node, "generated visualization is referenced from an unauthorized page")
            return
          }

          const siblings = parent && Array.isArray(parent.children) ? parent.children : []
          const before = typeof index === "number" ? siblings.slice(0, index) : []
          const precedingHeading = [...before].reverse().find((candidate) => candidate.type === "heading")
          const targetHeading = normalizeHeading(String(manifest.targetHeading ?? ""))
          const visibleHeading = normalizeHeading(
            precedingHeading ? nodeText(precedingHeading) : String(file.data.frontmatter?.title ?? ""),
          )
          if (!targetHeading || !(visibleHeading === targetHeading || visibleHeading.endsWith(` ${targetHeading}`))) {
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

          let compiled = ""
          let source = ""
          try {
            compiled = fs.readFileSync(path.join(artifactDir, "compiled.js"), "utf8")
            source = fs.readFileSync(path.join(artifactDir, "source.tsx"), "utf8")
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
