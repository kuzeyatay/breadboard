// A lesson may use a technical term only after it has explained it, or when
// an earlier unit taught it (or the Scope Contract says the learner brings it).
// The deterministic gate cannot know which words are terms, and the critic's
// leniency let glosses through ("a distributed algorithm: every user follows a
// common decision procedure" - telecom-1 M2 1.1, 2026-09-16). This review asks
// the model to list every technical term the page relies on and to say where
// it was explained; anything unexplained becomes a hard repair problem the
// lesson repair loop already knows how to act on.

import type { QualityProblem } from "./learn-utils.ts";

export const LESSON_TERM_REVIEW_PROMPT = `You check one lesson page of a learning garden for six failures: technical terms that do explanatory work without ever being explained to a beginner, ideas the page states more than once without adding anything, concepts the page defines only in the abstract with no concrete instance to hold on to, results the page states as facts without ever showing how they are reached, callouts that contribute nothing, and ideas earlier pages already established that this page teaches all over again.

You receive the page Markdown, the concepts this page is meant to introduce (newConcepts), the concepts earlier pages already taught (taughtEarlier), the concepts later pages will teach (taughtLater), and the background the learner is assumed to bring (assumedBackground). taughtEarlier and taughtLater match by concept, not by an everyday word that happens to appear in a concept name ("tradeoff", "capacity", "rule" on their own are not later-unit concepts).

The page's job is its learningQuestion and its newConcepts; judge everything against that. A later-unit concept used only at the level this page's question needs - naming that a time slot or a frequency channel exists in a worked count, without teaching how slot timing or channel spacing works - is not leaning on it; leaning means the argument would collapse if the reader did not already understand the later mechanism. Likewise the page's central idea recurring across paragraphs as the thread of the argument (a triad the page is about, restated as each branch is developed) is structure, not restatement; count a restatement only when a whole sentence or paragraph adds nothing at all.

When priorVerdicts is present, this is a re-review after a repair. Verdicts already given stand for sentences that did not change: do not flag a term, concept, result, or callout you previously judged fine unless the explanation that earned it was removed, and do not raise new objections to unchanged passages. Judge what changed.

Everyday words, anything assumedBackground covers, and anything any first-year student of the subject already knows (for a telecommunications course: signal, receiver, transmitter, frequency, bandwidth in its everyday sense, probability) are NOT terms for this review - do not list them. The terms that matter are the ones this course introduces (newConcepts here or in taughtEarlier) and specialist phrases beyond that background.

The ordinary mathematics an engineering student already writes with is background, not a term of this course: the imaginary unit and the complex or phasor way of writing a sinusoid, logarithms and decibels, exponentials, derivatives and integrals, vectors, summation, probability notation, SI units and prefixes. A page that writes \\(j\\) and says it is the imaginary unit of the complex field representation has done everything that is owed; demanding it teach \\(j^2=-1\\), or what a complex amplitude means, inside a lesson about fiber is asking the page to teach a different subject, and the repair will only add a paragraph that does not belong. Treat these as "taught_earlier". They become terms for this review only when the course itself introduces them as concepts - when they appear in newConcepts or taughtEarlier.

List every such technical term, phrase, abbreviation, symbol, or unit the page relies on. For each one decide:
- "explained_here": before or where the page relies on it, the page teaches it to the depth its own reasoning uses: what problem it solves, how it works step by step, why it takes the form it does, and one concrete instance or number. The student could now explain the mechanism to someone else, not just repeat its purpose.
- The page is written from assigned source material only and may not invent mechanisms the sources do not give. When the page says plainly, at the term, that the inner mechanism (how a CRC detects errors, how sync bits are recognised, the spreading mathematics) lies outside the assigned material, gives whatever the sources do give (its purpose, its position, its size, a number), and builds no reasoning on the missing part, count it "explained_here" at the page's depth - do not mark it shallow. Shallow is for a term the page reasons with as if taught while never saying what it gives and what it withholds.
- "shallow": the page gives it a purpose-only definition and then reasons with it as if it had been taught - "channel coding adds redundancy so errors can be corrected", "tail bits mark the end of a burst", "a guard time separates slots" - and a student who read it could name the term but could not say how it works, what it costs, or what goes wrong without it. A parenthetical gloss, a restated name, or a synonym ("a common decision procedure", "logically separated") is at best shallow.
- "taught_earlier": it is in taughtEarlier or assumedBackground, or is a plain everyday word used in its everyday sense.
- "named_later": it belongs to taughtLater and the page only points at it as a destination - what a later lesson will do, in one sentence that no reasoning on this page depends on ("later lessons separate users by time, by frequency band, or by code"). That is correct and must not be flagged; a page is not expected to teach later units, and a repair must not try to.
- "unexplained": a sentence depends on knowing what it means (it explains, compares, gives a reason, or states a result using it) and neither this page nor the earlier material explains it. A taughtLater concept that the page builds reasoning on is unexplained too, but the fix is different: the sentence must stop depending on it, not explain it here.

Be strict about glosses that introduce a second undefined phrase in place of the first. Ignore words inside displayed equations, code, image alt text, and the Question/Answer prompts copied from the sources.

Then read the page as a story. A restatement is a later sentence or paragraph that says an idea the page already established, in other words, without adding a step, a consequence, a number, a condition, or an example. A one-sentence pointer to a later lesson and the later place the page names that same destination are not restatements (e.g. "divide access by time: A, then B, then C, and the pattern repeats" followed later by "TDMA chooses time as the dimension used for that division" and again by "the system divides the time axis into short intervals"). Group each restated idea with every sentence that repeats it, quoting the sentences exactly. A deliberate one-sentence closing recap that ties the whole page together is not a restatement; a callout that repeats the paragraph above it is.

Finally, take each concept this page introduces (newConcepts, and any term the page defines in bold) and ask whether the page gives it a concrete, fully specified instance close to its definition: a named real system with its actual numbers, a worked case with the values written out, or a specific figure read in detail. "A frame gives the system a recurring timing structure ... those values depend on the radio system" is abstract_only; "in GSM one carrier carries 8 slots in a 4.615 ms frame, so user 3 transmits in slot 3 every 4.615 ms" is concrete. A concept with no such instance floats: the reader can recite it and cannot picture it. Judge grounding by the instance, not by whether a diagram is present: a structural concept (slots in a frame, channels across cells, states in a chain) whose real numbers are written out in prose is concrete even without a picture.

The source boundary applies here exactly as it does to terms. The page may only use numbers the assigned sources give it. When a concept's quantitative side is not in those sources, and the page says so plainly where it introduces the concept, gives what the sources do give, and states no result that depends on the missing quantities, that boundary sentence is its anchor: count it "concrete" at the page's depth. Do not answer such a concept with an example built from numbers you have supplied yourself, and never record a concept as abstract_only while writing in its "example" field that the sources do not establish the values the example would need - that is a demand the page cannot meet, and repeating it only burns the page's attempts. Abstract_only is for a concept whose instance the sources do supply and the page did not use.

Last, find every result the page states as a fact: a number of users a channel supports, a rate, a capacity, a probability, a count, a comparison ("three users with the full-rate coder, six with the half-rate coder"), or a conclusion that follows from earlier facts. For each, ask whether the page shows how it is reached from things already on the page - the calculation with the numbers written out, or the chain of reasoning - or at least says plainly that the sources give the result without its derivation. "One radio channel supports three users" with nothing showing where three comes from is unshown; "48.6 kbps shared over the six slots of a frame gives each user two slots, 16.2 kbps, which carries one 7.95 kbps coded voice stream plus its channel coding, so one carrier serves three conversations" is shown.

Then compare the page with taughtEarlier, the concepts earlier pages already established. A later page may pick one up with a one-sentence reminder of the meaning it needs now and then build on it. Using an earlier result as an input is not reteaching: stating its formula and number ("the cluster carries 125 x 8 = 1000 channels, from 6.2") and continuing with this page's own step is exactly what a later page should do. It may not teach it again: re-motivating why it exists, redefining it (a bold definition sentence for a term in taughtEarlier is always reteaching), re-deriving it step by step, or spending a paragraph re-explaining what an earlier page established ("the starting point is resource partitioning: a radio system has finite spectrum, so ...", again, three pages in a row) is reteaching. Report each such paragraph.

Then look at every callout block (> [!warning], > [!note], > [!info]). A callout is earned only if a reader who has followed the page this far gains something from it right now: a warning must name a mistake that reader could actually make with what has been taught (a step done in the wrong order, a sign reversed, a condition forgotten); a note must name a debt the page really incurs; an info must add one connection the reader can now understand. A warning that says "do not confuse X with Y" when Y was never taught, a callout that restates the paragraph above it, or one built on terms the page has not explained, is unearned - the reader cannot be confused about things they do not know.

Return ONLY one JSON object:
{"terms":[{"term":"exact term","status":"explained_here|shallow|taught_earlier|named_later|unexplained","laterUnit":true,"sentence":"the exact sentence that relies on it (required for unexplained and shallow)","missing":"what a beginner would need to be told, concretely (required for unexplained and shallow; for a laterUnit term, how the sentence can stand without it)"}],
 "restatements":[{"idea":"the idea in a few words","sentences":["exact first statement","exact repeat 1","exact repeat 2"]}],
 "concepts":[{"concept":"exact concept","grounding":"concrete|abstract_only","definition":"the exact sentence that defines it (required for abstract_only)","example":"what concrete instance would anchor it - name the system, the numbers, or the case (required for abstract_only)"}],
 "results":[{"result":"the result in a few words","status":"shown|asserted_with_notice|unshown","sentence":"the exact sentence that states it (required for unshown)","needed":"the calculation or reasoning the page must show (required for unshown)"}],
 "callouts":[{"kind":"warning|note|info","text":"the callout's first sentence, exactly","verdict":"earned|unearned","reason":"why (required for unearned)"}],
 "reteaching":[{"concept":"the earlier concept, as named in taughtEarlier","paragraph":"the exact first sentence of the paragraph that teaches it again","reason":"what the paragraph re-explains that the earlier page already established"}]}
"restatements" is an empty array when the page never repeats itself; "concepts" lists every introduced concept; "results" lists every stated result; "callouts" lists every callout block; "reteaching" is an empty array when every earlier idea is only reminded, never retaught.`;

