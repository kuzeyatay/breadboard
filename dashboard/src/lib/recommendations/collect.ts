import { cleanRecommendationText, type RecommendationEvidence } from './types.ts';

/** Independent bounded reads: one disconnected service cannot discard the rest. */
export async function collectRecommendationEvidence(readers: Array<() => Promise<RecommendationEvidence[]>>, timeoutMs = 10_000) {
  const results = await Promise.allSettled(readers.map(async read => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(read),
        new Promise<RecommendationEvidence[]>((_, reject) => { timer = setTimeout(() => reject(new Error('Source timed out')), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }));
  const seen = new Set<string>();
  const cleaned = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).flatMap(item => {
    const title = cleanRecommendationText(item.title, 180);
    if (!title || !item.id || seen.has(item.id)) return [];
    // Login and account-recovery material has no place on a home-screen card.
    if (/\b(verification code|one[- ]time (?:code|password)|password reset|security code|sign[- ]in code)\b/i.test(title)) return [];
    seen.add(item.id);
    return [{ ...item, title, summary: cleanRecommendationText(item.summary, 800) }];
  });
  // A busy local history must not use the entire budget before mail, calendar
  // or Recall is considered. Preserve each source's order while mixing sources.
  const groups = new Map<string, RecommendationEvidence[]>();
  for (const item of cleaned) {
    const group = groups.get(item.source) ?? [];
    group.push(item); groups.set(item.source, group);
  }
  const mixed: RecommendationEvidence[] = [];
  for (let index = 0; mixed.length < 28; index++) {
    const row = [...groups.values()].flatMap(group => group[index] ? [group[index]] : []);
    if (!row.length) break;
    mixed.push(...row.slice(0, 28 - mixed.length));
  }
  return mixed;
}
