// SPDX-License-Identifier: GPL-3.0-only
// Adapted 2026-11-18 from Bernhard Mueller's Cadence, commit
// 3961509cbb18071621e428b4c1f781b5d8a322da, src/cadence/stream.py
// (FastSynapses.recall/observe, delta rule) and memories.py (EpisodicRecords.vote).
// Breadboard specialization: one outcome per selected suggestion, sparse named
// feature keys, one output, unit cue normalization and a bounded feedback history.
export interface ChoiceEpisode {
  context: readonly string[];
  outcome: number;
}

function unitCue(keys: readonly string[]) {
  const unique = [...new Set(keys)];
  return unique.map((key) => ({ key, value: 1 / Math.sqrt(unique.length) }));
}
function recall(weights: Map<string, number>, cue: ReturnType<typeof unitCue>) {
  return cue.reduce((sum, feature) => sum + (weights.get(feature.key) ?? 0) * feature.value, 0);
}
export function trainChoicePredictor(episodes: readonly ChoiceEpisode[], rate = 0.5) {
  let place = 0;
  const weights = new Map<string, number>();
  for (const episode of episodes) {
    if (!Number.isFinite(episode.outcome)) continue;
    const cue = unitCue(episode.context);
    const residual = episode.outcome - recall(weights, cue);
    for (const { key, value } of cue) weights.set(key, (weights.get(key) ?? 0) + rate * value * residual);
    place += rate * (episode.outcome - place);
  }
  return (context: readonly string[]) => {
    const cue = unitCue(context);
    return cue.length ? 0.5 * (place + recall(weights, cue)) : place;
  };
}

export function episodicVote(episodes: readonly ChoiceEpisode[], context: readonly string[], rate = 0.5) {
  return trainChoicePredictor(episodes, rate)(context);
}
