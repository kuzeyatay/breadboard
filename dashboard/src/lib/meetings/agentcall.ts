// AgentCall (https://agentcall.dev): a cloud meeting bot that joins Google
// Meet, Zoom and Teams. Breadboard talks to its REST API and call WebSocket
// directly rather than running the skill's bridge scripts: the bridge exists to
// turn the call into a coding agent's stdin/stdout, and Breadboard's server is
// already the long-lived process that can hold the socket.
//
// The key lives where AgentCall's own scripts keep it (~/.agentcall/config.json,
// or AGENTCALL_API_KEY), so an account made with the CLI works here and the
// other way round. It is only ever sent to the AgentCall API.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENTCALL_DEFAULT_API = "https://api.agentcall.dev";

export class AgentCallError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

function configPath(): string {
  return path.join(os.homedir(), ".agentcall", "config.json");
}

function readConfig(): { api_key?: string; api_url?: string } {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")) as { api_key?: string; api_url?: string }; }
  catch { return {}; }
}

export function agentCallApiUrl(): string {
  const url = process.env.AGENTCALL_API_URL || readConfig().api_url || AGENTCALL_DEFAULT_API;
  return url.replace(/\/+$/, "");
}

export function agentCallApiKey(): string | null {
  const key = (process.env.AGENTCALL_API_KEY || readConfig().api_key || "").trim();
  return /^ak_ac_[A-Za-z0-9_-]{8,}$/.test(key) ? key : null;
}

/** Merge the key into AgentCall's own config file, keeping its other fields. */
export function saveAgentCallApiKey(key: string): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const config = readConfig();
  fs.writeFileSync(file, JSON.stringify({ ...config, api_key: key }, null, 2), { mode: 0o600 });
}

async function request<T>(method: string, route: string, body?: unknown, token?: string | null, timeoutMs = 30_000): Promise<T> {
  const key = token === undefined ? agentCallApiKey() : token;
  if (token === undefined && !key) {
    throw new AgentCallError(401, "agentcall_key_missing", "Breadboard has no AgentCall account yet.");
  }
  let response: Response;
  try {
    response = await fetch(`${agentCallApiUrl()}${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new AgentCallError(503, "agentcall_unreachable", `AgentCall could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error : `AgentCall answered ${response.status}.`;
    throw new AgentCallError(response.status, agentCallErrorCode(response.status), agentCallErrorMessage(response.status, message));
  }
  return data as T;
}

export function agentCallErrorCode(status: number): string {
  return status === 401 ? "agentcall_key_invalid" : status === 402 ? "agentcall_out_of_credits"
    : status === 409 ? "agentcall_conflict" : status === 429 ? "agentcall_busy" : status === 400 ? "agentcall_bad_request" : "agentcall_failed";
}

function agentCallErrorMessage(status: number, message: string): string {
  if (status === 401) return "The saved AgentCall key was refused. Sign in again to AgentCall to get a new one.";
  if (status === 402) return "The AgentCall account is out of credits.";
  if (status === 429) return `AgentCall is at its limit (a plan allows one call at a time): ${message}`;
  return message;
}

export interface AgentCallCall {
  call_id: string;
  status: string;
  meet_url?: string;
  bot_name?: string;
  bot_name_note?: string;
  ws_url?: string;
  created_at?: string;
  ended_at?: string | null;
}

export interface CreateCallInput {
  meetUrl: string;
  botName: string;
  context: string;
  triggerWords: string[];
  languages?: string[];
  disclosure?: string;
}

/** Google Meet, Zoom and Teams links only: the bot can join nothing else. */
export function meetingPlatform(url: string): "meet" | "zoom" | "teams" | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "meet.google.com") return "meet";
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return "zoom";
  if (host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com")) return "teams";
  return null;
}

/**
 * The realtime strategy: the bot's own voice answers greetings and simple
 * questions within a second, and hands everything that needs Breadboard (the
 * person's files, calendar, memory, tools, chat posts) back as `agent.request`.
 */
