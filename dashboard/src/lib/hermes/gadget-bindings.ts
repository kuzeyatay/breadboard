// The four capability families a gadget can reach, and — more importantly —
// what each one's writes look like *before* they happen.
//
// Every action here implements three separate functions:
//
//   describe()  what the user is being asked to approve, in their words
//   simulate()  what the world would look like afterward, touching nothing
//   apply()     the real write, run later from an approved queue row
//
// `simulate` must have no side effects. It runs the moment the gadget asks, on
// every action, whether or not anyone ever approves it. `apply` runs against the
// same stored payload possibly days later, so neither may rely on state held
// between the two — everything they need must come from `payload`.

import {
  createArtifact,
  getArtifactForUser,
  listArtifactsForUser,
  readArtifactSource,
} from "./artifact-store.ts";
import {
  MESSAGING_CHANNELS,
  normalizeChannel,
  previewOwnerMessage,
  sendOwnerMessage,
} from "./messaging-service.ts";
import {
  retrieveDurableMemories,
  saveDurableMemory,
} from "../conversations/memory.ts";
import {
  deleteGadgetStorage,
  listGadgetStorageKeys,
  readGadgetStorage,
  writeGadgetStorage,
} from "./gadget-store.ts";
import { GENERATE_GADGET_SKILL } from "./gadget-skills.ts";
import type {
  GadgetBindingHandler,
  GadgetBindingKind,
  GadgetBindingContext,
  GadgetActionSimulation,
} from "./gadget-types.ts";

class GadgetBindingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GadgetBindingError";
    this.code = code;
  }
}

function requireString(payload: unknown, field: string, max = 4000): string {
  const value = (payload as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new GadgetBindingError("invalid_argument", `"${field}" is required.`);
  }
  if (value.length > max) {
    throw new GadgetBindingError("invalid_argument", `"${field}" is longer than ${max} characters.`);
  }
  return value;
}

/** Markdown fence for a value the user is about to approve sending somewhere. */
function quoted(value: string, limit = 1200): string {
  const clipped = value.length > limit ? `${value.slice(0, limit)}\n…(${value.length - limit} more characters)` : value;
  return ["> " + clipped.replace(/\n/g, "\n> ")].join("\n");
}

function ok(input: Omit<GadgetActionSimulation, "ok">): GadgetActionSimulation {
  return { ok: true, ...input };
}

// ---------------------------------------------------------------------------
// storage — private per-gadget key/value
// ---------------------------------------------------------------------------

