import test, { describe } from "node:test"
import assert from "node:assert"

import {
  assignSourceFigureIds,
  buildVisualBlock,
  findVisualPlaceholders,
  replacePlaceholderWithBlock,
  tagVisualCodeNode,
  validateVisualSpec,
  VISUAL_BLOCK_LANG,
  VisualSpec,
} from "./visualSpec"

const validSpec = {
  id: "vis_shm_xva_001",
  type: "linked_time_plots",
  title: "Position, velocity, and acceleration in SHM",
  sourceAnchors: [
    {
      sourceId: "module_v_slides",
      page: 12,
      figureId: "S1.P12.F1",
      description: "Slide graph comparing x(t), v(t), and a(t)",
    },
  ],
  conceptTargets: ["simple harmonic motion", "phase difference"],
  pedagogicalPurpose: "Show that x, v, and a are linked descriptions of the same motion.",
  props: { amplitude: 1, angularFrequency: 1, phase: 0, showVelocity: true },
  controls: [
    { name: "amplitude", label: "Amplitude A", type: "slider", min: 0.2, max: 2, step: 0.1 },
  ],
  caption: "Watch how the three curves stay locked in phase relationships.",
  regenerationPrompt: "Regenerate to better explain the phase relationship.",
  createdAt: "2026-07-02T00:00:00.000Z",
  version: 1,
}

describe("validateVisualSpec", () => {
  test("accepts a valid spec and preserves its fields", () => {
    const { spec, errors } = validateVisualSpec(validSpec)
    assert.ok(spec, `expected valid spec, got errors: ${errors.join(", ")}`)
    assert.strictEqual(spec!.id, "vis_shm_xva_001")
    assert.strictEqual(spec!.type, "linked_time_plots")
    assert.strictEqual(spec!.sourceAnchors[0].figureId, "S1.P12.F1")
    assert.strictEqual(spec!.controls?.length, 1)
    assert.strictEqual(spec!.version, 1)
  })

  test("accepts a JSON string input", () => {
    const { spec } = validateVisualSpec(JSON.stringify(validSpec))
    assert.ok(spec)
    assert.strictEqual(spec!.title, validSpec.title)
  })

  test("rejects script content in string fields", () => {
    const dirty = { ...validSpec, caption: 'nice <script>alert("x")</script>' }
    const { spec, errors } = validateVisualSpec(dirty)
    assert.strictEqual(spec, null)
    assert.ok(errors.some((message) => message.includes("forbidden content")))
  })

  test("rejects javascript: URLs and event handlers in props", () => {
    const dirty = {
      ...validSpec,
      props: { label: "javascript:alert(1)" },
    }
    const { spec } = validateVisualSpec(dirty)
    assert.strictEqual(spec, null)
  })

  test("rejects unknown visual types", () => {
    const { spec, errors } = validateVisualSpec({ ...validSpec, type: "custom_widget" })
    assert.strictEqual(spec, null)
    assert.ok(errors.some((message) => message.startsWith("type must be one of")))
  })

  test("rejects missing required fields", () => {
    const { spec, errors } = validateVisualSpec({ type: "function_plot", title: "x" })
    assert.strictEqual(spec, null)
    assert.ok(errors.some((message) => message.includes("id is required")))
    assert.ok(errors.some((message) => message.includes("pedagogicalPurpose")))
    assert.ok(errors.some((message) => message.includes("regenerationPrompt")))
  })

  test("accepts allowlisted-but-unimplemented types (renderer degrades gracefully)", () => {
    const { spec } = validateVisualSpec({ ...validSpec, type: "ray_diagram" })
    assert.ok(spec)
    assert.strictEqual(spec!.type, "ray_diagram")
  })

  test("drops plain-English source anchor labels from visual anchor id fields", () => {
    const dirty = {
      ...validSpec,
      sourceAnchors: [
        {
          ...validSpec.sourceAnchors[0],
          figureId: "source caveats",
          textAnchorId: "S1.P12.spike-timing",
        },
      ],
    }
    const { spec, errors } = validateVisualSpec(dirty)
    assert.ok(spec)
    assert.strictEqual(spec!.sourceAnchors[0].figureId, undefined)
    assert.strictEqual(spec!.sourceAnchors[0].textAnchorId, "S1.P12.spike-timing")
    assert.ok(errors.some((message) => message.includes("sourceAnchors.figureId") && message.includes("planning_caveat")))
  })

  test("drops unknown fields and non-scalar junk from props", () => {
    const { spec } = validateVisualSpec({
      ...validSpec,
      __proto__pollution: true,
      props: { amplitude: 2, weird: () => 1, nested: { ok: 3 } },
    })
    assert.ok(spec)
    assert.strictEqual((spec!.props as Record<string, unknown>).amplitude, 2)
    assert.strictEqual((spec!.props as Record<string, unknown>).weird, undefined)
    assert.deepStrictEqual((spec!.props as Record<string, unknown>).nested, { ok: 3 })
    assert.strictEqual((spec as unknown as Record<string, unknown>).__proto__pollution, undefined)
  })
})

