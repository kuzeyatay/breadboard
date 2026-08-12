// The MoneyPrinter agent as everything around it sees it: the command a person
// types, the request that becomes, the config file the clone is handed, and the
// video paths a finished task reports back.
//
// Two of these are protocol boundaries with a project Breadboard does not own —
// the request body is checked against MoneyPrinterTurbo's own Pydantic model,
// and the config patcher against its own example file — so a change on either
// side fails here rather than silently producing a run that configures nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const cloneRoot = path.join(repositoryRoot, "MoneyPrinterTurbo");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

// Credentials are file-backed; point them somewhere disposable before anything
// imports the module, so a test run never touches the real key store.
const credentialsFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "money-printer-test-")),
  "credentials.json",
);
process.env.MONEY_PRINTER_CREDENTIALS_FILE = credentialsFile;

const {
  MONEY_PRINTER_AGENT_ID,
  MONEY_PRINTER_COMMAND,
  MONEY_PRINTER_VOICES,
  briefFromMoneyPrinterCommand,
  moneyPrinterRunLabel,
  moneyPrinterUserMessage,
  parseMoneyPrinterRequest,
  subjectFromScript,
} = await import("../src/lib/money-printer/identity.ts");
const { moneyPrinterSettingsFrom, taskRequestBody, DEFAULT_MONEY_PRINTER_SETTINGS } = await import(
  "../src/lib/money-printer/settings.ts"
);
const { patchAppTable, configuredFootageSources } = await import(
  "../src/lib/money-printer/config-file.ts"
);
const { resolveFootageSource, availableFootageSources } = await import(
  "../src/lib/money-printer/credentials.ts"
);
const { resolveTaskVideos, stageForProgress } = await import(
  "../src/lib/money-printer/run-manager.ts"
);

// ---- the command ------------------------------------------------------------

test("the command is recognised, and prose addressed to nobody is not", () => {
  assert.equal(MONEY_PRINTER_COMMAND, `/agents:${MONEY_PRINTER_AGENT_ID}`);
  assert.equal(
    briefFromMoneyPrinterCommand("/agents:money-printer why the sky is blue"),
    "why the sky is blue",
  );
  // A bare token means the palette inserted it and the person is still typing:
  // recognised, but with nothing to run yet.
  assert.equal(briefFromMoneyPrinterCommand("/agents:money-printer"), "");
  assert.equal(briefFromMoneyPrinterCommand("  /AGENTS:MONEY-PRINTER  hello  "), "hello");
  assert.equal(briefFromMoneyPrinterCommand("make me a video"), null);
  assert.equal(briefFromMoneyPrinterCommand("/agents:vimax a film"), null);
  // A different agent's token in front is not this agent's message.
  assert.equal(briefFromMoneyPrinterCommand("/skill /agents:money-printer hi"), null);

  assert.equal(moneyPrinterUserMessage(" tide pools "), `${MONEY_PRINTER_COMMAND} tide pools`);
  assert.equal(moneyPrinterUserMessage("   "), MONEY_PRINTER_COMMAND);
  assert.equal(moneyPrinterRunLabel(""), "Short video");
  assert.equal(moneyPrinterRunLabel("a".repeat(200)).length, 70);
});

// ---- the request ------------------------------------------------------------

test("flags shape the video and leave the subject clean", () => {
  const request = parseMoneyPrinterRequest(
    'why octopuses have three hearts --landscape --pixabay --clip 3 --paragraphs 2 --count 2 --no-music --no-subtitles --sequential --voice en-GB-RyanNeural-Male --language en --terms "octopus, deep sea"',
  );
  assert.equal(request.subject, "why octopuses have three hearts");
  assert.equal(request.script, "");
  assert.equal(request.aspect, "16:9");
  assert.equal(request.source, "pixabay");
  assert.equal(request.clipSeconds, 3);
  assert.equal(request.paragraphs, 2);
  assert.equal(request.videoCount, 2);
  assert.equal(request.music, false);
  assert.equal(request.subtitles, false);
  assert.equal(request.concat, "sequential");
  assert.equal(request.voice, "en-GB-RyanNeural-Male");
  assert.equal(request.language, "en");
  assert.deepEqual(request.terms, ["octopus", "deep sea"]);
});

