// The Socials Manager agent's chat identity: the slash command that activates
// it and the parsing of a prompt into a drafting request.
//
// Mirrors the OpenPlanter / Deep Research identity modules so every runtime
// agent is reached the same way — type the command in chat, and the agent's own
// surface appears inline for that turn only.
//
// The agent was called Postiz until it was renamed after the thing it does
// rather than after the stack it publishes through. `/agents:postiz` is still
// accepted, because it is sitting in people's chat history and in their muscle
// memory, and a command that used to work should not start doing nothing.

import { parseStamp } from "../calendar/wallclock.ts";
import {
  isSocialsManagerProviderId,
  resolveProviderMention,
  type SocialsManagerProvider,
} from "./providers.ts";

export const SOCIALS_MANAGER_COMMAND = "/agents:socials-manager";
export const SOCIALS_MANAGER_AGENT_ID = "socials-manager";
export const SOCIALS_MANAGER_AGENT_NAME = "Socials Manager";

/** The pre-rename command and agent id, still honoured wherever one is read. */
export const LEGACY_SOCIALS_MANAGER_COMMAND = "/agents:postiz";
export const LEGACY_SOCIALS_MANAGER_AGENT_ID = "postiz";

const COMMAND_TOKENS = new Set(["agents:socials-manager", "agents:postiz"]);

/**
 * Extract the brief from a Socials Manager invocation, preserving any other
 * slash tokens the user stacked in front of it so the command resolver still
 * sees them. Mirrors the Ruflo parser.
 */
export function taskFromSocialsManagerCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (COMMAND_TOKENS.has(match[1].toLowerCase())) {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function socialsManagerUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${SOCIALS_MANAGER_COMMAND} ${trimmed}` : SOCIALS_MANAGER_COMMAND;
}

export interface SocialsManagerRequest {
  /** What the post is about, with the flags stripped out. */
  brief: string;
  /** Networks explicitly requested by the user. Empty uses accounts, then local defaults. */
  providerIds: string[];
  /**
   * Wall-clock stamp ("YYYY-MM-DDTHH:MM") the user pinned with `--at`, or null
   * to let the drafting step propose one.
   */
  scheduleAt: string | null;
  /**
   * Draw artwork for every post as part of the run. Opt-in because generating
   * an image costs a slow provider round trip per network, and a run that only
   * needs copy should not pay for it.
   */
  withImages: boolean;
}

/**
 * Split a prompt into the brief and its run shape. Options stay inline flags so
 * chat remains the only surface, matching Deep Research:
 *   `--on x,linkedin` / `-o x,linkedin`  choose networks
 *   `--at 2026-08-05T09:00`              pin the publish time
 *   `--image` / `--images` / `-i`        draw artwork for each post
 *   `--no-image`                         skip artwork for this post
 * Anything unrecognized stays part of the brief.
 *
 * `defaults` is the user's saved settings: the networks to draft for when the
 * message names none, and whether artwork is drawn without asking. Both are
 * overridable in the message, which is what `--no-image` is for.
 */
export function parseSocialsManagerRequest(
  task: string,
  defaults?: { providerIds?: string[]; withImages?: boolean },
): SocialsManagerRequest {
  // Saved defaults first. `--on` replaces them wholesale rather than adding to
  // them, so a message that names networks is the complete list for that post.
  const defaultProviderIds = (defaults?.providerIds ?? []).filter((id) =>
    isSocialsManagerProviderId(id),
  );
  const providerIds: string[] = [];
  let scheduleAt: string | null = null;
  let withImages = defaults?.withImages === true;

  const brief = task
    .replace(/(?:^|\s)--no-images?(?=\s|$)/gi, () => {
      withImages = false;
      return " ";
    })
    .replace(/(?:^|\s)(?:--images?|-i)(?=\s|$)/gi, () => {
      withImages = true;
      return " ";
    })
    .replace(
      /(?:^|\s)(?:--at|-a)[= ](\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)/gi,
      (match, value: string) => {
        const normalized = value.includes("T") || value.includes(" ")
          ? value.replace(" ", "T")
          : `${value}T09:00`;
        if (parseStamp(normalized)) {
          scheduleAt = normalized;
          return " ";
        }
        return match;
      },
    )
    .replace(
      /(?:^|\s)(?:--on|-o)[= ]([a-z0-9_.,-]+)/gi,
      (match, value: string) => {
        const resolved = value
          .split(",")
          .map((mention) => resolveProviderMention(mention))
          .filter((provider): provider is SocialsManagerProvider => provider !== null);
        if (!resolved.length) return match;
        for (const provider of resolved) {
          if (!providerIds.includes(provider.id)) providerIds.push(provider.id);
        }
        return " ";
      },
    )
    .replace(/\s+/g, " ")
    .trim();

  return {
    brief,
    providerIds: providerIds.length ? providerIds : defaultProviderIds,
    scheduleAt,
    withImages,
  };
}
