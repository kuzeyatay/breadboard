# Learn contracts and prompts

Use this reference to construct structured inputs or maintain the skill against
the Learn implementation. It distills the prompts instead of duplicating the
large runtime source. The main skill is sufficient for ordinary section writing.

## Where the behavior comes from

Repository-relative implementation locations and stable symbols:

| Source | Relevant responsibility |
| --- | --- |
| `dashboard/src/lib/learn.ts` | `SOURCE_MAP_PROMPT`, `SCOPE_CONTRACT_PROMPT`, `TOPIC_MAP_PROMPT`, `INCREMENTAL_TOPIC_MAP_RULES`, syllabus prompts, `SUBSECTION_PROMPT`, `SUBSECTION_REPAIR_PROMPT`, `PageDossier`, `buildPageDossier`, formula copy sheet, lesson assembly |
| `dashboard/src/lib/learn-pedagogy.ts` | `LEARN_FOUNDATION_RULES`, `LEARN_FOUNDATION_PLANNING_RULES`, `LEARN_LENGTH_PLANNING_RULES` |
| `dashboard/src/lib/learn-utils.ts` | `OPENING_MOVE_BRIEFS`, lesson quality checks and output helpers |
| `dashboard/src/lib/learning-unit-contract.ts` | Learning-unit contracts and their validation |
| `dashboard/src/lib/learning-spine-prompt-projection.ts` | Canonical evidence packet projection |
| `dashboard/src/lib/learn-lesson-terms.ts` | `LESSON_TERM_REVIEW_PROMPT`, semantic review verdicts and hard failures |
| `dashboard/src/lib/learn-teaching-context.ts` and `learn-teaching-healing.ts` | Actual preceding prose, verified prerequisite citations, bounded repair followed by fresh review |
| `dashboard/src/lib/hermes/garden-lesson-review.ts` | The same teaching review and repair for saved section lessons |
| `dashboard/src/lib/learn-final-critic.ts` and `dashboard/src/lib/critic-loop.ts` | Final semantic review, evidence confirmation, targeted repairs |
| `dashboard/src/lib/learn-humanizer.ts` | Optional post-build rewriting with revalidation and restoration on failure |
| `dashboard/src/lib/hermes/skills.ts` | Automatic discovery of `hermes-skills/prebuilt` as first-party skills |
| `dashboard/src/app/components/hermes/skills-catalog-panel.tsx` | First-party skills appear in the Featured filter |

## How the pipeline forms a section

1. Normalize source evidence and retain canonical source and artifact identities.
   Read a supplied syllabus and resolve its assigned material against actual
   source evidence. A syllabus sets obligations; it cannot create evidence.
2. Build the internal Source Map: each source's contribution, central concepts,
   examples, anchors, complete registered artifact projection, exact assigned
   questions and their figures, and unresolved assignments.
3. Build the Scope Contract with exactly `included`, `excluded`, `background`,
   `deferred`, `sourceEmphasis`, and `caveats` arrays. `included` and
   `sourceEmphasis` must be nonempty.
4. Author `learningUnits` first. Each has a `sectionPlan` containing `id`,
   `title`, `purpose`, and a `singleSubsectionReason` when it stands alone.
   Repeat a section's identical metadata on each member unit. Members are
   contiguous and ordered by prerequisites. The model decides this semantic
   grouping; code validates and projects it, rather than inventing titles or
   clustering afterward.
5. Account for every canonical source artifact exactly once as either an
   assignment or an explicit omission. Assign every registered source question
   to exactly one unit with its required anchors, figures, and syllabus mapping.
6. Review the whole learning spine for teaching-medium needs separately. The
   topic planner does not choose interactive visual types. This later review
   decides whether interaction adds teaching value and authors its contract.
7. Create the section index from its title and purpose. Write each lesson from
   a local dossier, then review and repair it before attaching planned visuals
   and learner-page metadata. The pipeline adds the learning-question prompt.
8. Review the finished artifacts and source grounding. Optional humanization
   happens on a staged build and must pass revalidation. Publication and build
   state are runtime operations, separate from writing the content.

The full-course planner's expectations (such as many units for a source-rich
Garden) are not quotas for a user asking for one section. An additive pipeline
update retains all baseline units and their relative order verbatim; it inserts
new stable IDs and reuses existing lesson bodies.

## Planner contract

The pipeline's `TOPIC_MAP_PROMPT` returns JSON with `title`, `summary`,
`learningUnits`, `sourceArtifactOmissions` (present even if empty), and `warnings`.
Each unit carries:

| Field | Meaning |
| --- | --- |
| `id`, `title`, `role`, `learningQuestion` | One teaching step; role describes its teaching move, not its artifact type |
| `prerequisiteConcepts`, `newConcepts`, `mustNotRepeat` | Dependency order and ownership of explanation |
| `syllabusUnitIds`, `sourceAnchors` | Exact supplied IDs; syllabus IDs are empty when no syllabus exists |
| `sourceFigures`, `sourceTables` | Exact artifact IDs, inline placement, and interpretation goals |
| `sourceFormulas` | Exact ID, teaching goal, terms, placement, grounding, and `derivableFrom` |
| `sourceQuestions` | Exact registry ID, placement, and teaching goal |
| `semanticConcepts` | Stable reusable slugs, labels, aliases, evidence, and primary/supporting roles |
| `knowledgeClaims` | Separate readable claims grounded by evidence and concept endpoints |
| `zettelNotes` | Atomic conceptual anchors and their connections |
| `sectionPlan` | Exact shared section ownership, title, and purpose |
| `expectedWordRange` | Independent advisory estimate, with positive bounds and lower estimate at least 1400 in normal Learn mode |

