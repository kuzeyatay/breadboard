// The viewer's own Garden chats as nodes of the Thought Topology map.
//
// A chat links to the pages its answers cited, and to the pages its turns are
// closest to, scored like page-to-page links (centred cosine against the page
// and chapter vectors the map was built from). Each question-and-answer turn
// has its own vector: on EC 2 a turn's own vector ranked the page that turn
// cited first 13 times in 88, the whole chat's vector 4. Turn vectors are
// stored when an answer completes, so a map load never embeds.
//
// Chat nodes are added to one viewer's API response only: the topology
// artifact is published through Quartz, so chat text never reaches it.

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import db from "../db.ts";
import { embedTexts, embeddingSettings } from "../embeddings.ts";
import { citedNotes } from "../hermes/chat-cocitation.ts";
import { centeredVector, embeddingCentering, stableHashText } from "./scoring.ts";
import { readThoughtTopologyCache, TOPOLOGY_CACHE_REL_PATH } from "./storage.ts";
import type { ThoughtTopology, TopologyEdge, TopologyNode } from "./types.ts";

export const CHATS_FOLDER_ID = "folder:$chats";
/** Turn-to-page centred cosine needed for a line. Measured on EC 2: vague
 * turns reach ~0.35-0.40, real topical matches sit at 0.45-0.70. */
export const CHAT_LINK_FLOOR = 0.45;
const SEMANTIC_LINKS_PER_CHAT = 3;
const CITED_LINKS_PER_CHAT = 6;
const TURNS_PER_CHAT = 32;
const TURN_TEXT_CHARS = 1800;
const QUESTION_CHARS = 600;
const EMBED_BATCH = 16;

export interface ChatTurn {
  /** conversation_messages.id of the question; the vector's key. */
  messageId: number;
  askedAt?: number;
  /** client_message_id of the turn's last answer, for opening the chat there. */
  answerId: string | null;
  question: string;
  text: string;
  cited: string[];
}

export interface GardenChat {
  id: number;
  title: string;
  turns: ChatTurn[];
  activityTimes?: number[];
}

export interface ChatPageVector {
  nodeId: string;
  embedding: number[];
  sections?: Array<{ label: string; embedding: number[] | null }>;
}

const flat = (value: string) => value.replace(/\s+/g, " ").trim();

function chatTurns(conversationId: number, title: string, gardenSlug: string) {
  const rows = db.prepare(
    `SELECT id, role, content, created_at AS createdAt, client_message_id AS clientId FROM conversation_messages
      WHERE conversation_id = ? ORDER BY order_index`,
  ).all(conversationId) as Array<{ id: number; role: string; content: string | null; createdAt: string; clientId: string | null }>;
  const activityTimes: number[] = [];
  const turns: Array<ChatTurn & { answer: string }> = [];
  for (const row of rows) {
    if (row.role === "user") {
      const at = Date.parse(row.createdAt.includes("T") ? row.createdAt : row.createdAt.replace(" ", "T") + "Z");
      if (Number.isFinite(at)) {
        const last = activityTimes.at(-1);
        if (last == null || at - last >= 30 * 60_000) activityTimes.push(at);
        else activityTimes[activityTimes.length - 1] = Math.max(last, at);
      }
      const question = flat(row.content ?? "");
      if (question) turns.push({ messageId: row.id, askedAt: Number.isFinite(at) ? at : undefined, answerId: null, question, text: "", cited: [], answer: "" });
    } else if (row.role === "assistant" && turns.length) {
      const turn = turns[turns.length - 1];
      const content = row.content ?? "";
      turn.answer += ` ${flat(content.replace(/\]\([^)]*\)/g, "]"))}`;
      turn.cited.push(...citedNotes(content, gardenSlug));
      if (row.clientId) turn.answerId = row.clientId;
    }
  }
  const completed = turns
    .filter((turn) => turn.answer.trim())
    .slice(-TURNS_PER_CHAT)
    .map(({ answer, ...turn }) => ({
      ...turn,
      cited: [...new Set(turn.cited)],
      text: `${title}. ${turn.question.slice(0, QUESTION_CHARS)}. ${answer.trim()}`.slice(0, TURN_TEXT_CHARS),
    }));
  return { turns: completed, activityTimes: activityTimes.filter(t => t >= Date.now() - 7 * 86400000) };
}

