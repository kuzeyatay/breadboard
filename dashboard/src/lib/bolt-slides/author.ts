// Turning a sentence into a deck.
//
// Two forced tool calls. The first plans: the title, the theme family, and the
// slide-by-slide arc, each slide carrying the reason it exists. The second
// writes the whole of `src/App.tsx`, the `:root` theme block, and any component
// the topic needed that the kit did not have.
//
// Planning first is not ceremony. The bundled skill's sharpest rule is that
// every specialty layout has an entry condition — `<Chat>` only for a genuinely
// conversational product, `<BigNumber>` only for one real sourced figure — and
// a model writing 700 lines of TSX in one pass reaches for whatever is nearest.
// Making it name each slide's purpose before it writes any of them is what
// turns "the kit has a Globe" back into "this deck is about market entry".
//
// The doctrine itself is the clone's own `.bolt/skills/slides/SKILL.md`, read
// off disk rather than paraphrased here. That file is the reason the decks look
// the way they do, it is maintained upstream, and a copy of it in this
// repository would be wrong within one `git pull`. Two sections are dropped on
// the way past: the install steps, which Breadboard has already done, and an
// upstream demo trigger that would let a phrase in a brief replace the person's
// deck with the starter.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { humanizeProviderError } from "../provider-error.ts";
import fs from "node:fs";
import path from "node:path";
import { resolveBoltSlidesRoot } from "./runtime.ts";
import { kitDigest, renderKitDigest, type KitDigest } from "./kit-digest.ts";
import {
  deckPlanSchema,
  deckSourceSchema,
  parseWithSchema,
  type DeckPlan,
  type DeckSource,
} from "./schemas.ts";
import type { BoltSlidesRequest } from "./identity.ts";

const PLAN_TIMEOUT_MS = 300_000;
/** A whole deck in one tool call is a long generation; give it room. */
const SOURCE_TIMEOUT_MS = 900_000;

export class BoltSlidesAuthorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BoltSlidesAuthorError";
    this.code = code;
  }
}

