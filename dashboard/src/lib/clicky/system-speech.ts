/** Windows' installed voice can read a reply even when a saved Voicebox profile is gone. */
export async function speakWithSystemVoice(text: string, signal: AbortSignal): Promise<boolean> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  if (!synth.getVoices().length) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        synth.removeEventListener("voiceschanged", finish);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      synth.addEventListener("voiceschanged", finish, { once: true });
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  }
  signal.throwIfAborted();
  const voices = synth.getVoices().filter((voice) => voice.localService);
  const voice = voices.find((candidate) => candidate.lang.startsWith(navigator.language.split("-")[0])) || voices[0];
  if (!voice) return false;
  return new Promise<boolean>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      utterance.onend = null;
      utterance.onerror = null;
    };
    const abort = () => { cleanup(); synth.cancel(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); synth.cancel(); resolve(false); }, 180_000);
    utterance.onend = () => { cleanup(); resolve(true); };
    utterance.onerror = () => { cleanup(); resolve(false); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    synth.cancel();
    synth.speak(utterance);
  });
}