export interface LessonTermReviewEntry {
  term: string;
  status: "explained_here" | "shallow" | "taught_earlier" | "named_later" | "unexplained";
  laterUnit?: boolean;
  sentence?: string;
  missing?: string;
}

/** Validate the review and turn every unexplained term, restated idea,
 * concept left without a concrete instance, result stated without its
 * derivation, unearned callout, and retaught earlier concept into a hard
 * quality problem the lesson repair prompt acts on. */
export interface LessonReviewVerdicts {
  termsFine: string[];
  conceptsConcrete: string[];
  resultsShown: string[];
  calloutsEarned: string[];
}

export function lessonTermReviewProblems(parsed: unknown): {
  problems: QualityProblem[];
  /** What the review accepted, handed back to the next review so unchanged
   * passages keep their verdicts instead of being re-litigated. */
  accepted?: LessonReviewVerdicts;
  reviewError?: string;
} {
  const terms = (parsed as { terms?: unknown } | null)?.terms;
  if (!Array.isArray(terms)) {
    return { problems: [], reviewError: 'lesson term review returned no "terms" array' };
  }
  const problems: QualityProblem[] = [];
  const accepted: LessonReviewVerdicts = { termsFine: [], conceptsConcrete: [], resultsShown: [], calloutsEarned: [] };
  const seen = new Set<string>();
  for (const entry of terms) {
    const record = entry as Record<string, unknown>;
    const term = typeof record?.term === "string" ? record.term.trim() : "";
    const status = record?.status;
    if (
      !term ||
      (status !== "explained_here" && status !== "shallow" && status !== "taught_earlier" && status !== "named_later" && status !== "unexplained")
    ) {
      return { problems: [], reviewError: "lesson term review returned an invalid term entry" };
    }
    if (status !== "unexplained" && status !== "shallow") {
      accepted.termsFine.push(term);
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sentence = typeof record.sentence === "string" ? record.sentence.trim() : "";
    const missing = typeof record.missing === "string" ? record.missing.trim() : "";
    if (record.laterUnit === true) {
      // A later unit owns this concept: the page may point at it, never lean
      // on it. Explaining it here would teach the later unit's material.
      problems.push({
        code: "leans-on-later-unit",
        message:
          `the lesson builds reasoning on "${term}", which a later lesson teaches` +
          (missing ? `; ${missing}` : "") +
          `. Do not explain it here. Rewrite the sentence so nothing on this page depends on it: name it only as the lesson where it is taught, in one sentence, and carry the argument with what this page does teach.`,
        hard: true,
        evidence: sentence ? [sentence] : undefined,
      });
      continue;
    }
    problems.push(
      status === "shallow"
        ? {
            code: "shallow-explanation",
            message:
              `the lesson names what "${term}" is for and then reasons with it, but never teaches how it works` +
              (missing ? `; the reader still needs: ${missing}` : "") +
              `. Teach it where it is first used, to the depth this page's reasoning needs: the problem it solves, the mechanism step by step, what it costs or what goes wrong without it, and one concrete instance with numbers from the sources. If that is more than this page can carry and no earlier unit teaches it, stop relying on it: state in one sentence what role it plays and that it is outside this lesson, and build the reasoning on what the page does teach.`,
            hard: true,
            evidence: sentence ? [sentence] : undefined,
            subject: term,
          }
        : {
            code: "unexplained-term",
            message:
              `the lesson relies on "${term}" without explaining it` +
              (missing ? `; a beginner needs to be told: ${missing}` : "") +
              `. Explain it in plain words at its first use - what it is, what it does, with the concrete steps or an example - before any sentence depends on it. A gloss or synonym is not an explanation.`,
            hard: true,
            evidence: sentence ? [sentence] : undefined,
            subject: term,
          },
    );
  }
  const restatements = (parsed as { restatements?: unknown }).restatements;
  if (restatements !== undefined && !Array.isArray(restatements)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "restatements"' };
  }
  for (const entry of restatements ?? []) {
    const record = entry as Record<string, unknown>;
    const idea = typeof record?.idea === "string" ? record.idea.trim() : "";
    const sentences = Array.isArray(record?.sentences)
      ? record.sentences.filter((line): line is string => typeof line === "string" && line.trim().length > 0).map((line) => line.trim())
      : [];
    if (!idea || sentences.length === 0) {
      return { problems: [], reviewError: "lesson term review returned an invalid restatement entry" };
    }
    // One sentence is a statement, not a repeat.
    if (sentences.length < 2) continue;
    problems.push({
      code: "restated-idea",
      message:
        `the lesson states the same idea ${sentences.length} times (${idea}) without adding a step, consequence, number, or example` +
        `. Keep the one statement that teaches it best where the idea is first needed; delete the others or rewrite each into a sentence that moves the explanation forward.`,
      hard: true,
      evidence: sentences,
    });
  }
  const concepts = (parsed as { concepts?: unknown }).concepts;
  if (concepts !== undefined && !Array.isArray(concepts)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "concepts"' };
  }
  const floating = new Set<string>();
  for (const entry of concepts ?? []) {
    const record = entry as Record<string, unknown>;
    const concept = typeof record?.concept === "string" ? record.concept.trim() : "";
    const grounding = record?.grounding;
    if (!concept || (grounding !== "concrete" && grounding !== "abstract_only")) {
      return { problems: [], reviewError: "lesson term review returned an invalid concept entry" };
    }
    if (grounding === "concrete") accepted.conceptsConcrete.push(concept);
    if (grounding !== "abstract_only" || floating.has(concept.toLowerCase())) continue;
    floating.add(concept.toLowerCase());
    const definition = typeof record.definition === "string" ? record.definition.trim() : "";
    const example = typeof record.example === "string" ? record.example.trim() : "";
    problems.push({
      code: "floating-concept",
      message:
        `"${concept}" is defined only in the abstract; nothing on the page lets the reader picture one` +
        (example ? `. Anchor it: ${example}` : "") +
        `. Right after its definition, give one concrete, fully specified instance: the named system the sources describe with its actual numbers, or a small worked case with every value written out. If the concept has a structure, a small ASCII diagram in a fenced text block with the numbers labelled (slot 0 ... slot 7 across one 4.615 ms frame, say) usually anchors it best; when you use one, read it back in the prose beneath it. A sentence saying the values depend on the system is not an example.`,
      hard: true,
      evidence: definition ? [definition] : undefined,
      subject: concept,
    });
  }
  const results = (parsed as { results?: unknown }).results;
  if (results !== undefined && !Array.isArray(results)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "results"' };
  }
  const unshown = new Set<string>();
  for (const entry of results ?? []) {
    const record = entry as Record<string, unknown>;
    const result = typeof record?.result === "string" ? record.result.trim() : "";
    const status = record?.status;
    if (!result || (status !== "shown" && status !== "asserted_with_notice" && status !== "unshown")) {
      return { problems: [], reviewError: "lesson term review returned an invalid result entry" };
    }
    if (status !== "unshown") accepted.resultsShown.push(result);
    if (status !== "unshown" || unshown.has(result.toLowerCase())) continue;
    unshown.add(result.toLowerCase());
    const sentence = typeof record.sentence === "string" ? record.sentence.trim() : "";
    const needed = typeof record.needed === "string" ? record.needed.trim() : "";
    problems.push({
      code: "unshown-result",
      message:
        `the lesson states a result (${result}) without showing how it is reached` +
        (needed ? `; show: ${needed}` : "") +
        `. Right where the result appears, work it out from facts already on the page - the calculation with every number written out, or the chain of reasoning step by step. If the sources give the result without its derivation, say that plainly and name what the derivation would need; never present an unexplained number as obvious.`,
      hard: true,
      evidence: sentence ? [sentence] : undefined,
    });
  }
  const callouts = (parsed as { callouts?: unknown }).callouts;
  if (callouts !== undefined && !Array.isArray(callouts)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "callouts"' };
  }
  for (const entry of callouts ?? []) {
    const record = entry as Record<string, unknown>;
    const kind = record?.kind;
    const text = typeof record?.text === "string" ? record.text.trim() : "";
    const verdict = record?.verdict;
    if (
      (kind !== "warning" && kind !== "note" && kind !== "info") ||
      !text ||
      (verdict !== "earned" && verdict !== "unearned")
    ) {
      return { problems: [], reviewError: "lesson term review returned an invalid callout entry" };
    }
    if (verdict !== "unearned") {
      accepted.calloutsEarned.push(text);
      continue;
    }
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    problems.push({
      code: "unearned-callout",
      message:
        `the ${kind} callout contributes nothing to a reader at that point` +
        (reason ? ` (${reason})` : "") +
        `. Delete it, or rewrite it as something that reader can use right now: a warning names a mistake they could actually make with what the page has taught, a note names a debt this page really incurs, an info adds one connection they can now understand. Never warn about confusing the topic with something the page has not taught.`,
      hard: true,
      evidence: [text],
    });
  }
  const reteaching = (parsed as { reteaching?: unknown }).reteaching;
  if (reteaching !== undefined && !Array.isArray(reteaching)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "reteaching"' };
  }
  const retaught = new Map<string, string[]>();
  for (const entry of reteaching ?? []) {
    const record = entry as Record<string, unknown>;
    const concept = typeof record?.concept === "string" ? record.concept.trim() : "";
    const paragraph = typeof record?.paragraph === "string" ? record.paragraph.trim() : "";
    if (!concept || !paragraph) {
      return { problems: [], reviewError: "lesson term review returned an invalid reteaching entry" };
    }
    const key = concept.toLowerCase();
    const paragraphs = retaught.get(key) ?? [];
    if (!paragraphs.includes(paragraph)) paragraphs.push(paragraph);
    retaught.set(key, paragraphs);
  }
  for (const [concept, paragraphs] of retaught) {
    problems.push({
      code: "reteaches-earlier-unit",
      message:
        `the lesson teaches "${concept}" again although an earlier page established it` +
        `. Cut each listed paragraph to a one-sentence reminder of the meaning this page needs now, then build on it; do not re-motivate or redefine it, and spend the recovered space on this page's own learning question.`,
      hard: true,
      evidence: paragraphs,
    });
  }
  return { problems, accepted };
}
