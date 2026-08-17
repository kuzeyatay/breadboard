import type { SkillsShDetail } from "./skills-sh-client.ts";
import type { SkillsCatalogStore } from "./skills-catalog-store.ts";
import {
  SCIENTIFIC_SKILLS_SOURCE,
  getLocalScientificSkill,
  readLocalScientificSkillFiles,
  synchronizeLocalScientificSkillsCatalog,
} from "./scientific-skills-source.ts";
import {
  REVERSE_SKILLS_SOURCE,
  REVERSE_SKILLS_LABEL,
  getLocalReverseSkill,
  readLocalReverseSkillFiles,
  synchronizeLocalReverseSkillsCatalog,
} from "./reverse-skills-source.ts";
import {
  DESIGN_SKILLS_SOURCE,
  DESIGN_SKILLS_LABEL,
  getLocalDesignSkill,
  readLocalDesignSkillFiles,
  synchronizeLocalDesignSkillsCatalog,
} from "./design-skills-source.ts";
import {
  OMH_SKILLS_SOURCE,
  OMH_SKILLS_LABEL,
  getLocalOmhSkill,
  readLocalOmhSkillFiles,
  synchronizeLocalOmhSkillsCatalog,
} from "./omh-skills-source.ts";
import {
  ENGINEERING_SKILLS_SOURCE,
  ENGINEERING_SKILLS_LABEL,
  getLocalEngineeringSkill,
  readLocalEngineeringSkillFiles,
  synchronizeLocalEngineeringSkillsCatalog,
} from "./engineering-skills-source.ts";
import {
  HALLMARK_SKILLS_SOURCE,
  HALLMARK_SKILLS_LABEL,
  getLocalHallmarkSkill,
  readLocalHallmarkSkillFiles,
  synchronizeLocalHallmarkSkillsCatalog,
} from "./hallmark-skills-source.ts";
import {
  BULLSHIT_SKILLS_SOURCE,
  BULLSHIT_SKILLS_LABEL,
  getLocalBullshitSkill,
  readLocalBullshitSkillFiles,
  synchronizeLocalBullshitSkillsCatalog,
} from "./bullshit-skills-source.ts";
import {
  OFFICE_SKILLS_SOURCE,
  OFFICE_SKILLS_LABEL,
  getLocalOfficeSkill,
  readLocalOfficeSkillFiles,
  synchronizeLocalOfficeSkillsCatalog,
} from "./office-skills-source.ts";

export {
  SCIENTIFIC_SKILLS_SOURCE,
  REVERSE_SKILLS_SOURCE,
  DESIGN_SKILLS_SOURCE,
  OMH_SKILLS_SOURCE,
  ENGINEERING_SKILLS_SOURCE,
  HALLMARK_SKILLS_SOURCE,
  OFFICE_SKILLS_SOURCE,
  BULLSHIT_SKILLS_SOURCE,
};

/**
 * Reviewed local sources are operator-vendored skill clones that Breadboard
 * trusts the way it trusts its own first-party skills: their files are pinned
 * on disk, the operator added them deliberately, and installing any of them
 * still passes through explicit human review. Recognising them centrally keeps
 * the catalog routes from special-casing each clone by name.
 */
interface LocalSkillsSource {
  /** Catalog `source` id every ingested record carries. */
  source: string;
  /** Human label for inspection notices. */
  label: string;
  synchronize: (input: { store?: SkillsCatalogStore; force?: boolean }) => unknown;
  getSkill: (upstreamId: string) => {
    detail: SkillsShDetail;
    description: string | null;
    binaryPaths: string[];
    revision: string;
  } | null;
  readFiles: (upstreamId: string) => { files: Record<string, Buffer>; hash: string } | null;
}

