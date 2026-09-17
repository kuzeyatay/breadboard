import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  VOICE_DOUBLE_TAP_MS,
  VOICE_MIN_SPEECH_MS,
  VOICE_NO_SPEECH_MS,
  VOICE_SILENCE_HOLD_MS,
  advanceVoiceTurn,
  createVoiceNarrationQueue,
  frameLevel,
  haloRings,
  initialVoiceTurn,
  inkRingPath,
  inkUnderlinePath,
  isDoubleTap,
  isVoiceExitRequest,
  latestAssistantReply,
  replyKey,
  scribbleRings,
  speakableText,
  stageLabel,
  voiceTranscriptMessages,
  voiceTurnVerdict,
} from "../src/lib/speech/voice-conversation.ts";

const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const overlay = source("../src/app/components/voice-conversation-overlay.tsx");
const composer = source("../src/app/components/assistant-composer.tsx");
const dictation = source("../src/app/components/speech-dictation-button.tsx");
const styles = source("../src/app/globals.css");
const terminal = source("../src/app/components/knowledge-terminal.tsx");
const gardenAssistant = source("../src/app/garden/garden-assistant.tsx");
const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
const hermesPanel = source("../src/app/components/hermes/agent-runtime-panel.tsx");

const FRAME_MS = 85;

test('voice closes for complete farewell requests, not goodbye mentioned in a task', () => {
  for (const text of ['Goodbye.', 'Bye, Bread.', 'Thank you, goodbye!', 'See you later.', 'Okay, that’s all.', 'Please close yourself.', '[sigh] You can close yourself now', 'Could you please close the voice assistant?', 'End this conversation, please.']) {
    assert.equal(isVoiceExitRequest(text), true, text);
  }
  for (const text of ['', 'Thank you.', 'Don’t close yourself.', 'You cannot close yourself now.', 'Say goodbye in Turkish.', 'Explain what “goodbye” means.', 'Write a goodbye message.', 'Goodbye, but first finish the report.', 'Close the browser.', 'Stop listening.', '[noise]']) {
    assert.equal(isVoiceExitRequest(text), false, text);
  }
});

test('spoken close requests allow conversational lead-ins without swallowing tasks or negations', () => {
  for (const text of [
    'And then close yourself now',
    'Okay, and then close yourself now, please.',
    '[sigh] And then could you please close the voice assistant?',
    'Then end this conversation.',
    'So, goodbye.',
  ]) {
    assert.equal(isVoiceExitRequest(text), true, text);
  }
  for (const text of [
    'And then don’t close yourself now.',
    'And then you cannot close yourself now.',
    'Explain what “and then close yourself now” means.',
    'Finish the report and then close yourself now.',
    'And then close yourself now if the report is ready.',
    'And then close the browser.',
  ]) {
    assert.equal(isVoiceExitRequest(text), false, text);
  }
});

/** Feeds `count` frames at one loudness into a turn. */
function speak(state, level, milliseconds) {
  let next = state;
  for (let elapsed = 0; elapsed < milliseconds; elapsed += FRAME_MS) {
    next = advanceVoiceTurn(next, level, FRAME_MS);
  }
  return next;
}

test("a second tap inside the window is the gesture; a slower one is not", () => {
  assert.equal(isDoubleTap(null, 1_000), false);
  assert.equal(isDoubleTap(1_000, 1_000 + VOICE_DOUBLE_TAP_MS - 1), true);
  assert.equal(isDoubleTap(1_000, 1_000 + VOICE_DOUBLE_TAP_MS + 1), false);
  // The window is short enough that holding a single tap for it stays invisible
  // next to the microphone permission round trip.
  assert.ok(VOICE_DOUBLE_TAP_MS <= 320);
});