/** The viewer's kept (non-temporary) chats in one Garden, turn by turn. */
export function readGardenChats(userId: number, clusterId: number, gardenSlug: string): GardenChat[] {
  const chats = db.prepare(
    `SELECT cs.id, cs.title, cs.conversation_id AS conversationId
       FROM chat_sessions cs JOIN conversations c ON c.id = cs.conversation_id
      WHERE cs.cluster_id = ? AND cs.user_id = ? AND COALESCE(c.temporary, 0) = 0
      ORDER BY cs.updated_at DESC LIMIT 400`,
  ).all(clusterId, userId) as Array<{ id: number; title: string | null; conversationId: number }>;
  return chats.flatMap((chat) => {
    const firstQuestion = (db.prepare(
      "SELECT content FROM conversation_messages WHERE conversation_id = ? AND role = 'user' ORDER BY order_index LIMIT 1",
    ).get(chat.conversationId) as { content: string | null } | undefined)?.content;
    const title = flat(chat.title ?? "") || flat(firstQuestion ?? "").slice(0, 80);
    const { turns, activityTimes } = chatTurns(chat.conversationId, title, gardenSlug);
    return turns.length ? [{ id: chat.id, title, turns, activityTimes }] : [];
  });
}

// --- Scoring -----------------------------------------------------------------

type Unit = { nodeId: string; label: string | null; vector: Float32Array };

function unit(values: readonly number[]): Float32Array {
  let norm = 0;
  for (const value of values) norm += value * value;
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  return Float32Array.from(values, (value) => value * scale);
}

/** Centred unit vectors of every page and chapter, so a turn scores with dot products. */
export function preparePages(pages: readonly ChatPageVector[]): { units: Unit[]; center: (vector: readonly number[]) => Float32Array } {
  const centering = embeddingCentering(pages);
  const center = (vector: readonly number[]) => unit(centeredVector(vector, centering));
  const units: Unit[] = [];
  for (const page of pages) {
    units.push({ nodeId: page.nodeId, label: null, vector: center(page.embedding) });
    for (const section of page.sections ?? []) {
      if (section.embedding?.length) units.push({ nodeId: page.nodeId, label: section.label, vector: center(section.embedding) });
    }
  }
  return { units, center };
}

function dot(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) return 0;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

/** "In "<title>" you asked "<q1>", then "<q2>"." Questions are added until
 * the sentence says something: the map hides summaries under 40 characters,
 * and a first question is often a terse "why did we use the derivative". */
export function chatSummary(chat: Pick<GardenChat, "title" | "turns">): string {
  const asked: string[] = [];
  for (const turn of chat.turns) {
    asked.push(`"${turn.question.length > 120 ? `${turn.question.slice(0, 119)}…` : turn.question}"`);
    if (asked.join(", then ").length >= 60) break;
  }
  return `In "${chat.title}" you asked ${asked.join(", then ")}.`.slice(0, 320);
}

