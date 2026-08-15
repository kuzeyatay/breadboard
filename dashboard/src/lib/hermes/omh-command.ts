/**
 * Command-side identity of the vendored oh-my-hermes workflow pack, kept out of
 * omh-skills-source.ts so the composer can recognise a workflow without pulling
 * that module's filesystem synchroniser into the client bundle.
 */

/** GitHub identity of the vendored oh-my-hermes workflow pack. */
export const OMH_SKILLS_SOURCE = "rlaope/oh-my-hermes";
/** Every workflow reaches a chat as `/omh:<slug>`. */
export const OMH_COMMAND_PREFIX = "omh:";

export function omhWorkflowToken(slug: string): string {
  return `${OMH_COMMAND_PREFIX}${slug}`;
}

/**
 * Workflows are installed, reviewed, and stored as skills, so only the entry's
 * own fields separate them: the `omh:` command it was assigned, the upstream id
 * it was installed under, or the clone it was mirrored from.
 */
export function isWorkflowCommand(item: {
  kind?: string;
  id?: string;
  slug?: string;
  token?: string;
  source?: string;
}): boolean {
  if (item.kind && item.kind !== "skill") return false;
  if (
    [item.slug, item.token].some((value) =>
      value?.toLowerCase().startsWith(OMH_COMMAND_PREFIX),
    )
  ) {
    return true;
  }
  return [item.id, item.source].some((value) =>
    value?.toLowerCase().includes(OMH_SKILLS_SOURCE),
  );
}