test("a turn ends on the pause after speech, not on the first quiet frame", () => {
  let turn = speak(initialVoiceTurn(), 0.14, 1_400);
  assert.equal(voiceTurnVerdict(turn), "listening");

  turn = speak(turn, 0.002, VOICE_SILENCE_HOLD_MS / 2);
  assert.equal(voiceTurnVerdict(turn), "listening", "a breath mid-sentence must not send");

  turn = speak(turn, 0.14, 600);
  turn = speak(turn, 0.002, VOICE_SILENCE_HOLD_MS + FRAME_MS);
  assert.equal(voiceTurnVerdict(turn), "send");
});

test("voice hands off promptly but preserves a breath and resets the hold when speech resumes", () => {
  let turn = speak(speak(initialVoiceTurn(), 0.14, 1_400), 0.002, 700);
  assert.equal(voiceTurnVerdict(turn), 'listening');
  turn = speak(turn, 0.14, 400);
  turn = speak(turn, 0.002, 700);
  assert.equal(voiceTurnVerdict(turn), 'listening', 'a resumed sentence starts a fresh silence hold');
  turn = speak(turn, 0.002, 500);
  assert.equal(voiceTurnVerdict(turn), 'send', 'a completed turn reaches transcription within 1.2 seconds');
});

test("a quiet room is never mistaken for a sentence", () => {
  const turn = speak(initialVoiceTurn(), 0.004, VOICE_NO_SPEECH_MS + FRAME_MS);
  assert.equal(turn.heardSpeech, false);
  assert.equal(voiceTurnVerdict(turn), "silent");
});

test("a click or a cough is too short to send", () => {
  let turn = speak(initialVoiceTurn(), 0.2, VOICE_MIN_SPEECH_MS / 2);
  turn = speak(turn, 0.002, VOICE_SILENCE_HOLD_MS * 2);
  assert.equal(voiceTurnVerdict(turn), "listening");
});

test("steady room noise raises the bar instead of transcribing the room", () => {
  // A fan at a level that would clear the bare floor threshold.
  const roomy = speak(initialVoiceTurn(), 0.012, 4_000);
  assert.ok(roomy.noiseFloor > initialVoiceTurn().noiseFloor);
  assert.equal(roomy.heardSpeech, false);
});

test("frame loudness is the RMS of the samples", () => {
  assert.equal(frameLevel([]), 0);
  assert.equal(frameLevel([0, 0, 0]), 0);
  assert.equal(frameLevel([1, -1, 1, -1]), 1);
  assert.ok(Math.abs(frameLevel([0.5, -0.5]) - 0.5) < 1e-12);
});

test("the answer read out is the newest assistant message", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "first" },
    { role: "user", content: "again" },
    { role: "assistant", content: "second" },
  ];
  assert.equal(latestAssistantReply(messages), "second");
  assert.equal(replyKey(messages), "3");
  // An empty placeholder is not an answer yet, and a fresh chat has none.
  assert.equal(latestAssistantReply([{ role: "assistant", content: "   " }]), null);
  assert.equal(replyKey([{ role: "user", content: "hi" }]), null);
  // The key moves when a new turn lands, which is how one answer is spoken once.
  assert.notEqual(replyKey(messages), replyKey(messages.slice(0, 2)));
});

function narrationHarness(startIndex = 0) {
  const spoken = [], idle = [], errors = [], completions = [];
  const queue = createVoiceNarrationQueue({
    startIndex,
    speak(item, signal) {
      spoken.push({ ...item, signal });
      return new Promise((resolve, reject) => completions.push({ resolve, reject }));
    },
    onIdle: (answered) => idle.push(answered),
    onError: (error) => errors.push(error.message),
  });
  return { queue, spoken, idle, errors, completions };
}

const flushNarration = () => new Promise((resolve) => setImmediate(resolve));
const searchNote = 'Searching your recent chats for “fitness journey.”';
const retryNote = 'No exact match. Trying the likely gym, fat-loss, and nutrition terms.';

