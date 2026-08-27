import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

/**
 * Every runtime agent reads the chat it was launched from.
 *
 * A run used to receive its task and nothing else, so "yes", "do the second
 * one" or "fix the bug you just described" reached the agent with no
 * antecedent and it answered that it had nothing pending. These are the seams
 * that carry the conversation, listed per agent because each runtime takes its
 * prompt somewhere different.
 */
const WIRED = [
  { agent: "codex", file: "src/app/api/codex/runs/route.ts", seam: /withConversationContext\(/ },
  { agent: "opencode", file: "src/app/api/opencode/runs/route.ts", seam: /withConversationContext\(/ },
  { agent: "ruflo", file: "src/app/api/ruflo/runs/route.ts", seam: /withConversationContext\(/ },
  { agent: "agent-reach", file: "src/lib/agent-reach/run-manager.ts", seam: /promptWithContext\(run\.task/ },
  { agent: "career-ops", file: "src/lib/career-ops/run-manager.ts", seam: /promptWithContext\(request\.task \|\| run\.task/ },
  { agent: "open-gym", file: "src/lib/open-gym/run-manager.ts", seam: /promptWithContext\(run\.task, input\.conversationContext\)/ },
  { agent: "deep-tutor", file: "src/lib/deep-tutor/run-manager.ts", seam: /contextSection\(run\.conversationContext\)/ },
  { agent: "get-doc", file: "src/lib/get-doc/run-manager.ts", seam: /promptWithContext\(request\.query/ },
  { agent: "openplanter", file: "src/lib/openplanter/run-manager.ts", seam: /promptWithContext\(input\.task/ },
  { agent: "openscience", file: "src/lib/openscience/run-manager.ts", seam: /promptWithContext\(/ },
  { agent: "openwork", file: "src/lib/openwork/run-manager.ts", seam: /promptWithContext\(runInstruction\(run\.task\)/ },
  { agent: "legal", file: "src/lib/legal/run-manager.ts", seam: /contextSection\(input\.prepared\.conversationContext\)/ },
  { agent: "deer-flow", file: "src/lib/deer-flow/run-manager.ts", seam: /promptWithContext\(run\.task/ },
  { agent: "inbox-zero", file: "src/lib/inbox-zero/run-manager.ts", seam: /promptWithContext\(/ },
  { agent: "hyperframes", file: "src/lib/hyperframes/run-manager.ts", seam: /promptWithContext\(/ },
  { agent: "openmontage", file: "src/lib/openmontage/run-manager.ts", seam: /promptWithContext\(/ },
  { agent: "vibe-trading", file: "src/lib/vibe-trading/run-manager.ts", seam: /promptWithContext\(run\.task/ },
  { agent: "stock-analyst", file: "src/lib/stock-analyst/run-manager.ts", seam: /promptWithContext\(/ },
  { agent: "socials-manager", file: "src/lib/socials-manager/client.ts", seam: /promptWithContext\(request\.brief/ },
  { agent: "resource2skill", file: "src/lib/resource2skill/run-manager.ts", seam: /promptWithContext\(input\.task/ },
  { agent: "deep-research", file: "src/lib/deep-research/runtime-run-manager.ts", seam: /conversationContext: contextSection\(conversationContextFromBody/ },
  { agent: "video-use", file: "src/lib/video-use/run-manager.ts", seam: /promptWithContext\(run\.request\.prompt/ },
  { agent: "meeting-notes", file: "src/lib/meeting-notes/run-manager.ts", seam: /promptWithContext\(request\.prompt/ },
  { agent: "cad", file: "src/lib/cad/design-service.ts", seam: /promptWithContext\(brief, input\.conversationContext\)/ },
  { agent: "hardware-blueprint", file: "src/lib/hardware/model-client.ts", seam: /promptWithContext\(input\.brief/ },
  { agent: "vimax", file: "src/lib/vimax/prompts.ts", seam: /tagged\("CONVERSATION_SO_FAR", input\.conversation\)/ },
  { agent: "vox-director", file: "src/lib/vox-director/prompts.ts", seam: /tagged\("CONVERSATION_SO_FAR", input\.conversation\)/ },
  { agent: "wardrobe", file: "src/lib/wardrobe/run-manager.ts", seam: /promptWithContext\(\s*run\.request\.direction/ },
];

/**
 * The agents whose runtime has no prompt at all. Each takes a parsed request
 * object — a ticker, a start/stop instruction, a URL and a clip count, a file,
 * a video subject — and never sends free text to a model on the user's behalf,
 * so there is nowhere for a conversation to go that would not corrupt the
 * request. Listed rather than omitted, so adding a prompt to one of them is a
 * decision someone makes on purpose.
 */
const NO_PROMPT_SURFACE = [
  "shorts",
  "tradingagents",
  "shaper",
  "money-printer",
];

test("every runtime agent with a prompt reads the chat it was launched from", () => {
  for (const { agent, file, seam } of WIRED) {
    assert.match(source(file), seam, `${agent} lost its conversation context seam`);
  }
});

test("the launch routes hand the conversation to their run manager", () => {
  const routes = [
    "agent-reach", "career-ops", "open-gym", "deep-tutor", "get-doc", "openplanter",
    "openscience", "openwork", "legal", "deer-flow", "inbox-zero",
    "hyperframes", "openmontage", "vibe-trading", "stock-analyst",
    "socials-manager", "resource2skill", "video-use", "meeting-notes",
    "hardware-blueprint", "vimax", "vox-director", "wardrobe",
  ];
  for (const agent of routes) {
    const route = source(`src/app/api/${agent}/runs/route.ts`);
    assert.match(
      route,
      /conversationContext: conversationContextFromBody\(userId, body/,
      `${agent}'s route stopped passing the chat to its run`,
    );
  }
  // CAD resolves the conversation itself, so it reads the transcript directly.
  assert.match(
    source("src/lib/cad/run-manager.ts"),
    /conversationContext: conversationContextTranscript\(conversation/,
  );
});

test("the agents with no prompt surface are named, not silently skipped", () => {
  for (const agent of NO_PROMPT_SURFACE) {
    const identity = source(`src/lib/${agent === "shaper" ? "shaper" : agent}/identity.ts`);
    assert.ok(identity.length > 0, `${agent} has no identity module`);
  }
  // Two of them say so in their own words; that is the reason they are excluded.
  assert.match(source("src/lib/shorts/identity.ts"), /never becomes a prompt/);
  assert.match(source("src/lib/tradingagents/identity.ts"), /never becomes a prompt/);
});

test("a launch that cannot resolve its chat still starts the run", () => {
  const helper = source("src/lib/conversations/agent-context.ts");
  // Context is an improvement to a run, never a precondition for one.
  assert.match(helper, /catch \{\n\s+\/\/ No context is a worse run, not a failed one\./);
  // An opening turn keeps the exact prompt it had before this existed.
  assert.match(helper, /const section = contextSection\(transcript\);\n\s+if \(!section\) return instruction;/);
});
