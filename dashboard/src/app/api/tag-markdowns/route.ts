import { NextResponse } from "next/server";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import OpenAI from "openai";
import { DEFAULT_MODEL } from "@/lib/ai-models";
import { refreshClusterIndex, scanClusterKnowledge } from "@/lib/knowledge";
import { updateLearnerPageConcepts } from "@/lib/garden-semantics";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { withCouncil } from "@/lib/council";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type ChatMessage = { role: string; content: string };
type Attachment =
  | { type: "text"; text: string; name: string }
  | { type: "image"; dataUrl: string; name: string };

interface TaggingPlanUpdate {
  slug: string;
  tags: string[];
  reason?: string;
}

interface TaggingPlan {
  mode?: "merge" | "replace";
  summary?: string;
  updates?: TaggingPlanUpdate[];
}

const TAG_MARKDOWNS_SYSTEM_PROMPT = `You update tags for existing textbook pages in a second-brain cluster.

Return ONLY valid JSON with this shape:
{
  "mode": "merge" | "replace",
  "summary": "Short summary",
  "updates": [
    {
      "slug": "existing-page-slug",
      "tags": ["restoring-force", "angular-frequency", "simple-harmonic-motion"],
      "reason": "Why this note should get these tags"
    }
  ]
}

Rules:
- Only use note slugs that already exist in the provided inventory.
- Only update notes that clearly match the user's request.
- Tags are canonical reusable concepts: notes that share a concept become linked in the graph. Never submit a claim sentence, page summary, source name, or organizational label as a concept.
- Return only normalized lower-case kebab-case tags. Good: "restoring-force", "stable-equilibrium", "angular-frequency", "simple-harmonic-motion". Bad: physics, math, formula, important, wave, calculus, force, understanding-the-basics, title slugs, source filenames.
- If the user explicitly asks for organizational tags (schedule, week, unit, module, or course tags), you may use those exact tags even though they are not idea tags.
- Avoid generic, document-type, or learning tags like note, markdown, chat, garden, document, source, topic, misc, general, important, learning, study, formula, or example unless the user explicitly wants them, and never reference a page/slide/figure in a tag.
- Return 1-5 genuinely central concepts per learner page and use "merge" unless the user explicitly asks to replace, overwrite, reset, or clear existing tags.
- Only learner pages are editable. Never update sources, planning pages, indexes, or internal notes.
- If no notes should change, return {"mode":"merge","summary":"No clear matches","updates":[]}.
- Never invent notes that are not in the inventory.`;

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((word) => word.trim())
      .filter((word) => word.length > 2),
  );
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let matches = 0;
  for (const item of left) {
    if (right.has(item)) matches += 1;
  }
  return matches / Math.max(left.size, right.size);
}

function scoreNode(
  node: {
    title: string;
    tags: string[];
    locations: string[];
    sourceFile: string;
    excerpt: string;
    content: string;
  },
  queryTokens: Set<string>,
): number {
  if (queryTokens.size === 0) return 0;

  const titleScore = overlapScore(queryTokens, tokenize(node.title)) * 2.2;
  const metadataScore =
    overlapScore(
      queryTokens,
      tokenize([...node.tags, ...node.locations, node.sourceFile].join(" ")),
    ) * 1.8;
  const contentScore = overlapScore(
    queryTokens,
    tokenize(`${node.excerpt}\n${node.content.slice(0, 1200)}`),
  );

  return titleScore + metadataScore + contentScore;
}

function compactConversation(messages: unknown): string {
  if (!Array.isArray(messages)) return "";

  return messages
    .flatMap((message) => {
      if (!message || typeof message !== "object") return [];
      const record = message as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      if (typeof role !== "string" || typeof content !== "string") return [];
      return [`${role.toUpperCase()}: ${content.trim()}`];
    })
    .filter(Boolean)
    .slice(-10)
    .join("\n\n");
}

function attachmentContext(attachments: unknown): string {
  if (!Array.isArray(attachments)) return "";

  const lines = attachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") return [];
    const record = attachment as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      const name =
        typeof record.name === "string" ? record.name : "attachment.txt";
      return [`--- Attachment: ${name} ---\n${record.text.trim()}`];
    }
    return [];
  });

  return lines.join("\n\n");
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();
}

function shouldReplaceTags(requestText: string): boolean {
  return /\b(replace|overwrite|reset|clear(?:\s+all)?\s+(?:existing\s+)?tags|set\s+tags\s+to)\b/i.test(
    requestText,
  );
}

