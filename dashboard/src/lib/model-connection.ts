/**
 * Whether anything can answer a chat yet.
 *
 * A fresh install has no ChatGPT account, no API key and no subscription
 * proxy account. Sending a message then fails with a provider error, which
 * reads like a bug rather than a setup step; the terminal asks for a model
 * first. This is the rule it asks with, kept pure so it can be tested
 * without the three endpoints behind it.
 */
export interface ModelConnectionSignals {
  /** `/api/chatmock/account` → `account.signedIn`. */
  chatgptSignedIn: boolean;
  /** `/api/chatmock/providers` → `providers[]`, minus the ChatGPT OAuth entry. */
  providers: Array<{ kind: string; enabled: boolean; configured: boolean }>;
  /** `/api/cliproxy/status` → `accounts.length`. */
  proxyAccounts: number;
}

export function modelConnected(signals: ModelConnectionSignals): boolean {
  if (signals.chatgptSignedIn) return true;
  if (signals.proxyAccounts > 0) return true;
  return signals.providers.some(
    (provider) => provider.kind !== "chatgpt_oauth" && provider.enabled && provider.configured,
  );
}

/** Asks the composer to open its Settings popover; `detail` is the tab. */
export const OPEN_SETTINGS_EVENT = "breadboard:open-settings";