export const LOCAL_SKILLS_SOURCES: readonly LocalSkillsSource[] = [
  {
    source: SCIENTIFIC_SKILLS_SOURCE,
    label: "scientific-agent-skills clone",
    synchronize: synchronizeLocalScientificSkillsCatalog,
    getSkill: getLocalScientificSkill,
    readFiles: readLocalScientificSkillFiles,
  },
  {
    source: REVERSE_SKILLS_SOURCE,
    label: REVERSE_SKILLS_LABEL,
    synchronize: synchronizeLocalReverseSkillsCatalog,
    getSkill: getLocalReverseSkill,
    readFiles: readLocalReverseSkillFiles,
  },
  {
    source: DESIGN_SKILLS_SOURCE,
    label: DESIGN_SKILLS_LABEL,
    synchronize: synchronizeLocalDesignSkillsCatalog,
    getSkill: getLocalDesignSkill,
    readFiles: readLocalDesignSkillFiles,
  },
  {
    source: OMH_SKILLS_SOURCE,
    label: OMH_SKILLS_LABEL,
    synchronize: synchronizeLocalOmhSkillsCatalog,
    getSkill: getLocalOmhSkill,
    readFiles: readLocalOmhSkillFiles,
  },
  {
    source: ENGINEERING_SKILLS_SOURCE,
    label: ENGINEERING_SKILLS_LABEL,
    synchronize: synchronizeLocalEngineeringSkillsCatalog,
    getSkill: getLocalEngineeringSkill,
    readFiles: readLocalEngineeringSkillFiles,
  },
  {
    source: HALLMARK_SKILLS_SOURCE,
    label: HALLMARK_SKILLS_LABEL,
    synchronize: synchronizeLocalHallmarkSkillsCatalog,
    getSkill: getLocalHallmarkSkill,
    readFiles: readLocalHallmarkSkillFiles,
  },
  {
    source: OFFICE_SKILLS_SOURCE,
    label: OFFICE_SKILLS_LABEL,
    synchronize: synchronizeLocalOfficeSkillsCatalog,
    getSkill: getLocalOfficeSkill,
    readFiles: readLocalOfficeSkillFiles,
  },
  {
    source: BULLSHIT_SKILLS_SOURCE,
    label: BULLSHIT_SKILLS_LABEL,
    synchronize: synchronizeLocalBullshitSkillsCatalog,
    getSkill: getLocalBullshitSkill,
    readFiles: readLocalBullshitSkillFiles,
  },
];

const REVIEWED_LOCAL_SOURCES = new Set(LOCAL_SKILLS_SOURCES.map((entry) => entry.source));

/** True when a catalog `source` is a reviewed, operator-vendored local clone. */
export function isReviewedLocalSource(source: string | null | undefined): boolean {
  return typeof source === "string" && REVIEWED_LOCAL_SOURCES.has(source);
}

/** Mirror every reviewed local clone into the catalog store. */
export function synchronizeLocalSkillsCatalogs(input: {
  store?: SkillsCatalogStore;
  force?: boolean;
} = {}): void {
  for (const entry of LOCAL_SKILLS_SOURCES) {
    entry.synchronize(input);
  }
}

/** Resolve a locally-mirrored skill snapshot by its stable upstream id, if any. */
export function getLocalReviewedSkill(upstreamId: string): {
  detail: SkillsShDetail;
  description: string | null;
  binaryPaths: string[];
  revision: string;
  source: string;
  label: string;
} | null {
  for (const entry of LOCAL_SKILLS_SOURCES) {
    const skill = entry.getSkill(upstreamId);
    if (skill) return { ...skill, source: entry.source, label: entry.label };
  }
  return null;
}

/** Read a locally-mirrored skill's files for quarantine, if it is one. */
export function readLocalReviewedSkillFiles(upstreamId: string): {
  files: Record<string, Buffer>;
  hash: string;
} | null {
  for (const entry of LOCAL_SKILLS_SOURCES) {
    const files = entry.readFiles(upstreamId);
    if (files) return files;
  }
  return null;
}