test("voice reads completed thinking updates during generation and queues the final answer in order", async () => {
  const h = narrationHarness();
  const message = { role: 'assistant', content: 'An unfinished answer', progressNotes: [searchNote] };
  assert.equal(h.queue.update([message], true), false);
  assert.deepEqual(h.spoken.map(item => item.text), [searchNote]);
  message.progressNotes.push(retryNote);
  h.queue.update([message], true);
  h.queue.update([message], true); // Renders and reconnects must not replay notes.
  message.content = 'I found your fitness chats.';
  assert.equal(h.queue.update([message], false), true);
  h.queue.update([message], false);
  assert.equal(h.spoken.length, 1, 'the final answer must not interrupt progress audio');
  h.completions[0].resolve();
  await flushNarration();
  assert.deepEqual(h.spoken.map(item => item.text), [searchNote, retryNote]);
  assert.deepEqual(h.idle, [], 'do not reopen the microphone between queued messages');
  h.completions[1].resolve();
  await flushNarration();
  assert.equal(h.spoken[2].kind, 'answer');
  assert.equal(h.spoken[2].text, message.content);
  h.completions[2].resolve();
  await flushNarration();
  assert.deepEqual(h.idle, [true]);
});

test("gaps between thinking updates keep waiting for the answer", async () => {
  const h = narrationHarness();
  const message = { role: 'assistant', content: '', progressNotes: [searchNote] };
  h.queue.update([message], true);
  h.completions[0].resolve();
  await flushNarration();
  assert.deepEqual(h.idle, [false]);
  h.queue.update([message], true);
  assert.equal(h.spoken.length, 1);
  message.progressNotes.push(retryNote);
  h.queue.update([message], true);
  assert.equal(h.spoken[1].text, retryNote);
});

test("voice skips history, user notes, empty notes and raw reasoning", async () => {
  const h = narrationHarness(2);
  const messages = [
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'old answer', progressNotes: ['Old progress'] },
    { role: 'user', content: 'new question', progressNotes: ['User-supplied note'] },
    { role: 'assistant', content: '', reasoning: 'Raw reasoning', progressNotes: [' ', searchNote, ` ${searchNote} `], delegatedAgentPreamble: searchNote },
  ];
  h.queue.update(messages, true);
  h.completions[0].resolve();
  await flushNarration();
  assert.deepEqual(h.spoken.map(item => item.text), [searchNote]);
  const plain = narrationHarness(2);
  plain.queue.update(messages.slice(0, 3), false);
  assert.equal(plain.spoken.length, 0, 'an old answer must never be reused');
  messages[3] = { role: 'assistant', content: 'A normal answer' };
  plain.queue.update(messages, false);
  assert.equal(plain.spoken[0].text, 'A normal answer');
});

test("interrupting cancels pending speech and ignores late completion callbacks", async () => {
  const h = narrationHarness();
  const message = { role: 'assistant', content: 'Final answer', progressNotes: [searchNote, retryNote] };
  h.queue.update([message], false);
  h.queue.cancel();
  assert.equal(h.spoken[0].signal.aborted, true);
  h.completions[0].resolve();
  await flushNarration();
  h.queue.update([message], false);
  assert.equal(h.spoken.length, 1);
  assert.deepEqual(h.idle, []);
  assert.deepEqual(h.errors, []);
});

test("a failed progress message does not lose subsequent updates or the answer", async () => {
  const h = narrationHarness();
  h.queue.update([{ role: 'assistant', content: 'Final answer', progressNotes: [searchNote] }], false);
  h.completions[0].reject(new Error('Speech unavailable'));
  await flushNarration();
  assert.deepEqual(h.errors, ['Speech unavailable']);
  assert.equal(h.spoken[1].text, 'Final answer');
  h.completions[1].resolve();
  await flushNarration();
  assert.deepEqual(h.idle, [true]);
});

