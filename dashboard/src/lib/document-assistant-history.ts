import { createHash } from "node:crypto";
import db from "./db.ts";
import {
  createConversation,
  getConversationById,
  getConversationForUser,
  type ConversationMessageRow,
} from "./conversations/store.ts";
import { getArtifactForUser, ArtifactStoreError } from "./hermes/artifact-store.ts";
import { scrubbed } from "./watermarks/scrub-text.ts";
import {
  documentAssistantLabel,
  parseDocumentAssistantEntries,
  DOCUMENT_ASSISTANT_HISTORY_LIMIT,
  type DocumentAssistantKind,
  type DocumentAssistantHistory,
} from "./document-assistant-history-types.ts";

function messageRevision(row: Pick<ConversationMessageRow, "content" | "metadata" | "status">): string {
  return createHash("sha256").update(JSON.stringify([row.content, row.metadata, row.status])).digest("hex");
}

export function documentAssistantArtifact(userId: number, artifactId: string) {
  const owner = db.prepare(`SELECT c.public_id FROM hermes_artifacts a
    JOIN conversations c ON c.id = a.conversation_id WHERE a.id = ? AND a.user_id = ? AND c.user_id = ?`)
    .get(artifactId, userId, userId) as { public_id: string } | undefined;
  if (!owner) throw new ArtifactStoreError(404, "artifact_not_found", "Artifact not found.");
  return getArtifactForUser({ artifactId, userId, conversationPublicId: owner.public_id });
}