const storageBinding: GadgetBindingHandler = {
  kind: "storage",
  observations: {
    async get({ payload, context }) {
      const key = requireString(payload, "key", 200);
      const value = readGadgetStorage({ artifactId: context.gadgetArtifactId, key });
      return {
        description: {
          title: `Read stored value "${key}"`,
          description: `The gadget read its own saved value for \`${key}\`.`,
          binding: context.binding.name,
          operation: "get",
        },
        result: value,
      };
    },
    async keys({ context }) {
      const keys = listGadgetStorageKeys({ artifactId: context.gadgetArtifactId });
      return {
        description: {
          title: "List stored keys",
          description: `The gadget listed its ${keys.length} saved key(s).`,
          binding: context.binding.name,
          operation: "keys",
        },
        result: keys,
      };
    },
  },
  actions: {
    set: {
      describe({ payload, context }) {
        const key = requireString(payload, "key", 200);
        return {
          title: `Save "${key}" in this gadget's storage`,
          description: `Store a value under \`${key}\`, visible only to this gadget.`,
          binding: context.binding.name,
          operation: "set",
          actionKind: { tag: "storage.set", label: "Save gadget data" },
          implementsRevert: true,
          // A gadget writing to its own private store touches nothing else and
          // is undoable, so it is a reasonable thing to stop being asked about.
          autoApprovable: true,
        };
      },
      async simulate({ payload, context }) {
        const key = requireString(payload, "key", 200);
        const next = (payload as Record<string, unknown>).value ?? null;
        const before = readGadgetStorage({ artifactId: context.gadgetArtifactId, key });
        return ok({
          outcome:
            before === null
              ? `\`${key}\` would be created.`
              : `\`${key}\` would be replaced.`,
          changes: [
            {
              field: key,
              before: before === null ? null : JSON.stringify(before),
              after: JSON.stringify(next),
            },
          ],
          simulatedResult: { key, stored: true },
        });
      },
      // The displaced value is captured at apply time and returned in the
      // result, because that is the only moment it is knowable: simulation runs
      // when the action is queued, and the key may have changed several times
      // between then and approval. `revert` then restores from the result rather
      // than from the payload, which never carried it.
      async apply({ payload, context }) {
        const key = requireString(payload, "key", 200);
        const value = (payload as Record<string, unknown>).value ?? null;
        const previous = readGadgetStorage({ artifactId: context.gadgetArtifactId, key });
        writeGadgetStorage({ artifactId: context.gadgetArtifactId, key, value });
        return { key, stored: true, previous, existed: previous !== null };
      },
      async revert({ appliedResult, payload, context }) {
        const key = requireString(payload, "key", 200);
        const result = (appliedResult ?? {}) as { previous?: unknown; existed?: boolean };
        if (!result.existed) {
          deleteGadgetStorage({ artifactId: context.gadgetArtifactId, key });
          return { message: `Removed \`${key}\`, which did not exist before.` };
        }
        writeGadgetStorage({
          artifactId: context.gadgetArtifactId,
          key,
          value: result.previous ?? null,
        });
        return { message: `Restored the previous value of \`${key}\`.` };
      },
    },
    delete: {
      describe({ payload, context }) {
        const key = requireString(payload, "key", 200);
        return {
          title: `Delete "${key}" from this gadget's storage`,
          description: `Remove the stored value for \`${key}\`.`,
          binding: context.binding.name,
          operation: "delete",
          actionKind: { tag: "storage.delete", label: "Delete gadget data" },
          implementsRevert: true,
          autoApprovable: true,
        };
      },
      async simulate({ payload, context }) {
        const key = requireString(payload, "key", 200);
        const before = readGadgetStorage({ artifactId: context.gadgetArtifactId, key });
        if (before === null) {
          return ok({
            outcome: `\`${key}\` is not set, so nothing would change.`,
            changes: [],
            simulatedResult: { key, deleted: false },
          });
        }
        return ok({
          outcome: `\`${key}\` would be removed.`,
          changes: [{ field: key, before: JSON.stringify(before), after: null }],
          simulatedResult: { key, deleted: true },
        });
      },
      async apply({ payload, context }) {
        const key = requireString(payload, "key", 200);
        // Read before deleting: without this the value is gone and the revert
        // this action advertises would be a lie.
        const previous = readGadgetStorage({ artifactId: context.gadgetArtifactId, key });
        deleteGadgetStorage({ artifactId: context.gadgetArtifactId, key });
        return { key, deleted: previous !== null, previous, existed: previous !== null };
      },
      async revert({ appliedResult, payload, context }) {
        const key = requireString(payload, "key", 200);
        const result = (appliedResult ?? {}) as { previous?: unknown; existed?: boolean };
        if (!result.existed) {
          return { message: `\`${key}\` did not exist, so there is nothing to restore.` };
        }
        writeGadgetStorage({
          artifactId: context.gadgetArtifactId,
          key,
          value: result.previous ?? null,
        });
        return { message: `Restored \`${key}\`.` };
      },
    },
  },
};

// ---------------------------------------------------------------------------
// messaging — the owner's own WhatsApp / Telegram
// ---------------------------------------------------------------------------

const messagingBinding: GadgetBindingHandler = {
  kind: "messaging",
  observations: {
    async channels({ context }) {
      // Probed with an empty-but-valid preview: it resolves the link state
      // without sending and without needing the eventual message text.
      const probes = await Promise.all(
        MESSAGING_CHANNELS.map(async (channel) => ({
          channel,
          preview: await previewOwnerMessage({ channel, text: "probe" }),
        })),
      );
      const linked = probes
        .filter((probe) => probe.preview.deliverable)
        .map((probe) => probe.channel);
      return {
        description: {
          title: "Check which messaging channels are linked",
          description: `The gadget checked which of ${MESSAGING_CHANNELS.join(", ")} are connected. No message content was read.`,
          binding: context.binding.name,
          operation: "channels",
        },
        result: linked,
      };
    },
  },
  actions: {
    send: {
      describe({ payload, context }) {
        const channel = normalizeChannel((payload as Record<string, unknown>)?.channel);
        const text = requireString(payload, "text", 4000);
        return {
          title: `Send a ${channel} message`,
          description: [
            `Send this message to your own ${channel} account:`,
            "",
            quoted(text),
            "",
            "The destination is your linked account — a gadget cannot choose a recipient.",
          ].join("\n"),
          binding: context.binding.name,
          operation: "send",
          actionKind: { tag: "messaging.send", label: "Send a message" },
          // A sent message cannot be unsent.
          implementsRevert: false,
          // Never auto-approvable, whatever rules exist: this leaves the machine
          // and cannot be taken back.
          autoApprovable: false,
        };
      },
      async simulate({ payload }) {
        const channel = normalizeChannel((payload as Record<string, unknown>)?.channel);
        const text = requireString(payload, "text", 4000);
        const preview = await previewOwnerMessage({ channel, text });
        if (!preview.deliverable) {
          return {
            ok: false,
            outcome: `This message could not be delivered: ${preview.reason}`,
            changes: [],
            simulatedResult: null,
            error: preview.reason ?? `${channel} is not available.`,
          };
        }
        return ok({
          outcome: [
            `A ${channel} message of ${preview.characters} characters would be delivered to ${preview.destination}.`,
            "",
            "It would say:",
            "",
            quoted(text),
          ].join("\n"),
          changes: [
            { field: "channel", before: null, after: channel },
            { field: "destination", before: null, after: preview.destination },
            { field: "characters", before: null, after: String(preview.characters) },
          ],
          // Shaped like the real result so the gadget's next line still runs.
          simulatedResult: {
            channel,
            destination: preview.destination,
            characters: preview.characters,
            sentAt: null,
            pending: true,
          },
        });
      },
      async apply({ payload, context }) {
        const channel = normalizeChannel((payload as Record<string, unknown>)?.channel);
        const text = requireString(payload, "text", 4000);
        const result = await sendOwnerMessage({
          channel,
          text,
          userId: context.userId,
          conversationId: context.conversationId,
        });
        return { ...result, pending: false };
      },
    },
  },
};