test('answering a question keeps watching the same assistant message without replaying earlier speech', async () => {
  const spoken = [];
  const before = { role: 'assistant', content: 'Let me understand your goals. ', progressNotes: [searchNote] };
  const queue = createVoiceNarrationQueue({
    startIndex: 1,
    initialMessage: before,
    speak: async item => { spoken.push(item.text); },
    onIdle() {},
    onError(error) { throw error; },
  });
  const messages = [{ role: 'user', content: 'Help with fitness' }, before, { role: 'user', content: 'Build a workout plan' }];
  assert.equal(queue.update(messages, true), false);
  assert.equal(queue.update(messages, false), false, 'the old content cannot count as the new answer');
  assert.deepEqual(spoken, []);
  messages[1] = { ...before, content: before.content + 'Train three days a week.', progressNotes: [searchNote, retryNote] };
  assert.equal(queue.update(messages, true), false);
  await flushNarration();
  assert.equal(queue.update(messages, false), true);
  await flushNarration();
  assert.deepEqual(spoken, [retryNote, 'Train three days a week.']);
});

test('tool questions and spoken answers stay in order as the same assistant message continues', () => {
  const messages = [
    { role: 'user', content: 'Help with fitness' },
    { role: 'assistant', content: 'I can help. Start with three days. Use dumbbells.' },
    { role: 'user', content: 'Build a workout plan', clientMessageId: 'clarify:first' },
    { role: 'user', content: 'Dumbbells', clientMessageId: 'clarify:second' },
  ];
  const questions = [
    { requestId: 'first', question: 'What would you like?', messageIndex: 1, contentBefore: 'I can help. ' },
    { requestId: 'second', question: 'What equipment do you have?', messageIndex: 1, contentBefore: 'I can help. Start with three days. ' },
  ];
  assert.deepEqual(voiceTranscriptMessages(messages, questions).map(message => message.content), [
    'Help with fitness', 'I can help.', 'What would you like?', 'Build a workout plan',
    'Start with three days.', 'What equipment do you have?', 'Dumbbells', 'Use dumbbells.',
  ]);
});

test("markdown is turned into something worth hearing", async () => {
  const spoken = await speakableText(
    [
      "## Heading",
      "",
      "A **bold** claim with `code` and a [link](https://example.com/page).",
      "",
      "```ts",
      "const secret = 1;",
      "```",
      "",
      "- first point",
      "- second point",
    ].join("\n"),
  );
  assert.match(spoken, /^Heading\.\n\nA bold claim/);
  assert.match(spoken, /a link\./);
  assert.doesNotMatch(spoken, /```/);
  assert.match(spoken, /const secret = 1;/);
  assert.doesNotMatch(spoken, /https:\/\//);
  assert.doesNotMatch(spoken, /\*\*|^#/m);
  assert.match(spoken, /first point\.\n\nsecond point\./);
});

test('voice keeps resource-only replies and shows their widgets once after clarification', () => {
  const resource = { id: 'search-1', renderer: 'chat-search-results' };
  const messages = [{ role: 'assistant', content: 'Before. After.', uiResources: [resource] }];
  const transcript = voiceTranscriptMessages(messages, [
    { requestId: 'question', question: 'Which chat?', messageIndex: 0, contentBefore: 'Before. ', answer: 'Fitness' },
  ]);
  assert.deepEqual(transcript.map(message => message.content), ['Before.', 'Which chat?', 'Fitness', 'After.']);
  assert.deepEqual(transcript.flatMap(message => message.uiResources ?? []), [resource]);
  assert.deepEqual(transcript.at(-1).uiResources, [resource]);
  assert.deepEqual(voiceTranscriptMessages([{ ...messages[0], content: '' }], []), [
    { role: 'assistant', content: '', uiResources: [resource] },
  ]);
});

test('a completed resource-only response releases voice from waiting', async () => {
  const idle = [];
  const queue = createVoiceNarrationQueue({ startIndex: 0, speak: async () => {}, onIdle: answered => idle.push(answered), onError: assert.fail });
  const messages = [{ role: 'assistant', content: '', uiResources: [{ id: 'search-1' }] }];
  assert.equal(queue.update(messages, true), false);
  assert.equal(queue.update(messages, false), true);
  await flushNarration();
  assert.deepEqual(idle, [true]);
});

test('widget display data is not narrated as JSON or omitted code', async () => {
  for (const language of ['weather-results', 'image-results']) {
    for (const fence of ['```', '~~~']) {
      assert.equal(await speakableText(`Here it is.\n${fence}${language}\n{"privateDisplayData":true}\n${fence}\nTake a look.`), 'Here it is.\n\nTake a look.');
      assert.equal(await speakableText(`${fence}${language}\n{"partial":`), '');
    }
  }
  assert.equal(await speakableText('```js\nconsole.log(1)\n```'), 'console.log(1)');
});

