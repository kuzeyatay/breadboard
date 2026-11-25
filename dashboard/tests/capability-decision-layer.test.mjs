import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { isChatNotificationRecord } from '../src/lib/chat-notification-inbox.ts';
import { approvalNotificationId, dismissApprovalNotifications, listPendingApprovalNotifications,
  recordApprovalNotification, resolveApprovalNotification } from '../src/lib/chat-notifications/approvals.ts';
import { decideEscalation, escalationLabel, widenedDecision } from '../src/lib/hermes/capability-escalation.ts';
import { agentLaunchRepeats, recordAgentLaunchRequest, resetAgentLaunchRequests } from '../src/lib/hermes/agent-launch-store.ts';

// ── The decision layer ───────────────────────────────────────────────────

const SURFACE_TOOLS = ['agent_launch', 'skill_open', 'watch_run', 'terminal_execute_command', 'browser_terminal'];
const NO_DECISION_TOOLS = { allowedTools: ['web_search'], selectedConditionalSkills: [] };

function decide(overrides = {}) {
  return decideEscalation({
    surface: 'dashboard_terminal',
    tool: 'agent_launch',
    args: { agent: 'max-research' },
    surfaceTools: SURFACE_TOOLS,
    dispatch: { teamApproval: false, interactive: true },
    decision: NO_DECISION_TOOLS,
    openableSkillSlugs: ['diagram-design'],
    notifiable: true,
    ...overrides,
  });
}

test('"can you launch a swarm?": the swarm launcher is requested, not disabled', () => {
  const verdict = decide({ args: { team_action: 'start' } });
  assert.equal(verdict.status, 'grantable');
  assert.match(verdict.prompt, /launch a team of agents/);
});

test('a tool the turn already allows passes straight through', () => {
  assert.deepEqual(decide({ decision: { allowedTools: ['agent_launch'], selectedConditionalSkills: [] } }), { status: 'granted' });
});

test('a skill-gated tool needs its skill too, and gets it on grant', () => {
  const missingSkill = decide({ tool: 'watch_run', args: {}, decision: { allowedTools: ['watch_run'], selectedConditionalSkills: [] } });
  assert.equal(missingSkill.status, 'grantable');
  const stored = { id: 9, runtimeSessionId: 3, mode: 'knowledge', requestedOutcome: 'x', implementationRequired: false,
    decisionReason: 'plan', decisionSource: 'breadboard_server_policy_v1', authorizedRoots: [], authorizedPathPatterns: [],
    allowedTools: ['web_search'], allowedOperations: [], allowedCommandPatterns: [], selectedConditionalSkills: [],
    selectedConnections: [], createdAt: '2026-01-01T00:00:00Z', expiresAt: null, revokedAt: null };
  const widened = widenedDecision(stored, 'watch_run', 'watch');
  assert.ok(widened.allowedTools.includes('watch_run'));
  assert.ok(widened.selectedConditionalSkills.includes('watch'));
  assert.equal('id' in widened, false);
  // Filesystem and command authority are untouched.
  assert.deepEqual(widened.authorizedRoots, []);
  assert.deepEqual(widened.allowedOperations, []);
});

test('skill_open only for a skill the user actually has', () => {
  assert.equal(decide({ tool: 'skill_open', args: { slug: 'diagram-design' } }).status, 'grantable');
  assert.equal(decide({ tool: 'skill_open', args: { slug: 'not-installed' } }).status, 'denied');
});

test('never widened: terminal and browser-terminal authority, Quartz, team workers, unknown tools', () => {
  assert.equal(decide({ tool: 'terminal_execute_command', args: {} }).status, 'denied');
  assert.equal(decide({ tool: 'browser_terminal', args: {} }).status, 'denied');
  assert.equal(decide({ surface: 'quartz_ai' }).status, 'denied');
  assert.equal(decide({ dispatch: { swarmWorker: { runId: 'r', taskKey: 't' } } }).status, 'denied');
  assert.equal(decide({ tool: 'not_a_surface_tool' }).status, 'denied');
});

test('a headless turn asks through a notification, unless its chat cannot notify', () => {
  assert.equal(decide({ dispatch: { interactive: false } }).status, 'grantable');
  assert.equal(decide({ dispatch: { interactive: false }, notifiable: false }).status, 'denied');
  // YOLO answers its own card, so even an un-notifiable headless turn proceeds.
  assert.equal(decide({ dispatch: { interactive: false, teamApproval: true }, notifiable: false }).status, 'grantable');
});

test('the card names the actual action', () => {
  assert.equal(escalationLabel('agent_launch', { agent: 'max-research' }), 'start the max-research agent');
  assert.equal(escalationLabel('skill_open', { slug: 'premortem' }), 'open the premortem skill');
  assert.equal(escalationLabel('some_tool', {}), 'use some tool');
});

