// User-initiated Agent Reach setup is finite privileged work. The dashboard
// owns only the closed presentation catalog and request validation; Runtime V2
// owns every installer/configuration process and its complete descendant tree.

import {
  AgentReachSetupJobError,
  runAgentReachSetupJob,
  type AgentReachSetupRequest,
  type AgentReachSetupResult,
} from "../runtime-v2/agent-reach-setup-job.ts";

export class SetupError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.name = "SetupError";
  }
}

export interface InstallTarget {
  id: string;
  label: string;
  /** What the user gets once this finishes. */
  unlocks: string;
  /** Channels whose doctor entry should improve afterwards. */
  channels: string[];
  /** Shown when the platform has no supported recipe. */
  manual?: string;
  available: boolean;
}

const INSTALL_TARGETS: InstallTarget[] = [
  {
    id: "exa",
    label: "Exa web search",
    unlocks: "Semantic search across the open web. Free, no API key.",
    channels: ["exa_search"],
    available: true,
  },
  {
    id: "yt-dlp",
    label: "YouTube (yt-dlp)",
    unlocks: "Video metadata, subtitles, and video search.",
    channels: ["youtube"],
    available: true,
  },
  {
    id: "bili-cli",
    label: "Bilibili (bili-cli)",
    unlocks: "Video details, search, rankings, and audio — no login needed.",
    channels: ["bilibili"],
    available: true,
  },
  {
    id: "twitter-cli",
    label: "Twitter/X (twitter-cli)",
    unlocks: "The reader itself. Add cookies below before it can fetch anything.",
    channels: ["twitter"],
    available: true,
  },
  {
    id: "rdt-cli",
    label: "Reddit (rdt-cli)",
    unlocks: "Reddit search and post reading. Needs a login afterwards.",
    channels: ["reddit"],
    available: true,
  },
  {
    id: "opencli",
    label: "OpenCLI (Facebook, Instagram, XiaoHongShu, Reddit)",
    unlocks:
      "One backend for the login-only platforms. It drives a Chrome you are already signed in to, so after installing you also need its Chrome extension — Agent Reach never signs in for you.",
    channels: ["facebook", "instagram", "xiaohongshu", "reddit"],
    available: true,
    manual:
      "Install the OpenCLI extension from the Chrome Web Store, then sign in to each platform in that Chrome profile.",
  },
  {
    id: "gh",
    label: "GitHub CLI",
    unlocks:
      "Repository, issue, PR, and code search. Sign in afterwards with `gh auth login`, or paste a token below.",
    channels: ["github"],
    available: process.platform === "win32",
    manual: "Install the GitHub CLI from https://cli.github.com, then run `gh auth login`.",
  },
  {
    id: "ffmpeg",
    label: "Podcast transcription tools",
    unlocks: "ffmpeg plus Agent Reach's Xiaoyuzhou transcription script.",
    channels: ["xiaoyuzhou"],
    available: process.platform === "win32",
    manual: "Install ffmpeg from https://ffmpeg.org/download.html and put it on PATH.",
  },
];

/** Config keys accepted by the sealed Runtime setup worker. */
export interface CredentialField {
  key: string;
  label: string;
  channels: string[];
  hint: string;
  /** Where the user gets the value. */
  source?: string;
}

