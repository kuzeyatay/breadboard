/** Measure decoded samples before the muted media element's volume is applied.
 * Chromium can report zero RTP energy while MediaRecorder receives real speech. */
export function createRemoteAudioActivity(context: AudioContext) {
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let sink: GainNode | undefined;
  let energy = 0, samples = 0, level = 0;
  function close() {
    if (processor) processor.onaudioprocess = null;
    source?.disconnect(); processor?.disconnect(); sink?.disconnect();
    source = undefined; processor = undefined; sink = undefined;
  }
  return {
    attach(stream: MediaStream) {
      close();
      energy = samples = level = 0;
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(2048, 1, 1);
      sink = context.createGain();
      sink.gain.value = 0;
      processor.onaudioprocess = event => {
        const frame = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (const value of frame) sum += value * value;
        energy += sum / context.sampleRate;
        samples += frame.length;
        level = Math.sqrt(sum / frame.length);
      };
      // Keep decoding scheduled in the hidden companion without making the
      // unverified remote track audible. Playback owns a separate element.
      source.connect(processor).connect(sink).connect(context.destination);
    },
    snapshot() {
      return processor ? { totalAudioEnergy: energy, totalSamplesDuration: samples / context.sampleRate, audioLevel: level } : undefined;
    },
    close,
  };
}
