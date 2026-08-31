import { normalizeGenerativeUiResources } from "../generative-ui/contracts.ts";

export type ConversationExportFormat = "json" | "markdown";

interface ExportableConversation {
  id?: unknown;
  title?: unknown;
  surface?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  messages?: unknown;
}
function safeFileStem(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "Breadboard conversation";
  return title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "breadboard-conversation";
}

function exportMessages(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Array<Record<string, unknown>> => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const message = entry as Record<string, unknown>;
    if (
      !["user", "assistant"].includes(String(message.role)) ||
      typeof message.content !== "string"
    ) {
      return [];
    }
    const uiResources = normalizeGenerativeUiResources(message.uiResources);
    return [{
      id: message.id,
      clientMessageId: message.clientMessageId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      sources: message.sources,
      attachments: message.attachments,
      tools: message.tools,
      verification: message.verification,
      ...(uiResources.length ? { uiResources } : {}),
      interrupted: message.interrupted === true,
      failed: message.failed === true,
      branchGroupId: message.branchGroupId,
    }];
  });
}

export function serializeConversationExport(
  conversation: ExportableConversation,
  format: ConversationExportFormat,
): { body: string; contentType: string; filename: string } {
  const title = typeof conversation.title === "string" && conversation.title.trim()
    ? conversation.title.trim()
    : "Breadboard conversation";
  const messages = exportMessages(conversation.messages);
  const exportedAt = new Date().toISOString();
  const envelope = {
    schemaVersion: 1,
    type: "breadboard.conversation",
    exportedAt,
    conversation: {
      id: conversation.id,
      title,
      surface: conversation.surface,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    messages,
  };
  const stem = safeFileStem(title);
  if (format === "json") {
    return {
      body: `${JSON.stringify(envelope, null, 2)}\n`,
      contentType: "application/json; charset=utf-8",
      filename: `${stem}.breadboard.json`,
    };
  }
  const body = [
    `# ${title}`,
    "",
    `Exported from Breadboard at ${exportedAt}.`,
    "",
    ...messages.flatMap((message) => {
      const role = message.role === "user" ? "You" : "Assistant";
      const uiResources = normalizeGenerativeUiResources(message.uiResources);
      return [
        `## ${role}`,
        "",
        String(message.content),
        ...(uiResources.length
          ? [
              "",
              "```breadboard-ui",
              JSON.stringify(uiResources, null, 2),
              "```",
            ]
          : []),
        "",
      ];
    }),
  ].join("\n");
  return {
    body: `${body.trimEnd()}\n`,
    contentType: "text/markdown; charset=utf-8",
    filename: `${stem}.md`,
  };
}