export interface BoltSlidesTarget {
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * The clone's authoring skill, minus the two sections that do not apply here.
 *
 * "Step 1 — Run it in place" describes an install and a dev server, which the
 * workspace has already done differently. The "Internal trigger" section tells
 * an agent that one exact phrase in the request means "ship the starter demo
 * instead" — harmless in Bolt, where a person is watching one repo, and not
 * something a chat brief should be able to reach.
 */
function authoringSkill(): string {
  const root = resolveBoltSlidesRoot();
  if (!root) return "";
  let text: string;
  try {
    text = fs.readFileSync(
      path.join(root, ".bolt", "skills", "slides", "SKILL.md"),
      "utf8",
    );
  } catch {
    return "";
  }
  const sections = text.split(/\n(?=## )/);
  return sections
    .filter(
      (section) =>
        !/^## Step 1 —/.test(section) && !/^## Internal trigger/.test(section),
    )
    .join("\n")
    .trim();
}

/** What Breadboard changes about how the skill is carried out. */
function houseRules(digest: KitDigest): string {
  return [
    "## How this deck is delivered (Breadboard, not Bolt)",
    "",
    "The app is already installed and a workspace is already prepared, so ignore any",
    "instruction to install, scaffold, run a dev server, or check the result in a browser.",
    "You return source through a tool call and Breadboard builds it with Vite.",
    "",
    "- `src/App.tsx` is returned whole, as `appTsx`. It default-exports `App`, which takes",
    "  no props — `main.tsx` renders `<App />`. Every child of `<Deck>` is one slide.",
    "- The theme is returned as `tokensRoot`: DECLARATIONS from the `:root` block, with no",
    "  selector and no braces. They are merged over the block below token by token, so send",
    "  the ones the theme changes and leave the rest — but change values only, never names.",
    "- A component the kit does not have is returned in `components` and lands at",
    "  `src/authored/<Name>.tsx`, so `App.tsx` imports it as `./authored/<Name>`.",
    "- The engine and the kit are already on disk. Import them by relative path exactly as",
    "  listed below. Do not re-declare, re-implement, or paraphrase anything in `./deck/`.",
    "- No new dependencies, and no imports beyond `react`, `framer-motion`, and relative",
    "  paths. The build will reject anything else before it starts.",
    "- **No remote images.** There is no image generation step and a URL you invent will",
    "  404 in front of an audience. Build visuals from CSS, SVG, gradients, the `.vframe`",
    "  mocks, `BrowserFrame`, `Bento` panels, and the charts. An inline `data:` URI or an",
    "  inline `<svg>` is fine; `https://…` is not.",
    "- Web fonts are the exception: `fontImport` is prepended to `base.css`, so a Google",
    "  Fonts `@import` is allowed and is the way to set `--font-head` / `--font-body`.",
    "- Set `indexTitle` and `faviconEmoji` every time. The deck is shared as a link and the",
    "  browser tab is part of it.",
    "",
    "## The kit, read from the installed source",
    "",
    "These are the real signatures. Props not listed here do not exist.",
    "",
    renderKitDigest(digest),
    "",
    digest.classes.length
      ? `Atom and utility classes available in base.css: ${digest.classes.map((name) => `.${name}`).join(" ")}`
      : "",
    "",
    "## The theme tokens, as they currently stand",
    "",
    "`tokensRoot` is merged over these declarations. Send the ones the theme changes,",
    "spelled exactly as they are named here.",
    "",
    "```css",
    digest.tokensRoot,
    "```",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const PLAN_TOOL: ToolDefinition = {
  name: "submit_deck_plan",
  description: "Submit the plan for a presentation deck: its title, its theme, and its slides.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["title", "faviconEmoji", "themeFamily", "slides"],
    properties: {
      title: {
        type: "string",
        description: "The deck's real title, as it appears on the cover and the browser tab.",
      },
      subtitle: { type: "string", description: "One line under the title, if the cover wants one." },
      faviconEmoji: {
        type: "string",
        description: "One emoji for the browser tab, chosen for the topic.",
      },
      themeFamily: {
        type: "string",
        description:
          "Which theme family this deck dresses in — dark product, editorial luxury, Swiss, "
          + "dark technical, warm minimal, fintech, aurora glass, cinematic, paper editorial — "
          + "or the brand's own palette when a brand was named.",
      },
      themeRationale: {
        type: "string",
        description: "One sentence: why that theme fits this topic and audience.",
      },
      arc: {
        type: "string",
        description: "The story the deck tells, in one sentence: where it opens and where it lands.",
      },
      slides: {
        type: "array",
        minItems: 3,
        maxItems: 30,
        description:
          "One entry per slide, in order. Vary the shape — no two adjacent slides should be "
          + "built on the same component.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nav", "component", "headline", "purpose"],
          properties: {
            nav: { type: "string", description: "The label the thumbnail rail shows." },
            component: {
              type: "string",
              description: "The kit component this slide is built on, or Slide for plain JSX.",
            },
            headline: { type: "string", description: "The one thing the slide says." },
            purpose: {
              type: "string",
              description:
                "Why this slide is in the deck, and — for a specialty layout — how it meets that "
                + "layout's entry condition. If you cannot say it in a sentence, cut the slide.",
            },
            notes: { type: "string", description: "Speaker notes for presenter mode." },
          },
        },
      },
    },
  },
};

const SOURCE_TOOL: ToolDefinition = {
  name: "submit_deck_source",
  description: "Submit the finished deck: App.tsx, the theme tokens, and any new components.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["appTsx", "tokensRoot", "indexTitle", "faviconEmoji", "summary"],
    properties: {
      appTsx: {
        type: "string",
        description:
          "The complete contents of src/App.tsx: imports, any local helpers, and a default "
          + "export named App that renders <Deck> with one child per slide.",
      },
      tokensRoot: {
        type: "string",
        description:
          "The declarations inside the :root block of tokens.css — no selector, no braces. "
          + "Same variable names, values chosen for the theme.",
      },
      fontImport: {
        type: "string",
        description:
          "CSS @import lines for the deck's fonts, prepended to base.css. Empty when the "
          + "theme uses the system stack.",
      },
      indexTitle: { type: "string", description: "The browser tab title." },
      faviconEmoji: { type: "string", description: "One emoji for the favicon." },
      components: {
        type: "array",
        maxItems: 8,
        description:
          "Components the topic needed that the kit does not have. Each is a complete .tsx "
          + "module with a default export, using var(--…) tokens and no new dependencies.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "source"],
          properties: {
            name: { type: "string", description: "CapitalCase component name." },
            source: { type: "string", description: "The complete module source." },
          },
        },
      },
      summary: {
        type: "string",
        description:
          "What was built, for the person who asked: the arc in a sentence, the theme and where "
          + "its colours came from, and anything you had to decide on their behalf.",
      },
    },
  },
};

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

