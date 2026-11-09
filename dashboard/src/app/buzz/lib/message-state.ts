import type { BuzzMessage } from "../types.ts";

export function transcriptKey(userId: number, roomId: string, parentId: number | null = null): string {
  return `breadboard:organization:${userId}:${roomId}:${parentId ?? "room"}`;
}

export function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

export function writeStored(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep session state when storage is unavailable. */ }
}

export function mergeMessages(previous: BuzzMessage[], incoming: BuzzMessage[]): BuzzMessage[] {
  const merged = new Map(previous.map(message => [message.clientMessageId, message]));
  for (const message of incoming) merged.set(message.clientMessageId, message);
  return [...merged.values()].sort((a, b) => a.id - b.id);
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? "That change could not be saved. Try again.");
  return body as T;
}
