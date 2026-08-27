// Keeping a finished deck as a Breadboard artifact.
//
// A run leaves two things behind, and they answer different needs. The built
// `dist/` in the workspace is what the run card previews and what the "open the
// deck" link serves — many files, exactly as Vite emitted them. The artifact is
// the deck folded into ONE html file: the module bundle inlined into a
// `<script>`, the stylesheet into a `<style>`. That file is what survives the
// workspace being cleared, what downloads as a thing a person can email, and
// what the artifact panel lists under the chat turn that made it.
//
// Inlining is possible because the deck already carries no runtime
// dependencies: the engine, the components and even the globe are plain React
// and CSS, so a Vite build of a deck is one JS chunk and one stylesheet. Fonts
// stay as the `@import` the theme asked for, which is the only thing the file
// reaches the network for.

import fs from "node:fs";
import path from "node:path";
import { createArtifact, type ArtifactRow } from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import { distDirectory, distDirectoryAt } from "./workspace.ts";
import type { DeckPlan } from "./schemas.ts";

export const BOLT_SLIDES_ARTIFACT_TOOL = "bolt_slides_deck";

export interface BoltSlidesArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** The chat turn this deck belongs to, so the card sits under it. */
  assistantMessageId: number | null;
}

/**
 * Resolve everything the artifact store needs from the conversation the deck
 * was asked for in. Returns null when the conversation has no runtime session —
 * the run then says so plainly rather than silently dropping the file.
 */
export function openBoltSlidesArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  agentRunId: string;
}): BoltSlidesArtifactContext | null {
  try {
    const conversation = getConversationForUser(input.conversationPublicId, input.userId);
    if (conversation.surface !== "dashboard_terminal" && conversation.surface !== "garden_chat") {
      return null;
    }
    const session = getRuntimeSessionByConversation(conversation.id);
    if (!session) return null;
    const hermesSessionId = runtimeExternalSessionId(session);
    if (!hermesSessionId) return null;
    const run = beginRuntimeRun({
      runtimeSessionId: session.id,
      instruction: input.label.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.label.slice(0, 4_000),
      },
    });
    return {
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      runtimeSessionId: session.id,
      hermesSessionId,
      conversationId: conversation.id,
      clusterId: conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
      surface: conversation.surface,
      runId: run.id,
      assistantMessageId:
        findExternalAgentAssistantMessage({
          conversationId: conversation.id,
          runId: input.agentRunId,
        })?.id ?? null,
    };
  } catch {
    return null;
  }
}

export function closeBoltSlidesArtifactContext(
  context: BoltSlidesArtifactContext | null,
  status: "completed" | "failed",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(context.runId, status === "completed" ? "completed" : "error");
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

/** A `</script>` inside bundled JS would close the tag it is inlined into. */
function escapeClosingTags(source: string): string {
  return source.replace(/<\/(script|style)/gi, "<\\/$1");
}

const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_ASSET_BYTES = 64 * 1024 * 1024;

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function contained(candidate: string, root: string): boolean {
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function readAsset(root: string, reference: string): string | null {
  const cleaned = reference.replace(/^\.?\//, "").split(/[?#]/)[0];
  const absolute = path.resolve(root, cleaned);
  if (!contained(absolute, root)) return null;
  try {
    const metadata = fs.lstatSync(absolute);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > MAX_INLINE_ASSET_BYTES ||
      !samePath(fs.realpathSync.native(absolute), absolute)
    ) return null;
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

/**
 * The built deck as one self-contained HTML file.
 *
 * Every `<script src>` and `<link rel="stylesheet">` Vite emitted is replaced by
 * its contents; `modulepreload` hints are dropped, since there is nothing left
 * to preload. An asset that cannot be read is left as the reference it was, so
 * a deck with something unusual in it degrades rather than silently losing a
 * stylesheet.
 */
export function inlineBuiltDeck(runId: string): string {
  return inlineBuiltDeckFromDist(path.resolve(distDirectory(runId)));
}

export function inlineBuiltDeckAt(workspaceRoot: string): string {
  return inlineBuiltDeckFromDist(path.resolve(distDirectoryAt(workspaceRoot)));
}

function inlineBuiltDeckFromDist(root: string): string {
  const index = path.join(root, "index.html");
  const rootMetadata = fs.lstatSync(root);
  const indexMetadata = fs.lstatSync(index);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    !indexMetadata.isFile() ||
    indexMetadata.isSymbolicLink() ||
    indexMetadata.size > MAX_INDEX_BYTES ||
    !samePath(fs.realpathSync.native(root), root) ||
    !samePath(fs.realpathSync.native(index), index)
  ) {
    throw new Error("The built Bolt Slides deck is indirect or too large.");
  }
  let html = fs.readFileSync(index, "utf8");

  html = html.replace(/[ \t]*<link[^>]*rel="modulepreload"[^>]*>\s*\n?/gi, "");

  html = html.replace(
    /<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/gi,
    (match, before: string, source: string, after: string) => {
      const contents = readAsset(root, source);
      if (contents === null) return match;
      const attributes = `${before} ${after}`.replace(/\scrossorigin/gi, "").trim();
      return `<script${attributes ? ` ${attributes}` : ""}>\n${escapeClosingTags(contents)}\n</script>`;
    },
  );

  html = html.replace(
    /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi,
    (match, href: string) => {
      const contents = readAsset(root, href);
      if (contents === null) return match;
      return `<style>\n${escapeClosingTags(contents)}\n</style>`;
    },
  );

  return html;
}

/** What the artifact remembers about the deck it holds. */
export function deckMetadata(input: {
  plan: DeckPlan;
  brief: string;
  slideCount: number;
}): Record<string, unknown> {
  return {
    // The one flag the artifact viewer reads: this presentation is a React app,
    // not a static page, so it has to be framed with scripts enabled.
    boltSlidesDeck: true,
    boltSlidesTheme: input.plan.themeFamily,
    boltSlidesSlideCount: input.slideCount,
    boltSlidesArc: input.plan.arc,
    boltSlidesSubtitle: input.plan.subtitle,
    boltSlidesBrief: input.brief.slice(0, 2_000),
  };
}

export function saveDeckArtifact(input: {
  context: BoltSlidesArtifactContext;
  runId: string;
  plan: DeckPlan;
  brief: string;
}): ArtifactRow {
  return saveDeckArtifactContent(input, inlineBuiltDeck(input.runId));
}

export function saveRuntimeDeckArtifact(input: {
  context: BoltSlidesArtifactContext;
  workspaceRoot: string;
  plan: DeckPlan;
  brief: string;
}): ArtifactRow {
  return saveDeckArtifactContent(input, inlineBuiltDeckAt(input.workspaceRoot));
}

function saveDeckArtifactContent(input: {
  context: BoltSlidesArtifactContext;
  plan: DeckPlan;
  brief: string;
}, content: string): ArtifactRow {
  return createArtifact({
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    surface: input.context.surface,
    kind: "presentation",
    rendererId: "presentation-html",
    title: input.plan.title.slice(0, 240),
    content,
    metadata: deckMetadata({
      plan: input.plan,
      brief: input.brief,
      slideCount: input.plan.slides.length,
    }),
    sourceHermesTool: BOLT_SLIDES_ARTIFACT_TOOL,
  });
}