/** Pure: chat nodes and their links, added to a copy of the topology. */
export function addChatNodes(
  topology: ThoughtTopology,
  chats: readonly GardenChat[],
  turnVectors: ReadonlyMap<number, readonly number[]>,
  pages: ReturnType<typeof preparePages> | null,
): ThoughtTopology {
  if (chats.length === 0) return topology;
  const root = topology.folders.find((folder) => folder.depth === 0);
  if (!root) return topology;
  const byPath = new Map(topology.nodes.map((node) => [node.relPath.replace(/\.md$/i, "").toLocaleLowerCase(), node]));
  const byId = new Map(topology.nodes.map((node) => [node.id, node]));
  const floor = Math.max(CHAT_LINK_FLOOR, topology.build.threshold || 0);
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  for (const chat of chats) {
    const id = `chat:${chat.id}`;
    const links: Array<{ page: TopologyNode; origin: "authored" | "inferred"; score: number; turn: ChatTurn; section: string | null }> = [];
    const linked = new Set<string>();
    for (const turn of chat.turns) {
      for (const note of turn.cited) {
        const page = byPath.get(note);
        if (page && !linked.has(page.id) && links.length < CITED_LINKS_PER_CHAT) {
          linked.add(page.id);
          links.push({ page, origin: "authored", score: 1, turn, section: null });
        }
      }
    }
    if (pages) {
      // Each page keeps the turn (and chapter) that came closest to it.
      const best = new Map<string, { score: number; turn: ChatTurn; section: string | null }>();
      for (const turn of chat.turns) {
        const vector = turnVectors.get(turn.messageId);
        if (!vector?.length) continue;
        const centred = pages.center(vector);
        for (const candidate of pages.units) {
          if (linked.has(candidate.nodeId)) continue;
          const score = dot(centred, candidate.vector);
          if (score >= floor && score > (best.get(candidate.nodeId)?.score ?? -1)) {
            best.set(candidate.nodeId, { score, turn, section: candidate.label });
          }
        }
      }
      [...best.entries()]
        .filter(([nodeId]) => byId.has(nodeId))
        .sort((left, right) => right[1].score - left[1].score)
        .slice(0, SEMANTIC_LINKS_PER_CHAT)
        .forEach(([nodeId, match]) => links.push({ page: byId.get(nodeId)!, origin: "inferred", ...match }));
    }

    for (const link of links) {
      const asked = link.turn.question.length > 140 ? `${link.turn.question.slice(0, 139)}…` : link.turn.question;
      edges.push({
        id: `edge:${id}:${link.page.id}`,
        source: id,
        target: link.page.id,
        origin: link.origin,
        changedAt: link.turn.askedAt,
        score: link.score,
        threshold: floor,
        components: { embedding: link.origin === "inferred" ? link.score : 0, concept: 0, lexical: 0 },
        relationType: "related",
        direction: "undirected",
        explanation: {
          state: "ready",
          // Load-bearing wording: pastQuestionLinks() in hermes/cross-garden-retrieval.ts
          // parses the question back out with /^You asked "(.*)"(?: and the answer cited |; )/.
          text: link.origin === "authored"
            ? `You asked "${asked}" and the answer cited ${link.page.title}.`
            : `You asked "${asked}"; ${link.page.title}${link.section ? ` (${link.section})` : ""} is the closest page.`,
        },
        evidence: [
          { kind: "authored", label: link.origin === "authored" ? "Cited in this chat" : "Close to a question in this chat" },
          ...(link.section ? [{ kind: "heading" as const, label: link.section }] : []),
        ],
        pairHash: `${id}:${link.page.id}`,
        visual: { width: 1, opacity: 1, distance: 1, strength: link.score },
      });
    }
    // A click opens the chat at the answer behind its strongest link.
    const strongest = links.reduce<(typeof links)[number] | null>((top, link) => (!top || link.score > top.score ? link : top), null);
    const answerId = strongest?.turn.answerId;
    nodes.push({
      id,
      slug: answerId ? `${id}#${answerId}` : id,
      relPath: `Chats/${chat.title}`,
      folderId: CHATS_FOLDER_ID,
      title: chat.title,
      kind: "chat",
      activityTimes: chat.activityTimes,
      knowledgeType: "chat",
      contentHash: stableHashText(...chat.turns.map((turn) => turn.text)),
      summary: { state: "ready", text: chatSummary(chat) },
      primaryConcepts: [],
      supportingConcepts: [],
      claimIds: [],
      wordCount: chat.turns.reduce((sum, turn) => sum + turn.text.split(" ").length, 0),
    });
  }

  return {
    ...topology,
    folders: [...topology.folders, {
      id: CHATS_FOLDER_ID,
      path: "Chats",
      parentId: root.id,
      title: "Chats",
      depth: 1,
      nodeCount: nodes.length,
      summary: { state: "ready", text: "Your conversations in this Garden, each beside the pages it cited or asked about. Only you see them." },
    }],
    nodes: [...topology.nodes, ...nodes],
    edges: [...topology.edges, ...edges],
  };
}

