// Bread — the agent a room already has before anybody adds one.
//
// Every other agent member of a room is a persona: a file in the agency-agents
// catalog whose instructions are pasted into the turn, giving the member a
// narrow brief and a voice. Bread is the absence of that. Its member row
// carries this slug, `personaInstructions` finds no catalog entry for it, and
// the turn runs as the plain Hermes runtime — the same assistant that answers
// in the Terminal and in Garden chat, with the same tools, memory and skills.
//
// That is the reason it is seated by default and the reason it is the only
// agent that starts on `always`. A brand-new room whose only agent answers
// nothing until you learn its handle is a room that looks broken; a room where
// the general assistant is simply present behaves the way a person expects
// chat to behave. The specialists stay on `mention` underneath it, so adding
// one never turns a message into two answers.
//
// Kept free of imports on purpose: the members panel is a client component and
// reads this for the picker, while `agent-bridge.ts` and the room store read it
// on the server.

/** The persona slug no catalog file may claim. */
export const BREAD_SLUG = "bread";

export const BREAD_HANDLE = "bread";

export const BREAD_NAME = "Bread";

/** Latte mauve — the accent Breadboard's own assistant uses elsewhere. */
export const BREAD_ACCENT = "#8839ef";

export const BREAD_DESCRIPTION =
  "Breadboard's own assistant — the runtime behind every ordinary reply, with its full tools, memory and skills.";

/**
 * What Bread is told about itself.
 *
 * Short by design. A persona's instructions exist to narrow a general model
 * into one specialist; Bread's exist only to stop it from inventing a
 * speciality it does not have, and to keep it from answering a room the way it
 * would answer a private chat.
 */
export const BREAD_INSTRUCTIONS = [
  "You are Bread, Breadboard's own assistant — the same runtime that answers in the Terminal and in Garden chat, with the same tools, memory and skills.",
  "You are not a specialist. You are the member of this room who can be asked anything, and the one who answers when nobody was named.",
  "When a question really belongs to a specialist who is seated here, say so and name them by handle rather than guessing at their work.",
].join("\n");

/** Bread as the members picker renders it, matching `BuzzPersona`. */
export const BREAD_PERSONA = {
  slug: BREAD_SLUG,
  name: BREAD_NAME,
  description: BREAD_DESCRIPTION,
  division: "Breadboard",
  divisionColor: BREAD_ACCENT,
  color: BREAD_ACCENT,
  emoji: "",
} as const;

export function isBreadSlug(slug: string | null | undefined): boolean {
  return slug === BREAD_SLUG;
}
