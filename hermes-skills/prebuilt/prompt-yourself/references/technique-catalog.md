# Technique catalog

Every technique the DAIR.AI Prompt Engineering Guide documents, with the part
that matters when you are writing a prompt for yourself to answer in one turn.
Page names refer to the local clone at `prompt-engineering-guide/pages` and to
promptingguide.ai.

Read an entry when the request is unusual, when the user names a technique, or
when the routing table in SKILL.md does not obviously fit.

## Core prompting

**Zero-shot** (`techniques/zeroshot`). Instruction only, no exemplars.
Instruction-tuned models handle most well-specified tasks this way. Reach for
anything heavier only after the instruction itself is specific — most bad
zero-shot results are vague-instruction results.

**Few-shot** (`techniques/fewshot`). Demonstrations condition the format. What
transfers is the shape: the label space, the input distribution, and the
layout. Keep exemplars short, consistent in format, and representative; two or
three usually beat six. Few-shot does not repair a task that needs reasoning
steps — pair it with chain-of-thought instead of adding more examples.

**Chain-of-thought** (`techniques/cot`). Ask for intermediate reasoning before
the answer. Zero-shot CoT is the "think step by step" variant; the few-shot
variant supplies worked exemplars whose reasoning is visible. It earns its cost
on arithmetic, multi-constraint logic, diagnosis, and anything where a wrong
answer is hard to spot. Decide separately whether the user sees the reasoning
or only the checked result.

**Meta prompting** (`techniques/meta-prompting`). Structure over content:
describe the *form* of a good answer — its sections, its syntax, the shape of a
valid solution — instead of stuffing the prompt with content-heavy examples.
Token-efficient, works zero-shot, and it is the default posture for the prompt
you generate. It assumes the model already knows the domain, so it degrades on
genuinely novel tasks where an exemplar would carry more.

## Reasoning reliability

**Self-consistency** (`techniques/consistency`). Sample several diverse
reasoning paths and take the answer they agree on, instead of trusting one
greedy chain. In a single turn you cannot sample in parallel, so the honest
adaptation is: derive the result by two genuinely different routes (different
decomposition, different unit, a reverse check) and reconcile. If they
disagree, say so and show both — a disagreement is information, not a failure
to hide.

**Generate knowledge prompting** (`techniques/knowledge`). Have the model state
the relevant facts, rules, or constants first, then answer conditioned on them.
Useful where the failure mode is a missing premise rather than bad reasoning,
and it makes a wrong premise visible instead of buried.

**Tree of thoughts** (`techniques/tot`). Maintain several candidate lines of
thought, evaluate them against explicit criteria, expand the promising one, and
abandon the rest — search with backtracking rather than one straight line. In
one turn: enumerate 2–4 branches, score each against stated criteria, commit,
and record why the losers lost. Fits design decisions, planning, and puzzles
where the first idea is often wrong.

**Reflexion** (`techniques/reflexion`). Verbal self-critique fed back as
context for a retry: draft, evaluate against criteria, revise. One revision
pass is usually where the gain is; further passes mostly re-word. State the
criteria in the prompt or the critique becomes taste.

**Active-Prompt** (`techniques/activeprompt`). Picks which questions deserve
human-annotated exemplars by measuring disagreement across sampled answers.
The transferable idea for a single turn: uncertainty is a signal about *where*
to spend effort. When two readings of a request diverge, that divergence is the
thing to name — as a labeled assumption in the prompt, or as the one question
worth asking.

**Directional stimulus prompting** (`techniques/dsp`). A small policy model
generates hints that steer a frozen larger model — for example the keywords a
summary must contain. Without that trained policy, write the stimulus by hand:
audience, register, length, and the specific terms the answer must cover. It is
the cheapest fix for "technically correct, wrong register".

## Decomposition and tools

**Prompt chaining** (`techniques/prompt_chaining`). Split a task into ordered
subtasks where each prompt consumes the previous output. More reliable and far
easier to debug than one monolithic prompt for documents, multi-part
deliverables, and extract-then-reason work. Inside one turn, run the chain
yourself and show only the final product unless the intermediate stages are the
deliverable.

**RAG** (`techniques/rag`). Retrieve relevant passages and condition generation
on them, instead of relying on parametric memory. Requires an actual retrieval
path — a Garden, a connection, a search tool. Without one, the prompt must say
what is unavailable rather than inviting confident invention.

**ReAct** (`techniques/react`). Interleave reasoning traces with actions:
thought, action, observation, repeat. This is the shape of an agent turn, so
use it only where tools are genuinely authorized; otherwise it is theatre.

**ART — automatic reasoning and tool use** (`techniques/art`). Selects
multi-step reasoning and tool-use demonstrations from a task library, pausing
generation to call tools and resuming with their output. Relevant when the turn
has real tools and the task decomposes into recognizable sub-steps.

**PAL — program-aided language models** (`techniques/pal`). The reasoning chain
is a program, and a runtime executes it for the answer. Correct choice for
exact arithmetic, date math, and combinatorics *when execution is available*.
When it is not, write the arithmetic out in full so a reader can check each
step.

**Automatic prompt engineer** (`techniques/ape`). Generates and scores
candidate instructions automatically, which is how the "let's work this out in
a step by step way to be sure we have the right answer" phrasing was found. The
lesson for hand-written prompts: instruction wording is a variable worth
varying, not a constant.

**Multimodal CoT** (`techniques/multimodalcot`). Two stages over text plus
images: generate the rationale from both modalities, then infer the answer from
that rationale. Use it when the request includes an image whose content the
answer depends on.

**Graph prompting** (`techniques/graph`). Prompting over graph-structured data.
Niche; reach for it when the input genuinely is a graph and its structure
carries the meaning.

## Where the rest of the guide lives

- `introduction/elements`, `introduction/tips` — the four prompt elements and
  the general design tips, both distilled in `prompt-anatomy.md`.
- `introduction/settings` — temperature and top-p. Not settable from a chat
  turn, but a reminder that determinism is a knob elsewhere in the stack.
- `risks/` — adversarial prompting (injection, prompt leaking, jailbreaks),
  factuality, and biases.
- `applications/`, `agents/` — worked applications and the agent-side material
  (function calling, context engineering).
