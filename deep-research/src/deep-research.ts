import { generateText, type LanguageModelUsage } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { getModel, trimPrompt } from './ai/providers';
import {
  searchWeb,
  type SearchDocument,
  type SearchResponse,
} from './ai/search';
import { generateStructuredObject } from './ai/structured-output';
import { removeInvalidCitations, validateCitations } from './citations';
import { annotateSources } from './source-quality';
import { systemPrompt } from './prompt';
import type {
  ResearchBudgets,
  ResearchBudgetUsage,
  ResearchCoverage,
  ResearchEvidence,
  ResearchResult,
  ResearchSource,
  ResearchWarning,
} from './research-types';

export type {
  CitationValidation,
  ResearchBudgetUsage,
  ResearchBudgets,
  ResearchCoverage,
  ResearchEvidence,
  ResearchResult,
  ResearchSource,
  ResearchWarning,
  ResearchWarningCode,
} from './research-types';
export { validateCitations } from './citations';

function log(...args: unknown[]) {
  console.log(...args);
}

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
  budget?: ResearchBudgetUsage;
  warningCount?: number;
};

type PlannedQuery = {
  query: string;
  researchGoal: string;
};

type WorkItem = PlannedQuery & {
  remainingDepth: number;
  breadth: number;
};

type BranchDocument = {
  content: string;
  sourceIds: string[];
};

type CandidateEvidence = {
  claim: string;
  sourceIds: string[];
};

type BranchResult = {
  item: WorkItem;
  candidates: CandidateEvidence[];
  followUpQuestions: string[];
  allowedSourceIds: Set<string>;
  newSourceCount: number;
  warnings: ResearchWarning[];
};

// Parallel searches per batch. The supervisor still reserves every search and
// model call against the run budget before starting it.
const ConcurrencyLimit = Math.max(
  1,
  Math.min(
    8,
    Number(process.env.DEEP_RESEARCH_CONCURRENCY) ||
      Number(process.env.FIRECRAWL_CONCURRENCY) ||
      2,
  ),
);

const StepTimeoutMs = Math.max(
  1_000,
  Number(process.env.DEEP_RESEARCH_STEP_TIMEOUT_MS) || 60_000,
);

/** Enough room for the detailed, multi-page deliverable promised by report mode. */
export const FinalReportMaxTokens = 8_000;

/** A five-result search should not be collapsed to only three usable facts. */
export const FindingsPerSearch = 5;

/** The upstream project's recommended run shape for a normal report. */
export const DefaultResearchBreadth = 4;
export const DefaultResearchDepth = 2;

function finiteInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value as number)))
    : fallback;
}

export function defaultResearchBudgets(
  breadth: number,
  depth: number,
  overrides: Partial<ResearchBudgets> = {},
): ResearchBudgets {
  const boundedBreadth = finiteInteger(breadth, DefaultResearchBreadth, 1, 20);
  const boundedDepth = finiteInteger(depth, DefaultResearchDepth, 1, 10);
  let branchCount = boundedBreadth;
  let branchBreadth = boundedBreadth;
  let projectedSearches = 0;
  for (let round = 0; round < boundedDepth; round += 1) {
    projectedSearches += branchCount;
    if (projectedSearches >= 40) break;
    branchBreadth = Math.max(1, Math.ceil(branchBreadth / 2));
    branchCount *= branchBreadth;
  }
  // A depth round fans out from every preceding branch. Breadth × depth
  // under-counted the default 4×2 shape as eight searches even though the
  // queue correctly planned four initial and eight follow-up searches.
  const defaultSearches = Math.min(40, projectedSearches);

  return {
    maxSearches: finiteInteger(overrides.maxSearches, defaultSearches, 1, 100),
    // One planning call plus at most one evidence-extraction call per search.
    maxModelCalls: finiteInteger(
      overrides.maxModelCalls,
      defaultSearches + 1,
      1,
      120,
    ),
    maxSources: finiteInteger(
      overrides.maxSources,
      Math.min(100, defaultSearches * 5),
      1,
      500,
    ),
    maxTokens: finiteInteger(overrides.maxTokens, 180_000, 1_000, 2_000_000),
    maxDurationMs: finiteInteger(
      overrides.maxDurationMs,
      10 * 60_000,
      1_000,
      60 * 60_000,
    ),
    maxNoProgressBranches: finiteInteger(
      overrides.maxNoProgressBranches,
      Math.max(2, Math.min(5, boundedBreadth)),
      1,
      20,
    ),
  };
}

function combinedStepSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(StepTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The research run was aborted.', 'AbortError');
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError'),
  );
}

function normalizeQuery(query: string): string {
  return query
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeClaim(claim: string): string {
  return normalizeQuery(claim.replace(/\[(?:S|source)\s*\d+\]/gi, ''));
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    for (const parameter of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$)/i.test(parameter)) {
        url.searchParams.delete(parameter);
      }
    }
    return url.toString().replace(/\?$/, '');
  } catch {
    return null;
  }
}

function sourceTitle(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
}

function excerpt(content: string): string | undefined {
  const value = content.replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, 600) : undefined;
}

// Take a user question and make a small, diverse initial plan. Follow-up work
// is generated by evidence extraction, so the planner is paid for only once.
async function generateSerpQueries({
  query,
  userContext,
  numQueries,
  learnings,
  onUsage,
  signal,
}: {
  query: string;
  userContext?: string;
  numQueries: number;
  learnings?: string[];
  onUsage?: (usage: LanguageModelUsage) => void;
  signal?: AbortSignal;
}): Promise<PlannedQuery[]> {
  const result = await generateStructuredObject({
    abortSignal: combinedStepSignal(signal),
    system: systemPrompt(userContext),
    prompt: `Plan web research for the question below. Produce at most ${numQueries} distinct search queries. Each query must cover a different fact, perspective, primary source, or uncertainty. Treat prior learnings as unverified leads, not facts. Do not answer the question.\n\n<question>${query}</question>\n\n${
      learnings?.length
        ? `<unverified_leads>${learnings.join('\n')}</unverified_leads>`
        : ''
    }`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().min(1).describe('A focused web-search query'),
            researchGoal: z
              .string()
              .min(1)
              .describe('The claim or uncertainty this query should resolve'),
          }),
        )
        .max(numQueries),
    }),
    schemaName: 'research_plan',
    schemaDescription: 'A diverse set of focused web research queries.',
    onUsage,
  });
  return result.queries.slice(0, numQueries);
}

