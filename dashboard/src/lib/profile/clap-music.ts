import type { ClapAction } from './clap-action.ts';

type Track = { uri: string; name: string };
export interface ClapMusicServices {
  connected(): boolean;
  api(input: { method: 'GET' | 'PUT' | 'POST'; endpoint: string; query?: Record<string, number | string>; body?: unknown }): Promise<unknown>;
  search(query: string): Promise<Track[]>;
  engine(): Promise<{ ready: boolean; deviceId: string | null }>;
  random(): number;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
function savedTrack(payload: unknown): Track | null {
  const items = record(payload).items;
  const track = record(record(Array.isArray(items) ? items[0] : null).track);
  return typeof track.uri === 'string' && /^spotify:track:[A-Za-z0-9]{10,64}$/.test(track.uri) && typeof track.name === 'string' && track.is_playable !== false
    ? { uri: track.uri, name: track.name } : null;
}

/** Uses the existing account connection and player; never picks an external URL. */
export async function executeClapMusic(action: Extract<ClapAction, { kind: 'music' }>, services: ClapMusicServices): Promise<string> {
  if (!services.connected()) throw new Error('Connect Spotify in Settings → Connections, then try your gesture again.');
  const engine = await services.engine();
  const deviceId = engine.ready ? engine.deviceId : null;
  if (!deviceId) throw new Error("Breadboard's Spotify player is unavailable. Try your gesture again once the player is ready.");
  const query = { device_id: deviceId };
  if (['pause', 'resume', 'next', 'previous'].includes(action.operation)) {
    const operation = action.operation === 'resume' ? 'play' : action.operation;
    await services.api({ method: ['next', 'previous'].includes(operation) ? 'POST' : 'PUT', endpoint: `/v1/me/player/${operation}`, query });
    return { pause: 'Asked Spotify to pause.', resume: 'Asked Spotify to resume.', next: 'Skipped to the next song.', previous: 'Went to the previous song.' }[action.operation as 'pause' | 'resume' | 'next' | 'previous'];
  }
  let track: Track | null = null;
  if (action.trackUri) {
    track = { uri: action.trackUri, name: action.query! };
  } else if (action.query) {
    const tracks = await services.search(action.query);
    track = tracks[action.operation === 'random' ? Math.floor(services.random() * tracks.length) : 0] ?? null;
    if (!track) throw new Error(`No Spotify song matched “${action.query}”. Change the prompt in Profile.`);
  } else {
    const first = await services.api({ method: 'GET', endpoint: '/v1/me/tracks', query: { limit: 1 } });
    const total = Number(record(first).total);
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Your Spotify Liked Songs is empty. Like a song or choose an artist in Profile.');
    // Sample across the entire library, rather than only the latest page.
    const offset = Math.floor(services.random() * total);
    track = savedTrack(offset === 0 ? first : await services.api({ method: 'GET', endpoint: '/v1/me/tracks', query: { limit: 1, offset } }));
    if (!track) throw new Error('That saved song is unavailable on Spotify. Clap again to choose another.');
  }
  await services.api({ method: 'PUT', endpoint: '/v1/me/player/play', query, body: { uris: [track.uri] } });
  return `Playing “${track.name}” in Breadboard.`;
}
