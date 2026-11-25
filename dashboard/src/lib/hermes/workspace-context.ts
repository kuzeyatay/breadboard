export const WORKSPACE_CONNECTION = "breadboard-workspace";

export function isWorkspaceBotRequest(text: string): boolean {
  if (/^\s*(?:\/|what\b|how (?:do|can|would) I\b|explain\b)/i.test(text)) return false;
  if (!/\b(?:create|make|add|build|set up)\b[^.!?\n]{0,80}\b(?:bot|teammate)\b/i.test(text)) return false;
  if (/\b(?:Bots page|Breadboard bot|bot in Bread(?:board)?)\b/i.test(text)) return true;
  if (/\b(?:repo(?:sitory)?|SDK|Discord|Telegram|Slack|source code|Python|JavaScript|TypeScript)\b/i.test(text)) return false;
  return /\b(?:create|make|add|build|set up)\s+(?:me\s+)?(?:a |an |my |another |new |custom )*(?:bot|teammate)\b/i.test(text);
}

export const BOT_CREATION_TURN = "Create the user's working teammate using bot_manage with action=create. Write its job, available tools and expected deliverables into its personality. Confirm the returned bot handle from the saved team roster.";
export const SPACE_TEMPLATE_CONTEXT = 'For a reusable creation tile on the Spaces page, use breadboard-workspace / find_space_files {title} and save_space_template {name, fileId}. Create or edit the source document first if the user asks for new content. Clicking the saved tile makes an editable copy of that revision.';

export const WORKSPACE_SKILLS_CONTEXT = `To author a reusable skill, use mcp_call connection="breadboard-workspace" tool="draft_skill". Supply name, description and instructions. Put Python helpers in scripts: [{filename, contents}] and cite scripts/<filename> in the instructions. The resulting skill appears in Skills for review before activation.`;

export const WORKSPACE_CONTEXT = `Manage the user's Gardens and chats with mcp_call connection="breadboard-workspace". Use list_gardens {} for owned Garden names and slugs. create_garden {name, description?, folder?} creates a private Garden on the dashboard. find_chats {title?, garden?} searches the user's saved chats by title and source Garden slug. move_chat {chatId, garden} moves the chosen chat and its transcript into the destination Garden. For "this chat" use chatId="current". Resolve names first and ask when multiple chats match. For bot creation use bot_manage.`;