async function processSearchResult({
  query,
  documents,
  numLearnings,
  numFollowUpQuestions,
  onUsage,
  signal,
}: {
  query: string;
  documents: BranchDocument[];
  numLearnings: number;
  numFollowUpQuestions: number;
  onUsage?: (usage: LanguageModelUsage) => void;
  signal?: AbortSignal;
}): Promise<{
  candidates: CandidateEvidence[];
  followUpQuestions: string[];
}> {
  const contents = documents
    .map(document => ({
      ...document,
      content: trimPrompt(document.content, 8_000),
    }))
    .filter(document => document.content.trim());

  if (contents.length === 0) {
    return { candidates: [], followUpQuestions: [] };
  }

  const sourceIds = [
    ...new Set(contents.flatMap(document => document.sourceIds)),
  ];
  const result = await generateStructuredObject({
    abortSignal: combinedStepSignal(signal),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Extract at most ${numLearnings} concise, material findings that the supplied documents directly support for <query>${query}</query>. Every finding MUST list one or more source IDs from the document that supports it. Never cite an ID that is not supplied. If support is ambiguous or absent, omit the finding. Preserve exact names, dates, quantities, units, and disagreements. Generate at most ${numFollowUpQuestions} follow-up search questions only for important unresolved gaps.\n\nAvailable source IDs: ${sourceIds.join(', ')}\n\n<documents>\n${contents
        .map(
          document =>
            `<document source_ids="${document.sourceIds.join(' ')}">\n${document.content}\n</document>`,
        )
        .join('\n')}\n</documents>`,
      40_000,
    ),
    schema: z.object({
      findings: z
        .array(
          z.object({
            claim: z.string().min(1).describe('One evidence-backed finding'),
            sourceIds: z
              .array(z.string().min(1))
              .min(1)
              .describe(
                'Only supplied source IDs that directly support the claim',
              ),
          }),
        )
        .max(numLearnings),
      followUpQuestions: z.array(z.string().min(1)).max(numFollowUpQuestions),
    }),
    schemaName: 'research_findings',
    schemaDescription:
      'Source-bound findings and unresolved follow-up research questions.',
    onUsage,
  });

  return {
    candidates: result.findings,
    followUpQuestions: result.followUpQuestions,
  };
}

function fallbackDocuments(result: SearchResponse): SearchDocument[] {
  if (result.documents?.length) return result.documents;
  if (result.contents.length === result.urls.length) {
    return result.contents.flatMap((content, index) => {
      const url = result.urls[index];
      return url ? [{ url, content }] : [];
    });
  }
  return result.contents.flatMap(content =>
    result.urls.map(url => ({ url, content })),
  );
}

function appendUniqueWarning(
  warnings: ResearchWarning[],
  warning: ResearchWarning,
): void {
  const key = `${warning.code}\u0000${warning.query ?? ''}\u0000${warning.message}`;
  if (
    warnings.some(
      existing =>
        `${existing.code}\u0000${existing.query ?? ''}\u0000${existing.message}` ===
        key,
    )
  ) {
    return;
  }
  warnings.push(warning);
}

function budgetSnapshot(
  usage: ResearchBudgetUsage,
  sourceCount: number,
  startedAt: number,
): ResearchBudgetUsage {
  return {
    ...usage,
    sources: sourceCount,
    elapsedMs: Date.now() - startedAt,
  };
}

function writerInputs({
  learnings,
  visitedUrls = [],
  sources,
  evidence,
}: {
  learnings: string[];
  visitedUrls?: string[];
  sources?: ResearchSource[];
  evidence?: ResearchEvidence[];
}): { sources: ResearchSource[]; evidence: ResearchEvidence[] } {
  const registered = sources?.length
    ? sources
    : compact(visitedUrls).flatMap((raw, index) => {
        const url = normalizeUrl(raw);
        return url
          ? [
              {
                id: `S${index + 1}`,
                url,
                title: sourceTitle(url),
                query: 'Prior research',
                retrievedAt: new Date().toISOString(),
              },
            ]
          : [];
      });
  const allSourceIds = registered.map(source => source.id);
  const groundedEvidence = evidence?.length
    ? evidence
    : learnings.map((claim, index) => ({
        id: `E${index + 1}`,
        claim,
        // Legacy calls did not retain claim/source links. Passing every
        // registered source is conservative and keeps old callers working;
        // new engine results always provide exact source IDs.
        sourceIds: allSourceIds,
        query: 'Prior research',
        depth: 0,
      }));
  return { sources: registered, evidence: groundedEvidence };
}

function evidencePrompt(
  evidence: ResearchEvidence[],
  sources: ResearchSource[],
): string {
  const known = new Set(sources.map(source => source.id));
  return evidence
    .map(item => {
      const allowed = item.sourceIds.filter(id => known.has(id));
      return `<evidence id="${item.id}" allowed_source_ids="${allowed.join(' ')}">\n${item.claim}\n</evidence>`;
    })
    .join('\n');
}

/**
 * Who published a source, as a name a sentence can use.
 *
 * The registry already carries the URL, but a model asked to name a publisher
 * from one is a model inventing organisation names. Handing it the host means
 * an attribution in the prose is derived rather than guessed.
 */
function publisherOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function sourceRegistryPrompt(sources: ResearchSource[]): string {
  const annotations = annotateSources(sources);
  return sources
    .map(source => {
      const note = annotations.get(source.id);
      const attributes = [
        `id="${source.id}"`,
        `url="${source.url}"`,
        note?.publisher ? `publisher="${note.publisher}"` : '',
        note && note.kind !== 'unclassified' ? `publisher_kind="${note.kind}"` : '',
        note?.promotional ? 'promotional_page="true"' : '',
        note?.samePublisherAs.length
          ? `same_publisher_as="${note.samePublisherAs.join(' ')}"`
          : '',
      ].filter(Boolean);
      return `<source ${attributes.join(' ')}>${source.title ?? ''}${
        source.excerpt ? `\n${source.excerpt}` : ''
      }</source>`;
    })
    .join('\n');
}

export function finalReportPrompt(
  question: string,
  evidence: ResearchEvidence[],
  sources: ResearchSource[],
): string {
  return `Write a comprehensive, long-form Markdown report for a first-time reader that answers <question>${question}</question> using only the evidence registry below.

This is report mode, not direct-answer mode. Produce the equivalent of a substantive three-page research brief: for a broad question with enough evidence, aim for roughly 1,500–2,500 words. Cover every material supported dimension and use the relevant evidence throughout instead of selecting only a few headline findings. Prefer developed prose and question-specific sections over a terse outline. Include an executive summary, the main analysis, important counterevidence or disagreements, implications, unresolved uncertainties, and a conclusion when those sections fit the question. If the registry genuinely cannot support that depth, be shorter rather than padding with repetition, generic background, or unsupported speculation.

Start with the plain-English conclusion and why it matters. Build the explanation one idea at a time before using specialist categories or dense comparisons. Explain every necessary technical term on first use, and give each important number a baseline and practical meaning. Do not use an "Executive summary" heading as a container for unexplained shorthand.

That opening conclusion is bound by the same evidence as the body. Any headline figure in it must be one the registry supports, must carry its citation and its scope, and must be consistent with every figure below it — a summary that no cited evidence supports, or that is stronger than the evidence beneath it, is the report contradicting itself in the sentence a reader is most likely to act on. Before finishing, read the opening back against the cited figures and correct the opening, not the evidence.

For every factual claim, place one or more allowed citations immediately after the claim in the exact form [S1][S2]. An evidence item may use only its own allowed_source_ids. Never invent a source ID, URL, quote, fact, or missing detail. Clearly label inference and unresolved uncertainty. Reconcile material conflicts instead of hiding them. Write currency as \`USD 2.6 trillion\` rather than with a bare dollar sign: it names which dollar, which a reader outside the United States needs. Do not add a Sources or References section; the registered source list is appended separately.

A marker is not an attribution. Where a figure is one a reader might act on — a salary, a price, a payback period, a growth rate, a market size — say in the sentence who published it, using the \`publisher\` attribute of the source you are citing, and keep the marker alongside. A startling number from a source nobody has heard of reads as established fact the moment it is wearing a bare citation, and naming the publisher is what lets the reader weigh it.

Each source carries what is knowable about it from its address, and no more. \`publisher_kind\` appears only when the domain places it — \`government\`, \`academic\`, \`intergovernmental\` — and its absence means unknown, never untrustworthy. \`promotional_page="true"\` marks a page whose address reads as sales material: it is the best source for that seller's own price or specification and a weak one for what the market pays, how fast an investment repays, or how it compares to a rival, so say whose material it is when you use it for anything beyond the seller's own facts. \`same_publisher_as\` lists other registered sources from the same host: those are one publisher, not several agreeing ones, and citing them as a cluster implies a consensus that does not exist — say "one publisher" and cite once. None of these attributes decides anything for you; you have read the pages and they have not.

<evidence_registry>
${evidencePrompt(evidence, sources)}
</evidence_registry>

<source_registry>
${sourceRegistryPrompt(sources)}
</source_registry>`;
}

function cleanGeneratedCitations(
  markdown: string,
  sources: ResearchSource[],
): string {
  return removeInvalidCitations(markdown, sources)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export async function writeFinalReport({
  prompt,
  userContext,
  learnings,
  visitedUrls = [],
  sources,
  evidence,
  onUsage,
  signal,
}: {
  prompt: string;
  userContext?: string;
  learnings: string[];
  visitedUrls?: string[];
  sources?: ResearchSource[];
  evidence?: ResearchEvidence[];
  onUsage?: (usage: LanguageModelUsage) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const grounded = writerInputs({ learnings, visitedUrls, sources, evidence });
  const res = await generateText({
    model: getModel(),
    abortSignal: combinedStepSignal(signal),
    system: systemPrompt(userContext, { writing: true }),
    maxTokens: FinalReportMaxTokens,
    prompt: trimPrompt(
      finalReportPrompt(prompt, grounded.evidence, grounded.sources),
      64_000,
    ),
  });
  onUsage?.(res.usage);
  const reportMarkdown = res.text.trim();
  if (!reportMarkdown) throw new Error('The model returned an empty report.');

  const rawValidation = validateCitations(
    reportMarkdown,
    grounded.sources,
    grounded.evidence,
  );
  if (rawValidation.invalidSourceIds.length) {
    log('Removed invalid report citations', rawValidation.invalidSourceIds);
  }
  let report = cleanGeneratedCitations(reportMarkdown, grounded.sources);
  const validation = validateCitations(
    report,
    grounded.sources,
    grounded.evidence,
  );
  if (
    grounded.evidence.length > 0 &&
    grounded.sources.length > 0 &&
    validation.citedSourceIds.length === 0
  ) {
    // Never ship an authoritative-looking uncited synthesis. The deterministic
    // evidence ledger preserves the useful work and its exact provenance.
    report = `## Evidence-backed findings\n\n${grounded.evidence
      .map(item => {
        const allowed = item.sourceIds.filter(id =>
          grounded.sources.some(source => source.id === id),
        );
        return `- ${item.claim}${allowed.length ? ` ${allowed.map(id => `[${id}]`).join('')}` : ''}`;
      })
      .join('\n')}`;
  }
  const sourcesSection = grounded.sources.length
    ? `\n\n## Sources\n\n${grounded.sources
        .map(source => `- [${source.id}] ${source.url}`)
        .join('\n')}`
    : '';
  return report + sourcesSection;
}

export async function writeFinalAnswer({
  prompt,
  userContext,
  learnings,
  sources,
  evidence,
  onUsage,
  signal,
}: {
  prompt: string;
  userContext?: string;
  learnings: string[];
  sources?: ResearchSource[];
  evidence?: ResearchEvidence[];
  onUsage?: (usage: LanguageModelUsage) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const grounded = writerInputs({ learnings, sources, evidence });
  const res = await generateText({
    model: getModel(),
    abortSignal: combinedStepSignal(signal),
    system: systemPrompt(userContext, { writing: true }),
    prompt: trimPrompt(
      `Answer <question>${prompt}</question> in plain language for a first-time reader, using only the supplied evidence. Be as concise as a complete explanation permits: state the practical conclusion first, explain necessary specialist terms on first use, and give important numbers a comparison and practical meaning. Include citations immediately after factual claims as [S1][S2], using only the allowed_source_ids for the supporting evidence. If the evidence cannot answer the question, say that it could not be verified. Never invent a citation or fill a gap from memory. Return only the answer.\n\n<evidence_registry>\n${evidencePrompt(
        grounded.evidence,
        grounded.sources,
      )}\n</evidence_registry>\n\n<source_registry>\n${sourceRegistryPrompt(
        grounded.sources,
      )}\n</source_registry>`,
      64_000,
    ),
  });
  onUsage?.(res.usage);
  const exactAnswer = res.text.trim();
  if (!exactAnswer) throw new Error('The model returned an empty answer.');

  let answer = cleanGeneratedCitations(exactAnswer, grounded.sources);
  const validation = validateCitations(
    answer,
    grounded.sources,
    grounded.evidence,
  );
  // Do not attach an arbitrary source after generation: that would make the
  // response look grounded without proving which evidence supports the answer.
  if (
    grounded.evidence.length > 0 &&
    grounded.sources.length > 0 &&
    validation.citedSourceIds.length === 0 &&
    !/could not be verified|insufficient evidence/i.test(answer)
  ) {
    answer =
      'The answer could not be verified with a source-bound citation from the collected evidence.';
  }
  return answer;
}

export async function deepResearch({
  query,
  userContext,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
  onUsage,
  signal,
  budgets: budgetOverrides = {},
}: {
  query: string;
  userContext?: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  onUsage?: (usage: LanguageModelUsage) => void;
  signal?: AbortSignal;
  budgets?: Partial<ResearchBudgets>;
}): Promise<ResearchResult> {
  const normalizedBreadth = finiteInteger(
    breadth,
    DefaultResearchBreadth,
    1,
    20,
  );
  const normalizedDepth = finiteInteger(depth, DefaultResearchDepth, 1, 10);
  const budgets = defaultResearchBudgets(
    normalizedBreadth,
    normalizedDepth,
    budgetOverrides,
  );
  const startedAt = Date.now();
  const budgetUsage: ResearchBudgetUsage = {
    searches: 0,
    modelCalls: 0,
    sources: 0,
    tokens: 0,
    elapsedMs: 0,
  };
  const warnings: ResearchWarning[] = [];
  const sources: ResearchSource[] = [];
  const evidence: ResearchEvidence[] = [];
  const sourceByUrl = new Map<string, ResearchSource>();
  const evidenceByClaim = new Map<string, ResearchEvidence>();
  let totalClaims = 0;
  let citedClaims = 0;

  const recordUsage = (usage: LanguageModelUsage) => {
    budgetUsage.tokens += Math.max(0, Number(usage.totalTokens) || 0);
    onUsage?.(usage);
  };

  const progress: ResearchProgress = {
    currentDepth: normalizedDepth,
    totalDepth: normalizedDepth,
    currentBreadth: normalizedBreadth,
    totalBreadth: normalizedBreadth,
    totalQueries: 0,
    completedQueries: 0,
  };
  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update, {
      budget: budgetSnapshot(budgetUsage, sources.length, startedAt),
      warningCount: warnings.length,
    });
    onProgress?.({ ...progress });
  };

  const registerSource = (
    rawUrl: string,
    sourceQuery: string,
    content = '',
    title?: string,
  ): ResearchSource | null => {
    const url = normalizeUrl(rawUrl);
    if (!url) return null;
    const existing = sourceByUrl.get(url);
    if (existing) {
      if (!existing.excerpt) existing.excerpt = excerpt(content);
      return existing;
    }
    if (sources.length >= budgets.maxSources) return null;
    const source: ResearchSource = {
      id: `S${sources.length + 1}`,
      url,
      title: title?.trim() || sourceTitle(url),
      excerpt: excerpt(content),
      query: sourceQuery,
      retrievedAt: new Date().toISOString(),
    };
    sources.push(source);
    sourceByUrl.set(url, source);
    return source;
  };

  for (const url of visitedUrls) registerSource(url, 'Prior research');

  const materializeDocuments = (
    result: SearchResponse,
    sourceQuery: string,
  ): { documents: BranchDocument[]; allowedSourceIds: Set<string> } => {
    const grouped = new Map<string, Set<string>>();
    for (const document of fallbackDocuments(result)) {
      if (!document.content?.trim()) continue;
      const source = registerSource(
        document.url,
        sourceQuery,
        document.content,
        document.title,
      );
      if (!source) continue;
      const ids = grouped.get(document.content) ?? new Set<string>();
      ids.add(source.id);
      grouped.set(document.content, ids);
    }
    const documents = [...grouped.entries()].map(([content, ids]) => {
      const sourceIds = [...ids];
      const mapping = sourceIds
        .map(id => {
          const source = sources.find(candidate => candidate.id === id);
          return `${id}: ${source?.url ?? 'unavailable'}`;
        })
        .join('\n');
      return {
        // ChatMock returns one synthesis containing several inline URLs. Keep
        // the ID-to-URL mapping beside that synthesis so extraction can bind a
        // claim to the URL it actually cites, rather than choosing among IDs.
        content: `<source_map>\n${mapping}\n</source_map>\n${content}`,
        sourceIds,
      };
    });
    return {
      documents,
      allowedSourceIds: new Set(
        documents.flatMap(document => document.sourceIds),
      ),
    };
  };

  let planned: PlannedQuery[] = [];
  throwIfAborted(signal);
  budgetUsage.modelCalls += 1;
  try {
    planned = await generateSerpQueries({
      query,
      userContext,
      learnings,
      numQueries: normalizedBreadth,
      onUsage: recordUsage,
      signal,
    });
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    appendUniqueWarning(warnings, {
      code: 'analysis_failed',
      message: `The research planner failed; using the original question as the search query: ${
        error instanceof Error ? error.message : String(error)
      }`,
      query,
      depth: 0,
      recoverable: true,
    });
  }
  if (planned.length === 0) {
    planned = [
      { query, researchGoal: 'Answer the original research question' },
    ];
  }

  const seenQueries = new Set<string>();
  const queue: WorkItem[] = [];
  const enqueue = (item: WorkItem): boolean => {
    const key = normalizeQuery(item.query);
    if (!key || seenQueries.has(key)) return false;
    seenQueries.add(key);
    queue.push(item);
    progress.totalQueries += 1;
    return true;
  };
  for (const item of planned) {
    enqueue({
      ...item,
      breadth: normalizedBreadth,
      remainingDepth: normalizedDepth,
    });
  }

  const budgetStopReason = (): ResearchBudgetUsage['stoppedReason'] => {
    if (Date.now() - startedAt >= budgets.maxDurationMs) return 'duration';
    if (budgetUsage.searches >= budgets.maxSearches) return 'searches';
    if (budgetUsage.modelCalls >= budgets.maxModelCalls) return 'modelCalls';
    if (sources.length >= budgets.maxSources) return 'sources';
    if (budgetUsage.tokens >= budgets.maxTokens) return 'tokens';
    return undefined;
  };

  const limit = pLimit(ConcurrencyLimit);
  let consecutiveNoProgress = 0;

  const runBranch = async (item: WorkItem): Promise<BranchResult> => {
    const branchWarnings: ResearchWarning[] = [];
    const empty: BranchResult = {
      item,
      candidates: [],
      followUpQuestions: [],
      allowedSourceIds: new Set(),
      newSourceCount: 0,
      warnings: branchWarnings,
    };
    throwIfAborted(signal);
    if (budgetStopReason()) return empty;

    budgetUsage.searches += 1;
    const sourcesBefore = sources.length;
    try {
      const result = await searchWeb(item.query, 5, { signal });
      if (result.usage) recordUsage(result.usage);
      throwIfAborted(signal);
      const materialized = materializeDocuments(result, item.query);
      empty.allowedSourceIds = materialized.allowedSourceIds;
      empty.newSourceCount = sources.length - sourcesBefore;
      if (materialized.documents.length === 0) {
        branchWarnings.push({
          code: 'empty_result',
          message: 'Search returned no cited content that could be retained.',
          query: item.query,
          depth: normalizedDepth - item.remainingDepth + 1,
          recoverable: true,
        });
        return empty;
      }
      if (budgetUsage.modelCalls >= budgets.maxModelCalls) {
        branchWarnings.push({
          code: 'budget_exhausted',
          message:
            'The model-call budget was exhausted before this branch could be analyzed.',
          query: item.query,
          depth: normalizedDepth - item.remainingDepth + 1,
          recoverable: true,
        });
        return empty;
      }

      budgetUsage.modelCalls += 1;
      try {
        const analyzed = await processSearchResult({
          query: item.query,
          documents: materialized.documents,
          numLearnings: FindingsPerSearch,
          numFollowUpQuestions: Math.max(1, Math.ceil(item.breadth / 2)),
          onUsage: recordUsage,
          signal,
        });
        return {
          ...empty,
          candidates: analyzed.candidates,
          followUpQuestions: analyzed.followUpQuestions,
        };
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        branchWarnings.push({
          code: 'analysis_failed',
          message: `Retrieved sources could not be analyzed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          query: item.query,
          depth: normalizedDepth - item.remainingDepth + 1,
          recoverable: true,
        });
        return empty;
      }
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      branchWarnings.push({
        code: 'search_failed',
        message: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        query: item.query,
        depth: normalizedDepth - item.remainingDepth + 1,
        recoverable: true,
      });
      return empty;
    }
  };

  while (queue.length > 0) {
    throwIfAborted(signal);
    const stop = budgetStopReason();
    if (stop) {
      budgetUsage.stoppedReason = stop;
      break;
    }
    if (consecutiveNoProgress >= budgets.maxNoProgressBranches) {
      budgetUsage.stoppedReason = 'noProgress';
      break;
    }

    const remainingSearches = budgets.maxSearches - budgetUsage.searches;
    const batchSize = Math.max(
      0,
      Math.min(ConcurrencyLimit, queue.length, remainingSearches),
    );
    if (batchSize === 0) {
      budgetUsage.stoppedReason = 'searches';
      break;
    }
    const batch = queue.splice(0, batchSize);
    reportProgress({
      currentQuery: batch[0]?.query,
      currentDepth: batch[0]?.remainingDepth ?? 0,
      currentBreadth: queue.length + batch.length,
    });

    const results = await Promise.all(
      batch.map(item => limit(() => runBranch(item))),
    );

    for (const result of results) {
      for (const warning of result.warnings)
        appendUniqueWarning(warnings, warning);
      let newEvidenceCount = 0;

      for (const candidate of result.candidates) {
        totalClaims += 1;
        const validSourceIds = [
          ...new Set(
            candidate.sourceIds
              .map(id => id.trim().toUpperCase())
              .filter(id => result.allowedSourceIds.has(id)),
          ),
        ];
        if (validSourceIds.length === 0) {
          appendUniqueWarning(warnings, {
            code: 'uncited_evidence',
            message:
              'A proposed finding was dropped because it did not cite a source from its branch.',
            query: result.item.query,
            depth: normalizedDepth - result.item.remainingDepth + 1,
            recoverable: true,
          });
          continue;
        }

        const cleanClaim = candidate.claim
          .replace(/\[S\d+\]/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        const claimKey = normalizeClaim(cleanClaim);
        if (!claimKey) continue;
        citedClaims += 1;
        const existing = evidenceByClaim.get(claimKey);
        if (existing) {
          existing.sourceIds = [
            ...new Set([...existing.sourceIds, ...validSourceIds]),
          ];
          continue;
        }
        const item: ResearchEvidence = {
          id: `E${evidence.length + 1}`,
          claim: cleanClaim,
          sourceIds: validSourceIds,
          query: result.item.query,
          depth: normalizedDepth - result.item.remainingDepth + 1,
        };
        evidence.push(item);
        evidenceByClaim.set(claimKey, item);
        newEvidenceCount += 1;
      }

      const madeProgress = newEvidenceCount > 0 || result.newSourceCount > 0;
      consecutiveNoProgress = madeProgress ? 0 : consecutiveNoProgress + 1;

      if (newEvidenceCount > 0 && result.item.remainingDepth > 1) {
        const nextBreadth = Math.max(1, Math.ceil(result.item.breadth / 2));
        for (const question of result.followUpQuestions.slice(0, nextBreadth)) {
          enqueue({
            query: question,
            researchGoal: `Resolve a gap found while researching: ${result.item.researchGoal}`,
            remainingDepth: result.item.remainingDepth - 1,
            breadth: nextBreadth,
          });
        }
      }

      progress.completedQueries += 1;
      reportProgress({
        currentQuery: result.item.query,
        currentDepth: result.item.remainingDepth,
        currentBreadth: queue.length,
      });
    }
  }

  if (budgetUsage.stoppedReason) {
    const reason = budgetUsage.stoppedReason;
    appendUniqueWarning(warnings, {
      code: reason === 'noProgress' ? 'no_progress' : 'budget_exhausted',
      message:
        reason === 'noProgress'
          ? `Research stopped after ${consecutiveNoProgress} branches added no new evidence or sources.`
          : `Research stopped at its ${reason} budget; results may be partial.`,
      recoverable: true,
    });
  }

  const referencedSourceIds = new Set(evidence.flatMap(item => item.sourceIds));
  const coverage: ResearchCoverage = {
    totalClaims,
    citedClaims,
    ratio: totalClaims === 0 ? 0 : citedClaims / totalClaims,
    referencedSources: referencedSourceIds.size,
    totalSources: sources.length,
    sourceRatio:
      sources.length === 0 ? 0 : referencedSourceIds.size / sources.length,
  };
  if (
    evidence.length > 0 &&
    (coverage.ratio < 1 ||
      warnings.some(warning =>
        ['search_failed', 'analysis_failed', 'budget_exhausted'].includes(
          warning.code,
        ),
      ))
  ) {
    appendUniqueWarning(warnings, {
      code: 'partial_coverage',
      message: `The run retained ${coverage.citedClaims} of ${coverage.totalClaims} proposed claims and may not cover every research branch.`,
      recoverable: true,
    });
  }

  const finalBudget = budgetSnapshot(budgetUsage, sources.length, startedAt);
  reportProgress({
    currentDepth: 0,
    currentBreadth: 0,
    currentQuery: undefined,
  });
  log(
    `Research retained ${evidence.length} findings from ${sources.length} sources after ${finalBudget.searches} searches.`,
  );

  return {
    learnings: evidence.map(item => item.claim),
    visitedUrls: sources.map(source => source.url),
    sources,
    evidence,
    warnings,
    coverage,
    budget: finalBudget,
  };
}
