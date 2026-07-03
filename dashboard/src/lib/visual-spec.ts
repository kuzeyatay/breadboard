/**
 * Breadboard VisualSpec: the typed, data-driven contract between LLM-generated
 * visualization specs and the trusted Quartz renderer.
 *
 * The LLM only ever produces JSON matching this schema. It is validated and
 * sanitized here before anything reaches the page; the renderer builds DOM via
 * createElement/textContent only, so no spec string can ever execute.
 *
 * NOTE: this is a dependency-free mirror of quartz/quartz/util/visualSpec.ts
 * (the canonical copy, which also carries the unit tests) — keep the two in
 * sync.
 */

export const VISUAL_TYPES = [
  "function_plot",
  "linked_time_plots",
  "phase_space",
  "mass_spring",
  "pendulum",
  "energy_exchange",
  "damping_envelope",
  "resonance_curve",
  "travelling_wave",
  "standing_wave",
  "ray_diagram",
  "source_figure_explainer",
  "formula_derivation",
  "concept_diagram",
  "comparison_table",
] as const

export type VisualType = (typeof VISUAL_TYPES)[number]

/** Visual types the Quartz renderer can draw interactively today. Everything
 * else in VISUAL_TYPES is schema-valid and degrades to a readable card. */
export const IMPLEMENTED_VISUAL_TYPES = [
  "function_plot",
  "linked_time_plots",
  "mass_spring",
  "energy_exchange",
  "resonance_curve",
] as const

export interface SourceAnchor {
  sourceId?: string
  sourceTitle?: string
  page?: number
  figureId?: string
  tableId?: string
  equationId?: string
  questionId?: string
  description: string
}

export interface FormulaRef {
  latex: string
  explanation: string
  symbols: Record<string, string>
}

export interface VisualControl {
  name: string
  label: string
  type: "slider" | "toggle" | "select"
  min?: number
  max?: number
  step?: number
  options?: string[]
  defaultValue?: unknown
}

export interface VisualAnnotation {
  label: string
  target?: string
  explanation: string
}

export interface VisualSpec {
  id: string
  gardenId?: string
  pageId?: string
  type: VisualType
  title: string
  subtitle?: string
  sourceAnchors: SourceAnchor[]
  conceptTargets: string[]
  misconceptionTargets?: string[]
  pedagogicalPurpose: string
  formulaRefs?: FormulaRef[]
  props: Record<string, unknown>
  controls?: VisualControl[]
  annotations?: VisualAnnotation[]
  caption?: string
  regenerationPrompt: string
  createdAt: string
  updatedAt?: string
  version: number
}

const MAX_SPEC_CHARS = 40000
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/
const CONTROL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
const CONTROL_TYPES = new Set(["slider", "toggle", "select"])

/** Anything that could smuggle executable behavior through a string field. */
const FORBIDDEN_PATTERN =
  /<\s*script|<\s*iframe|<\s*object|<\s*embed|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|srcdoc\s*=|\bon[a-z]+\s*=|\beval\s*\(|new\s+Function|import\s*\(|document\s*\.\s*(write|cookie)|window\s*\[/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeString(value: unknown, field: string, errors: string[], maxLen = 4000): string | undefined {
  if (typeof value !== "string") return undefined
  if (value.length > maxLen) {
    errors.push(`${field} is too long`)
    return undefined
  }
  if (FORBIDDEN_PATTERN.test(value)) {
    errors.push(`${field} contains forbidden content`)
    return undefined
  }
  return value
}

function safeStringArray(value: unknown, field: string, errors: string[]): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value.slice(0, 40)) {
    const str = safeString(item, field, errors, 500)
    if (str !== undefined && str.trim()) out.push(str)
  }
  return out
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Recursively sanitize prop values: finite numbers, booleans, safe strings,
 * arrays and shallow objects of those. Everything else is dropped. */
function sanitizeValue(value: unknown, field: string, errors: string[], depth: number): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "boolean") return value
  if (typeof value === "string") return safeString(value, field, errors, 2000)
  if (Array.isArray(value)) {
    if (depth <= 0) return undefined
    const out = value
      .slice(0, 200)
      .map((item) => sanitizeValue(item, field, errors, depth - 1))
      .filter((item) => item !== undefined)
    return out
  }
  if (isPlainObject(value)) {
    if (depth <= 0) return undefined
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      if (!CONTROL_NAME_PATTERN.test(key) && !/^[A-Za-z0-9_ .-]{1,60}$/.test(key)) continue
      const sanitized = sanitizeValue(item, `${field}.${key}`, errors, depth - 1)
      if (sanitized !== undefined) out[key] = sanitized
    }
    return out
  }
  return undefined
}