async function callTool(
  target: BoltSlidesTarget,
  messages: ChatMessage[],
  tool: ToolDefinition,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  target.signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(completionsUrl(target.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model: target.model,
        messages,
        tools: [{ type: "function", function: tool }],
        tool_choice: { type: "function", function: { name: tool.name } },
        ...(target.reasoningEffort ? { reasoning_effort: target.reasoningEffort } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } | string };
        detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? "");
      } catch {
        detail = body;
      }
      throw new BoltSlidesAuthorError(
        "model_unavailable",
        humanizeProviderError(detail).trim() || `The model endpoint returned ${response.status}.`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      throw new BoltSlidesAuthorError("empty_response", "The model returned no deck.");
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new BoltSlidesAuthorError("invalid_json", "The model returned malformed JSON.");
    }
  } finally {
    clearTimeout(timer);
    target.signal?.removeEventListener("abort", onAbort);
  }
}

function planSystemPrompt(digest: KitDigest, request: BoltSlidesRequest): string {
  return [
    "You are planning a presentation built on the Bolt Slides deck engine: a paged React",
    "deck where every slide is a live, responsive web page, presented with a clicker.",
    "",
    "Plan the deck before any of it is written. Name every slide, what it is built on, and",
    "why it exists. A slide you cannot justify in one sentence does not go in the deck, and",
    "a specialty layout whose entry condition this topic does not meet does not appear at all.",
    "",
    `Aim for about ${request.slides} slides; land where the material actually ends.`,
    request.theme === "auto"
      ? "Choose the theme family from the topic and the audience."
      : `The person asked for the ${request.theme.replace(/-/g, " ")} theme family.`,
    request.brandUrl
      ? `The deck dresses as the brand at ${request.brandUrl}: take its palette, type, and name.`
      : "",
    "",
    authoringSkill(),
    "",
    "## The components you are planning against",
    "",
    digest.components.map((component) => component.name).join(", "),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function briefPrompt(request: BoltSlidesRequest, conversationContext?: string): string {
  return [
    conversationContext ? `## Conversation so far\n\n${conversationContext}\n` : "",
    "## The brief",
    "",
    request.brief,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function planDeck(input: {
  target: BoltSlidesTarget;
  request: BoltSlidesRequest;
  conversationContext?: string;
}): Promise<DeckPlan> {
  const digest = kitDigest();
  if (!digest) {
    throw new BoltSlidesAuthorError(
      "kit_unreadable",
      "The bolt-slides component library could not be read.",
    );
  }
  const raw = await callTool(
    input.target,
    [
      { role: "system", content: planSystemPrompt(digest, input.request) },
      { role: "user", content: briefPrompt(input.request, input.conversationContext) },
    ],
    PLAN_TOOL,
    PLAN_TIMEOUT_MS,
  );
  const parsed = parseWithSchema(deckPlanSchema, raw, "The deck plan");
  if (parsed.ok) return parsed.value;
  throw new BoltSlidesAuthorError(
    "invalid_plan",
    `${parsed.error} ${parsed.issues.slice(0, 3).join("; ")}`.trim(),
  );
}

function renderPlan(plan: DeckPlan): string {
  const lines = [
    `Title: ${plan.title}`,
    plan.subtitle ? `Subtitle: ${plan.subtitle}` : "",
    `Theme: ${plan.themeFamily}${plan.themeRationale ? ` — ${plan.themeRationale}` : ""}`,
    `Favicon: ${plan.faviconEmoji}`,
    plan.arc ? `Arc: ${plan.arc}` : "",
    "",
    "Slides:",
  ];
  plan.slides.forEach((slide, index) => {
    lines.push(
      `${index + 1}. [${slide.component}] ${slide.nav} — ${slide.headline}`,
      slide.purpose ? `   why: ${slide.purpose}` : "",
      slide.notes ? `   notes: ${slide.notes}` : "",
    );
  });
  return lines.filter((line) => line !== "").join("\n");
}

function sourceSystemPrompt(digest: KitDigest, request: BoltSlidesRequest): string {
  return [
    "You are writing a presentation on the Bolt Slides deck engine. The plan is settled;",
    "write the deck it describes. Follow the plan's slide order and purposes — if a slide",
    "genuinely cannot be built as planned, build the closest thing that serves the same",
    "purpose rather than substituting a different idea.",
    "",
    request.brandUrl
      ? `The deck dresses as the brand at ${request.brandUrl}; theme from its real colours.`
      : "",
    "",
    authoringSkill(),
    "",
    houseRules(digest),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface AuthorDeckInput {
  target: BoltSlidesTarget;
  request: BoltSlidesRequest;
  plan: DeckPlan;
  conversationContext?: string;
}

/** Write the deck the plan describes, with one schema-repair attempt. */
export async function authorDeck(input: AuthorDeckInput): Promise<{
  deck: DeckSource;
  messages: ChatMessage[];
}> {
  const digest = kitDigest();
  if (!digest) {
    throw new BoltSlidesAuthorError(
      "kit_unreadable",
      "The bolt-slides component library could not be read.",
    );
  }
  const messages: ChatMessage[] = [
    { role: "system", content: sourceSystemPrompt(digest, input.request) },
    {
      role: "user",
      content: [
        briefPrompt(input.request, input.conversationContext),
        "",
        "## The plan",
        "",
        renderPlan(input.plan),
      ].join("\n"),
    },
  ];
  const first = await callTool(input.target, messages, SOURCE_TOOL, SOURCE_TIMEOUT_MS);
  const parsed = parseWithSchema(deckSourceSchema, first, "The deck");
  if (parsed.ok) return { deck: parsed.value, messages };

  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: "(submitted a deck that was rejected)" },
    {
      role: "user",
      content: [
        `The deck was rejected: ${parsed.error}`,
        parsed.issues.length ? `Problems:\n- ${parsed.issues.join("\n- ")}` : "",
        "Call the tool again with the same deck, corrected.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  const second = parseWithSchema(
    deckSourceSchema,
    await callTool(input.target, repairMessages, SOURCE_TOOL, SOURCE_TIMEOUT_MS),
    "The deck",
  );
  if (second.ok) return { deck: second.value, messages: repairMessages };
  throw new BoltSlidesAuthorError(
    "invalid_deck",
    `${second.error} ${second.issues.slice(0, 3).join("; ")}`.trim(),
  );
}

/**
 * Ask for the deck again after Vite refused to build it.
 *
 * The failure line leads, because that is the part that names the file and the
 * position; the tail follows for the cases where the named line is a symptom.
 * One attempt only — a second failure on the same error is a model that cannot
 * see the problem, and the run says so rather than burning another generation.
 */
export async function repairDeck(input: {
  target: BoltSlidesTarget;
  previous: ChatMessage[];
  failure: string;
  log: string;
}): Promise<DeckSource> {
  const messages: ChatMessage[] = [
    ...input.previous,
    { role: "assistant", content: "(submitted a deck that failed to build)" },
    {
      role: "user",
      content: [
        "The deck did not build. Vite reported:",
        "",
        input.failure,
        "",
        "Full build output (tail):",
        "",
        input.log.split(/\r?\n/).slice(-40).join("\n"),
        "",
        "Fix the cause and call the tool again with the complete deck. Keep the same slides,",
        "the same copy, and the same theme — change only what the error requires.",
      ].join("\n"),
    },
  ];
  const parsed = parseWithSchema(
    deckSourceSchema,
    await callTool(input.target, messages, SOURCE_TOOL, SOURCE_TIMEOUT_MS),
    "The repaired deck",
  );
  if (parsed.ok) return parsed.value;
  throw new BoltSlidesAuthorError(
    "invalid_deck",
    `${parsed.error} ${parsed.issues.slice(0, 3).join("; ")}`.trim(),
  );
}
