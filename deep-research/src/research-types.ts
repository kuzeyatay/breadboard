export type ResearchSource = {
  /** Stable, report-safe identifier such as S1. */
  id: string;
  url: string;
  title?: string;
  excerpt?: string;
  query: string;
  retrievedAt: string;
};

export type ResearchEvidence = {
  /** Stable identifier such as E1. */
  id: string;
  claim: string;
  sourceIds: string[];
  query: string;
  depth: number;
};

export type ResearchWarningCode =
  | 'search_failed'
  | 'analysis_failed'
  | 'empty_result'
  | 'uncited_evidence'
  | 'no_progress'
  | 'budget_exhausted'
  | 'partial_coverage';

export type ResearchWarning = {
  code: ResearchWarningCode;
  message: string;
  query?: string;
  depth?: number;
  recoverable: boolean;
};

export type ResearchBudgets = {
  /** Maximum web-search calls, including searches that return nothing. */
  maxSearches: number;
  /** Maximum structured model calls, including the initial research plan. */
  maxModelCalls: number;
  /** Maximum distinct source URLs retained across the run. */
  maxSources: number;
  /** Maximum observed input + output tokens across planning, search, and analysis. */
  maxTokens: number;
  /** Wall-clock deadline for the whole research phase. */
  maxDurationMs: number;
  /** Stop after this many consecutive branches add no evidence or source. */
  maxNoProgressBranches: number;
};

export type ResearchBudgetUsage = {
  searches: number;
  modelCalls: number;
  sources: number;
  tokens: number;
  elapsedMs: number;
  stoppedReason?:
    | 'searches'
    | 'modelCalls'
    | 'sources'
    | 'tokens'
    | 'duration'
    | 'noProgress';
};

export type ResearchCoverage = {
  /** Candidate claims returned by the analyst model. */
  totalClaims: number;
  /** Claims retained because they cite at least one registered source. */
  citedClaims: number;
  /** citedClaims / totalClaims, or 0 when no claim was produced. */
  ratio: number;
  /** Registered sources referenced by at least one retained claim. */
  referencedSources: number;
  totalSources: number;
  sourceRatio: number;
};

export type ResearchResult = {
  /** Backward-compatible flat claims. */
  learnings: string[];
  /** Backward-compatible source URL list. */
  visitedUrls: string[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  warnings: ResearchWarning[];
  coverage: ResearchCoverage;
  budget: ResearchBudgetUsage;
};

export type CitationValidation = {
  citedSourceIds: string[];
  invalidSourceIds: string[];
  uncitedEvidenceIds: string[];
  evidenceCoverage: number;
};
