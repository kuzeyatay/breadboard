# Cognivia: mental-health turns as a CBT copilot

When a message is about the user's mental health, Breadboard stops answering as
a general assistant and answers as a cognitive behavioral therapy copilot. This
is Cognivia, from "A Cognitive Behavioral Therapy Copilot for Evidence-Based
Mental Healthcare" (Chen, Luo, Wang, Shi, Rao and Zhao), cloned at
[`Cognivia/`](../Cognivia). Its claim is that a supportive answer is worth more
when it identifies the *cognitive distortion* in what the person actually said
and answers that with a technique, instead of offering sympathy and stopping.

It is innate rather than a skill, a command, or a mode. There is nothing to
invoke, nothing to switch on, and no button that says "therapy". The routing is
the integration: a turn that reads as mental-health related is composed
differently, on every surface, including the ones that reach Breadboard from
WhatsApp, Telegram, a scheduled chat, or the Quartz garden.

## The two halves

**The discipline** lives in
[`hermes-config/system/cognivia.md`](../hermes-config/system/cognivia.md): the
copilot stance, the instruction to work with one distortion rather than
performing analysis at someone, the boundary rules Cognivia's own evaluation
criteria call relational boundary integrity — a cognitive support tool, not a
therapist, not a relationship, no simulated attachment — the crisis rule, and
the instruction never to narrate any of it. Unlike the meta-prompting
discipline, it ships only on turns the classifier engages, so a question about
TypeScript pays nothing for it.

**The per-turn half** comes from
[`dashboard/src/lib/cognivia/index.ts`](../dashboard/src/lib/cognivia/index.ts).
`classifyCogniviaTurn` reads the user's newest message and returns one of three
registers, and `cogniviaSection` renders the discipline plus that message's
evidence.

## Three registers

`crisis` covers self-harm, suicidality, and being unsafe. Safety displaces
everything else: no distortion analysis, no exercise, no wall of resources.
A specific crisis line is named only when the conversation says which country
the person is in; otherwise the model offers to find the local one. Obvious
hyperbole about a failing build is explicitly not a crisis.

`personal_distress` covers someone describing their own struggle, or asking how
to help a person who is. It gets the full copilot, plus up to three candidate
distortions prefiltered from their wording. When the distress belongs to
somebody else, the candidates are dropped and the section says whose it is, so
the answer is not aimed at the wrong person.

`informational` covers a factual question *about* mental health — what a
cognitive distortion is, how exposure therapy works, what an SSRI does. It is
answered as the factual question it is, without therapeutic framing and without
assuming the person asking is the person struggling.

Everything else classifies as `none` and no section is composed.

Distortion wording alone never engages the copilot. "This build always breaks
and nothing ever works" is the same sentence shape as "I always fail", and only
one of them is about a person, so a distress signal has to be present first and
the wording only adds weight on top of it. In the other direction the
classifier is deliberately lenient, matching upstream's own labelling prompt:
answering a frustrated technical question a little more warmly costs a
paragraph, and missing someone who is struggling costs the thing that mattered.
The section closes that loop by telling the model to answer the actual request
first when the message is really a technical one.

## The clone is a live dependency

The distortion taxonomy and the reference thoughts are read out of
`Cognivia/data/CBT_Cognitive_Triplet_Dataset.xlsx` at request time, cached by
mtime, so pulling the clone changes what Breadboard says without a restart. The
workbook's second sheet is the eleven distortions with Burns's definitions; the
first is 318 thoughts curated from CBT literature, each labelled with its
distortion. `cogniviaDiagnostics()` reports whether the clone was actually the
source; a missing clone degrades to an embedded taxonomy and no exemplars,
which is a working turn rather than a broken one.

Two upstream artifacts are deliberately not used. The paper's deliverable is a
LoRA fine-tune of Qwen2.5-7B served from Aliyun Model Studio behind the authors'
own API key, which is not reachable from here; the method transfers through the
prompt and the data, and the model behind the turn stays Breadboard's own. The
workbook's *Rational Response* column is excerpted explanation from the source
texts rather than something said back to a person — only 118 of 318 rows carry
text at all, and most of those narrate mechanisms in the third person — so it
never reaches the prompt. Only the labelled thoughts do, as calibration for
identification. Generating the response here rather than copying one is the same
division upstream's own pipeline makes, where that stage is model-generated too.

Upstream is licensed CC BY-NC 4.0. The dataset is read in place from the clone;
nothing here redistributes it.

## Where the routing is wired

`composeHermesSystemPrompt` covers the authenticated Terminal, Garden chat and
Quartz AI, and with them every surface that reaches a turn through
`startConversationTurn`: WhatsApp, Telegram, scheduled chats, and the Hermes
sessions API. Three surfaces build their own system prompts and are wired
separately — [`/api/chat`](../dashboard/src/app/api/chat/route.ts),
[`/api/knowledge-chat`](../dashboard/src/app/api/knowledge-chat/route.ts), and
`directSystemPrompt` in
[`direct-turn-service.ts`](../dashboard/src/lib/conversations/direct-turn-service.ts),
which is the runtime-less path when Agent mode is off. A fourth such surface
would have to be wired by hand; `dashboard/tests/cognivia.test.mjs` asserts
those three are, which is the only guard against a new route quietly missing it.

## Switches

`ENABLE_COGNIVIA=0` turns the whole integration off, including the discipline.
`COGNIVIA_DIR` points at a different checkout of the clone.
