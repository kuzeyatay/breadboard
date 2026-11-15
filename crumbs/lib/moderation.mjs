// The gate every public highlight passes before anyone sees it.
// Verdicts: "visible", "rejected" (never shown) or "pending" (checked again later).
// With OPENAI_API_KEY set the text also goes through OpenAI's moderation
// endpoint; without it only the built-in rules run.

const RULES = [
  [/\b(kill|hang|shoot)\s+(yo)?ur\s?sel(f|ves)\b|\bkys\b/i, "harassment"],
  [/\b(i('| a)?m going to|i will|gonna)\s+(kill|rape|shoot|stab|bomb)\s+(you|u|him|her|them)\b/i, "threat"],
  [/\b(n[i1]gg(er|a)s?|f[a4]gg?(ot)?s?|k[i1]kes?|tr[a4]nn(y|ies)|ch[i1]nks?|sp[i1]cs?|wetbacks?|ret[a4]rds?)\b/i, "hate"],
  [/\b(child|kid|minor|under ?age)\s?(porn|sex)|\bcp\s+(links?|videos?|trade)\b/i, "sexual content involving minors"],
  [/\b(buy|cheap|discount)\b.{0,40}\b(viagra|cialis|followers|crypto signals)\b|\b(free|earn)\s+(bitcoin|btc|usdt)\b|\bwhatsapp\s*\+?\d{7,}/i, "spam"],
];

/** Fast local rules. Also used by the Breadboard client to warn before posting. */
export function localVerdict(text) {
  const value = String(text ?? "");
  for (const [pattern, reason] of RULES) if (pattern.test(value)) return { status: "rejected", reason };
  if ((value.match(/https?:\/\//gi) ?? []).length > 3) return { status: "rejected", reason: "spam" };
  if (/(.)\1{24,}/s.test(value) || (value.length > 40 && value === value.toUpperCase() && /[A-Z]{30,}/.test(value.replace(/[^A-Z]/g, "")))) return { status: "rejected", reason: "spam" };
  return { status: "visible", reason: null };
}

export async function moderate(text, { apiKey = process.env.OPENAI_API_KEY, fetcher = fetch } = {}) {
  const local = localVerdict(text);
  if (local.status !== "visible" || !apiKey) return local;
  try {
    const response = await fetcher(`${process.env.CRUMBS_MODERATION_URL ?? "https://api.openai.com/v1"}/moderations`, {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: String(text).slice(0, 8000) }),
    });
    if (!response.ok) return { status: "pending", reason: `moderation service answered ${response.status}` };
    const result = (await response.json()).results?.[0];
    if (!result) return { status: "pending", reason: "moderation service sent no verdict" };
    if (!result.flagged) return { status: "visible", reason: null };
    const categories = Object.entries(result.categories ?? {}).filter(([, flagged]) => flagged).map(([name]) => name);
    return { status: "rejected", reason: categories.join(", ") || "flagged" };
  } catch (error) {
    return { status: "pending", reason: `moderation service unreachable: ${error.message}` };
  }
}
