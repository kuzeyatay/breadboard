import test from "node:test";
import assert from "node:assert/strict";
import {authorizeTerminalCommand, runAuthorizedTerminalCommand} from "../src/lib/hermes/terminal-execution.ts";
import {validateTerminalCommandRequest} from "../scripts/runtime-v2-terminal-command-worker.mjs";

test("terminal authorization and worker agree on the UTF-8 command bound", () => {
  const command = "Write-Output '" + "界".repeat(700) + "'";
  assert.ok(command.length < 2000 && Buffer.byteLength(command) > 2000);
  const authorization = authorizeTerminalCommand(command, {approvedCommand: command});
  assert.equal(authorization.allowed, false);
  assert.match(authorization.reason, /Save the script.*invoke its file/);
  assert.throws(() => validateTerminalCommandRequest({command, workspaceRoot: process.cwd(), maxRuntimeMs: 1000}), /invalid/);
});

test("resource denial carries measured headroom and never retries a possibly started command", async () => {
  for (const started of [false, true]) {
    let submissions = 0;
    const command = "pwd";
    const authority = {userId: 1, gardenId: null, conversationId: "conv_resource_test"};
    const result = await runAuthorizedTerminalCommand(command, {
      runtimeSessionId: started ? 9902 : 9901,
      runtimeAuthority: authority,
      runtimeControl: {async submit() {
        submissions++;
        return {jobId: `resource-${started}`, jobType: "terminal-command", workerKind: "terminal-command-node", resourceClass: "document-processing", state: "resource_exhausted", ...authority,
          startedAt: started ? Date.now() : null, resourceExhaustion: {resource: "windows_commit", retryable: false, requiredHeadroomMb: 4608, availableHeadroomMb: 4200}};
      }},
    });
    assert.equal(submissions, 1);
    assert.equal(result.exitCode, -1);
    assert.deepEqual(result.resourceFailure, {retryable: false, executionStarted: started, requiredHeadroomMb: 4608, availableHeadroomMb: 4200});
    assert.match(result.stderr, /Do not repeat commands while memory is unchanged/);
    assert.match(result.stderr, started ? /stopped the Terminal/ : /prevented.*starting/);
  }
});