function sanitizeSourceAnchors(value: unknown, errors: string[]): SourceAnchor[] {
  if (!Array.isArray(value)) return []
  const anchors: SourceAnchor[] = []
  for (const raw of value.slice(0, 20)) {
    if (!isPlainObject(raw)) continue
    const description = safeString(raw.description, "sourceAnchors.description", errors, 1000)
    if (!description || !description.trim()) continue
    const anchor: SourceAnchor = { description }
    const sourceId = safeString(raw.sourceId, "sourceAnchors.sourceId", errors, 200)
    const sourceTitle = safeString(raw.sourceTitle, "sourceAnchors.sourceTitle", errors, 300)
    const figureId = safeString(raw.figureId, "sourceAnchors.figureId", errors, 80)
    const tableId = safeString(raw.tableId, "sourceAnchors.tableId", errors, 80)
    const equationId = safeString(raw.equationId, "sourceAnchors.equationId", errors, 80)
    const questionId = safeString(raw.questionId, "sourceAnchors.questionId", errors, 80)
    const page = finiteNumber(raw.page)
    if (sourceId) anchor.sourceId = sourceId
    if (sourceTitle) anchor.sourceTitle = sourceTitle
    if (figureId) anchor.figureId = figureId
    if (tableId) anchor.tableId = tableId
    if (equationId) anchor.equationId = equationId
    if (questionId) anchor.questionId = questionId
    if (page !== undefined) anchor.page = page
    anchors.push(anchor)
  }
  return anchors
}

function sanitizeControls(value: unknown, errors: string[]): VisualControl[] {
  if (!Array.isArray(value)) return []
  const controls: VisualControl[] = []
  for (const raw of value.slice(0, 12)) {
    if (!isPlainObject(raw)) continue
    const name = typeof raw.name === "string" && CONTROL_NAME_PATTERN.test(raw.name) ? raw.name : null
    const label = safeString(raw.label, "controls.label", errors, 200)
    const type = typeof raw.type === "string" && CONTROL_TYPES.has(raw.type) ? raw.type : null
    if (!name || !label || !type) {
      errors.push("control entries need a valid name, label, and type")
      continue
    }
    const control: VisualControl = { name, label, type: type as VisualControl["type"] }
    const min = finiteNumber(raw.min)
    const max = finiteNumber(raw.max)
    const step = finiteNumber(raw.step)
    if (min !== undefined) control.min = min
    if (max !== undefined) control.max = max
    if (step !== undefined) control.step = step
    if (Array.isArray(raw.options)) control.options = safeStringArray(raw.options, "controls.options", errors)
    const defaultValue = sanitizeValue(raw.defaultValue, "controls.defaultValue", errors, 1)
    if (defaultValue !== undefined) control.defaultValue = defaultValue
    controls.push(control)
  }
  return controls
}

function sanitizeFormulaRefs(value: unknown, errors: string[]): FormulaRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const refs: FormulaRef[] = []
  for (const raw of value.slice(0, 12)) {
    if (!isPlainObject(raw)) continue
    const latex = safeString(raw.latex, "formulaRefs.latex", errors, 1000)
    const explanation = safeString(raw.explanation, "formulaRefs.explanation", errors, 2000)
    if (!latex || !explanation) continue
    const symbols: Record<string, string> = {}
    if (isPlainObject(raw.symbols)) {
      for (const [key, item] of Object.entries(raw.symbols).slice(0, 30)) {
        const symbolKey = safeString(key, "formulaRefs.symbols", errors, 80)
        const symbolValue = safeString(item, "formulaRefs.symbols", errors, 400)
        if (symbolKey && symbolValue) symbols[symbolKey] = symbolValue
      }
    }
    refs.push({ latex, explanation, symbols })
  }
  return refs.length > 0 ? refs : undefined
}

function sanitizeAnnotations(value: unknown, errors: string[]): VisualAnnotation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const annotations: VisualAnnotation[] = []
  for (const raw of value.slice(0, 20)) {
    if (!isPlainObject(raw)) continue
    const label = safeString(raw.label, "annotations.label", errors, 200)
    const explanation = safeString(raw.explanation, "annotations.explanation", errors, 1500)
    if (!label || !explanation) continue
    const annotation: VisualAnnotation = { label, explanation }
    const target = safeString(raw.target, "annotations.target", errors, 200)
    if (target) annotation.target = target
    annotations.push(annotation)
  }
  return annotations.length > 0 ? annotations : undefined
}

export interface VisualSpecValidation {
  spec: VisualSpec | null
  errors: string[]
}

/** Validate + sanitize an untrusted VisualSpec candidate. Returns a cleaned
 * spec containing only known fields, or null with the reasons it failed. */