const CREDENTIALS: CredentialField[] = [
  {
    key: "groq-key",
    label: "Groq API key",
    channels: ["xiaoyuzhou", "youtube"],
    hint: "Whisper transcription for podcasts and videos without subtitles.",
    source: "https://console.groq.com/keys — free",
  },
  {
    key: "openai-key",
    label: "OpenAI API key",
    channels: ["xiaoyuzhou"],
    hint: "Fallback transcription provider when Groq fails.",
  },
  {
    key: "github-token",
    label: "GitHub token",
    channels: ["github"],
    hint: "An alternative to `gh auth login` for read-only repository access.",
    source: "https://github.com/settings/tokens",
  },
  {
    key: "twitter-cookies",
    label: "Twitter/X cookies",
    channels: ["twitter"],
    hint:
      "Export with the Cookie-Editor extension while signed in to x.com, then paste the header string.",
  },
  {
    key: "xhs-cookies",
    label: "XiaoHongShu cookies",
    channels: ["xiaohongshu"],
    hint: "Cookie-Editor export only. Agent Reach never signs in for you or reads your browser.",
  },
  {
    key: "youtube-cookies",
    label: "YouTube cookies",
    channels: ["youtube"],
    hint: "Only needed for age-restricted or members-only videos.",
  },
  {
    key: "proxy",
    label: "Proxy URL",
    channels: ["reddit", "twitter"],
    hint: "Only needed on a server whose IP those platforms block. Local machines do not need one.",
  },
];

export const COOKIE_BROWSERS = ["chrome", "edge", "firefox", "brave", "opera"] as const;
export const COOKIE_PLATFORMS = ["bilibili", "xueqiu"] as const;

export function setupCatalog(): {
  installs: InstallTarget[];
  credentials: CredentialField[];
  browsers: readonly string[];
  platforms: readonly string[];
} {
  return {
    installs: INSTALL_TARGETS.map((target) => ({
      ...target,
      channels: [...target.channels],
    })),
    credentials: CREDENTIALS.map((field) => ({
      ...field,
      channels: [...field.channels],
    })),
    browsers: COOKIE_BROWSERS,
    platforms: COOKIE_PLATFORMS,
  };
}

function requireUserId(userId: number): number {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new SetupError(401, "authentication_required");
  }
  return userId;
}

async function dispatch(input: {
  userId: number;
  request: AgentReachSetupRequest;
  secret?: string;
  signal?: AbortSignal;
}): Promise<AgentReachSetupResult> {
  try {
    const result = await runAgentReachSetupJob(input);
    if ("available" in result) {
      throw new Error("Runtime returned the wrong Agent Reach setup result.");
    }
    return result;
  } catch (error) {
    if (error instanceof AgentReachSetupJobError) {
      throw new SetupError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export async function install(
  targetId: unknown,
  userId: number,
  signal?: AbortSignal,
): Promise<AgentReachSetupResult> {
  const target = INSTALL_TARGETS.find((candidate) => candidate.id === targetId);
  if (!target) throw new SetupError(400, "unknown_install_target");
  if (!target.available) {
    throw new SetupError(409, "manual_install_required", target.manual ?? "Install this tool manually.");
  }
  return dispatch({
    userId: requireUserId(userId),
    request: { protocolVersion: 1, operation: "install", target: target.id },
    signal,
  });
}

export async function configure(
  key: unknown,
  value: unknown,
  userId: number,
  signal?: AbortSignal,
): Promise<AgentReachSetupResult> {
  const field = CREDENTIALS.find((candidate) => candidate.key === key);
  if (!field) throw new SetupError(400, "unknown_credential");
  if (typeof value !== "string" || !value.trim()) throw new SetupError(400, "empty_value");
  if (value.length > 20_000) throw new SetupError(413, "value_too_long");
  return dispatch({
    userId: requireUserId(userId),
    request: { protocolVersion: 1, operation: "configure", key: field.key },
    secret: value.trim(),
    signal,
  });
}

export async function importCookies(
  browser: unknown,
  platform: unknown,
  userId: number,
  signal?: AbortSignal,
): Promise<AgentReachSetupResult> {
  if (typeof browser !== "string" || !COOKIE_BROWSERS.includes(browser as never)) {
    throw new SetupError(400, "unknown_browser");
  }
  if (typeof platform !== "string" || !COOKIE_PLATFORMS.includes(platform as never)) {
    throw new SetupError(400, "unknown_platform");
  }
  return dispatch({
    userId: requireUserId(userId),
    request: { protocolVersion: 1, operation: "import-cookies", browser, platform },
    signal,
  });
}
