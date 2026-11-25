// Bread drives Codex for code-writing requests in a Garden with a connected
// repository: the turn gets `agent_launch` (like the CAD route) and a directive
// to hand the work to Codex with a self-contained brief, then review and report
// its result. Without a repository Bread writes the code in the reply and
// offers to create a repository and connect it (`garden_create_repository`). Detection is a
// cheap pure function over the request text: an action verb aimed at a code
// object. Questions about code ("what does this function do") stay Bread's.

import { isMcpAuthoringRequest } from "./mcp-installer-context.ts";
import { isWorkspaceBotRequest } from "./workspace-context.ts";

// ponytail: lexical heuristic, swap for a classifier call if it misroutes.
const ACTION = /\b(write|writ(?:ing)|code|implement|build|create|make|add|fix|debug|refactor|rewrite|port|scaffold|set up|develop|program|patch|update|change|modify|optimi[sz]e|migrate)\b/i;
const CODE_OBJECT = /\b(code|function|method|class|script|program|app|application|website|web ?app|component|endpoint|api|cli|library|module|package|bug|test(?:s| suite)?|unit tests?|feature|repo(?:sitory)?|codebase|pull request|pr|regex|query|sql|algorithm|backend|frontend|server|bot|plugin|extension|hook|compile error|stack trace|typescript|javascript|python|rust|golang|java|c\+\+|c#|react|next\.?js|node(?:\.js)?|html|css)\b|\.(?:ts|tsx|js|jsx|py|rs|go|java|cs|cpp|c|rb|php|swift|kt|sh|ps1|sql)\b/i;
const QUESTION = /^\s*(what|why|how does|how do|explain|tell me about|is there|which|who|when|where|can you explain|describe|compare)\b/i;

export function isCodeWritingRequest(text: string): boolean {
  const request = text.trim();
  // An explicit command already chose its capability.
  if (!request || request.startsWith("/") || isMcpAuthoringRequest(request) || isWorkspaceBotRequest(request)) return false;
  if (QUESTION.test(request) && !/\b(write|implement|fix|build|code)\b/i.test(request)) return false;
  return ACTION.test(request) && CODE_OBJECT.test(request);
}

export function codexDriveDirective(): string {
  return [
    "## Code work goes to Codex",
    "This request asks for code to be written or changed, and this Garden has a connected repository. Do not write the code yourself in the reply.",
    "Call `agent_launch` with `agent: \"codex\"`, a `reason` (Codex works in the repository and runs the code), and a self-contained `brief`: Codex cannot see this chat, so include the goal, the project or repository path, relevant files, constraints, and how to verify the result (tests or commands to run).",
    "When Codex reports back, review its result, then tell the user what changed and anything left to do. Answer directly only if the launch is refused or fails, and say why.",
  ].join("\n");
}

export function codeWithoutRepositoryDirective(gardenOpen: boolean): string {
  return [
    "## Code without a connected repository",
    "This request asks for code, and no repository is connected, so write the code yourself in the reply: complete, runnable, in fenced code blocks with the language tag, one block per file with its file name above it, so the user can copy and paste it.",
    gardenOpen
      ? "End the reply by asking whether you should create a Git repository and connect it to this Garden, so future code work can be done by Codex inside it. If the user agrees (now or in a later message), call `garden_create_repository`, then offer to have Codex put this code into the new repository."
      : "No Garden is open in this chat, so do not offer to create a repository.",
  ].join("\n");
}