export function validateVisualSpec(input: unknown): VisualSpecValidation {
  const errors: string[] = []

  let candidate: unknown = input
  if (typeof input === "string") {
    if (input.length > MAX_SPEC_CHARS) return { spec: null, errors: ["spec JSON is too large"] }
    try {
      candidate = JSON.parse(input)
    } catch {
      return { spec: null, errors: ["spec is not valid JSON"] }
    }
  }
  if (!isPlainObject(candidate)) return { spec: null, errors: ["spec must be a JSON object"] }

  try {
    if (JSON.stringify(candidate).length > MAX_SPEC_CHARS) {
      return { spec: null, errors: ["spec JSON is too large"] }
    }
  } catch {
    return { spec: null, errors: ["spec is not serializable"] }
  }

  const id = typeof candidate.id === "string" && ID_PATTERN.test(candidate.id) ? candidate.id : null
  if (!id) errors.push("id is required and must match [A-Za-z0-9_-]{1,80}")

  const type =
    typeof candidate.type === "string" && (VISUAL_TYPES as readonly string[]).includes(candidate.type)
      ? (candidate.type as VisualType)
      : null
  if (!type) errors.push(`type must be one of: ${VISUAL_TYPES.join(", ")}`)

  const title = safeString(candidate.title, "title", errors, 300)
  if (!title || !title.trim()) errors.push("title is required")

  const pedagogicalPurpose = safeString(candidate.pedagogicalPurpose, "pedagogicalPurpose", errors, 2000)
  if (!pedagogicalPurpose || !pedagogicalPurpose.trim()) errors.push("pedagogicalPurpose is required")

  const regenerationPrompt = safeString(candidate.regenerationPrompt, "regenerationPrompt", errors, 2000)
  if (!regenerationPrompt || !regenerationPrompt.trim()) errors.push("regenerationPrompt is required")

  const props = isPlainObject(candidate.props)
    ? (sanitizeValue(candidate.props, "props", errors, 3) as Record<string, unknown>)
    : {}

  if (errors.length > 0) return { spec: null, errors }

  const spec: VisualSpec = {
    id: id!,
    type: type!,
    title: title!,
    sourceAnchors: sanitizeSourceAnchors(candidate.sourceAnchors, errors),
    conceptTargets: safeStringArray(candidate.conceptTargets, "conceptTargets", errors),
    pedagogicalPurpose: pedagogicalPurpose!,
    props: props ?? {},
    regenerationPrompt: regenerationPrompt!,
    createdAt:
      safeString(candidate.createdAt, "createdAt", errors, 60) || new Date().toISOString(),
    version:
      typeof candidate.version === "number" && Number.isInteger(candidate.version) && candidate.version > 0
        ? candidate.version
        : 1,
  }

  const subtitle = safeString(candidate.subtitle, "subtitle", errors, 500)
  if (subtitle) spec.subtitle = subtitle
  const caption = safeString(candidate.caption, "caption", errors, 1500)
  if (caption) spec.caption = caption
  const gardenId = safeString(candidate.gardenId, "gardenId", errors, 200)
  if (gardenId) spec.gardenId = gardenId
  const pageId = safeString(candidate.pageId, "pageId", errors, 300)
  if (pageId) spec.pageId = pageId
  const updatedAt = safeString(candidate.updatedAt, "updatedAt", errors, 60)
  if (updatedAt) spec.updatedAt = updatedAt

  const misconceptions = safeStringArray(candidate.misconceptionTargets, "misconceptionTargets", errors)
  if (misconceptions.length > 0) spec.misconceptionTargets = misconceptions
  const controls = sanitizeControls(candidate.controls, errors)
  if (controls.length > 0) spec.controls = controls
  const formulaRefs = sanitizeFormulaRefs(candidate.formulaRefs, errors)
  if (formulaRefs) spec.formulaRefs = formulaRefs
  const annotations = sanitizeAnnotations(candidate.annotations, errors)
  if (annotations) spec.annotations = annotations

  // String-level violations discovered while sanitizing optional fields are
  // fatal: a spec that tried to smuggle executable content is never rendered.
  if (errors.some((message) => message.includes("forbidden content"))) {
    return { spec: null, errors }
  }

  return { spec, errors }
}

// ---------------------------------------------------------------------------
// Markdown block + legacy placeholder helpers
// ---------------------------------------------------------------------------

export const VISUAL_BLOCK_LANG = "breadboard-visual"

/** Legacy bracket placeholders emitted by earlier generations. */
export const PLACEHOLDER_PATTERN =
  /\[(?:Interactive visual|Visual|Generated visual)\s*:\s*([^\[\]]+)\]/gi

export interface VisualPlaceholder {
  fullMatch: string
  /** Text after the colon: "title — what it teaches". */
  body: string
  title: string
  description: string
  index: number
}