/** Append editor history to an ordinary owned conversation, independent of its source chat. */
export function syncDocumentAssistantHistory(input: {
  userId: number;
  artifactId: string;
  kind: DocumentAssistantKind;
  entries: unknown;
}): DocumentAssistantHistory {
  const artifact = documentAssistantArtifact(input.userId, input.artifactId);
  const kind = artifact.renderer_id === "document-file" && artifact.filename.toLowerCase().endsWith(".docx")
    ? "word" : artifact.kind === "markdown" ? "markdown" : null;
  if (kind !== input.kind) throw new ArtifactStoreError(422, "document_assistant_kind_mismatch", "This document does not have that assistant.");
  const parent = getConversationById(artifact.conversation_id);
  if (!parent || parent.user_id !== input.userId) throw new ArtifactStoreError(404, "artifact_not_found", "Artifact not found.");
  const entries = parseDocumentAssistantEntries(input.entries).filter(entry => !entry.id.startsWith("server:"));

  return db.transaction(() => {
    let mapping = db.prepare("SELECT conversation_id FROM document_assistant_conversations WHERE artifact_id = ?")
      .get(artifact.id) as { conversation_id: number | null } | undefined;
    const unseen = entries.filter(entry => !db.prepare("SELECT 1 FROM document_assistant_entries WHERE artifact_id = ? AND entry_id = ?").get(artifact.id, entry.id));
    // A deleted chat leaves entry tombstones, so an old browser cache cannot recreate it.
    if (!mapping?.conversation_id && unseen.length && (!mapping || unseen.some(entry => entry.role === "user"))) {
      const title = (unseen.find(entry => entry.role === "user")?.text || artifact.title).replace(/\s+/g, " ").trim().slice(0, 100);
      const conversation = createConversation({
        userId: input.userId,
        title,
        originLabel: documentAssistantLabel(input.kind),
        defaultGardenId: artifact.cluster_id,
        scopeKind: artifact.cluster_id ? "garden" : "global",
        temporary: parent.temporary === 1,
      });
      db.prepare(`INSERT INTO document_assistant_conversations(artifact_id, kind, conversation_id)
        VALUES (?, ?, ?) ON CONFLICT(artifact_id) DO UPDATE SET conversation_id = excluded.conversation_id`)
        .run(artifact.id, input.kind, conversation.id);
      mapping = { conversation_id: conversation.id };
    }
    const conversation = mapping?.conversation_id ? getConversationById(mapping.conversation_id) : null;
    if (!conversation) return { conversationId: null, title: null, entries: [], changed: false };
    // Never allow a mapping to bypass the same owner check as Terminal's history API.
    getConversationForUser(conversation.public_id, input.userId);
    let order = conversation.next_order_index;
    let userClientId: string | null = null;
    let changed = false;
    for (const entry of entries) {
      const imported = db.prepare(`SELECT m.* FROM document_assistant_entries e
        LEFT JOIN conversation_messages m ON m.id = e.message_id WHERE e.artifact_id = ? AND e.entry_id = ?`)
        .get(artifact.id, entry.id) as ConversationMessageRow | undefined;
      if (imported) {
        if (entry.role === "user") userClientId = imported.client_message_id;
        // Save recovery may amend a Word reply. A stale editor must never
        // overwrite a message edited or regenerated from Terminal.
        if (imported.id && entry.role === imported.role && entry.revision === messageRevision(imported)) {
          const metadata = JSON.parse(imported.metadata || "{}");
          delete metadata.error;
          delete metadata.documentActivities;
          if (entry.error) metadata.error = entry.error;
          if (entry.activities) metadata.documentActivities = entry.activities;
          const content = scrubbed(entry.text);
          const status = entry.error ? "failed" : "complete";
          const serialized = JSON.stringify(metadata);
          if (content !== imported.content || status !== imported.status || serialized !== imported.metadata) {
            db.prepare("UPDATE conversation_messages SET content = ?, status = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?")
              .run(content, status, serialized, imported.id);
            changed = true;
          }
        }
        continue;
      }
      let clientId = `document:${createHash("sha256").update(`${artifact.id}:${entry.id}`).digest("hex")}`;
      if (entry.role === "assistant" && userClientId && !db.prepare(
        "SELECT 1 FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'",
      ).get(conversation.id, userClientId)) clientId = userClientId;
      if (entry.role === "user") userClientId = clientId;
      const metadata = {
        documentAssistant: { kind: input.kind, artifactId: artifact.id, entryId: entry.id, sourceConversationId: parent.public_id },
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.activities ? { documentActivities: entry.activities } : {}),
      };
      const result = db.prepare(`INSERT INTO conversation_messages
        (conversation_id, client_message_id, role, surface, content, status, order_index, metadata)
        VALUES (?, ?, ?, 'dashboard_terminal', ?, ?, ?, ?)`).run(
        conversation.id, clientId, entry.role, scrubbed(entry.text), entry.error ? "failed" : "complete", order++, JSON.stringify(metadata),
      );
      db.prepare("INSERT INTO document_assistant_entries(artifact_id, entry_id, message_id) VALUES (?, ?, ?)")
        .run(artifact.id, entry.id, Number(result.lastInsertRowid));
      changed = true;
    }
    if (changed) db.prepare("UPDATE conversations SET next_order_index = ?, updated_at = datetime('now') WHERE id = ?").run(order, conversation.id);
    const rows = db.prepare(`SELECT m.*, e.entry_id FROM conversation_messages m
      LEFT JOIN document_assistant_entries e ON e.message_id = m.id
      WHERE m.conversation_id = ? ORDER BY m.order_index DESC LIMIT ?`)
      .all(conversation.id, DOCUMENT_ASSISTANT_HISTORY_LIMIT) as (ConversationMessageRow & { entry_id: string | null })[];
    return {
      conversationId: conversation.public_id,
      title: conversation.title,
      changed,
      entries: rows.reverse().flatMap(row => {
        if (!row.content.trim() || row.status === "pending") return [];
        const metadata = row.metadata ? JSON.parse(row.metadata) : {};
        return [{
          id: row.entry_id ?? `server:${row.id}`,
          role: row.role,
          text: row.content,
          revision: messageRevision(row),
          ...(typeof metadata.error === "string" ? { error: metadata.error } : {}),
          ...(Array.isArray(metadata.documentActivities) ? { activities: metadata.documentActivities } : {}),
        }];
      }),
    };
  }).immediate();
}