test("voice reads the entire long answer, including its final words", async () => {
  const long = `${"This is a full sentence. ".repeat(200)}`;
  const spoken = await speakableText(long);
  assert.equal(spoken, long.trim());
});

test("every stage has a label", () => {
  for (const stage of ["opening", "listening", "transcribing", "thinking", "speaking", "paused", "unavailable", "blocked"]) {
    assert.ok(stageLabel(stage).length > 0);
  }
});

test("the ring is a closed hand-drawn circle, wobbling but still round", () => {
  const path = inkRingPath(11, 100, 100, 62, 0.05, 16);
  assert.match(path, /^M /);
  assert.match(path, /Z$/);
  const numbers = path.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.ok(numbers.every(Number.isFinite));

  // Every knot (the end point of each cubic) stays within the wobble band.
  const knots = [...path.matchAll(/C [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+)/g)];
  assert.ok(knots.length >= 16);
  for (const [, x, y] of knots) {
    const distance = Math.hypot(Number(x) - 100, Number(y) - 100);
    assert.ok(distance > 62 * 0.94 && distance < 62 * 1.06, `knot at ${distance}`);
  }

  // Same seed, same ring — the screen does not redraw a different circle on
  // every render.
  assert.equal(path, inkRingPath(11, 100, 100, 62, 0.05, 16));
  assert.notEqual(path, inkRingPath(12, 100, 100, 62, 0.05, 16));
});

test("the caption rule is an open line, not a closed shape", () => {
  const path = inkUnderlinePath(43);
  assert.match(path, /^M /);
  assert.doesNotMatch(path, /Z/);
  assert.ok(path.match(/-?\d+(\.\d+)?/g).map(Number).every(Number.isFinite));
});

test("the ring is sketched over again, each pass a different hand", () => {
  const passes = scribbleRings(100, 100, 62);
  assert.ok(passes.length >= 2);
  assert.equal(new Set(passes).size, passes.length, "every pass has to differ");
  for (const pass of passes) {
    assert.match(pass, /^M /);
    assert.match(pass, /Z$/);
    assert.ok(pass.match(/-?\d+(\.\d+)?/g).map(Number).every(Number.isFinite));
  }
  // Same arguments, same sketch: the ring does not re-roll on every render.
  assert.deepEqual(passes, scribbleRings(100, 100, 62));
});

