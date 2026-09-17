import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import Database from 'better-sqlite3';
import { notificationTimestamp, readLatestNotifications } from '../src/lib/chat-notifications/read.ts';
import { ensureChatNotificationSchema, dismissChatNotifications } from '../src/lib/chat-notifications/store.ts';
import { ensureLearnNotificationSchema, dismissLearnNotifications } from '../src/lib/chat-notifications/learn.ts';
import { issueCapabilityToken } from '../src/lib/hermes/capability-token.ts';
import { allowedToolsForSurface } from '../src/lib/hermes/tool-scopes.ts';
import { brokerCapabilities } from '../src/lib/hermes/capability-broker.ts';
import { planTask } from '../src/lib/hermes/task-plan.ts';
import { composeHermesSystemPrompt } from '../src/lib/hermes/system-prompts.ts';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES(1),(2);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, slug TEXT);
    INSERT INTO clusters VALUES(1,1,'Signals','signals'),(2,2,'Private Garden','private');
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT, surface TEXT,
      default_garden_id INTEGER, legacy_chat_session_id INTEGER, temporary INTEGER DEFAULT 0, buzz_room_id INTEGER, origin_label TEXT);
    INSERT INTO conversations(id,public_id,user_id,title,surface,origin_label) VALUES
      (1,'conv_main',1,'Research','dashboard_terminal',NULL),(2,'conv_other',2,'Other account','dashboard_terminal',NULL),
      (3,'conv_voice',1,'Voice','dashboard_terminal','Voice');
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT,
      role TEXT DEFAULT 'assistant', content TEXT, status TEXT DEFAULT 'complete', metadata TEXT, updated_at TEXT);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY, user_id INTEGER, conversation_id INTEGER);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER, status TEXT, dispatch_json TEXT, started_at TEXT, heartbeat_at TEXT);
    CREATE TABLE learn_jobs(id TEXT PRIMARY KEY, garden_id TEXT, status TEXT, current_step TEXT, progress_percent INTEGER DEFAULT 0,
      current_section_title TEXT, current_page_title TEXT, error TEXT, paused_from_status TEXT, updated_at TEXT);
  `);
  ensureChatNotificationSchema(db); ensureLearnNotificationSchema(db);
  db.exec(`
    INSERT INTO chat_notification_baselines(user_id,updated_at,message_id) VALUES(1,'2026-01-01 00:00:00',0),(2,'2026-01-01 00:00:00',0);
    INSERT INTO learn_notification_baselines(user_id,baseline_at) VALUES(1,'2026-01-01T00:00:00Z'),(2,'2026-01-01T00:00:00Z');
    INSERT INTO conversation_messages(id,conversation_id,content,updated_at) VALUES
      (1,1,'The research is ready.','2026-09-07 09:10:00'),(2,1,'Latest answer.','2026-09-07 09:30:00'),
      (3,2,'Never return the other account.','2026-09-07 10:00:00'),(4,3,'Never repeat the spoken answer.','2026-09-07 11:00:00');
    INSERT INTO learn_jobs(id,garden_id,status,updated_at) VALUES
      ('learn1','signals','complete','2026-09-07T09:20:00.000Z'),('other','private','complete','2026-09-07T12:00:00.000Z');
  `);
  return db;
}

test('latest notifications merge the live inbox newest first, stay account scoped, and never dismiss on read', () => {
  const db = database();
  try {
    const result = readLatestNotifications(db, 1, 2);
    assert.equal(result.scope, 'undismissed');
    assert.equal(result.availableCount, 3); assert.equal(result.hasMore, true);
    assert.deepEqual(result.notifications.map(notice => notice.id), ['msg_2', 'learn_learn1:complete']);
    assert.equal(result.notifications[1].source, 'Signals');
    assert.equal(result.notifications[1].kind, 'learn');
    assert.equal(readLatestNotifications(db, 1).notifications.length, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM chat_notification_dismissals').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM learn_notification_dismissals').get().n, 0);
    db.prepare("UPDATE conversation_messages SET content=?,updated_at='2026-09-07 09:40:00' WHERE id=1").run('x'.repeat(7000));
    const latest = readLatestNotifications(db, 1, 1).notifications[0];
    assert.equal(latest.id, 'msg_1'); assert.equal(latest.content.length, 6000); assert.equal(latest.contentTruncated, true);
    dismissChatNotifications(db, 1, [1, 2]);
    dismissLearnNotifications(db, 1, [{ jobId: 'learn1', phase: 'complete' }]);
    assert.deepEqual(readLatestNotifications(db, 1).notifications, []);
    assert.equal(readLatestNotifications(db, 2).notifications.length, 2);
    for (const limit of [0, 11, -1, 1.5, '2', NaN]) assert.throws(() => readLatestNotifications(db, 1, limit), RangeError);
    assert.equal(notificationTimestamp('2026-09-07 09:10:00'), Date.parse('2026-09-07T09:10:00Z'));
    assert.equal(notificationTimestamp('2026-09-07T11:10:00+02:00'), notificationTimestamp('2026-09-07 09:10:00'));
  } finally { db.close(); }
});

test('the voice/Terminal tool and its spoken guidance are granted without automatic read-aloud settings', () => {
  for (const surface of ['dashboard_terminal', 'garden_chat', 'quartz_ai']) {
    const isolated = surface === 'quartz_ai';
    const plan = planTask({ request: 'Read my latest notifs', authenticated: !isolated, isolated });
    const grant = brokerCapabilities({ plan, surface, userId: isolated ? null : 1, grants: [], workspaceRoot: '/runtime/voice', isolated });
    assert.equal(grant.allowedTools.notifications_read, surface === 'dashboard_terminal');
    assert.equal(allowedToolsForSurface(surface).includes('notifications_read'), surface === 'dashboard_terminal');
  }
  const prompt = composeHermesSystemPrompt({ surface: 'dashboard_terminal', userText: 'Read my latest notification', decision: {
    mode: 'knowledge', requestedOutcome: 'Read notifications', implementationRequired: false,
    decisionReason: 'Knowledge task', decisionSource: 'breadboard_server_policy_v1', authorizedRoots: [],
    authorizedPathPatterns: [], allowedTools: ['notifications_read'], allowedOperations: ['knowledge_work'],
    allowedCommandPatterns: [], selectedConditionalSkills: [], selectedConnections: [], createdAt: '2026-09-07T00:00:00Z',
    expiresAt: null, revokedAt: null,
  } });
  assert.match(prompt, /call `notifications_read`/);
  assert.match(prompt, /automatic notification read-aloud is off/);
  assert.match(prompt, /limit=1/);
  assert.match(prompt, /does not dismiss/);
  assert.match(prompt, /no pending Breadboard notifications/);
});

test('the real notifications route enforces session ownership and active grants before reading SQLite', async () => {
  const state = globalThis.__notificationsToolTest = { db: database(), token: null,
    session: { id: 33, user_id: 1, surface: 'dashboard_terminal', conversation_id: 44 },
    conversation: { id: 44, user_id: 1, origin_label: 'Voice' }, run: { id: 'run' },
    decision: { allowedTools: ['notifications_read'] },
  };
  const stubs = {
    '@/lib/db.ts': 'export default globalThis.__notificationsToolTest.db;',
    '@/lib/hermes/tool-service-auth.ts': 'export const capabilityForInternalToolRequest = () => globalThis.__notificationsToolTest.token;',
    '@/lib/hermes/runtime-store.ts': 'export const getRuntimeSessionById = id => id === 33 ? globalThis.__notificationsToolTest.session : null; export const runtimeExternalSessionId = () => "voice-runtime"; export const getActiveCapabilityDecision = () => globalThis.__notificationsToolTest.decision;',
    '@/lib/hermes/run-store.ts': 'export const getActiveRuntimeRun = () => globalThis.__notificationsToolTest.run;',
    '@/lib/conversations/store.ts': 'export const getConversationById = () => globalThis.__notificationsToolTest.conversation;',
    '@/lib/hermes/route-helpers.ts': `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; } }
      export const requireEnabled = () => {}; export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message }, { status: error.status || 500 });`,
  };
  const bundle = await build({ entryPoints: ['src/app/api/hermes/tools/notifications/route.ts'], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'authority', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: 'authority' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'authority' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const call = (args = {}) => module.exports.POST(new Request('http://localhost/api/hermes/tools/notifications', {
    method: 'POST', body: JSON.stringify({ action: 'notifications_read', args }),
  }));
  const token = overrides => issueCapabilityToken({ userId: 1, conversationId: 44, breadboardSessionId: '33',
    hermesSessionId: 'voice-runtime', surface: 'dashboard_terminal', allowedTools: ['notifications_read'], ...overrides });
  try {
    assert.equal((await call()).status, 403);
    for (const override of [{ userId: 2 }, { conversationId: 45 }, { surface: 'quartz_ai' }, { hermesSessionId: 'wrong' }, { allowedTools: [] }]) {
      state.token = token(override); assert.equal((await call()).status, 403);
    }
    state.token = token();
    state.conversation.user_id = 2; assert.equal((await call()).status, 403); state.conversation.user_id = 1;
    state.decision.allowedTools = []; assert.equal((await call()).status, 403); state.decision.allowedTools = ['notifications_read'];
    state.run = null; assert.equal((await call()).status, 409); state.run = { id: 'run' };
    for (const limit of [0, 11, '2', 1.5]) assert.equal((await call({ limit })).status, 400);
    const response = await call({ limit: 1, userId: 2, dismiss: true });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.notifications.map(notice => notice.id), ['msg_2']);
    assert.equal((await (await call()).json()).data.notifications.length, 3);
    assert.equal(state.db.prepare('SELECT count(*) AS n FROM chat_notification_dismissals').get().n, 0);
  } finally { state.db.close(); delete globalThis.__notificationsToolTest; }
});
