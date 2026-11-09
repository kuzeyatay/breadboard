/** Explicit limits on retrieval apply before automatic research tools run. */
export function restrictsExternalResearch(question: string): boolean {
  const text = question.replaceAll("’", "'");
  // A topic such as "schools without internet access" is not an instruction
  // to disable research. Recognize exclusions at the start of a clause.
  for (const clause of text.split(/[.!?;\n]/u).map(value => value.trim())) {
    if (/^(?:please\s+)?(?:use\s+)?no\s/iu.test(clause) &&
        /\b(?:internet|web)(?!\s+(?:restrictions?|limits?)\b)\b|\bexternal\s+(?:parts?\s+)?(?:research|lookups?|sources?)\b/iu.test(clause)) return true;
    if (/^(?:please\s+)?(?:without|avoid)\s+(?:(?:using|accessing|searching)\s+)?(?:the\s+)?(?:internet|web|browsing)\b/iu.test(clause)) return true;
  }
  if (/\bwithout\s+(?:browsing|(?:using|accessing|searching)\s+(?:the\s+)?(?:internet|web))\b/iu.test(text)) return true;
  // Includes lists such as "Do not install packages, browse, or publish".
  for (const match of text.matchAll(/\b(?:do not|don't|never)\s+([^.!?;\n]+)/giu)) {
    if (/(?:^|,|\b(?:and|or))\s*(?:browse\b|(?:use|access|search|retrieve)\s+(?:the\s+)?(?:internet|web|external sources?)\b)/iu.test(match[1])) return true;
  }
  return false;
}