test("the halo is the same circle, lying on the line until a voice moves it", () => {
  const radius = 62;
  const rings = haloRings(100, 100, radius);
  assert.ok(rings.length >= 2);

  for (const ring of rings) {
    // Closed circles drawn by the same hand as the ring — not a second shape.
    assert.match(ring.path, /^M /);
    assert.match(ring.path, /Z$/);
    const numbers = ring.path.match(/-?[\d.]+/g).map(Number);
    assert.ok(numbers.every(Number.isFinite));
    // At rest every ring sits on the drawn circle, which is what makes the halo
    // invisible until someone speaks: it swells out of the line, it never
    // arrives from somewhere else.
    for (let index = 0; index < numbers.length; index += 2) {
      const distance = Math.hypot(numbers[index] - 100, numbers[index + 1] - 100);
      assert.ok(distance > radius * 0.93 && distance < radius * 1.07, `off the ring at ${distance}`);
    }
    // A quiet reaction: even a shout carries the outermost ring a fifth of the
    // radius, so the circle stays the circle.
    assert.ok(ring.spread > 0 && ring.spread <= 0.2, `${ring.id} spreads by ${ring.spread}`);
  }

  // Further out is fainter and finer, so the halo fades into the room instead
  // of ending on a hard outer edge.
  for (let index = 1; index < rings.length; index += 1) {
    assert.ok(rings[index].spread > rings[index - 1].spread);
    assert.ok(rings[index].opacity < rings[index - 1].opacity);
    assert.ok(rings[index].width < rings[index - 1].width);
    assert.notEqual(rings[index].path, rings[index - 1].path, "every pass is a different hand");
  }

  // Same arguments, same halo: it does not re-roll on every render.
  assert.deepEqual(rings, haloRings(100, 100, radius));
});

test("double-tapping the microphone opens voice mode instead of the options", () => {
  assert.match(dictation, /onOpenVoiceMode\?: \(greet\?: boolean\) => void/);
  assert.match(dictation, /onClick=\{handleTap\}/);
  // A tap that would open the options is the one that arms the window;
  // stopping a running recording never is.
  assert.match(dictation, /if \(!onOpenVoiceMode \|\| state !== "idle"\)/);
  // The first tap shows the menu straight away — nothing waits out the window,
  // it only decides whether a second tap takes the menu back down again.
  assert.match(
    dictation,
    /tapTimerRef\.current = window\.setTimeout\(\(\) => \{\s*tapTimerRef\.current = null;\s*\}, VOICE_DOUBLE_TAP_MS\);\s*toggleMenu\(\);/,
  );
  assert.match(
    dictation,
    /window\.clearTimeout\(tapTimerRef\.current\);[\s\S]{0,220}?setMenuOpen\(false\);[\s\S]{0,220}?onOpenVoiceMode\(\);/,
  );
  assert.match(dictation, /double-tap to talk to the assistant/);
});