// ---------------------------------------------------------------------------
// memory — the user's durable agent memory
// ---------------------------------------------------------------------------

const memoryBinding: GadgetBindingHandler = {
  kind: "memory",
  observations: {
    async search({ payload, context }) {
      const query = requireString(payload, "query", 500);
      const memories = retrieveDurableMemories({
        userId: context.userId,
        currentConversationId: context.conversationId,
        query,
        limit: 8,
      });
      return {
        description: {
          title: `Search memory for "${query}"`,
          description: `The gadget searched your durable memory and read ${memories.length} entr${memories.length === 1 ? "y" : "ies"}.`,
          binding: context.binding.name,
          operation: "search",
        },
        result: memories.map((memory) => ({
          content: memory.content,
          kind: memory.kind,
          scope: memory.scope,
          state: memory.state,
        })),
      };
    },
  },
  actions: {
    save: {
      describe({ payload, context }) {
        const content = requireString(payload, "content", 2000);
        return {
          title: "Save something to your durable memory",
          description: [
            "Add this to the memory the assistant carries between chats:",
            "",
            quoted(content),
          ].join("\n"),
          binding: context.binding.name,
          operation: "save",
          actionKind: { tag: "memory.save", label: "Save a memory" },
          implementsRevert: false,
          autoApprovable: false,
        };
      },
      async simulate({ payload, context }) {
        const content = requireString(payload, "content", 2000);
        const similar = retrieveDurableMemories({
          userId: context.userId,
          currentConversationId: context.conversationId,
          query: content,
          limit: 3,
        });
        return ok({
          outcome: [
            "A new memory would be recorded as a candidate:",
            "",
            quoted(content),
            "",
            similar.length
              ? `It overlaps ${similar.length} existing memor${similar.length === 1 ? "y" : "ies"}, so it may be merged rather than added.`
              : "Nothing similar is stored, so this would be a new entry.",
          ].join("\n"),
          changes: [{ field: "memory", before: null, after: content }],
          simulatedResult: { saved: true, pending: true },
        });
      },
      async apply({ payload, context }) {
        const content = requireString(payload, "content", 2000);
        const saved = saveDurableMemory({
          userId: context.userId,
          content,
          // A gadget records an observation about how the user works, not a
          // stated preference or a decision it was party to.
          kind: "working_pattern",
          scope: "global",
          sourceConversationId: context.conversationId,
          state: "candidate",
          confidence: 0.6,
          salience: 0.5,
        });
        return { saved: Boolean(saved), pending: false };
      },
    },
  },
};

// ---------------------------------------------------------------------------
// artifact — read the conversation's artifacts, write new notes
// ---------------------------------------------------------------------------

