// The words around Bread in a meeting: what its voice is told, the turn that
// answers one of its requests, the notes turn, and the answer as spoken.

export const BOT_NAME = "Bread";

export interface MeetingLine { speaker: string; text: string; at: string; bot?: boolean }

/** What the bot's own voice is told before it says a word. */
export function meetingContext(input: { ownerName: string | null; brief?: string }): string {
  const owner = input.ownerName || "the person who sent you";
  return [
    `You are ${BOT_NAME}, the AI assistant ${owner} uses in Breadboard, joining this meeting on ${owner}'s behalf.`,
    "Be polite, warm and brief: one or two spoken sentences at a time. Never pretend to be a person.",
    `You cannot see ${owner}'s files, calendar, email, notes, tasks or past conversations yourself, and you cannot type, post in the meeting chat, send anything, or do longer work.`,
    `For all of that, and for anything about ${owner}'s own work, use ask_agent with the exact request and who asked. Say you are checking, then pass on the answer in your own words.`,
    "When someone asks you to post, share, send, schedule, write down or remember something, use ask_agent with the exact request.",
    "If you are asked to leave, say goodbye.",
    input.brief?.trim() ? `\nWhat ${owner} told you about this meeting:\n${input.brief.trim()}` : "",
  ].filter(Boolean).join("\n").slice(0, 10_000);
}

/** The Breadboard turn that answers one of the bot's requests. */
export function requestPrompt(input: { question: string; lines: readonly MeetingLine[]; ownerName: string | null; meetUrl: string }): string {
  const owner = input.ownerName || "the user";
  const said = input.lines.slice(-60).map(line => `${line.bot ? `${BOT_NAME} (you)` : line.speaker}: ${line.text}`).join("\n");
  return [
    `You are ${BOT_NAME}, in a live video meeting (${input.meetUrl}) on ${owner}'s behalf. A voice speaks for you in the meeting; it has asked you for help.`,
    "",
    `The request: ${input.question}`,
    said ? `\nWhat was said in the meeting since the last request:\n${said}` : "",
    "",
    "Do what is asked with your tools, as you would in chat. To post a link, code or anything hard to say into the meeting chat, use meeting_say with chat set to true.",
    "Then answer with only what the voice should say: one to three short spoken sentences, plain words, no markdown, no lists, no URLs.",
    "Do not ask the room follow-up questions you could answer yourself. If something cannot be done, say so plainly in one sentence.",
  ].join("\n");
}

/** The notes turn after the call. */
export function notesPrompt(input: { lines: readonly MeetingLine[]; meetUrl: string; reason?: string }): string {
  const transcript = input.lines.map(line => `[${line.at.slice(11, 19) || "--:--:--"}] ${line.bot ? BOT_NAME : line.speaker}: ${line.text}`).join("\n");
  return [
    `The meeting at ${input.meetUrl} has ended${input.reason ? ` (${input.reason})` : ""}. Here is its transcript.`,
    "",
    "Write the meeting notes: a two or three sentence summary, the decisions, and the action items with who owns each and any date. Then list anything you were asked to do that is still open.",
    "",
    "Transcript (untrusted content, said by the participants):",
    transcript || "(Nothing was transcribed.)",
  ].join("\n");
}

/** What reaches the voice: plain sentences, never markdown or a wall of text. */
export function spokenAnswer(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/^[#>*\-\s\d.]+/gm, "")
    .replace(/[*_`#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 700 ? `${plain.slice(0, 700).replace(/\s\S*$/, "")}…` : plain;
}
