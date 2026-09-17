import { splitSpeechPassages } from './passages.ts';

/** Start a short passage as soon as it is ready, preparing at most one ahead. */
export async function playVoicePassages(text: string, options: {
  signal: AbortSignal;
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob>;
  play: (audio: Blob, signal: AbortSignal, onProgress: (progress: number) => void) => Promise<void>;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const passages = splitSpeechPassages(text, { maxCharacters: 360, maxWords: 50 });
  if (!passages.length) return;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const total = passages.reduce((count, passage) => count + passage.length, 0);
  // Prefetched failures are observed even if playback is stopped before they
  // are consumed. Neither a late success nor a late failure can start audio.
  const prepare = (passage: string) => Promise.resolve().then(() => {
    signal.throwIfAborted();
    return options.synthesize(passage, signal);
  }).then(audio => ({ audio } as const), error => ({ error } as const));
  let prepared = prepare(passages[0]);
  let completed = 0;
  try {
    for (let index = 0; index < passages.length; index++) {
      const result = await prepared;
      signal.throwIfAborted();
      if ('error' in result) throw result.error;
      if (index + 1 < passages.length) prepared = prepare(passages[index + 1]);
      const length = passages[index].length;
      await options.play(result.audio, signal, progress => {
        if (!signal.aborted) options.onProgress?.((completed + length * progress) / total);
      });
      signal.throwIfAborted();
      completed += length;
    }
    options.onProgress?.(1);
  } finally {
    controller.abort();
  }
}
