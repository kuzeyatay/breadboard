// Breadboard visualization service: generates VisualSpec JSON through
// ChatMock/Council, stores specs per garden, migrates legacy bracket
// placeholders into real breadboard-visual blocks, and records ledger events.
//
// The LLM only ever produces JSON specs (validated by ./visual-spec); the
// interactive rendering happens inside Quartz via trusted components.

import fs from 'fs';
import path from 'path';
import type OpenAI from 'openai';
import { withCouncil } from './council';
import {
  buildVisualBlock,
  findVisualPlaceholders,
  replacePlaceholderWithBlock,
  validateVisualSpec,
  IMPLEMENTED_VISUAL_TYPES,
  type SourceFigure,
  type VisualPlaceholder,
  type VisualSpec,
} from './visual-spec';

export type { VisualSpec, SourceFigure };

// ---------------------------------------------------------------------------
// Storage: quartz/content/<garden>/.breadboard/{visuals/*.json, visual-index.json, events.jsonl}
// ---------------------------------------------------------------------------

export function gardenBreadboardDir(contentPath: string, gardenSlug: string): string {
  return path.join(contentPath, gardenSlug, '.breadboard');
}

function visualsDir(contentPath: string, gardenSlug: string): string {
  return path.join(gardenBreadboardDir(contentPath, gardenSlug), 'visuals');
}

interface VisualIndexEntry {
  id: string;
  pageSlug?: string;
  type: string;
  title: string;
  version: number;
  updatedAt: string;
}

export function saveVisualSpec(
  contentPath: string,
  gardenSlug: string,
  spec: VisualSpec,
  pageSlug?: string,
): void {
  try {
    const dir = visualsDir(contentPath, gardenSlug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${spec.id}.json`), JSON.stringify(spec, null, 2), 'utf-8');

    const indexPath = path.join(gardenBreadboardDir(contentPath, gardenSlug), 'visual-index.json');
    let index: Record<string, VisualIndexEntry> = {};
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch {
      index = {};
    }
    index[spec.id] = {
      id: spec.id,
      pageSlug: pageSlug ?? spec.pageId,
      type: spec.type,
      title: spec.title,
      version: spec.version,
      updatedAt: spec.updatedAt ?? spec.createdAt,
    };
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[visuals] could not persist spec ${spec.id}:`, error);
  }
}

/**
 * Prune stale interactive-visual artifacts after a generation run. The index
 * merges on every save, so IDs from earlier runs linger even after their page
 * was overwritten or removed. This rewrites visual-index.json to only the
 * visuals still referenced by the current run and deletes orphan spec files, so
 * the index never advertises a visual no page embeds.
 *
 * Returns the ids that were removed (for logging).
 */
export function pruneVisualArtifacts(
  contentPath: string,
  gardenSlug: string,
  keepIds: Iterable<string>,
): { removedFromIndex: string[]; removedSpecFiles: string[] } {
  const keep = new Set(keepIds);
  const removedFromIndex: string[] = [];
  const removedSpecFiles: string[] = [];
  try {
    const indexPath = path.join(gardenBreadboardDir(contentPath, gardenSlug), 'visual-index.json');
    let index: Record<string, VisualIndexEntry> = {};
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch {
      index = {};
    }
    const nextIndex: Record<string, VisualIndexEntry> = {};
    for (const [id, entry] of Object.entries(index)) {
      if (keep.has(id)) nextIndex[id] = entry;
      else removedFromIndex.push(id);
    }
    fs.writeFileSync(indexPath, JSON.stringify(nextIndex, null, 2), 'utf-8');

    // Delete orphan spec files so the on-disk visuals/ set matches the index.
    const dir = visualsDir(contentPath, gardenSlug);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    } catch {
      files = [];
    }
    for (const file of files) {
      const id = file.replace(/\.json$/i, '');
      if (keep.has(id)) continue;
      try {
        fs.rmSync(path.join(dir, file), { force: true });
        removedSpecFiles.push(id);
      } catch {
        // Best-effort; a lingering spec file is caught by the validator.
      }
    }
  } catch (error) {
    console.warn(`[visuals] could not prune stale visuals for ${gardenSlug}:`, error);
  }
  return { removedFromIndex, removedSpecFiles };
}

export function loadVisualSpec(
  contentPath: string,
  gardenSlug: string,
  visualId: string,
): VisualSpec | null {
  try {
    const raw = fs.readFileSync(path.join(visualsDir(contentPath, gardenSlug), `${visualId}.json`), 'utf-8');
    const { spec } = validateVisualSpec(raw);
    return spec;
  } catch {
    return null;
  }
}