export function findVisualPlaceholders(markdown: string): VisualPlaceholder[] {
  const placeholders: VisualPlaceholder[] = []
  const pattern = new RegExp(PLACEHOLDER_PATTERN.source, PLACEHOLDER_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    const body = match[1].trim()
    const separator = body.search(/\s+[—–-]\s+|\s+—\s*|\s*—\s+/)
    const emDash = body.indexOf("—")
    let title = body
    let description = ""
    if (emDash > 0) {
      title = body.slice(0, emDash).trim()
      description = body.slice(emDash + 1).trim()
    } else if (separator > 0) {
      title = body.slice(0, separator).trim()
      description = body.slice(separator).replace(/^\s*[—–-]\s*/, "").trim()
    }
    placeholders.push({
      fullMatch: match[0],
      body,
      title: title || "Interactive visual",
      description,
      index: match.index,
    })
  }
  return placeholders
}

/** Serialize a VisualSpec into the fenced block embedded in Markdown. */
export function buildVisualBlock(spec: VisualSpec): string {
  return "```" + VISUAL_BLOCK_LANG + "\n" + JSON.stringify(spec, null, 2) + "\n```"
}

/** Replace one placeholder occurrence with a visual block. */
export function replacePlaceholderWithBlock(
  markdown: string,
  placeholder: VisualPlaceholder,
  spec: VisualSpec,
): string {
  return (
    markdown.slice(0, placeholder.index) +
    buildVisualBlock(spec) +
    markdown.slice(placeholder.index + placeholder.fullMatch.length)
  )
}

/** Mutates an mdast `code` node in place so the trusted client renderer can
 * hydrate it. Only specs with a truly interactive renderer are hydrated;
 * schema-valid-but-non-interactive and invalid blocks are tagged for removal
 * (interactive or nothing — there is no static explainer card). Returns
 * whether the node carries a renderable spec. Kept here (dependency-free) so
 * it is unit-testable without loading the transformer's bundled imports. */
export function tagVisualCodeNode(node: {
  lang?: string | null
  value: string
  data?: unknown
}): boolean {
  const { spec, errors } = validateVisualSpec(node.value)
  if (spec && (IMPLEMENTED_VISUAL_TYPES as readonly string[]).includes(spec.type)) {
    node.data = {
      hProperties: {
        className: ["breadboard-visual-block"],
        "data-visual-spec": JSON.stringify(spec),
      },
    }
    // No-JS / pre-hydration fallback stays readable.
    node.value = `Interactive visual: ${spec.title}${spec.caption ? ` — ${spec.caption}` : ""}`
    return true
  }
  if (spec) {
    node.data = {
      hProperties: {
        className: ["breadboard-visual-block", "breadboard-visual-noninteractive"],
        "data-visual-error": `type "${spec.type}" has no interactive renderer`,
      },
    }
    node.value = ""
    return false
  }
  node.data = {
    hProperties: {
      className: ["breadboard-visual-block", "breadboard-visual-invalid"],
      "data-visual-error": errors.slice(0, 3).join("; ") || "invalid visual spec",
    },
  }
  node.value = ""
  return false
}

// ---------------------------------------------------------------------------
// Source figure labeling: S{sourceIndex}.P{page}.{F|T|G}{n}
// ---------------------------------------------------------------------------

export type SourceFigureKind = "graph" | "diagram" | "table" | "photo" | "formula" | "unknown"

export interface SourceFigure {
  figureId: string
  sourceId?: string
  page?: number
  kind: SourceFigureKind
  caption?: string
  ocrText?: string
  relevanceNotes?: string
  suggestedVisualUse?: string
}

const FIGURE_KIND_LETTER: Record<SourceFigureKind, string> = {
  graph: "G",
  diagram: "F",
  table: "T",
  photo: "F",
  formula: "F",
  unknown: "F",
}

/** Assign stable internal ids (S1.P7.F2 style) to source figures that do not
 * already carry one. Numbering restarts per page per kind letter. */
export function assignSourceFigureIds(
  sourceIndex: number,
  figures: Array<Partial<SourceFigure> & { page?: number }>,
): SourceFigure[] {
  const counters = new Map<string, number>()
  return figures.map((figure) => {
    const kind: SourceFigureKind = figure.kind ?? "unknown"
    const page = typeof figure.page === "number" && Number.isFinite(figure.page) ? figure.page : 0
    const letter = FIGURE_KIND_LETTER[kind] ?? "F"
    const counterKey = `${page}:${letter}`
    const next = (counters.get(counterKey) ?? 0) + 1
    counters.set(counterKey, next)
    const figureId =
      typeof figure.figureId === "string" && figure.figureId.trim()
        ? figure.figureId
        : `S${sourceIndex}.P${page}.${letter}${next}`
    return {
      ...figure,
      figureId,
      kind,
      page: figure.page,
    }
  })
}