test("a stored default fills in what the message did not say, and never beats it", () => {
  const defaults = {
    aspect: "16:9",
    source: "coverr",
    voice: "en-US-GuyNeural-Male",
    clipSeconds: 8,
    subtitles: false,
    music: false,
    paragraphs: 3,
    concat: "sequential",
    videoCount: 2,
    language: "nl",
  };
  const untouched = parseMoneyPrinterRequest("tulip season", defaults);
  assert.equal(untouched.aspect, "16:9");
  assert.equal(untouched.source, "coverr");
  assert.equal(untouched.subtitles, false);

  // Every default has an opposite flag; a preference you cannot override in one
  // message is a trap.
  const overridden = parseMoneyPrinterRequest(
    "tulip season --vertical --pexels --subtitles --music --random --clip 5",
    defaults,
  );
  assert.equal(overridden.aspect, "9:16");
  assert.equal(overridden.source, "pexels");
  assert.equal(overridden.subtitles, true);
  assert.equal(overridden.music, true);
  assert.equal(overridden.concat, "random");
  assert.equal(overridden.clipSeconds, 5);
  assert.equal(overridden.subject, "tulip season");
});

test("--script makes the message the narration and still names a subject", () => {
  const request = parseMoneyPrinterRequest(
    "--script The tide goes out twice a day. It has done so for four billion years.",
  );
  assert.equal(
    request.script,
    "The tide goes out twice a day. It has done so for four billion years.",
  );
  // The clone requires a subject even when handed a script — it is what the
  // search-term step reads alongside the narration.
  assert.equal(request.subject, "The tide goes out twice a day.");
  assert.ok(request.subject.length > 0);
  assert.equal(subjectFromScript("a".repeat(400)).length, 120);
});

test("out-of-range numbers are clamped rather than passed on", () => {
  const request = parseMoneyPrinterRequest("bees --paragraphs 99 --count 40 --clip 900");
  assert.equal(request.paragraphs, 10);
  assert.equal(request.videoCount, 5);
  assert.equal(request.clipSeconds, 30);
});

// ---- settings ---------------------------------------------------------------

test("unknown stored values fall back to the defaults instead of reaching the clone", () => {
  const settings = moneyPrinterSettingsFrom({
    aspect: "4:3",
    source: "shutterstock",
    concat: "sideways",
    voice: "",
    paragraphs: 400,
    clipSeconds: -3,
    count: 0,
  });
  assert.equal(settings.aspect, DEFAULT_MONEY_PRINTER_SETTINGS.aspect);
  assert.equal(settings.source, DEFAULT_MONEY_PRINTER_SETTINGS.source);
  assert.equal(settings.concat, DEFAULT_MONEY_PRINTER_SETTINGS.concat);
  assert.equal(settings.voice, DEFAULT_MONEY_PRINTER_SETTINGS.voice);
  assert.equal(settings.paragraphs, 10);
  assert.equal(settings.clipSeconds, 1);
  assert.equal(settings.videoCount, 1);

  // A row written before these toggles existed must read as on, not as off.
  assert.equal(moneyPrinterSettingsFrom({}).subtitles, true);
  assert.equal(moneyPrinterSettingsFrom({}).music, true);
  assert.equal(moneyPrinterSettingsFrom({ music: false }).music, false);
});

test("the settings catalog offers only voices the clone would accept", async () => {
  const { findConfigurableAgent } = await import("../src/lib/agent-settings/catalog.ts");
  const agent = findConfigurableAgent(MONEY_PRINTER_AGENT_ID);
  assert.ok(agent, "MoneyPrinter has no settings entry");
  assert.equal(agent.command, MONEY_PRINTER_COMMAND);
  const voices = agent.fields.find((field) => field.key === "voice");
  assert.deepEqual(
    voices.options.map((option) => option.value),
    MONEY_PRINTER_VOICES.map((voice) => voice.value),
  );

  // Every voice offered has to exist in the clone's own voice table, or the run
  // fails at the point where it tries to speak.
  const voiceData = path.join(cloneRoot, "app", "services", "data", "azure_voices.json");
  if (!fs.existsSync(voiceData)) return;
  const known = new Set(
    JSON.parse(fs.readFileSync(voiceData, "utf8")).map((entry) => `${entry.name}-${entry.gender}`),
  );
  for (const voice of MONEY_PRINTER_VOICES) {
    assert.ok(known.has(voice.value), `${voice.value} is not a voice the clone knows`);
  }
});

// ---- the protocol boundary --------------------------------------------------

