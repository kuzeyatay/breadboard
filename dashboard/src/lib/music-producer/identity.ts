export const MUSIC_PRODUCER_COMMAND = "/agents:music-producer";
export const MUSIC_PRODUCER_AGENT_ID = "music-producer";
export const MUSIC_PRODUCER_AGENT_NAME = "Music Producer";
export function taskFromMusicProducerCommand(value: string): string | null {
  let remaining = value.trim();
  const tokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match)
      break;
    if (`/${match[1].toLowerCase()}` === MUSIC_PRODUCER_COMMAND)
      selected = true;
    else
      tokens.push(`/${match[1]}`);
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return selected ? [...tokens, remaining].filter(Boolean).join(" ").trim() : null;
}
export function musicProducerUserMessage(task: string): string {
  return `${MUSIC_PRODUCER_COMMAND} ${task.trim()}`.trim();
}