/** Garden event ledger (JSONL). Ledger failures never block the caller. */
export function appendGardenEvent(
  contentPath: string,
  gardenSlug: string,
  type: string,
  data: Record<string, unknown>,
): void {
  try {
    const dir = gardenBreadboardDir(contentPath, gardenSlug);
    fs.mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({ type, at: new Date().toISOString(), ...data });
    fs.appendFileSync(path.join(dir, 'events.jsonl'), entry + '\n', 'utf-8');
  } catch (error) {
    console.warn(`[visuals] could not record event ${type}:`, error);
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const IMPLEMENTED_PROPS_GUIDE = `Prop contracts for the interactive types (these are the ONLY allowed types):
- function_plot: { "family": "sine"|"cosine"|"damped_sine"|"exp_decay"|"exponential"|"gaussian"|"polynomial"|"linear"|"abs"|"reciprocal", "parameters": {"a":1,"b":1,"c":0,"d":0} or {"coefficients":[c0,c1,...]}, "xMin": -5, "xMax": 5, "expressionLatex": "f(x)=..." }
- linked_time_plots: { "amplitude": 1, "angularFrequency": 1, "phase": 0, "duration": 12, "showPosition": true, "showVelocity": true, "showAcceleration": true }
- mass_spring: { "amplitude": 1, "angularFrequency": 1, "phase": 0, "showForceVector": true, "showVelocityVector": false }
- energy_exchange: { "amplitude": 1, "springConstant": 1, "mass": 1, "phase": 0 }
- resonance_curve: { "naturalFrequency": 1, "damping": 0.2, "driveFrequency": 1 }
- lif_neuron (leaky integrate-and-fire membrane simulator: input, leak, threshold, reset, refractory): { "restPotential": 0, "threshold": 1, "resetPotential": 0, "inputCurrent": 1.2, "leak": 0.15, "refractory": 2, "duration": 40 } — good controls: inputCurrent, leak, threshold, refractory (sliders).
- neural_coding (rate coding vs temporal coding for one stimulus): { "strength": 0.6, "mode": "both" } — controls: strength (slider 0..1), mode (select: rate|temporal|both).
- stdp_window (spike-timing-dependent plasticity Δw vs Δt): { "aPlus": 1, "aMinus": 1, "tauPlus": 20, "tauMinus": 20, "deltaT": 8 } — controls: deltaT (slider, e.g. -60..60), aPlus, aMinus (sliders).
- tradeoff_explorer (accuracy/latency/energy tradeoff across model families): { "models": [ {"label": "ANN", "accuracy": 0.99, "latency": 0.9, "energy": 0.95}, {"label": "Converted SNN", "accuracy": 0.95, "latency": 0.6, "energy": 0.45}, {"label": "Surrogate-gradient SNN", "accuracy": 0.96, "latency": 0.45, "energy": 0.4}, {"label": "STDP SNN", "accuracy": 0.86, "latency": 0.35, "energy": 0.2} ], "priority": "balanced" } — accuracy is 0..1 higher-better; latency and energy are 0..1 lower-better (cost). Control: priority (select: accuracy|latency|energy|balanced).
Controls bind by "name" to a prop key (e.g. a slider named "amplitude" drives props.amplitude).`;

const VISUAL_SPEC_SYSTEM_PROMPT =
  `You design ONE interactive visualization spec for a Breadboard learning page. ` +
  `Return ONLY a single JSON object — no markdown fence, no commentary.\n\n` +
  `Required fields: id (short slug like "vis_shm_energy_001"), type, title, sourceAnchors (array, may be empty; ` +
  `each anchor: {sourceId?, sourceTitle?, page?, figureId?, description}), conceptTargets (string array), ` +
  `pedagogicalPurpose (why this visual belongs exactly here), props (object), controls (array of ` +
  `{name, label, type: "slider"|"toggle"|"select", min?, max?, step?, options?, defaultValue?}), ` +
  `caption, regenerationPrompt (how to improve it next time). Optional: subtitle, misconceptionTargets, ` +
  `formulaRefs ({latex, explanation, symbols}), annotations ({label, target?, explanation}).\n\n` +
  `Allowed types: ${IMPLEMENTED_VISUAL_TYPES.join(', ')}. Every visual you design MUST be genuinely interactive — ` +
  `there is no static fallback, so any other type is rejected and nothing is shown.\n` +
  `If none of the allowed interactive types genuinely fits this concept, return exactly {"skip": true, "reason": "why no interactive visual fits"} ` +
  `instead of forcing a spec. A page with no visual is always better than a non-interactive one.\n\n` +
  IMPLEMENTED_PROPS_GUIDE +
  `\n\nHard rules:\n` +
  `- The visual must clarify the specific concept at this point in the page, intuition before memorization.\n` +
  `- Controls must teach something (each control should change what the learner sees meaningfully).\n` +
  `- Include sourceAnchors whenever source figures/pages are given; never invent source-specific claims and never exceed the source scope.\n` +
  `- Strings only contain plain text and LaTeX. Never produce code, scripts, HTML tags, URLs to executables, or event handlers.\n` +
  `- Numbers must be finite; keep props physically sensible.`;

export interface VisualGenerationContext {
  gardenId?: string;
  pageId?: string;
  sectionTitle?: string;
  subsectionTitle?: string;
  pageMarkdown?: string;
  sourceContext?: unknown;
  sourceFigures?: SourceFigure[];
  learningSpine?: unknown;
  topicMap?: unknown;
  userInstructions?: string;
  visualOpportunity?: string;
  /** Existing spec, when regenerating. */
  existingSpec?: VisualSpec | null;
  councilModeOverride?: 'direct_council' | 'lite_council' | 'full_council';
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n[...truncated...]`;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function newVisualId(): string {
  return `vis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface GeneratedVisual {
  spec: VisualSpec | null;
  errors: string[];
}

/** VisualizationGenerator: one ChatMock/Council call -> one validated VisualSpec. */
export async function generateVisualSpec(
  client: OpenAI,
  model: string,
  context: VisualGenerationContext,
): Promise<GeneratedVisual> {
  const userPayload = {
    visualOpportunity: context.visualOpportunity,
    sectionTitle: context.sectionTitle,
    subsectionTitle: context.subsectionTitle,
    userInstructions: truncateText(context.userInstructions, 2000),
    surroundingPageMarkdown: truncateText(context.pageMarkdown, 9000),
    sourceFigures: context.sourceFigures?.slice(0, 12),
    learningSpine: context.learningSpine,
    topicMap: context.topicMap,
    existingSpec: context.existingSpec ?? undefined,
  };

  // Council-mediated: many source figures (or an explicit override) escalate.
  const manySourceFigures = (context.sourceFigures?.length ?? 0) >= 3;
  const councilSourceContext = {
    pageMarkdown: truncateText(context.pageMarkdown, 6000),
    sourceFigures: context.sourceFigures?.slice(0, 12),
    visualOpportunity: context.visualOpportunity,
    currentSubsection: context.subsectionTitle,
    ...(typeof context.sourceContext === 'object' && context.sourceContext !== null
      ? (context.sourceContext as Record<string, unknown>)
      : {}),
  };

  let raw = '';
  try {
    const response = await client.chat.completions.create(withCouncil({
      model,
      messages: [
        { role: 'system', content: VISUAL_SPEC_SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            'Design the visualization spec for this context. Return only the JSON object.\n\n' +
            JSON.stringify(userPayload, null, 2),
        },
      ],
    }, {
      taskType: 'visualization_generation',
      gardenId: context.gardenId,
      pageId: context.pageId,
      sourceContext: councilSourceContext,
      councilModeOverride:
        context.councilModeOverride ?? (manySourceFigures ? 'full_council' : undefined),
    }));
    raw = response.choices[0]?.message?.content ?? '';
  } catch (error) {
    return { spec: null, errors: [error instanceof Error ? error.message : 'model call failed'] };
  }

  const candidate = stripJsonFence(raw);

  // The model may honestly decline when no interactive type fits the concept.
  // A declined visual is not an error: the page simply gets no visual.
  try {
    const declined = JSON.parse(candidate);
    if (declined && typeof declined === 'object' && (declined as Record<string, unknown>).skip === true) {
      const reason = String((declined as Record<string, unknown>).reason ?? 'no interactive type fits');
      return { spec: null, errors: [`declined: ${reason}`] };
    }
  } catch {
    // not a skip payload — validate as a spec below
  }

  const { spec, errors } = validateVisualSpec(candidate);
  if (!spec) {
    // One repair attempt: fill in mechanical fields the model may have omitted.
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        const patched = {
          id: newVisualId(),
          regenerationPrompt:
            context.visualOpportunity ?? 'Regenerate this visualization with better pedagogy.',
          pedagogicalPurpose: context.visualOpportunity ?? '',
          ...parsed,
        };
        const retry = validateVisualSpec(patched);
        if (retry.spec) return finalizeSpec(retry.spec, context);
      }
    } catch {
      // fall through
    }
    return { spec: null, errors };
  }
  return finalizeSpec(spec, context);
}

function finalizeSpec(spec: VisualSpec, context: VisualGenerationContext): GeneratedVisual {
  // Interactive or nothing: there is no static-card fallback in the renderer,
  // so a schema-valid spec with a non-interactive type must never ship.
  if (!(IMPLEMENTED_VISUAL_TYPES as readonly string[]).includes(spec.type)) {
    return {
      spec: null,
      errors: [`type "${spec.type}" is not interactive; only ${IMPLEMENTED_VISUAL_TYPES.join(', ')} are allowed`],
    };
  }
  if (context.gardenId) spec.gardenId = context.gardenId;
  if (context.pageId) spec.pageId = context.pageId;
  if (context.existingSpec) {
    spec.id = context.existingSpec.id;
    spec.version = (context.existingSpec.version ?? 1) + 1;
    spec.createdAt = context.existingSpec.createdAt;
    spec.updatedAt = new Date().toISOString();
    if (spec.sourceAnchors.length === 0 && context.existingSpec.sourceAnchors.length > 0) {
      spec.sourceAnchors = context.existingSpec.sourceAnchors;
    }
  }
  return { spec, errors: [] };
}

// Deterministic interactive visual builders live in ./visual-spec (dependency-
// free so they can be unit-tested and shared with the renderer). Re-exported
// here for callers that already import from ./visuals.
export {
  buildLifThresholdResetVisual,
  buildRateVsTemporalCodingVisual,
  buildStdpTimingWindowVisual,
  buildMetricTradeoffExplorerVisual,
  buildDeterministicVisual,
  type HardConceptKind,
} from './visual-spec';

// ---------------------------------------------------------------------------
// Legacy placeholder migration
// ---------------------------------------------------------------------------

export interface MigrationFailure {
  placeholder: string;
  errors: string[];
}

export interface MigrationResult {
  markdownWithVisualBlocks: string;
  generatedVisualSpecs: VisualSpec[];
  failures: MigrationFailure[];
}

/** Converts legacy "[Interactive visual: ...]" placeholders into real
 * breadboard-visual blocks. Failed conversions keep their placeholder. */
export async function migrateVisualPlaceholders(
  client: OpenAI,
  model: string,
  pageMarkdown: string,
  context: VisualGenerationContext,
): Promise<MigrationResult> {
  const placeholders = findVisualPlaceholders(pageMarkdown);
  const generatedVisualSpecs: VisualSpec[] = [];
  const failures: MigrationFailure[] = [];
  const replacements: Array<{ placeholder: VisualPlaceholder; spec: VisualSpec }> = [];

  for (const placeholder of placeholders) {
    const nearby = pageMarkdown.slice(
      Math.max(0, placeholder.index - 2500),
      placeholder.index + placeholder.fullMatch.length + 1200,
    );
    const { spec, errors } = await generateVisualSpec(client, model, {
      ...context,
      pageMarkdown: nearby,
      visualOpportunity: placeholder.body,
    });
    if (spec) {
      replacements.push({ placeholder, spec });
      generatedVisualSpecs.push(spec);
    } else {
      failures.push({ placeholder: placeholder.fullMatch, errors });
    }
  }

  // Replace from the last placeholder to the first so indices stay valid.
  let markdown = pageMarkdown;
  for (const { placeholder, spec } of [...replacements].sort(
    (a, b) => b.placeholder.index - a.placeholder.index,
  )) {
    markdown = replacePlaceholderWithBlock(markdown, placeholder, spec);
  }

  return { markdownWithVisualBlocks: markdown, generatedVisualSpecs, failures };
}

// ---------------------------------------------------------------------------
// Markdown block helpers used by the API routes
// ---------------------------------------------------------------------------

const VISUAL_BLOCK_PATTERN = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;

export function findVisualBlockById(
  markdown: string,
  visualId: string,
): { fullMatch: string; json: string; index: number } | null {
  const pattern = new RegExp(VISUAL_BLOCK_PATTERN.source, VISUAL_BLOCK_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && parsed.id === visualId) {
        return { fullMatch: match[0], json: match[1], index: match.index };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function replaceVisualBlock(
  markdown: string,
  block: { fullMatch: string; index: number },
  spec: VisualSpec,
): string {
  return (
    markdown.slice(0, block.index) +
    buildVisualBlock(spec) +
    markdown.slice(block.index + block.fullMatch.length)
  );
}

/** Recursively list markdown files of a garden (skipping .breadboard). */
export function listGardenMarkdownFiles(contentPath: string, gardenSlug: string): string[] {
  const root = path.join(contentPath, gardenSlug);
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
    }
  };
  walk(root);
  return files;
}

/** Record ledger events for a freshly created visual (incl. figure links). */
export function recordVisualCreated(
  contentPath: string,
  gardenSlug: string,
  spec: VisualSpec,
  pageSlug: string | undefined,
): void {
  appendGardenEvent(contentPath, gardenSlug, 'visualization_created', {
    visualId: spec.id,
    pageId: pageSlug ?? spec.pageId,
    type: spec.type,
    title: spec.title,
    sourceAnchors: spec.sourceAnchors,
    conceptTargets: spec.conceptTargets,
  });
  for (const anchor of spec.sourceAnchors) {
    if (anchor.figureId) {
      appendGardenEvent(contentPath, gardenSlug, 'source_figure_linked', {
        figureId: anchor.figureId,
        pageId: pageSlug ?? spec.pageId,
        visualId: spec.id,
        sourceId: anchor.sourceId,
      });
    }
  }
}
