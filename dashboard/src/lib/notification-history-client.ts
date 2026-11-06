import { VOICE_ASSISTANT_CHANNEL } from './speech/assistant-preferences.ts';

export async function updateNotificationHistory(body: { notice?: unknown; clearHistory?: string[]; readHistory?: string[] }): Promise<void> {
  const response = await fetch('/api/chat-notifications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true,
  });
  if (!response.ok) throw new Error('Couldn’t update notifications. Try again.');
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
    channel.postMessage({ type: 'notification-history-changed' });
    channel.close();
  }
}
