import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { BotsStore, validateBotInput } from "../src/lib/bots/store.ts";
import { BOT_SHAPES, botPersonalityPrompt, conversationPersonalityPrompt } from "../src/lib/bots/types.ts";
import { composeSoul, duplicateBotName } from "../src/vendor/hermes-bots/identity.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

const custom = { name: "Luna", description: "Curious astronomy companion", personality: "Speak warmly, with short astronomy analogies.", avatar: { shape: "star", color: "#eab543", face: "mouth" } };
function fixture(t) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1),(2); CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER REFERENCES users(id), title TEXT);");
  const store = new BotsStore(db);
  let next = 0;
  const create = (userId = 1) => name => {
    const public_id = `conv_bot_test_${++next}`;
    const result = db.prepare("INSERT INTO conversations(public_id,user_id,title) VALUES (?,?,?)").run(public_id,userId,name);
    return { id: Number(result.lastInsertRowid), public_id };
  };
  t.after(() => db.close());
  return { db, store, create };
}

test("prebuilt bots seed once per user and preserve edits and removals", t => {
  const { store } = fixture(t);
  const originals = store.list(1);
  assert.equal(originals.length, 6);
  assert.equal(store.list(1).length, 6);
  const edited = store.save(1, { ...originals[0], name: "My teacher" }, originals[0].id);
  assert.equal(edited.prebuilt, true);
  assert.equal(store.list(1).find(bot => bot.id === edited.id).name, "My teacher");
  store.archive(1, originals[1].id);
  assert.equal(store.list(1).length, 5);
  assert.equal(store.list(2).length, 6);
  assert.equal(store.get(2, originals[0].id).name, originals[0].name);
});

test("create, edit, reopen, and remove retain the bot's dedicated conversation", t => {
  const { db, store, create } = fixture(t);
  const bot = store.save(1, { ...custom, name: "  Luna  " });
  assert.equal(bot.name, "Luna");
  const chat = store.chat(1, bot.id, create());
  const reopened = new BotsStore(db);
  assert.deepEqual(reopened.get(1, bot.id), bot);
  assert.equal(reopened.chat(1, bot.id, () => { throw Error("must reuse chat"); }), chat);
  const edited = reopened.save(1, { ...custom, name: "Luna II", avatar: { shape: "cat", color: "#ff00aa", face: "eyes" } }, bot.id);
  assert.deepEqual(reopened.forConversation(1, chat), edited);
  const other = reopened.save(1, { ...custom, name: "Other bot" });
  assert.notEqual(reopened.chat(1, other.id, create()), chat);
  reopened.archive(1, bot.id);
  assert.equal(reopened.forConversation(1, chat).archived, true);
  assert.match(botPersonalityPrompt(reopened.forConversation(1, chat)), /Luna II/);
  assert.equal(db.prepare("SELECT count(*) n FROM conversations").get().n, 2);
  assert.throws(() => reopened.get(1, bot.id), { status: 404 });
});

test("bot and chat reads and mutations are isolated by account", t => {
  const { store, create } = fixture(t);
  const bot = store.save(1, custom);
  const chat = store.chat(1, bot.id, create());
  assert.equal(store.forConversation(2, chat), null);
  for (const action of [() => store.get(2, bot.id), () => store.save(2, custom, bot.id), () => store.archive(2, bot.id), () => store.chat(2, bot.id, () => { throw Error("must not create"); })]) {
    assert.throws(action, { status: 404 });
  }
  const bob = store.save(2, custom);
  assert.throws(() => store.chat(2, bob.id, create(1)), { status: 403 });
});

test("deleting a saved conversation permits a fresh chat without changing the bot", t => {
  const { db, store, create } = fixture(t);
  const bot = store.save(1, custom);
  const chat = store.chat(1, bot.id, create());
  db.prepare("DELETE FROM conversations WHERE public_id=?").run(chat);
  assert.notEqual(store.chat(1, bot.id, create()), chat);
  assert.deepEqual(store.get(1, bot.id), bot);
});

test("validation rejects malformed data, empty update ids and a full roster", t => {
  const { store } = fixture(t);
  for (const value of [null, [], {}, { ...custom, name: " " }, { ...custom, name: "a".repeat(61) }, { ...custom, personality: "a".repeat(6001) }, { ...custom, avatar: { ...custom.avatar, shape: "unknown" } }, { ...custom, avatar: { ...custom.avatar, color: "url(https://example.test)" } }]) {
    assert.throws(() => validateBotInput(value), { status: 400 });
  }
  assert.throws(() => store.save(1, custom, ""), { status: 404 });
  for (let i = 0; i < 94; i++) store.save(1, custom);
  assert.equal(store.list(1).length, 100);
  assert.throws(() => store.save(1, custom), { status: 400 });
  for (const shape of BOT_SHAPES) assert.equal(validateBotInput({ ...custom, avatar: { ...custom.avatar, shape } }).avatar.shape, shape);
});

test("Hermes identity helpers preserve custom personality and create unique copy names", () => {
  assert.equal(composeSoul({ name: "Luna", customSoul: "  Curious and kind  " }), "Curious and kind");
  assert.match(composeSoul({ name: "Luna", description: "Study astronomy" }), /Luna/);
  assert.equal(duplicateBotName("Luna", ["Luna", "luna-2"]), "Luna-3");
  assert.equal(duplicateBotName("x".repeat(60), []).length, 60);
});

test("the Hermes system prompt includes the saved identity and leaves ordinary chats unchanged", t => {
  const { store, create } = fixture(t);
  const bot = store.save(1, custom);
  const chat = store.chat(1, bot.id, create());
  const persona = botPersonalityPrompt(store.forConversation(1, chat));
  const prompt = composeHermesSystemPrompt({ surface: "dashboard_terminal", decision: { mode: "knowledge", allowedTools: [], authorizedRoots: [], authorizedPathPatterns: [], allowedOperations: [], allowedCommandPatterns: [] }, persona });
  assert.match(prompt, /For this conversation your name is "Luna"/);
  assert.match(prompt, /Speak warmly, with short astronomy analogies/);
  assert.match(prompt, /does not change tool availability, permissions/);
  assert.equal(botPersonalityPrompt(null), "");
});

test("a full personality survives the runtime budget alongside a long specialist persona", t => {
  const {store} = fixture(t);
  const personality = '"\n'.repeat(2990) + "END OF PERSONALITY";
  const bot = store.save(1,{...custom,personality});
  const prompt = conversationPersonalityPrompt(bot,"Specialist instructions ".repeat(1500));
  assert.ok(prompt.length<=8000);
  assert.ok(prompt.includes(personality));
  assert.ok(prompt.includes('your name is "Luna"'));
  assert.equal(conversationPersonalityPrompt(null,"Original specialist"),"Original specialist");
});
