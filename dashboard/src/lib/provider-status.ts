import type { ChatmockProvider } from "./chatmock-providers.ts";

/** The signed-in ChatGPT account, as reported by /api/chatmock/account. */
export interface ChatgptAccountSummary {
  signedIn: boolean;
  email: string | null;
  plan: string;
}

export type ProviderBadge = {
  text: string;
  tone: "connected" | "off" | "idle";
} | null;

/**
 * The badge shown on one provider card in Settings → Accounts.
 *
 * ChatGPT is the exception. It authenticates through the OAuth flow owned by
 * the account list, not through ChatMock's credential store, so its badge must
 * reflect that account: the store's `configured` flag only means "not switched
 * off" and would claim "Connected" even with nobody signed in.
 *
 * Pure and separate from the component so this rule is testable — it is easy to
 * get subtly wrong and invisible until someone looks at the panel.
 */
export function providerStatusBadge(
  provider: Pick<ChatmockProvider, "kind" | "enabled" | "configured">,
  chatgptAccount?: ChatgptAccountSummary | null,
): ProviderBadge {
  if (provider.kind === "chatgpt_oauth") {
    // Account still loading: say nothing rather than guess.
    if (!chatgptAccount) return null;
    return chatgptAccount.signedIn
      ? { text: "Connected", tone: "connected" }
      : { text: "Not signed in", tone: "idle" };
  }
  if (!provider.enabled) return { text: "Off", tone: "off" };
  if (provider.configured) return { text: "Connected", tone: "connected" };
  return { text: "Not configured", tone: "idle" };
}