// --- Stored turn vectors -------------------------------------------------------

function readTurnVectors(turns: readonly ChatTurn[], model: string): Map<number, number[]> {
  const vectors = new Map<number, number[]>();
  const select = db.prepare("SELECT text_hash AS hash, vector FROM thought_topology_chat_turn_vectors WHERE message_id = ? AND model = ?");
  for (const turn of turns) {
    const row = select.get(turn.messageId, model) as { hash: string; vector: Buffer } | undefined;
    if (row && row.hash === stableHashText(turn.text)) {
      vectors.set(turn.messageId, Array.from(new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4)));
    }
  }
  return vectors;
}

/** Embeds and stores the turns whose stored vector is missing or out of date. */
export async function embedChatTurns(turns: readonly ChatTurn[]): Promise<number> {
  const settings = embeddingSettings();
  if (!settings.model) return 0;
  const stored = readTurnVectors(turns, settings.model);
  const missing = turns.filter((turn) => !stored.has(turn.messageId));
  const save = db.prepare(
    `INSERT INTO thought_topology_chat_turn_vectors (message_id, text_hash, model, vector) VALUES (?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET text_hash = excluded.text_hash, model = excluded.model, vector = excluded.vector`,
  );
  for (let index = 0; index < missing.length; index += EMBED_BATCH) {
    const batch = missing.slice(index, index + EMBED_BATCH);
    const { vectors, model } = await embedTexts(batch.map((turn) => turn.text), settings, { timeoutMs: 120_000 });
    batch.forEach((turn, offset) => {
      // The message may have been deleted while this batch embedded.
      try {
        save.run(turn.messageId, stableHashText(turn.text), model, Buffer.from(Float32Array.from(vectors[offset]).buffer));
      } catch {}
    });
  }
  return missing.length;
}

const backfills = new Map<string, Promise<unknown>>();

