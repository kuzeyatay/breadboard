/** Browser-safe model defaults shared by every Breadboard AI surface. */
export const DEFAULT_MODEL = 'gpt-5.6-sol';

/**
 * Model id meaning "whatever the user picked as the global background model" in
 * Settings -> Providers. ChatMock expands it per request, so a subsystem that
 * sends this (Hermes, OpenCode, UI-TARS, deep research) follows the choice
 * without being restarted. With no choice stored it resolves to DEFAULT_MODEL.
 */
export const GLOBAL_MODEL_SENTINEL = 'default';

/**
 * Provider id for ChatMock, Breadboard's local OpenAI-compatible gateway. Agent
 * surfaces that pick a provider (UI-TARS) use this literal; the server resolves
 * it to the running ChatMock endpoint.
 */
export const CHATMOCK_PROVIDER = 'chatmock';

/** Models shown when ChatMock's model endpoint is unavailable or incomplete. */
export const DEFAULT_ASSISTANT_MODELS: readonly string[] = [
  DEFAULT_MODEL,
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
];

export function normalizeAssistantModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && /^[a-z0-9._:/-]+$/i.test(normalized)
    ? normalized
    : null;
}

export function mergeAssistantModels(modelIds: readonly unknown[]): string[] {
  const validIds = modelIds.flatMap((modelId) => {
    const normalized = normalizeAssistantModelId(modelId);
    return normalized ? [normalized] : [];
  });
  return Array.from(new Set([...DEFAULT_ASSISTANT_MODELS, ...validIds]));
}

/** Who *makes* a model, which is what a reader is choosing between. */
const VENDOR_LABELS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  moonshot: 'Moonshot',
  xai: 'xAI',
  meta: 'Meta',
  alibaba: 'Alibaba',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
};

/**
 * ChatMock provider ids that identify a vendor outright.
 *
 * The rest — `cliproxy`, `openrouter`, `groq`, `together`, `custom` — are
 * routes, not makers: one of them serves models from several vendors, so the
 * model name has to decide.
 */
const PROVIDER_VENDOR: Readonly<Record<string, string>> = {
  chatgpt: 'openai',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
  deepseek: 'deepseek',
  mistral: 'mistral',
};

/** Model-name families, matched against the bare id after any provider prefix. */
const VENDOR_BY_MODEL_FAMILY: ReadonlyArray<[RegExp, string]> = [
  [/^(gpt|chatgpt|codex|o[1-9])/i, 'openai'],
  [/^claude/i, 'anthropic'],
  [/^(gemini|gemma)/i, 'google'],
  [/^(kimi|moonshot)/i, 'moonshot'],
  [/^grok/i, 'xai'],
  [/^(llama|meta-llama)/i, 'meta'],
  [/^(qwen|qwq)/i, 'alibaba'],
  [/^deepseek/i, 'deepseek'],
  [/^(mistral|mixtral|magistral|codestral|ministral)/i, 'mistral'],
];

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The vendor whose model this is.
 *
 * Grouping by the *route* named the sections after plumbing — "ChatGPT" and
 * "Subscriptions" — when what distinguishes the entries is who built them.
 * A subscription proxy serves Claude, Gemini, Kimi and Grok alike, so its id
 * says nothing; the model name does.
 *
 * Only the first path segment is the provider, so vendor-scoped ids such as
 * `openrouter/meta-llama/llama-3.3-70b` still resolve by their model name.
 */
