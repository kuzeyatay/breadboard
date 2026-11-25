import db from "../db.ts";
import { createOwnedGarden } from "../garden-creation.ts";
import { ConversationStoreError, getConversationForUser, getConversationById, listConversationsForUser, moveConversationToGarden } from "../conversations/store.ts";
import { ApiError } from "./route-core.ts";
import { stageAuthoredSkill } from "./stage-authored-skill.ts";
import { gardenFiles } from "../garden-files/repository.ts";
import { saveSpaceTemplate } from "../office/templates.ts";
import { spacesKindForPath } from "../office/types.ts";

const skillFileList = { type: "array", items: { type: "object", properties: {
  filename: { type: "string" }, contents: { type: "string" },
}, required: ["filename", "contents"] } };
const skillDraftTool = { name: "draft_skill", description: "Write a local skill with optional Python scripts and Markdown references, then stage it for review in Skills.",
  inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, instructions: { type: "string" },
    references: skillFileList, scripts: skillFileList }, required: ["name", "description", "instructions"] } };

const descriptions = {
  list_gardens: ["List owned Gardens.", [], []],
  create_garden: ["Create a private Garden.", ["name", "description", "folder"], ["name"]],
  find_chats: ["Find saved Terminal and workspace chats by title and source Garden slug.", ["title", "garden"], []],
  move_chat: ["Move the selected chat into an owned Garden by slug. Use current for this chat.", ["chatId", "garden"], ["chatId", "garden"]],
  find_space_files: ["Find your editable Spaces files by name.", ["title"], []],
  save_space_template: ["Create or update a Spaces creation tile from the current revision of one of your files.", ["name", "fileId"], ["name", "fileId"]],
} as const;

function stringArg(args: Record<string, unknown>, key: string, limit: number, required = false) {
  if (args[key] === undefined && !required) return "";
  if (typeof args[key] !== "string" || args[key].length > limit || (required && !args[key].trim())) {
    throw new ApiError(400, "invalid_workspace_argument", `Provide a valid ${key} (up to ${limit} characters).`);
  }
  return args[key].trim();
}

export function callWorkspaceTool(userId: number, conversationId: number, tool: string, args: Record<string, unknown>) {
  if (tool === "__breadboard_list_tools") return { tools: [skillDraftTool, ...Object.entries(descriptions).map(([name, [description, fields, required]]) => ({
    name, description, inputSchema: { type: "object", properties: Object.fromEntries(fields.map(key => [key, { type: "string" }])), required },
  }))] };
  if (tool === "draft_skill") {
    const { report, warnings } = stageAuthoredSkill(userId, args);
    return { name: report.slashCommand ?? report.name, status: "awaiting_review", files: report.files, warnings };
  }
  if (tool === "create_garden") {
    const name = stringArg(args, "name", 120, true);
    const description = stringArg(args, "description", 2000);
    const folder = stringArg(args, "folder", 500);
    const garden = createOwnedGarden(userId, name, description, folder);
    return { garden: { name: garden.name, slug: garden.slug, folder: garden.folder, url: "/gardens/" + garden.slug } };
  }
  if (tool === "save_space_template") {
    return { template: saveSpaceTemplate(gardenFiles(), userId, stringArg(args, "name", 80, true), stringArg(args, "fileId", 120, true)) };
  }
  if (tool === "find_space_files") {
    const title = stringArg(args, "title", 120).toLowerCase();
    const store = gardenFiles();
    const rows = store.database.prepare(`SELECT f.id AS fileId,c.slug AS garden,f.path FROM garden_files f JOIN clusters c ON c.id=f.cluster_id
      WHERE f.owner_id=? AND c.user_id=? AND f.deleted_at IS NULL AND f.kind='file' AND instr(lower(f.path),?)>0 ORDER BY f.updated_at DESC`)
      .all(userId,userId,title) as Array<{fileId: string; garden: string; path: string}>;
    return { files: rows.filter(row => spacesKindForPath(row.path)).slice(0,100) };
  }
  const gardens = db.prepare("SELECT id, slug, name, folder FROM clusters WHERE user_id = ? ORDER BY name, slug").all(userId) as
    Array<{ id: number; slug: string; name: string; folder: string | null }>;
  if (tool === "list_gardens") return { gardens };
  if (tool === "find_chats") {
    const title = stringArg(args, "title", 200).toLowerCase();
    const slug = stringArg(args, "garden", 200);
    const gardenSlugs = new Map(gardens.map(garden => [garden.id, garden.slug]));
    const matches = listConversationsForUser(userId).filter(chat => {
      return (chat.surface === "dashboard_terminal" || chat.surface === "garden_chat") &&
        chat.title.toLowerCase().includes(title) && (!slug || gardenSlugs.get(chat.default_garden_id ?? 0) === slug);
    });
    return { total: matches.length, chats: matches.slice(0, 100).map(chat => ({
      chatId: chat.public_id, title: chat.title, garden: gardenSlugs.get(chat.default_garden_id ?? 0) ?? null,
    })) };
  }
  if (tool === "move_chat") {
    const chatId = stringArg(args, "chatId", 120, true);
    const slug = stringArg(args, "garden", 200, true);
    const garden = gardens.find(entry => entry.slug === slug);
    if (!garden) throw new ApiError(404, "garden_not_found", "Destination Garden not found.");
    try {
      const chat = chatId === "current" ? getConversationById(conversationId) : getConversationForUser(chatId, userId);
      if (!chat || chat.user_id !== userId || chat.buzz_room_id || chat.temporary) throw new ApiError(404, "chat_not_found", "Saved chat not found.");
      const moved = moveConversationToGarden(chat, garden.id);
      return { chatId: moved.public_id, title: moved.title, garden: garden.slug };
    } catch (error) {
      if (error instanceof ConversationStoreError) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  }
  throw new ApiError(400, "unknown_workspace_tool", "Unknown workspace tool.");
}