/** One background embedding pass per key at a time; failures are logged, never thrown. */
function inBackground(key: string, work: () => Promise<unknown>): void {
  if (backfills.has(key)) return;
  const job = work()
    .catch((error) => console.warn(`[topology-chats] embedding skipped: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => backfills.delete(key));
  backfills.set(key, job);
}

/** Called when an answer completes: embeds that Garden chat's new or changed turns. */
export function embedGardenChatAfterAnswer(conversationId: number): void {
  try {
    const chat = db.prepare(
      `SELECT cs.title, cl.slug FROM chat_sessions cs
         JOIN clusters cl ON cl.id = cs.cluster_id
         JOIN conversations c ON c.id = cs.conversation_id
        WHERE cs.conversation_id = ? AND COALESCE(c.temporary, 0) = 0 LIMIT 1`,
    ).get(conversationId) as { title: string | null; slug: string } | undefined;
    if (!chat) return;
    const { turns } = chatTurns(conversationId, flat(chat.title ?? ""), chat.slug);
    inBackground(`conversation:${conversationId}`, () => embedChatTurns(turns));
  } catch (error) {
    console.warn(`[topology-chats] could not queue embedding: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Waits for this module's background embedding (tests and scripts). */
export async function settleChatEmbedding(): Promise<void> {
  while (backfills.size) await Promise.all([...backfills.values()]);
}

// --- The route's entry point -------------------------------------------------------

/** One aggregate that moves whenever a Garden's chats, their messages or their
 * stored turn vectors do; cheap enough to ask on every map load. */
function chatMarker(userId: number, clusterId: number): unknown {
  return db.prepare(
    `SELECT COUNT(m.id) AS messages, MAX(m.id) AS lastId, SUM(LENGTH(m.content)) AS chars, COUNT(v.message_id) AS vectors,
            COUNT(DISTINCT cs.id) AS chats, MAX(cs.updated_at) AS renamed, GROUP_CONCAT(DISTINCT cs.title) AS titles
       FROM chat_sessions cs
       JOIN conversations c ON c.id = cs.conversation_id
       LEFT JOIN conversation_messages m ON m.conversation_id = cs.conversation_id
       LEFT JOIN thought_topology_chat_turn_vectors v ON v.message_id = m.id
      WHERE cs.cluster_id = ? AND cs.user_id = ? AND COALESCE(c.temporary, 0) = 0`,
  ).get(clusterId, userId);
}

const pageCache = new Map<string, { mtimeMs: number; model: string; prepared: ReturnType<typeof preparePages> }>();
const viewerCache = new Map<string, { signature: string; apply: (topology: ThoughtTopology) => ThoughtTopology }>();

function preparedPages(gardenDir: string): { mtimeMs: number; model: string; prepared: ReturnType<typeof preparePages> } | null {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(path.join(gardenDir, TOPOLOGY_CACHE_REL_PATH)).mtimeMs;
  } catch {
    return null;
  }
  const cached = pageCache.get(gardenDir);
  if (cached?.mtimeMs === mtimeMs) return cached;
  const cache = readThoughtTopologyCache(gardenDir);
  if (!cache) return null;
  const records = Object.values(cache.nodes).filter((node) => node.embedding?.length);
  if (!records.length) return null;
  const entry = {
    mtimeMs,
    model: records[0].embeddingModel,
    prepared: preparePages(records.map((node) => ({ nodeId: node.id, embedding: node.embedding!, sections: node.sections }))),
  };
  pageCache.set(gardenDir, entry);
  return entry;
}

/**
 * The topology with the viewer's chats added. Never throws and never embeds on
 * the request: turns without a stored vector (chats from before this existed)
 * are embedded in the background and gain their lines on a later load.
 */
export function withViewerChats(
  topology: ThoughtTopology,
  input: { userId: number | null; clusterId: number; gardenSlug: string; gardenDir: string },
): ThoughtTopology {
  if (!Number.isInteger(input.userId)) return topology;
  try {
    // Reading every message and scoring every turn costs ~1.3 s on EC 2's 71
    // chats; nothing changes between loads unless a message, a stored vector
    // or the map does, which this one aggregate query notices.
    const pages = topology.build.retrievalMode === "semantic-vector" ? preparedPages(input.gardenDir) : null;
    const marker = chatMarker(input.userId!, input.clusterId);
    const key = `${input.userId}:${input.clusterId}`;
    const signature = JSON.stringify([marker, topology.sourceRevision, topology.build.generatedAt, pages?.mtimeMs ?? 0]);
    const cached = viewerCache.get(key);
    if (cached?.signature === signature) return cached.apply(topology);

    const chats = readGardenChats(input.userId!, input.clusterId, input.gardenSlug);
    const turns = chats.flatMap((chat) => chat.turns);
    const vectors = pages ? readTurnVectors(turns, pages.model) : new Map<number, number[]>();
    if (pages && vectors.size < turns.length && embeddingSettings().model === pages.model) {
      inBackground(`garden:${key}`, () => embedChatTurns(turns));
    }
    const result = addChatNodes(topology, chats, vectors, pages?.prepared ?? null);
    const added = {
      folders: result.folders.slice(topology.folders.length),
      nodes: result.nodes.slice(topology.nodes.length),
      edges: result.edges.slice(topology.edges.length),
    };
    viewerCache.set(key, {
      signature,
      apply: (base) => added.nodes.length
        ? { ...base, folders: [...base.folders, ...added.folders], nodes: [...base.nodes, ...added.nodes], edges: [...base.edges, ...added.edges] }
        : base,
    });
    return result;
  } catch (error) {
    console.warn(`[topology-chats] skipped for ${input.gardenSlug}: ${error instanceof Error ? error.message : String(error)}`);
    return topology;
  }
}

// --- Chats across Gardens -----------------------------------------------------

/** Closest pages of other Gardens one chat may link to. */
const CROSS_GARDEN_LINKS_PER_CHAT = 2;

export interface CrossGardenChatLink {
  chatId: number;
  fromSlug: string;
  toSlug: string;
  /** Topology node id of the page in the other Garden. */
  pageId: string;
  score: number;
  question: string;
}

const crossGardenCache = new Map<string, { signature: string; links: CrossGardenChatLink[] }>();

/**
 * Lines from the viewer's chats to the closest pages of their other Gardens, so
 * a question asked in one Garden reaches the page that answers it in another.
 * Scored as inside a Garden — each turn's stored vector, centred with the
 * target Garden's own centering, against the same 0.45 floor — but against
 * whole pages only (no chapters), which keeps the scan to turns × pages.
 * Recomputed only when a Garden's chats or a target's page vectors change.
 * Never embeds and never throws.
 */
export function crossGardenChatLinks(
  userId: number,
  gardens: ReadonlyArray<{ clusterId: number; slug: string; gardenDir: string }>,
): CrossGardenChatLink[] {
  if (gardens.length < 2) return [];
  try {
    const targets = gardens.flatMap((garden) => {
      const pages = preparedPages(garden.gardenDir);
      if (!pages) return [];
      return [{ slug: garden.slug, pages, units: pages.prepared.units.filter((unit) => unit.label === null) }];
    });
    const targetSignature = JSON.stringify(targets.map((target) => [target.slug, target.pages.mtimeMs]));
    const links: CrossGardenChatLink[] = [];
    for (const source of gardens) {
      const key = `${userId}:${source.clusterId}`;
      const signature = JSON.stringify([chatMarker(userId, source.clusterId), targetSignature]);
      const cached = crossGardenCache.get(key);
      if (cached?.signature === signature) {
        links.push(...cached.links);
        continue;
      }
      const found: CrossGardenChatLink[] = [];
      for (const chat of readGardenChats(userId, source.clusterId, source.slug)) {
        const vectorsByModel = new Map<string, Map<number, number[]>>();
        const best = new Map<string, CrossGardenChatLink>();
        for (const target of targets) {
          if (target.slug === source.slug) continue;
          let vectors = vectorsByModel.get(target.pages.model);
          if (!vectors) {
            vectors = readTurnVectors(chat.turns, target.pages.model);
            vectorsByModel.set(target.pages.model, vectors);
          }
          for (const turn of chat.turns) {
            const vector = vectors.get(turn.messageId);
            if (!vector?.length) continue;
            const centred = target.pages.prepared.center(vector);
            for (const unit of target.units) {
              const score = dot(centred, unit.vector);
              const pageKey = `${target.slug}\0${unit.nodeId}`;
              if (score >= CHAT_LINK_FLOOR && score > (best.get(pageKey)?.score ?? -1)) {
                best.set(pageKey, {
                  chatId: chat.id,
                  fromSlug: source.slug,
                  toSlug: target.slug,
                  pageId: unit.nodeId,
                  score,
                  question: turn.question,
                });
              }
            }
          }
        }
        found.push(
          ...[...best.values()].sort((left, right) => right.score - left.score).slice(0, CROSS_GARDEN_LINKS_PER_CHAT),
        );
      }
      crossGardenCache.set(key, { signature, links: found });
      links.push(...found);
    }
    return links;
  } catch (error) {
    console.warn(`[topology-chats] cross-Garden links skipped: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