test("every field of the request body is a field of the clone's own model", () => {
  const schema = path.join(cloneRoot, "app", "models", "schema.py");
  if (!fs.existsSync(schema)) return;
  const source = fs.readFileSync(schema, "utf8");
  const model = /class VideoParams\(BaseModel\):([\s\S]*?)\nclass /.exec(source);
  assert.ok(model, "VideoParams is no longer where it was in the clone");
  const known = new Set(
    [...model[1].matchAll(/^\s{4}([a-z_]+)\s*:/gm)].map((match) => match[1]),
  );

  const body = taskRequestBody(parseMoneyPrinterRequest("sea otters"));
  for (const key of Object.keys(body)) {
    assert.ok(known.has(key), `${key} is not a field of the clone's VideoParams`);
  }
  // FastAPI drops unknown keys silently, so the important half is that the ones
  // that carry meaning are actually there.
  for (const required of ["video_subject", "video_aspect", "voice_name", "video_source"]) {
    assert.ok(required in body, `${required} is missing from the request`);
  }
});

test("turning music off is expressed the way the clone reads it", () => {
  const off = taskRequestBody(parseMoneyPrinterRequest("kelp forests --no-music"));
  // `should_use_bgm` treats an empty type or a zero volume as no music at all;
  // sending both means neither reading can turn it back on.
  assert.equal(off.bgm_type, "");
  assert.equal(off.bgm_volume, 0);
  const on = taskRequestBody(parseMoneyPrinterRequest("kelp forests --music"));
  assert.equal(on.bgm_type, "random");
  assert.ok(on.bgm_volume > 0);
});

// ---- the config file --------------------------------------------------------

test("patching the config keeps everything the user wrote", () => {
  const original = [
    "# a comment the project ships",
    'log_level = "DEBUG"',
    "",
    "[app]",
    "# Register at https://www.pexels.com/api/",
    "pexels_api_keys = []",
    'llm_provider = "moonshot"',
    'moonshot_api_key = "the-user-key"',
    'voice_name = "zh-CN-XiaoxiaoNeural-Female"',
    "",
    "[ui]",
    "hide_log = false",
  ].join("\n");

  const patched = patchAppTable(original, {
    llm_provider: '"oneapi"',
    oneapi_base_url: '"http://127.0.0.1:8765/v1"',
    pexels_api_keys: '["abc"]',
  });

  // Replaced where they already were, so the file's own comments still describe
  // the line under them.
  assert.match(patched, /^llm_provider = "oneapi"$/m);
  assert.match(patched, /^pexels_api_keys = \["abc"\]$/m);
  // Added inside [app], not at the end of the file where [ui] would swallow it.
  assert.ok(
    patched.indexOf('oneapi_base_url = "http://127.0.0.1:8765/v1"') < patched.indexOf("[ui]"),
    "a new key landed outside the [app] table",
  );
  // Untouched: the user's own provider key, their voice, the other tables, the
  // comments.
  assert.match(patched, /^moonshot_api_key = "the-user-key"$/m);
  assert.match(patched, /^voice_name = "zh-CN-XiaoxiaoNeural-Female"$/m);
  assert.match(patched, /^# a comment the project ships$/m);
  assert.match(patched, /^hide_log = false$/m);
  assert.equal(patched.match(/^llm_provider/gm).length, 1);
});

test("a key written across several lines is replaced whole", () => {
  const original = ["[app]", "pexels_api_keys = [", '  "one",', '  "two",', "]", 'x = "y"'].join(
    "\n",
  );
  const patched = patchAppTable(original, { pexels_api_keys: '["three"]' });
  assert.match(patched, /^pexels_api_keys = \["three"\]$/m);
  assert.doesNotMatch(patched, /"one"/);
  // The orphaned closing bracket is what would have made the file unparseable.
  assert.doesNotMatch(patched, /^\]$/m);
  assert.match(patched, /^x = "y"$/m);
});

test("the clone's own example file survives a patch", () => {
  const example = path.join(cloneRoot, "config.example.toml");
  if (!fs.existsSync(example)) return;
  const source = fs.readFileSync(example, "utf8");
  const patched = patchAppTable(source, {
    llm_provider: '"oneapi"',
    oneapi_api_key: '"local"',
    ffmpeg_path: '"C:\\\\tools\\\\ffmpeg.exe"',
  });
  assert.match(patched, /^llm_provider = "oneapi"$/m);
  assert.match(patched, /^oneapi_api_key = "local"$/m);
  // The example already declares these, so they are replaced rather than added.
  assert.equal(patched.match(/^llm_provider/gm).length, 1);
  // Windows paths must not turn into escape sequences on the way in.
  assert.match(patched, /ffmpeg_path = "C:\\\\tools\\\\ffmpeg\.exe"/);
  // Nothing else moved: the file is the same length in lines, plus what was added.
  assert.ok(patched.split("\n").length >= source.split("\n").length);
});

