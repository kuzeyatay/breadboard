import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publishModuleUrl = pathToFileURL(
  path.join(dashboardRoot, "src", "lib", "quartz-publish.ts"),
).href;

function runPublisher(scriptPath, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", scriptPath],
      {
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`publisher exited ${code}: ${stderr || stdout}`));
    });
  });
}

test(
  "Quartz publication is serialized across independent Node processes",
  { timeout: 20_000 },
  async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "breadboard-quartz-lock-test-"),
    );
    try {
      const quartzRoot = path.join(temporaryRoot, "quartz-root");
      const quartzCliDir = path.join(quartzRoot, "quartz");
      const contentDir = path.join(quartzRoot, "content");
      const buildLog = path.join(temporaryRoot, "builds.jsonl");
      fs.mkdirSync(quartzCliDir, { recursive: true });
      fs.mkdirSync(contentDir, { recursive: true });
      fs.writeFileSync(
        path.join(quartzRoot, "package.json"),
        '{"private":true,"type":"module"}\n',
        "utf8",
      );
      fs.writeFileSync(
        path.join(quartzCliDir, "bootstrap-cli.mjs"),
        [
          'import fs from "node:fs";',
          "const record = (event) => fs.appendFileSync(process.env.QUARTZ_LOCK_TEST_LOG, JSON.stringify({ event, pid: process.pid, time: Date.now() }) + '\\n');",
          'record("start");',
          "await new Promise((resolve) => setTimeout(resolve, 180));",
          'record("end");',
        ].join("\n"),
        "utf8",
      );

      const publisherScript = path.join(temporaryRoot, "publish.mjs");
      fs.writeFileSync(
        publisherScript,
        [
          `import { publishQuartzAfterMutation } from ${JSON.stringify(publishModuleUrl)};`,
          'await publishQuartzAfterMutation(`lock-test-${process.pid}`, { requireSuccess: true });',
        ].join("\n"),
        "utf8",
      );

      const environment = {
        ...process.env,
        NODE_ENV: "production",
        QUARTZ_AUTO_PUBLISH: "1",
        QUARTZ_CONTENT_PATH: contentDir,
        QUARTZ_BUILD_TIMEOUT_MS: "10000",
        QUARTZ_PUBLISH_LOCK_TIMEOUT_MS: "10000",
        QUARTZ_PUBLISH_LOCK_STALE_MS: "1000",
        QUARTZ_PUBLISH_LOCK_POLL_MS: "10",
        QUARTZ_LOCK_TEST_LOG: buildLog,
      };

      await Promise.all([
        runPublisher(publisherScript, environment),
        runPublisher(publisherScript, environment),
      ]);

      const records = fs
        .readFileSync(buildLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.equal(records.length, 4);
      let activeBuilds = 0;
      let maximumActiveBuilds = 0;
      for (const record of records) {
        activeBuilds += record.event === "start" ? 1 : -1;
        maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
        assert.ok(activeBuilds >= 0);
      }
      assert.equal(activeBuilds, 0);
      assert.equal(maximumActiveBuilds, 1);
      assert.equal(
        fs.existsSync(path.join(quartzRoot, ".breadboard-quartz-publish.lock")),
        false,
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);
