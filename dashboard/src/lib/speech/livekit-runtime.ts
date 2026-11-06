/** Load only LiveKit's audio detector. The umbrella SDK also loads its own
 * Sharp/libvips, which conflicts with Next's already-loaded DLL on Windows.
 * These paths are pinned to the installed SDK and exercised by the artifact
 * check. The explicit voice trace supplies their complete runtime closure. */
export function loadLiveKitVoiceRuntime() {
  const node = Reflect.apply(Reflect.get(process, 'getBuiltinModule'), process, ['node:module']) as typeof import('node:module');
  const requireVoice = node.createRequire(`${process.cwd()}/package.json`);
  requireVoice('@livekit/local-inference');
  const entry = requireVoice.resolve('@livekit/agents').replaceAll('\\', '/');
  const directory = entry.slice(0, entry.lastIndexOf('/'));
  const { VAD } = requireVoice(`${directory}/inference/vad.cjs`) as { VAD: typeof import('@livekit/agents').inference.VAD };
  const { VADEventType } = requireVoice(`${directory}/vad.cjs`) as Pick<typeof import('@livekit/agents'), 'VADEventType'>;
  const { log, initializeLogger } = requireVoice(`${directory}/log.cjs`) as Pick<typeof import('@livekit/agents'), 'log' | 'initializeLogger'>;
  const { AudioFrame } = requireVoice('@livekit/rtc-node') as Pick<typeof import('@livekit/rtc-node'), 'AudioFrame'>;
  return { VAD, VADEventType, log, initializeLogger, AudioFrame };
}