test("a footage key the user put in the clone themselves is found", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "money-printer-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "config.toml"),
      ["[app]", "pexels_api_keys = []", 'pixabay_api_keys = ["their-key"]', ""].join("\n"),
      "utf8",
    );
    assert.deepEqual(configuredFootageSources(root), ["pixabay"]);
    assert.deepEqual(configuredFootageSources(path.join(root, "nowhere")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- the run ----------------------------------------------------------------

test("a run falls back to local footage rather than failing halfway through", () => {
  const environment = {};
  assert.deepEqual(availableFootageSources(environment), []);
  // No key anywhere: the only honest answer is local footage, reported as a
  // substitution rather than hidden.
  assert.deepEqual(resolveFootageSource("pexels", environment), {
    source: "local",
    substituted: true,
  });
  assert.deepEqual(resolveFootageSource("local", environment), {
    source: "local",
    substituted: false,
  });
  const withKey = { PIXABAY_API_KEY: "k" };
  assert.deepEqual(resolveFootageSource("pexels", withKey), {
    source: "pixabay",
    substituted: true,
  });
  assert.deepEqual(resolveFootageSource("pixabay", withKey), {
    source: "pixabay",
    substituted: false,
  });
});

test("a finished task's videos are resolved inside the clone's task directory only", () => {
  const root = path.resolve("/tmp/clone/storage/tasks");
  const expected = [path.join(root, "abc", "final-1.mp4")];
  // What the API actually returns with no endpoint configured. On Windows this
  // reads as an absolute path to `path.isAbsolute`, which is what used to throw
  // every finished video away.
  assert.deepEqual(resolveTaskVideos(["/tasks/abc/final-1.mp4"], root), expected);
  assert.deepEqual(resolveTaskVideos(["tasks/abc/final-1.mp4"], root), expected);
  // What it returns when the clone has an endpoint configured.
  assert.deepEqual(
    resolveTaskVideos(["http://127.0.0.1:8080/tasks/abc/final-1.mp4"], root),
    expected,
  );
  // A real absolute path inside the workspace is still accepted.
  assert.deepEqual(resolveTaskVideos([path.join(root, "abc", "final-1.mp4")], root), expected);
  // Anything climbing out is a path the run had no business producing.
  assert.deepEqual(resolveTaskVideos(["/tasks/../../../etc/passwd"], root), []);
  assert.deepEqual(resolveTaskVideos([path.resolve("/elsewhere/x.mp4")], root), []);
  assert.deepEqual(resolveTaskVideos("not a list", root), []);
  assert.deepEqual(resolveTaskVideos([""], root), []);
});

test("the progress the clone reports becomes a stage a person can read", () => {
  assert.equal(stageForProgress(0), "Writing the script");
  assert.equal(stageForProgress(5), "Writing the script");
  assert.equal(stageForProgress(10), "Choosing what footage to search for");
  assert.equal(stageForProgress(20), "Recording the voiceover");
  assert.equal(stageForProgress(30), "Timing the subtitles");
  assert.equal(stageForProgress(40), "Finding and downloading footage");
  assert.equal(stageForProgress(75), "Cutting the video");
  assert.equal(stageForProgress(100), "Cutting the video");
});

test("the card lists the same stages the run manager narrates", () => {
  const manager = read("src/lib/money-printer/run-manager.ts");
  const card = read("src/app/components/hermes/inline-money-printer-run.tsx");
  const stagesOf = (source) => {
    const table = /const STAGES[^=]*=\s*\[([\s\S]*?)\n\]/.exec(source);
    assert.ok(table, "no STAGES table");
    return [...table[1].matchAll(/at:\s*(\d+),\s*label:\s*"([^"]+)"/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
  };
  // The card decides which rows are already behind the run from these numbers,
  // so a table that drifts shows the wrong stage as finished.
  assert.deepEqual(stagesOf(card), stagesOf(manager));
});

test("stopping the last run stops the work rather than only looking away", () => {
  const manager = read("src/lib/money-printer/run-manager.ts");
  // The clone cannot cancel a task in flight, so the abort path has to reach the
  // service itself; a card that only stopped polling would leave ffmpeg running.
  assert.match(manager, /export function abortRun/);
  assert.match(manager, /stopService\(\)/);
});
