import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { prepareTurn, mergeSelectedTools } from '../src/lib/hermes/dispatch-core.ts';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-signed-in-routing-'));
process.env.HERMES_FIRST_PARTY_SKILLS_ROOT = path.join(workspace, 'skills');
process.env.HERMES_SKILLS_APPROVED = path.join(workspace, 'approved');
process.env.HERMES_SKILLS_CONDITIONAL = path.join(workspace, 'conditional');
fs.cpSync(new URL('../../hermes-skills/prebuilt/breadboard-use', import.meta.url),
  path.join(process.env.HERMES_FIRST_PARTY_SKILLS_ROOT, 'breadboard-use'), { recursive: true });
const mocks = {
  'server-only': 'export {};',
  './mcp-connections.ts': 'export const listMcpConnections = () => [];',
  './agency-agents.ts': "export const CHIEF_OF_STAFF_SLUG = 'chief-of-staff'; export const loadAgencyAgentsCatalog = () => ({status:'unavailable'});",
  '../workflows/store.ts': 'export const listWorkflows = () => [];',
};
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/hermes/super-agent.ts') && mocks[specifier]) {
    return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { loadSuperAgentInventory, renderSuperAgentDirective } = await import('../src/lib/hermes/super-agent.ts');
hooks.deregister();

for (const surface of ['dashboard_terminal', 'garden_chat']) {
  test(`Super Agent can use signed-in browser accounts without connectors on ${surface}`, async () => {
    const request = 'can you use my whatsapp to send messages in my name';
    const inventory = await loadSuperAgentInventory({ userId: 7, surface, request });
    assert.equal(inventory.connections.length, 0);
    assert.ok(inventory.skillSlugs.includes('breadboard-use'));
    const directive = renderSuperAgentDirective(inventory);
    assert.match(directive, /Start with action `state`.*fresh `snapshot`/);
    assert.match(directive, /own-thread-only restriction does not prohibit sending to another person/);
    assert.match(directive, /If the recipient or message is unspecified.*missing details/);
    assert.doesNotMatch(directive, /never part of an opening plan/);
    const prepared = prepareTurn({ request, surface, userId: 7, grants: [], workspaceRoot: workspace, superAgent: true });
    assert.equal(prepared.blocked, false);
    assert.equal(prepared.grant.allowedTools.breadboard_use, true);
    assert.ok(prepared.decision.allowedTools.includes('breadboard_use'));
    assert.equal(mergeSelectedTools(prepared.grant.allowedTools, { breadboard_use: true }).breadboard_use, true);
  });
}

test.after(() => {
  assert.equal(path.dirname(path.resolve(workspace)), path.resolve(os.tmpdir()));
  fs.rmSync(workspace, { recursive: true, force: true });
});
