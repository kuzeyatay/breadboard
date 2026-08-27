import type { HermesSurface } from "./config.ts";
import {
  SPOTIFY_AGENT_COMMAND,
  SPOTIFY_AGENT_SLUG,
} from "../spotify-agent/identity.ts";

export const SPOTIFY_SKILL = "spotify";

const NON_PLAYBACK = /\b(?:essay|research|theory|biograph|discograph|meaning|interpret|explain|discuss|review|critique|lyrics?|chords?|sheet\s+music|bpm|tempo|key\s+signature|analy[sz]|mix(?:ing)?|master(?:ing)?|transcrib|transcript|caption|convert|transcode|re-?encode|download|upload|edit|trim|normalize|waveform|spectrum)\b/i;
const NON_CATALOG = /\b(?:write|compose|produce|essay|research|theory|biograph|discograph|meaning|interpret|explain|discuss|review|critique|lyrics?|chords?|sheet\s+music|bpm|tempo|key\s+signature|analy[sz]|mix(?:ing)?|master(?:ing)?|transcrib|transcript|caption|convert|transcode|re-?encode|download|upload|edit|trim|normalize|waveform|spectrum)\b/i;
const FALSE_PLAY = /\b(?:play\s+(?:a\s+)?role|play\s+along|play\s+(?:the\s+)?game|video|movie|clip|podcast|audiobook)\b/i;
const DIRECT_START = /^(?:hey\s+\w+[,.]?\s*)?(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?(?:now\s+)?(?:play|put\s+on|listen\s+to|queue(?:\s+up)?|add\s+.+\s+to\s+(?:my\s+)?(?:queue|playlist)|start\s+(?:playing\s+)?)\b/i;
const PLAYLIST_CREATE = /(?:^|\b)(?:create|make|build|generate|curate|put\s+together)\b[^.!?]{0,160}\bplaylist\b/i;
const CONTROL = /(?:^|\b)(?:pause|resume|unpause|stop\s+(?:the\s+)?music|skip(?:\s+this)?|next\s+(?:song|track)|previous\s+(?:song|track)|go\s+back\s+(?:a\s+)?(?:song|track)|seek\s+(?:to|forward|back)|rewind|fast\s*forward|shuffle|repeat|turn\s+(?:the\s+)?(?:music|volume|it)\s+(?:up|down)|set\s+(?:the\s+)?volume|volume\s+(?:up|down|to)|what(?:'s|\s+is)\s+playing|what\s+(?:song|track)\s+is\s+playing|now\s+playing|show\s+(?:the\s+)?queue)\b/i;
const CATALOG_ACTION = /\b(?:find|search(?:\s+for)?|look\s+up|recommend|suggest|discover|browse|show\s+me|list|give\s+me|pick)\b[^.!?]{0,180}\b(?:music|songs?|tracks?|albums?|artists?|bands?|playlists?|singles?|releases?)\b/i;
const CATALOG_RELATION = /\b(?:music|songs?|tracks?|albums?|artists?|bands?|playlists?|singles?)\b[^.!?]{0,120}\b(?:like|similar\s+to|by|from|for)\b/i;
const CATALOG_FACT = /\b(?:(?:what|which)\s+(?:album|artist|band|song|track|single|release)\b[^.!?]{0,160}\b(?:is|was|has|features?|includes?|contains?|by|on|from)|who\s+(?:sings?|sang|recorded|performs?|made|released)\b|(?:top|best|popular|essential|latest|new)\s+(?:songs?|tracks?|albums?|artists?|releases?)\b|what\s+should\s+I\s+listen\s+to\b)/i;

interface SpotifyPlayerPlacementMessage {
  role: "user" | "assistant";
  content: string;
  tools?: Array<{
    toolName: string;
    status?: "running" | "completed" | "failed";
  }>;
}

function withoutSpotifyCommand(text: string): {
  normalized: string;
  explicit: boolean;
} {
  const normalized = text.trim();
  const command = /^\/(?:spotify|agent:agent-spotify)(?:\s+|$)/i.exec(normalized);
  return {
    normalized: command ? normalized.slice(command[0].length).trim() : normalized,
    explicit: Boolean(command),
  };
}

/** Requests that should prepare or control the conversation's inline player. */
export function isSpotifyPlaybackRequest(text: string): boolean {
  const { normalized } = withoutSpotifyCommand(text);
  if (!normalized) return false;
  return (DIRECT_START.test(normalized) || PLAYLIST_CREATE.test(normalized) || CONTROL.test(normalized))
    && !NON_PLAYBACK.test(normalized)
    && !FALSE_PLAY.test(normalized);
}

/** Music discovery and metadata questions that benefit from Spotify's live catalog. */
export function isSpotifyCatalogRequest(text: string): boolean {
  const { normalized, explicit } = withoutSpotifyCommand(text);
  if (!normalized) return explicit;
  return (CATALOG_ACTION.test(normalized) || CATALOG_RELATION.test(normalized) || CATALOG_FACT.test(normalized))
    && !NON_CATALOG.test(normalized)
    && !FALSE_PLAY.test(normalized);
}

/** Shared intent vocabulary for automatic Spotify skill selection. */
export function isSpotifyRequest(text: string): boolean {
  const { explicit } = withoutSpotifyCommand(text);
  return explicit || isSpotifyPlaybackRequest(text) || isSpotifyCatalogRequest(text);
}

/** True for both Breadboard's native Spotify tools and remote MCP tool names. */
export function isSpotifyToolName(toolName: string): boolean {
  return /(?:^|__)spotify(?:_|$)/i.test(toolName.trim());
}

function isSpotifyPlaybackToolName(toolName: string): boolean {
  return /(?:^|__)spotify_(?:play|prepare_playback|create_playlist)(?:__|$)/i.test(
    toolName.trim(),
  );
}

/**
 * Choose the one assistant row that owns the conversation's live player.
 *
 * The player is conversation-scoped, so rendering one in every old music row
 * would create several controls for the same device. Keeping it only on the
 * latest row was also wrong: a new message made the player unmount, and
 * contextual requests such as "another one" do not contain Spotify keywords.
 * Keep the last confirmed music row instead. A first explicit request can own
 * its loading state immediately; later requests advance only while a Spotify
 * tool is active or after it succeeds. If that tool fails, the previous player
 * returns instead of disappearing with the failed turn.
 */
export function spotifyPlayerAssistantIndex(
  messages: SpotifyPlayerPlacementMessage[],
): number {
  let owner = -1;
  let previousUserIndex = -1;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      previousUserIndex = index;
      return;
    }

    const explicitRequest =
      previousUserIndex >= 0 &&
      isSpotifyPlaybackRequest(messages[previousUserIndex]?.content ?? "");
    const usedSpotify = message.tools?.some(
      (tool) =>
        tool.status !== "failed" &&
        isSpotifyPlaybackToolName(tool.toolName),
    );
    if (usedSpotify || (explicitRequest && owner < 0)) owner = index;
  });

  return owner;
}

export interface SpotifyIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  hasAudioAttachment?: boolean;
  activeAgentSlug?: string | null;
}

export function spotifyCommandText(
  input: SpotifyIntentInput,
): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const privateSurface =
    input.surface === "dashboard_terminal" || input.surface === "garden_chat";
  const eligible = input.authenticated && privateSurface && !text.startsWith("/");
  const explicitAgent = new RegExp(
    `^${SPOTIFY_AGENT_COMMAND.replace("/", "\\/")}(?:\\s+|$)`,
    "i",
  ).exec(text);
  if (input.authenticated && privateSurface && explicitAgent) {
    const request = text.slice(explicitAgent[0].length).trim();
    return {
      text: request
        ? `${SPOTIFY_AGENT_COMMAND} /${SPOTIFY_SKILL} ${request}`
        : text,
      automatic: Boolean(request),
    };
  }
  if (eligible && input.activeAgentSlug === SPOTIFY_AGENT_SLUG && text) {
    return { text: `/${SPOTIFY_SKILL} ${input.text}`, automatic: true };
  }
  const automatic = eligible && isSpotifyRequest(text);
  return { text: automatic ? `/${SPOTIFY_SKILL} ${input.text}` : input.text, automatic };
}