// ── No fixed launch cap: repeats are the loop signal ─────────────────────

test('many distinct launches are fine; the same brief twice is a loop', t => {
  resetAgentLaunchRequests();
  t.after(resetAgentLaunchRequests);
  for (let index = 0; index < 12; index += 1) {
    assert.ok(recordAgentLaunchRequest({ runId: 'run', agentId: 'max-research', agentName: 'Max Research',
      command: '/max', brief: `Job ${index}`, reason: 'r', awaitResult: true }), `launch ${index} accepted`);
  }
  assert.equal(agentLaunchRepeats('run', 'max-research', '  job   3 '), true);
  assert.equal(agentLaunchRepeats('run', 'max-research', 'Job 99'), false);
  assert.equal(agentLaunchRepeats('run', 'claude-code', 'Job 3'), false);
});

// ── Approvals answerable from notifications ───────────────────────────────

function database(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES(1),(2);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT);
    INSERT INTO clusters VALUES(1,'signals');
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT, surface TEXT,
      default_garden_id INTEGER, legacy_chat_session_id INTEGER, temporary INTEGER DEFAULT 0, buzz_room_id INTEGER, origin_label TEXT);
    INSERT INTO conversations(id,public_id,user_id,title,surface,default_garden_id,legacy_chat_session_id,temporary) VALUES
      (1,'conv_main',1,'Nightly report','dashboard_terminal',NULL,NULL,0),
      (2,'conv_other',2,'Other account','dashboard_terminal',NULL,NULL,0),
      (3,'conv_temp',1,'Off the record','dashboard_terminal',NULL,NULL,1);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY, user_id INTEGER, conversation_id INTEGER);
    INSERT INTO hermes_runtime_sessions VALUES(1,1,1),(2,2,2),(3,1,3);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER, status TEXT, dispatch_json TEXT, started_at TEXT, heartbeat_at TEXT);
  `);
  for (const id of [1, 2, 3]) db.prepare('INSERT INTO hermes_runs VALUES(?,?,?,?,?,?)')
    .run(`run${id}`, id, 'active', '{}', new Date().toISOString(), new Date().toISOString());
  return db;
}

function ask(db, session = 1, requestId = 'perm1') {
  recordApprovalNotification(db, { runtimeSessionId: session, runId: `run${session}`, requestId,
    description: 'Bread wants to start the max-research agent. Allow it for this turn?', allowSession: true });
}

test('an approval card becomes an answerable notification for its owner only', t => {
  const db = database(t);
  ask(db);
  const [notice] = listPendingApprovalNotifications(db, 1);
  assert.equal(notice.kind, 'chat_approval');
  assert.equal(notice.title, 'Approval needed');
  assert.deepEqual(notice.approval, { sessionId: 1, requestId: 'perm1',
    description: 'Bread wants to start the max-research agent. Allow it for this turn?', allowSession: true });
  assert.ok(isChatNotificationRecord(notice), 'the inbox accepts the record');
  assert.deepEqual(listPendingApprovalNotifications(db, 2), []);
});

test('answering, dismissing or the run ending removes it; replays do not revive it', t => {
  const db = database(t);
  ask(db);
  resolveApprovalNotification(db, 1, 'perm1');
  ask(db); // replayed event
  assert.deepEqual(listPendingApprovalNotifications(db, 1), []);
  ask(db, 1, 'perm2');
  const id = approvalNotificationId(listPendingApprovalNotifications(db, 1)[0].id);
  assert.equal(dismissApprovalNotifications(db, 2, [id]), 0, 'another account cannot dismiss it');
  assert.equal(dismissApprovalNotifications(db, 1, [id]), 1);
  assert.deepEqual(listPendingApprovalNotifications(db, 1), []);
  ask(db, 1, 'perm3');
  db.exec("UPDATE hermes_runs SET status='completed' WHERE id='run1'");
  assert.deepEqual(listPendingApprovalNotifications(db, 1), []);
});

test('a temporary chat gets no approval notification', t => {
  const db = database(t);
  ask(db, 3);
  assert.deepEqual(listPendingApprovalNotifications(db, 1), []);
});

test('a terminal command card carries its exact command', t => {
  const db = database(t);
  recordApprovalNotification(db, { runtimeSessionId: 1, runId: 'run1', requestId: 'cmd', description: 'Run a command',
    command: 'git clone https://example.com/repo', allowSession: false });
  const [notice] = listPendingApprovalNotifications(db, 1);
  assert.equal(notice.approval.command, 'git clone https://example.com/repo');
  assert.equal(notice.approval.allowSession, false);
  assert.match(notice.response, /git clone/);
});
