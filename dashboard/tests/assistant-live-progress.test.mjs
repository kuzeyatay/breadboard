import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activityLabelForTool } from '../src/lib/hermes/evidence.ts';

test('live progress shows waiting states immediately and restores image status with real usage', async () => {
  assert.equal(activityLabelForTool('attachment_image'), 'Reading image');
  const bundle = await build({ entryPoints: ['src/app/components/hermes/activity-panel.tsx'],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const ActivityPanel = module.exports.default;
  const render = props => renderToStaticMarkup(React.createElement(ActivityPanel, {
    activities: [], connection: 'streaming', pendingPermission: null, onPermissionDecision: () => {}, ...props,
  }));
  const permission = render({ pendingPermission: { requestId: 'p', title: 'Run a command', description: 'Command', affectedPaths: [], allowSession: false }, stateLabel: 'Delegating' });
  assert.match(permission, /Waiting for permission/);
  const clarify = render({ pendingClarification: { requestId: 'q', question: 'What is the exponent?', choices: [] } });
  assert.match(clarify, /Waiting for your answer/);
  const restored = render({ restoredActivityLabel: 'Reading image', responseStartedAt: new Date(Date.now() - 10000).toISOString(),
    usage: { inputTokens: 12000, outputTokens: 150, totalTokens: 12150 } });
  assert.match(restored, /Reading image/);
  assert.doesNotMatch(restored, /counting tokens|usage pending/);
  assert.match(render({}), /usage pending/);
});