Valid roles include motivation, core_concept, mechanism, formula,
worked_example, training_method, metric, result_interpretation, comparison,
application, limitation, and synthesis. A mechanism unit owning an equation
remains a mechanism unit. Do not relabel it just to match the artifact.

When preserving an actual Learn contract, retain its semantic identities:
1-5 useful public concepts per unit, 1-2 primary concepts, consistent labels and
ordered aliases across occurrences, and no alias shared by different concepts.
Claims are not tags; zero claims is valid. Ordinary chat drafting need not
manufacture a graph registry to produce a useful section.

## Actual writer prompt composition

The base system message is `SUBSECTION_PROMPT`, composed from:

- `LEARNER_VOICE_RULES`: direct teaching, a linear argument, plain words,
  shown reasoning, no document commentary or restatement.
- `DEPTH_RULES`, including `LEARN_FOUNDATION_RULES`: ground-up explanations,
  intuition before math, concrete examples, supported derivations, and depth.
- `ANTI_AIISM_RULES`: remove canned transitions, filler, and negation-led prose.
- `PLACEHOLDER_FREE_PROSE_RULES`: finished learner prose only.
- Mechanics: one heading-free body, emphasis rules, concept ownership,
  exact questions/formulas, assigned inline visuals, and collapsed answers.

`withSyllabusRules` adds `SYLLABUS_PAGE_RULES` only with a syllabus.
`withAssumedBackgroundRules` supplies the scope's actual declared starting level.
`withLearnUserInstructionRules` supplies the learner's scope/revision request.
The user request is carried out, not quoted inside the lesson.

The user payload is `task: "write_subsection"`, the `userInstruction`, a local
`dossier`, `plannedEarlier`, `earlierLessons`, `taughtLater`, and writing instructions. Earlier lessons carry actual prose; planned concepts are routing hints, not proof of understanding. The
dossier includes the section purpose, one unit contract, assumed background,
opening move, required questions and formulas, exact source passages, assigned
visuals, relevant syllabus obligations, unavailable citations, and optional
supplementary artifacts. **Planning word ranges are deliberately omitted**:
they make the writer stop at the estimate rather than finish the explanation.

`withVerbatimSourceFormulaCopySheet` prepends literal display-math blocks outside
the JSON. Copy these directly; JSON-escaped backslashes and line breaks are not
the authoritative string to reconstruct by eye. The writer returns Markdown
body only, without frontmatter or a wrapping code fence. Runtime assembly adds
the title, metadata, and learning-question prompt.

For a standalone skill run, apply that same separation internally: keep evidence
and contract data distinct from instructions, then render the lesson title once
when assembling the deliverable. Do not expose JSON packets to the learner.

## Review and repair prompts

`LESSON_TERM_REVIEW_PROMPT` reviews the actual lesson against the dossier and
earlier/later concepts. Its output separates:

- `terms`: explained here, shallow, taught earlier, named later, or unexplained;
- `restatements`: all sentences repeating the same idea;
- `concepts`: concrete or abstract-only at the supported source depth;
- `results`: shown, asserted with notice, or unshown;
- `callouts`: earned or unearned at their position in the lesson;
- `reteaching`: paragraphs that unnecessarily teach an earlier concept again.

The runtime translates findings into hard failures such as `unexplained-term`,
`shallow-explanation`, `floating-concept`, `unshown-result`, `restated-idea`,
`reteaches-earlier-unit`, `leans-on-later-unit`, and `unearned-callout`.
Other checks cover missing source formulas/questions, internal headings,
unfinished text, and unavailable citations. Source limits apply to the review
too: it cannot demand an example or derivation the evidence does not supply.
Knowledge failures (including reliance on later concepts, shallow explanations,
incorrect results, unverified prerequisites, and broken progression) cannot be
accepted as repair-budget leftovers. The healing stage replaces premature
examples or supplies supported bridges, then the whole argument is reviewed again.
An unresolved knowledge failure prevents publication; it is never converted into
a success or merely mentioned in the completion message.

The repair system uses `SUBSECTION_REPAIR_PROMPT` plus the same starting level
and user guidance. The user payload contains `pageMarkdown`, `failedProblems`,
the dossier, earlier/later concepts, and a literal formula replacement sheet
when required. Return only the repaired body. Fix listed failures, preserving
working prose and visuals. Replace malformed formulas with the exact required
blocks rather than retaining both variants. Preserve an actual pipeline's
visual insertion markers and existing visual blocks verbatim.

For a manual pass, use the same contract: identify concrete failures, change
only what resolves them, then check the affected evidence and teaching again.
Accepted unchanged passages should not be re-litigated without new evidence.
Do not claim the automated review ran when only a manual review was performed.
Saving a generated lesson with `garden_save_note` and its `lesson` context does
run the shared automated teaching review. The result includes `teachingReview`
only after the exact saved text passes. Ordinary notes and brief guides do not
need a lesson context. A full Learn-style minimum also requires the context, so
word count alone cannot authorize a generated lesson.