describe("visual placeholders", () => {
  const markdown = [
    "Some prose before.",
    "",
    "[Interactive visual: Horizontal mass-spring oscillator — adjust $m$ and $k$ and observe the period]",
    "",
    "More prose.",
    "",
    "[Visual: Energy bars]",
    "",
    "[Generated visual: Resonance curve — sweep the drive frequency]",
  ].join("\n")

  test("detects all legacy placeholder styles", () => {
    const placeholders = findVisualPlaceholders(markdown)
    assert.strictEqual(placeholders.length, 3)
    assert.strictEqual(placeholders[0].title, "Horizontal mass-spring oscillator")
    assert.ok(placeholders[0].description.includes("observe the period"))
    assert.strictEqual(placeholders[1].title, "Energy bars")
    assert.strictEqual(placeholders[2].title, "Resonance curve")
  })

  test("replaces a placeholder with a breadboard-visual block", () => {
    const placeholders = findVisualPlaceholders(markdown)
    const { spec } = validateVisualSpec(validSpec)
    const next = replacePlaceholderWithBlock(markdown, placeholders[0], spec as VisualSpec)
    assert.ok(!next.includes("[Interactive visual:"))
    assert.ok(next.includes("```" + VISUAL_BLOCK_LANG))
    assert.ok(next.includes('"id": "vis_shm_xva_001"'))
    // Other placeholders untouched
    assert.ok(next.includes("[Visual: Energy bars]"))
  })

  test("buildVisualBlock produces a parseable fenced block", () => {
    const { spec } = validateVisualSpec(validSpec)
    const block = buildVisualBlock(spec as VisualSpec)
    const inner = block.replace("```" + VISUAL_BLOCK_LANG + "\n", "").replace(/\n```$/, "")
    const reparsed = validateVisualSpec(inner)
    assert.ok(reparsed.spec)
    assert.strictEqual(reparsed.spec!.id, "vis_shm_xva_001")
  })
})

describe("source figure labeling", () => {
  test("assigns S{source}.P{page}.{kind}{n} ids and keeps existing ids", () => {
    const figures = assignSourceFigureIds(1, [
      { page: 7, kind: "graph" },
      { page: 7, kind: "graph" },
      { page: 7, kind: "table" },
      { page: 12, kind: "diagram" },
      { page: 3, kind: "graph", figureId: "S1.P3.G9" },
    ])
    assert.strictEqual(figures[0].figureId, "S1.P7.G1")
    assert.strictEqual(figures[1].figureId, "S1.P7.G2")
    assert.strictEqual(figures[2].figureId, "S1.P7.T1")
    assert.strictEqual(figures[3].figureId, "S1.P12.F1")
    assert.strictEqual(figures[4].figureId, "S1.P3.G9")
  })
})

describe("visual code block tagging (transformer core)", () => {
  test("tags valid blocks with the sanitized spec and readable fallback", () => {
    const codeNode = {
      lang: VISUAL_BLOCK_LANG,
      value: JSON.stringify(validSpec),
      data: undefined as unknown,
    }
    const ok = tagVisualCodeNode(codeNode)
    assert.strictEqual(ok, true)
    const data = codeNode.data as { hProperties: Record<string, unknown> }
    assert.deepStrictEqual(data.hProperties.className, ["breadboard-visual-block"])
    const embedded = JSON.parse(data.hProperties["data-visual-spec"] as string)
    assert.strictEqual(embedded.id, "vis_shm_xva_001")
    assert.ok(codeNode.value.startsWith("Interactive visual:"))
  })

  test("tags invalid blocks for removal with no spec payload and no fallback text", () => {
    const codeNode = {
      lang: VISUAL_BLOCK_LANG,
      value: '{"id": "x", "type": "not_a_type"}',
      data: undefined as unknown,
    }
    const ok = tagVisualCodeNode(codeNode)
    assert.strictEqual(ok, false)
    const data = codeNode.data as { hProperties: Record<string, unknown> }
    assert.deepStrictEqual(data.hProperties.className, [
      "breadboard-visual-block",
      "breadboard-visual-invalid",
    ])
    assert.strictEqual(data.hProperties["data-visual-spec"], undefined)
    assert.ok(typeof data.hProperties["data-visual-error"] === "string")
    assert.strictEqual(codeNode.value, "")
  })

  test("tags schema-valid but non-interactive blocks for removal (no static card)", () => {
    const codeNode = {
      lang: VISUAL_BLOCK_LANG,
      value: JSON.stringify({ ...validSpec, type: "concept_diagram" }),
      data: undefined as unknown,
    }
    const ok = tagVisualCodeNode(codeNode)
    assert.strictEqual(ok, false)
    const data = codeNode.data as { hProperties: Record<string, unknown> }
    assert.deepStrictEqual(data.hProperties.className, [
      "breadboard-visual-block",
      "breadboard-visual-noninteractive",
    ])
    assert.strictEqual(data.hProperties["data-visual-spec"], undefined)
    assert.ok(String(data.hProperties["data-visual-error"]).includes("concept_diagram"))
    assert.strictEqual(codeNode.value, "")
  })
})