export function assistantModelVendor(
  modelId: string,
): { id: string; label: string } {
  const slash = modelId.indexOf('/');
  const provider = slash < 0 ? '' : modelId.slice(0, slash).toLowerCase();
  const rest = slash < 0 ? modelId : modelId.slice(slash + 1);

  // A provider that is itself a vendor settles it.
  const fromProvider = provider ? PROVIDER_VENDOR[provider] : PROVIDER_VENDOR.chatgpt;
  if (fromProvider) return { id: fromProvider, label: VENDOR_LABELS[fromProvider] };

  // Otherwise read the model name, including a vendor-scoped middle segment
  // (`openrouter/anthropic/claude-…`).
  const candidates = [rest, rest.slice(rest.indexOf('/') + 1)];
  for (const candidate of candidates) {
    if (candidate in PROVIDER_VENDOR) {
      const vendor = PROVIDER_VENDOR[candidate];
      return { id: vendor, label: VENDOR_LABELS[vendor] };
    }
    for (const [pattern, vendor] of VENDOR_BY_MODEL_FAMILY) {
      if (pattern.test(candidate)) return { id: vendor, label: VENDOR_LABELS[vendor] };
    }
  }

  // An unrecognised model keeps its route as the heading rather than being
  // filed under a vendor it may not belong to.
  return { id: provider || 'other', label: provider ? titleCase(provider) : 'Other' };
}

export interface AssistantModelGroup {
  vendorId: string;
  vendorLabel: string;
  models: string[];
}

/**
 * The model list split into vendor sections, in first-appearance order.
 *
 * A flat list of bare names gives no footing — a dozen `claude-*` and a few
 * `gpt-*` read as one undifferentiated column. Sections restore that without
 * lengthening every row with a prefix.
 */
export function groupAssistantModels(
  modelIds: readonly string[],
): AssistantModelGroup[] {
  const groups: AssistantModelGroup[] = [];
  const byVendor = new Map<string, AssistantModelGroup>();
  for (const modelId of modelIds) {
    const vendor = assistantModelVendor(modelId);
    let group = byVendor.get(vendor.id);
    if (!group) {
      group = { vendorId: vendor.id, vendorLabel: vendor.label, models: [] };
      byVendor.set(vendor.id, group);
      groups.push(group);
    }
    group.models.push(modelId);
  }
  return groups;
}

/** Release-date suffix: `-20250805`, or the dashed `-2024-08-06` spelling. */
const RELEASE_DATE_SUFFIX = /-\d{4}-?\d{2}-?\d{2}$/;

/**
 * `claude-opus-4-1` -> `Claude Opus 4.1`, `claude-3-5-haiku` -> `Claude 3.5 Haiku`.
 *
 * Anthropic spells version numbers with the same dash it uses between words, so
 * a plain dash-to-space pass reads as "Claude Opus 4 1". Runs of digits rejoin
 * on a dot; everything else is a word.
 */
function formatClaudeModelName(bare: string): string {
  const words: string[] = [];
  for (const segment of bare.split('-')) {
    const previous = words.length > 0 ? words[words.length - 1] : '';
    if (/^\d+$/.test(segment) && /^\d+(\.\d+)*$/.test(previous)) {
      words[words.length - 1] = `${previous}.${segment}`;
      continue;
    }
    words.push(/^\d/.test(segment) ? segment : segment.charAt(0).toUpperCase() + segment.slice(1));
  }
  return words.join(' ');
}

/**
 * Display name for a model id.
 *
 * The `provider/` prefix is routing detail, not something a reader needs: a
 * list of `cliproxy/claude-…` entries buries the part that distinguishes them.
 * The release-date stamp goes the same way — it is the longest part of the row
 * and never the part being chosen between. The full id is still what gets
 * selected and sent.
 */
export function formatAssistantModelName(modelId: string): string {
  const slash = modelId.indexOf('/');
  const withPrefix = slash < 0 ? modelId : modelId.slice(slash + 1);
  const bare = withPrefix.replace(RELEASE_DATE_SUFFIX, '') || withPrefix;

  if (bare === 'gpt-5.6-sol' || bare === 'gpt-5.6') return 'GPT-5.6 Sol';
  if (bare === 'gpt-5.6-terra') return 'GPT-5.6 Terra';
  if (bare === 'gpt-5.6-luna') return 'GPT-5.6 Luna';
  if (bare === GLOBAL_MODEL_SENTINEL) return 'Background model';
  if (/^claude-/i.test(bare)) return formatClaudeModelName(bare);
  return bare.replace(/^gpt-/i, 'GPT-');
}
