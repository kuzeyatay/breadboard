// All-caps emphasis, engaged per turn.
//
// People switch to capitals when something has gone wrong or they have had
// enough: an instruction they already gave was ignored, a constraint keeps
// being broken, or the part they care about keeps getting buried. The words in
// capitals are the ones they most need honoured, so this lifts them out of the
// message and puts them in front of the model as the turn's first priority.
//
// ponytail: word-run heuristic. Two+ consecutive all-caps words with 8+
// letters between them, so "use the API" or "HTML and CSS" stay quiet while
// "DO NOT TOUCH THE TESTS" trips it. Upgrade to a classifier if acronym-heavy
// prose starts false-firing.

const MIN_RUN_WORDS = 2;
const MIN_RUN_LETTERS = 8;

function isCapsWord(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters.length >= 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** The shouted spans of a message, in order. Code is never shouting. */
export function shoutedSpans(userText: string | undefined | null): string[] {
  const text = (userText ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
  const spans: string[] = [];
  for (const line of text.split(/\n+/)) {
    let run: string[] = [];
    const flush = () => {
      const letters = run.join("").replace(/[^\p{L}]/gu, "").length;
      if (run.length >= MIN_RUN_WORDS && letters >= MIN_RUN_LETTERS) spans.push(run.join(" "));
      run = [];
    };
    for (const word of line.split(/\s+/).filter(Boolean)) {
      if (isCapsWord(word)) run.push(word);
      // Digits and punctuation ("2", "-", "!!") neither break nor start a run.
      else if (run.length && !/\p{L}/u.test(word)) run.push(word);
      else flush();
    }
    flush();
  }
  return spans.map((span) => span.replace(/[\s,;:-]+$/u, ""));
}

export function capsEmphasisSection(input: { userText: string | undefined | null }): string | null {
  const spans = shoutedSpans(input.userText);
  if (!spans.length) return null;
  return [
    "# caps_emphasis",
    "The user wrote part of this message in capital letters. People do that when something is wrong or they have had enough, usually because something they already asked for was ignored, got wrong, or keeps happening. Treat these words as the most important thing in the message:",
    ...spans.map((span) => `- "${span}"`),
    "",
    "Address them first and completely before anything else in the turn. If earlier turns in this conversation already failed this point, find where and fix it rather than repeating the same approach. Follow the capitalised instruction exactly, even where it overrides a default of yours. Acknowledge the frustration in at most one short plain sentence when it is clearly there, without apologising at length, and do not mention capital letters or this note. Then make sure your answer visibly satisfies what was emphasised.",
  ].join("\n");
}
