/** Receiving decoded audio does not prove that the speaker is playing it. */
export async function startLiveSpeechOutput(
  context: AudioContext,
  player: HTMLAudioElement,
  current: () => boolean,
  signal: AbortSignal,
): Promise<boolean> {
  const active = () => current() && !signal.aborted;
  if (!active()) return false;
  const wait = (operation: Promise<void>) => new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const aborted = () => finish(signal.reason ?? new Error('Voice playback stopped.'));
    const timer = setTimeout(() => finish(new Error('Voice audio could not start. Reopen voice to reconnect.')), 2000);
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(() => finish(), finish);
    if (signal.aborted) aborted();
  });
  try {
    if (context.state !== 'running') await wait(context.resume());
    if (!active()) { if (signal.aborted) player.volume = 0; return false; }
    if (context.state !== 'running') throw new Error('Voice audio is suspended. Reopen voice to reconnect.');
    player.muted = false;
    player.volume = 1;
    // Reassert play after unmuting a warm stream. An earlier successful muted
    // play() can outlive an output-device change, suspension, or autoplay pause.
    await wait(player.play());
    if (!active()) { if (signal.aborted) player.volume = 0; return false; }
    if (player.paused || player.ended || player.error) {
      throw new Error('Voice audio stopped before playback. Reopen voice to reconnect.');
    }
    return true;
  } catch (error) {
    if (!active()) { if (signal.aborted) player.volume = 0; return false; }
    player.volume = 0;
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('Click voice to enable audio playback.');
    }
    throw error;
  }
}
