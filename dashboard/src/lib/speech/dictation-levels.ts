/** Match the microphone meter in SpeechDictationButton, without changing pill size. */
export function watchDictationLevels(stream: MediaStream, paint: (rms: number) => void): () => void {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser(); analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0, stopped = false;
  const update = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(samples);
    let energy = 0; for (const sample of samples) energy += sample * sample;
    paint(Math.sqrt(energy / samples.length));
    frame = requestAnimationFrame(update);
  };
  void context.resume().catch(() => {}); update();
  return () => { stopped = true; cancelAnimationFrame(frame); source.disconnect(); analyser.disconnect(); void context.close(); paint(0); };
}

export function paintDictationLevels(bars: readonly (HTMLSpanElement | null)[], rms: number) {
  const level = Math.min(1, Math.max(0, rms * 9));
  const shape = [0.56, 0.82, 1, 0.76, 0.52];
  bars.forEach((bar, index) => {
    if (!bar) return;
    bar.style.transform = `scaleY(${Math.min(1, 0.24 + level * (shape[index] ?? 0.6)).toFixed(3)})`;
    bar.style.opacity = `${(0.62 + level * 0.38).toFixed(3)}`;
  });
}