test("a spoken turn is sent as an ordinary chat message", () => {
  // The transcript is written into the host's draft, and the submit fires from
  // the render that has it — otherwise onSubmit would send the previous draft.
  assert.match(composer, /pendingVoiceSendRef/);
  assert.match(
    composer,
    /if \(pendingVoiceSendRef\.current === null \|\| pendingVoiceSendRef\.current !== value\) return;/,
  );
  assert.match(composer, /onSubmitRef\.current\(\);/);
  assert.match(composer, /const sendSpokenTurn = useCallback\(/);
  assert.match(composer, /onOpenVoiceMode=\{voiceMessages \? \(greet = false\) => \{ setGreetVoice\(greet\); setVoiceOpen\(true\); \} : undefined\}/);
  assert.match(composer, /<VoiceConversationOverlay/);
  assert.match(composer, /messages=\{voiceMessages\}/);
  // Whatever the host calls its run flag, "a turn is in flight" has to reach the
  // voice screen — it is what keeps an answer from being spoken half-written.
  assert.match(composer, /busy=\{isSending \|\| \w+\}/);
});

test("the voice screen talks to the chat and takes the whole screen", () => {
  assert.match(overlay, /createPortal\(overlay, document\.body\)/);
  assert.match(overlay, /'\/api\/speech\/transcribe'/);
  assert.match(overlay, /'\/api\/speech\/synthesize'/);
  assert.match(overlay, /prepareLocalSpeech\(cloudController\.signal\)/);
  assert.match(overlay, /playSpeechBlob/);
  assert.match(overlay, /onSendRef\.current\(text\)/);
  // Escape closes, and closing tears the microphone and playback down.
  assert.match(overlay, /event\.key === 'Escape'/);
  assert.match(overlay, /stopSpeechPlayback\(\);\s*\n\s*releaseMicrophone\(\);/);
  // Answers are spoken once, when they have settled.
  assert.match(overlay, /narration\.update\(messages, busy\)/);
  assert.match(overlay, /if \(answered\) \{\s*awaitingRef\.current = false;/);
});

test("voice mode prepares the selected speech provider before it starts listening", () => {
  assert.match(
    overlay,
    /const cloud = await subscriptionSelected\(cloudController\.signal\);[\s\S]*?if \(!cloud\) await prepareLocalSpeech\(cloudController\.signal\);[\s\S]*?serviceReady = true;[\s\S]*?requestForegroundMicrophone/,
  );
  assert.match(overlay, /\[401, 403, 409\]\.includes\(response\.status\)[\s\S]*?enterStage\('unavailable'\)/);
  assert.match(overlay, /stage === 'blocked' \|\| stage === 'unavailable'/);
});

test("a slow answer is waited for; only an undelivered turn gives up", () => {
  // The watchdog guards delivery, not generation: an agent that thinks for two
  // minutes must not be abandoned and then never read out.
  assert.match(overlay, /const DISPATCH_WATCHDOG_MS = 20_000;/);
  // Delivery and retry behavior is exercised with microphone input and a busy
  // question in voice-answer-dispatch-ui.test.mjs.
  assert.match(overlay, /sentMessageCountRef\.current = messagesRef\.current\.length;/);
  // Waiting is still escapable by hand, so nothing traps the screen.
  assert.match(overlay, /if \(stage === 'thinking'\) \{[\s\S]*?awaitingRef\.current = false;/);
  assert.doesNotMatch(overlay, /REPLY_WATCHDOG_MS/);
});

test("only the ring is drawn on: nothing scribbles across the background", () => {
  assert.match(styles, /\.voice-stage \{/);
  assert.match(styles, /position: fixed;/);
  assert.match(styles, /@keyframes voice-ring-draw/);
  assert.match(styles, /@keyframes voice-ring-sketch/);
  assert.match(styles, /@keyframes voice-echo-pulse/);
  // The whole-screen mark layer is gone, in both the markup and the styles.
  assert.doesNotMatch(styles, /voice-doodle|voice-stage-doodles/);
  assert.doesNotMatch(overlay, /doodle/i);
  // ...and so is the standing hint that used to sit under it.
  assert.doesNotMatch(styles, /voice-stage-footer|voice-stage-hint/);
  assert.doesNotMatch(overlay, /Every turn is saved in the chat/);

  // pathLength="1" is what lets one dash rule draw any generated shape.
  assert.match(overlay, /pathLength=\{1\}/);
  assert.match(styles, /stroke-dasharray: 1;\s*\n\s*stroke-dashoffset: 1;/);
  // The microphone level reaches the ring as a custom property, not a re-render.
  assert.match(overlay, /setProperty\('--voice-level'/);
  assert.match(styles, /var\(--voice-level\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("talking swells the circle; it never takes the circle away", () => {
  // The whole reaction is one property against one transform. Nothing here is
  // animated frame by frame from JavaScript, and nothing keeps moving on its own.
  assert.match(
    styles,
    /\.voice-halo-ring \{[\s\S]*?transform: scale\(calc\(1 \+ var\(--voice-level\) \* var\(--halo-spread[\s\S]*?transition: transform /,
  );
  assert.match(
    styles,
    /\.voice-stage\[data-voicing=["']true["']\] \.voice-halo \{\s*\n\s*opacity: 1;/,
  );
  assert.match(overlay, /'--halo-spread': `\$\{ring\.spread\}`/);
  assert.match(overlay, /className="voice-halo-ring"/);

  // The circle is the fixed point of the screen: it is never faded out, never
  // unwrapped, and it does not jump on every syllable.
  assert.doesNotMatch(styles, /voice-wave|voice-waves|--line-wave|voice-ribbon/);
  assert.doesNotMatch(overlay, /waveLines|--line-wave/);
  assert.doesNotMatch(styles, /\.voice-stage\[data-voicing='true'\] \.voice-ring-line/);
  assert.match(overlay, /className="voice-ring-line"/);
  assert.match(styles, /transform: scale\(calc\(1 \+ var\(--voice-level\) \* 0\.05\)\)/);

  // The state is "someone is talking right now", held past the last loud frame
  // so the halo does not blink out between two words.
  assert.match(overlay, /const VOICING_HOLD_MS = 420;/);
  assert.match(overlay, /speechThreshold\(turnRef\.current\.noiseFloor\)/);
  assert.match(overlay, /node\.dataset\.voicing = next \? 'true' : 'false'/);

  // The browser's own focus circle is replaced rather than left over the art.
  assert.match(styles, /\.voice-ring-button:focus-visible \.voice-ring-ink/);
  assert.doesNotMatch(styles, /voice-string/);
});

test("the screen owns the whole window, chrome and scrollbars included", () => {
  // The desktop shell's caption strip: the web half through a data attribute,
  // the native buttons in it through the bridge, and back to the theme after.
  assert.match(overlay, /root\.dataset\.voiceStage = 'open'/);
  assert.match(overlay, /shell\?\.setTheme\?\.\('voice'\)/);
  assert.match(
    overlay,
    /setTheme\?\.\(root\.dataset\.theme === 'dark' \? 'dark' : 'light'\)[\s\S]*?paintShell\(false\);\s*delete root\.dataset\.voiceStage;/,
  );
  assert.match(
    styles,
    /html\[data-breadboard-desktop="true"\]\[data-voice-stage="open"\]\s+\.desktop-title-bar \{\s*\n\s*background: transparent;/,
  );
  // The ground reaches all four edges rather than starting under the caption
  // strip, or the corners of the window read as a band laid over the screen.
  assert.match(styles, /\.voice-stage \{[\s\S]*?\n  inset: 0;/);
  // The strip underneath is what used to move the window, so the header row
  // takes the job on — with the chips on it still clickable.
  assert.match(
    styles,
    /html\[data-breadboard-desktop="true"\] \.voice-stage-header \{\s*\n\s*-webkit-app-region: drag;/,
  );
  assert.match(
    styles,
    /html\[data-breadboard-desktop="true"\] \.voice-chip \{\s*\n\s*-webkit-app-region: no-drag;/,
  );
  // ...and the row clears the native caption buttons Electron paints over it.
  assert.match(styles, /padding: calc\(1\.15rem \+ var\(--breadboard-titlebar-height, 0px\)\)/);

  // Scrollbars come from the app's shared material, re-pointed at this palette
  // rather than restyled with pseudo-elements of their own.
  assert.match(styles, /\.voice-stage \{[\s\S]*?--bb-scrollbar-thumb: rgb\(253 234 222/);
  assert.match(styles, /\.voice-stage \{[\s\S]*?--bb-scrollbar-track: rgb\(122 42 28/);

  // Only the words scroll: a long answer must not slide under the caption rule.
  assert.match(styles, /\.voice-caption-text \{[\s\S]*?overflow-y: auto;/);
  assert.match(overlay, /className="voice-caption-text"/);

  // Nothing labels the screen in the corner any more.
  assert.doesNotMatch(overlay, /voice-stage-title/);
  assert.doesNotMatch(styles, /voice-stage-title/);
});

test("every chat that hosts the composer can be talked to", () => {
  assert.match(terminal, /voiceMessages=\{messages\}/);
  assert.match(gardenAssistant, /voiceMessages=\{messages\}/);
  assert.match(workspace, /voiceMessages=\{messages\}/);
  assert.match(hermesPanel, /voiceMessages=\{messages\}/);
});