function wantsBroadTaggingRequest(value: string): boolean {
  return /\b(?:all|every|each)\s+(?:markdowns?|notes?|documents?|topics?|sources?|materials?)\b/i.test(
    value,
  );
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

export async function POST(request: Request) {
  try {
    const { baseURL } = resolveChatmockBaseUrl(request);
    const body = await request.json();
    const clusterSlug =
      typeof body.clusterSlug === "string" ? body.clusterSlug.trim() : "";
    const requestText =
      typeof body.request === "string" ? body.request.trim() : "";
    const messages = body.messages as ChatMessage[] | undefined;
    const attachments = body.attachments as Attachment[] | undefined;
    const selectedModel =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL;

    if (!clusterSlug) {
      return NextResponse.json(
        { error: "clusterSlug is required" },
        { status: 400 },
      );
    }
    if (!requestText) {
      return NextResponse.json(
        { error: "request is required" },
        { status: 400 },
      );
    }

    const { cluster, userId } = await requireOwnedClusterFromSlug(clusterSlug);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const clusterDir = path.join(contentPath, cluster.slug);
    const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
    const editableNodes = knowledge.nodes.filter(
      (node) =>
        node.type === "learning-page" ||
        node.breadboardType === "learning_page",
    );
    if (editableNodes.length === 0) {
      return NextResponse.json({
        success: true,
        summary: "No textbook pages found.",
        updated: [],
      });
    }

    const conversationContext = compactConversation(messages);
    const attachmentsText = attachmentContext(attachments);
    const fullRequestContext = [
      requestText,
      conversationContext,
      attachmentsText,
    ].join("\n\n");
    const queryTokens = tokenize(fullRequestContext);
    const broadTaggingRequest = wantsBroadTaggingRequest(fullRequestContext);
    const selectedNodes =
      broadTaggingRequest || editableNodes.length <= 40
        ? editableNodes
        : [...editableNodes]
            .map((node) => ({ node, score: scoreNode(node, queryTokens) }))
            .sort(
              (a, b) =>
                b.score - a.score || a.node.title.localeCompare(b.node.title),
            )
            .slice(0, 40)
            .map(({ node }) => node);

    const noteInventory = selectedNodes
      .map((node) => {
        const details = [
          `slug: ${node.slug}`,
          `title: ${node.title}`,
          `type: ${node.type}`,
          `current tags: ${node.tags.join(", ") || "(none)"}`,
          `source file: ${node.sourceFile || node.fileName}`,
          `locations: ${node.locations.join(", ") || "(none)"}`,
          `excerpt: ${node.excerpt || "(none)"}`,
        ];
        return details.join("\n");
      })
      .join("\n\n---\n\n");

    const promptSections = [
      `User tagging request:\n${requestText}`,
      conversationContext
        ? `Recent conversation context:\n${conversationContext}`
        : "",
      attachmentsText ? `Attachment text context:\n${attachmentsText}` : "",
      `Editable note inventory:\n${noteInventory}`,
    ].filter(Boolean);

    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || "local",
    });

    const response = await client.chat.completions.create(
      withCouncil(
        {
          model: selectedModel,
          messages: [
            { role: "system", content: TAG_MARKDOWNS_SYSTEM_PROMPT },
            { role: "user", content: promptSections.join("\n\n") },
          ],
        },
        { taskType: "tagging", gardenId: cluster.slug },
      ),
    );

    const rawContent = response.choices[0]?.message?.content ?? "";
    let plan: TaggingPlan = {};
    try {
      const parsed = JSON.parse(stripMarkdownFence(rawContent));
      plan =
        parsed && typeof parsed === "object" ? (parsed as TaggingPlan) : {};
    } catch {
      return NextResponse.json(
        { error: "Could not parse the tagging plan from ChatMock." },
        { status: 500 },
      );
    }

    const finalMode =
      shouldReplaceTags(requestText) && plan.mode === "replace"
        ? "replace"
        : "merge";
    const updates = Array.isArray(plan.updates) ? plan.updates : [];
    const appliedUpdates: Array<{
      slug: string;
      title: string;
      tags: string[];
      reason: string;
    }> = [];

    const lease = acquireGardenMutationLease(clusterDir, "retag-markdowns");
    try {
      const currentKnowledge = scanClusterKnowledge(contentPath, cluster.slug);
      const editableBySlug = new Map(
        currentKnowledge.nodes
          .filter(
            (node) =>
              node.type === "learning-page" ||
              node.breadboardType === "learning_page",
          )
          .map((node) => [node.slug, node]),
      );
      for (const update of updates) {
        if (!update || typeof update !== "object") continue;
        const slug = typeof update.slug === "string" ? update.slug.trim() : "";
        const suggestedTags = Array.isArray(update.tags)
          ? update.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        if (!slug || suggestedTags.length === 0) continue;

        const node = editableBySlug.get(slug);
        if (!node) continue;

        // node.relPath includes any sub-folder (e.g. sources/, generated/).
        const filePath = path.resolve(clusterDir, node.relPath);
        if (
          !filePath.startsWith(`${path.resolve(clusterDir)}${path.sep}`) ||
          !fs.existsSync(filePath)
        ) {
          continue;
        }

        const currentTags = node.tags;
        const assignment = updateLearnerPageConcepts({
          gardenDir: clusterDir,
          pageRelPath: node.relPath,
          requestedTerms: suggestedTags,
          primaryTerms: suggestedTags.slice(0, 1),
          mode: finalMode,
          provenance: "bulk-tag-edit",
        });
        const nextTags = assignment.tags;
        if (sameStringArray(currentTags, nextTags)) continue;
        appliedUpdates.push({
          slug: node.slug,
          title: node.title,
          tags: nextTags,
          reason: typeof update.reason === "string" ? update.reason.trim() : "",
        });
      }

      if (appliedUpdates.length > 0) {
        refreshClusterIndex(contentPath, cluster.slug);
        await publishQuartzAfterMutation(`retag markdowns in ${cluster.slug}`, {
          userId,
        });
      }
    } finally {
      lease.release();
    }

    return NextResponse.json({
      success: true,
      mode: finalMode,
      summary:
        typeof plan.summary === "string" && plan.summary.trim()
          ? plan.summary.trim()
          : appliedUpdates.length > 0
            ? `Updated tags on ${appliedUpdates.length} textbook page${appliedUpdates.length === 1 ? "" : "s"}.`
            : "No textbook pages matched that tagging request clearly enough to update.",
      updated: appliedUpdates,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