export function createCallBody(input: CreateCallInput): Record<string, unknown> {
  return {
    meet_url: input.meetUrl,
    bot_name: input.botName,
    mode: "audio",
    voice_strategy: "realtime",
    realtime: {
      trigger_words: input.triggerWords,
      context: input.context.slice(0, 10_000),
      audience: "auto",
      search: true,
      ...(input.languages?.length ? { languages: input.languages.slice(0, 5) } : {}),
      vad_confirm_ms: 500,
      vad_min_loud_frames: 14,
    },
    // A bot nobody is talking to costs money; leave an empty room and cap a call.
    alone_timeout: 120_000,
    max_duration: 3 * 60 * 60_000,
    ...(input.disclosure ? { disclosure: { enabled: true, message: input.disclosure, delay_seconds: 5 } } : {}),
  };
}

export function createCall(input: CreateCallInput): Promise<AgentCallCall> {
  return request<AgentCallCall>("POST", "/v1/calls", createCallBody(input));
}

export function listCalls(): Promise<AgentCallCall[]> {
  return request<AgentCallCall[]>("GET", "/v1/calls").then(rows => Array.isArray(rows) ? rows : []);
}

export function getCall(callId: string): Promise<AgentCallCall> {
  return request<AgentCallCall>("GET", `/v1/calls/${encodeURIComponent(callId)}`);
}

export async function endCall(callId: string): Promise<void> {
  try { await request("DELETE", `/v1/calls/${encodeURIComponent(callId)}`); }
  catch (error) { if (!(error instanceof AgentCallError && error.status === 409)) throw error; }
}

export interface TranscriptEntry { speaker: string; text: string; at: string }

export async function getTranscript(callId: string): Promise<TranscriptEntry[]> {
  const body = await request<{ entries?: Array<{ speaker?: { name?: string }; text?: string; timestamp?: string }> }>(
    "GET", `/v1/calls/${encodeURIComponent(callId)}/transcript?format=json`);
  return (body.entries ?? []).filter(entry => typeof entry.text === "string" && entry.text.trim())
    .map(entry => ({ speaker: entry.speaker?.name || "Someone", text: entry.text!.trim(), at: entry.timestamp ?? "" }));
}

export function callSocketUrl(callId: string): string {
  const key = agentCallApiKey();
  if (!key) throw new AgentCallError(401, "agentcall_key_missing", "Breadboard has no AgentCall account yet.");
  return `${agentCallApiUrl().replace(/^http/, "ws")}/v1/calls/${encodeURIComponent(callId)}/ws?api_key=${encodeURIComponent(key)}`;
}

/** Step one of signing up or in: AgentCall emails a six-digit code. */
export async function sendSignInCode(email: string): Promise<void> {
  await request("POST", "/v1/auth/email-otp/send", { email: email.trim().toLowerCase() }, null);
}

/** Step two: trade the code for a session, mint an API key and keep it. */
export async function verifySignInCode(email: string, code: string): Promise<{ newAccount: boolean; keyPrefix: string }> {
  const session = await request<{ token?: string; is_new_user?: boolean }>("POST", "/v1/auth/email-otp/verify",
    { email: email.trim().toLowerCase(), code: code.trim() }, null);
  if (!session?.token) throw new AgentCallError(400, "agentcall_code_invalid", "That code was not accepted. It may have expired.");
  const minted = await request<{ key?: string; key_prefix?: string }>("POST", "/v1/auth/api-keys",
    { name: `Breadboard on ${os.hostname() || "this computer"}` }, session.token);
  if (!minted?.key) throw new AgentCallError(502, "agentcall_key_not_minted", "AgentCall did not return an API key.");
  saveAgentCallApiKey(minted.key);
  return { newAccount: Boolean(session.is_new_user), keyPrefix: minted.key_prefix ?? minted.key.slice(0, 10) };
}
