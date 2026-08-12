/** Shapes shared by the document-skill pipeline, store, and turn wiring. */

/** One segment of a source document, as the book-to-skill clone detects it. */
export interface DocumentChapter {
  /** Chapter number from the heading, or a synthesized ordinal. */
  number: number;
  title: string;
  /** Character offsets into the extracted full text. */
  start: number;
  end: number;
  /**
   * How the boundary was found. `window` means the document had no detectable
   * structure and was cut into fixed slices — worth surfacing, because a skill
   * built from windows is inherently coarser than one built from real chapters.
   */
  kind: "numbered" | "structural" | "front-matter" | "window";
}

export interface DocumentStructure {
  chapters: DocumentChapter[];
  /** The clone's own count, which may differ from `chapters.length`. */
  chaptersDetected: number;
  hasToc: boolean;
  headingSample: string[];
  estimatedTokens: number;
  /** True when the clone's Python segmentation ran; false for the TS fallback. */
  fromClone: boolean;
}

/** Whether the distillation should preserve code/tables or prioritize prose. */
export type BookType = "technical" | "text";

/** How much worked detail each chapter file carries (book-to-skill Step 4). */
export type SkillDepth = "study" | "reference";

export type DocumentSkillStatus = "building" | "ready" | "failed";

/** Where the source document came from, for provenance and re-use. */
export type DocumentSkillOrigin =
  | { kind: "upload"; fileName: string }
  | { kind: "garden"; clusterSlug: string; documentSlug: string; fileName: string };

export interface DocumentSkillRecord {
  id: number;
  /** Stable slug; also the on-disk directory name. */
  slug: string;
  /** SHA-256 of the extracted text — the identity that makes builds cacheable. */
  contentHash: string;
  title: string;
  author: string | null;
  status: DocumentSkillStatus;
  bookType: BookType;
  depth: SkillDepth;
  chapterCount: number;
  sourceTokens: number;
  origin: DocumentSkillOrigin;
  userId: number;
  /** Set only when status is `failed`. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A file inside a built skill, addressable by the on-demand read tool. */
export interface DocumentSkillFile {
  /** Relative to the skill directory, e.g. `chapters/ch03-replication.md`. */
  path: string;
  bytes: number;
}

export interface DocumentSkillProgress {
  phase:
    | "extracting"
    | "segmenting"
    | "chapters"
    | "supporting"
    | "index"
    | "validating"
    | "done";
  /** Completed units of the current phase. */
  completed: number;
  total: number;
  message: string;
}