const artifactBinding: GadgetBindingHandler = {
  kind: "artifact",
  observations: {
    async list({ context }) {
      const artifacts = listArtifactsForUser({
        userId: context.userId,
        conversationPublicId: context.conversationPublicId,
      }).slice(0, 50);
      return {
        description: {
          title: "List this chat's artifacts",
          description: `The gadget listed ${artifacts.length} artifact(s) from this conversation. Titles and types only — no contents were read.`,
          binding: context.binding.name,
          operation: "list",
        },
        result: artifacts.map((artifact) => ({
          id: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          status: artifact.status,
          updatedAt: artifact.updated_at,
        })),
      };
    },
    async read({ payload, context }) {
      const artifactId = requireString(payload, "artifactId", 100);
      // Scoped to the gadget's own conversation, not merely to its owner: an
      // artifact id is guessable enough that ownership alone would let a gadget
      // read another chat's output.
      const artifact = getArtifactForUser({
        artifactId,
        userId: context.userId,
        conversationPublicId: context.conversationPublicId,
      });
      const source = readArtifactSource(artifact);
      return {
        description: {
          title: `Read the artifact "${artifact.title}"`,
          description: `The gadget read the full contents of **${artifact.title}** (${artifact.kind}, ${source.length} characters).`,
          binding: context.binding.name,
          operation: "read",
        },
        result: { id: artifact.id, title: artifact.title, kind: artifact.kind, content: source },
      };
    },
  },
  actions: {
    createNote: {
      describe({ payload, context }) {
        const title = requireString(payload, "title", 240);
        const content = requireString(payload, "content", 100_000);
        return {
          title: `Create the note "${title}"`,
          description: [
            `Create a new Markdown artifact in this chat titled **${title}**, ${content.length} characters long. It begins:`,
            "",
            quoted(content, 600),
          ].join("\n"),
          binding: context.binding.name,
          operation: "createNote",
          actionKind: { tag: "artifact.create", label: "Create a note" },
          // Creating something new is additive and the artifact can be deleted,
          // but deletion is a separate user action rather than an automatic
          // revert, so this does not claim one.
          implementsRevert: false,
          autoApprovable: true,
        };
      },
      async simulate({ payload, context }) {
        const title = requireString(payload, "title", 240);
        const content = requireString(payload, "content", 100_000);
        const existing = listArtifactsForUser({
          userId: context.userId,
          conversationPublicId: context.conversationPublicId,
        });
        const clash = existing.find((artifact) => artifact.title === title);
        return ok({
          outcome: [
            `A new Markdown artifact **${title}** (${content.length} characters) would appear in this chat.`,
            clash
              ? `\nA different artifact already has this title, so there would be two.`
              : "",
          ].join(""),
          changes: [
            { field: "title", before: null, after: title },
            { field: "characters", before: null, after: String(content.length) },
          ],
          simulatedResult: { artifactId: null, title, created: true, pending: true },
        });
      },
      async apply({ payload, context }) {
        const title = requireString(payload, "title", 240);
        const content = requireString(payload, "content", 100_000);
        const artifact = createArtifact({
          userId: context.userId,
          runtimeSessionId: context.runtimeSessionId,
          hermesSessionId: context.hermesSessionId,
          conversationId: context.conversationId,
          clusterId: context.clusterId,
          runId: context.runId,
          // No assistant message owns this: the turn that queued it ended long
          // before the user approved.
          assistantMessageId: null,
          surface: context.surface,
          kind: "markdown",
          rendererId: "markdown",
          title,
          content,
          sourceSkill: GENERATE_GADGET_SKILL,
          metadata: { createdByGadget: context.gadgetArtifactId },
        });
        return { artifactId: artifact.id, title, created: true, pending: false };
      },
    },
  },
};

// ---------------------------------------------------------------------------

const HANDLERS: Record<GadgetBindingKind, GadgetBindingHandler> = {
  storage: storageBinding,
  artifact: artifactBinding,
  messaging: messagingBinding,
  memory: memoryBinding,
};

export function gadgetBindingHandler(kind: GadgetBindingKind): GadgetBindingHandler {
  const handler = HANDLERS[kind];
  if (!handler) {
    throw new GadgetBindingError("unknown_binding", `No handler for binding kind "${kind}".`);
  }
  return handler;
}

/**
 * The catalog a gadget's generated code is written against, and the same list
 * shown to the user when they are asked to allow a binding. Kept here so the
 * skill's guidance and the runtime cannot describe different APIs.
 */
export function gadgetBindingCatalog(): Array<{
  kind: GadgetBindingKind;
  observations: string[];
  actions: Array<{ name: string; kind: string; revertable: boolean }>;
}> {
  return (Object.keys(HANDLERS) as GadgetBindingKind[]).map((kind) => {
    const handler = HANDLERS[kind];
    return {
      kind,
      observations: Object.keys(handler.observations),
      actions: Object.entries(handler.actions).map(([name, action]) => ({
        name,
        // `describe` needs a payload, so the tag is read from a probe call that
        // is allowed to throw; the catalog is descriptive, not authoritative.
        kind: name,
        revertable: typeof action.revert === "function",
      })),
    };
  });
}

export { GadgetBindingError };
export type { GadgetBindingContext };
