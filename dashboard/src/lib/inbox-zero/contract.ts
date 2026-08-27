// Process-free Inbox Zero protocol shared by Next and the Runtime-owned stack
// controller. Keep execution modules (Docker, Compose and psql) out of this
// dependency root.

export type InboxZeroMode = "stack" | "disabled";

export type StackState =
  | "running"
  | "starting"
  | "stopped"
  | "docker_unavailable"
  | "not_installed";

export interface DockerStatus {
  cliInstalled: boolean;
  desktopInstalled: boolean;
  daemonRunning: boolean;
  reason?: string;
}

export interface StackStatus {
  state: StackState;
  docker: DockerStatus;
  reachable: boolean;
  reason?: string;
}

export type SetupStep =
  | "clone_missing"
  | "docker_unavailable"
  | "oauth_client_missing"
  | "stack_not_running"
  | "mailbox_not_connected"
  | "ready";

export interface SetupStatus {
  step: SetupStep;
  ready: boolean;
  message: string;
  url?: string;
  stack?: StackStatus;
  mailboxes?: Array<{ email: string; provider: string }>;
}

/** better-auth's default cookie name; secure prefixes apply only over HTTPS. */
export const SESSION_COOKIE_NAME = "better-auth.session_token";
/** Inbox Zero uses this header to select one connected mailbox. */
export const EMAIL_ACCOUNT_HEADER = "X-Email-Account-ID";

export interface MailboxIdentity {
  userId: string;
  emailAccountId: string;
  email: string;
  provider: string;
}

export interface InboxZeroSession {
  cookie: string;
  identity: MailboxIdentity;
  expiresAt: Date;
}

export interface ReadyResult {
  ok: boolean;
  session?: InboxZeroSession;
  setup: SetupStatus;
  /** Sealed loopback origin selected by the Runtime-owned controller. */
  baseUrl?: string;
}

export interface InboxZeroStatusResult {
  available: boolean;
  installed: boolean;
  mode: InboxZeroMode;
  baseUrl: string;
  cloneRoot: string;
  oauth: {
    google: boolean;
    microsoft: boolean;
    configured: boolean;
  };
  setup: SetupStatus;
}
