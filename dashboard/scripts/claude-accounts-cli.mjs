/** PowerShell entry point for the official Claude CLI and its local account pool. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  addProfile, claudeRoot, preferProfile, profileDir, profileRows,
  profileStore, rememberProfile, restProfile, sessionTranscript,
} from "./claude-profiles.mjs";

const script = fileURLToPath(import.meta.url);
const root = claudeRoot();
const executable = process.env.CLAUDE_CLI_PATH || (process.platform === "win32" ? "claude.exe" : "claude");

function environment(id) {
  return id === "default" ? process.env : { ...process.env, CLAUDE_CONFIG_DIR: profileDir(root, id) };
}

function invoke(id, args, capture = false) {
  const env = { ...environment(id) };
  if (args[0] === "auth" && (capture || args.includes("--claudeai"))) {
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[key];
  }
  const result = spawnSync(executable, args, {
    env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8", ...(capture ? { timeout: 30000 } : {}),
  });
  if (result.error) throw result.error;
  return result;
}

function status(id) {
  const parsed = JSON.parse(invoke(id, ["auth", "status", "--json"], true).stdout);
  if (typeof parsed.loggedIn !== "boolean") throw new Error("Claude Code could not confirm the login.");
  return parsed;
}

async function accounts([action = "list", selector]) {
  if (action === "add") {
    const id = await addProfile(root, id => {
      if (invoke(id, ["auth", "login", "--claudeai"]).status !== 0) throw new Error("Sign-in did not finish.");
    }, status);
    console.log("Preferred Claude account:", profileRows(root).find(row => row.id === id)?.email);
    return;
  }
  rememberProfile(root, "default", status("default"));
  const rows = profileRows(root);
  if (action === "list") {
    const serving = rows.find(row => row.resetAt <= Date.now());
    for (const [i, row] of rows.entries()) {
      const states = [i === 0 && "preferred", row === serving && "serving",
        row.resetAt > Date.now() && "retry " + new Date(row.resetAt).toLocaleString()].filter(Boolean);
      console.log((i + 1) + ". " + (row.email || row.id) + (states.length ? " (" + states.join(", ") + ")" : ""));
    }
    if (!rows.length) console.log("No Claude accounts connected. Run claude accounts add.");
    return;
  }
  if (action !== "use") throw new Error("Use claude accounts list, add, or use <email or number>.");
  const row = rows.find((item, i) => item.id === selector || String(i + 1) === selector || item.email?.toLowerCase() === selector?.toLowerCase());
  if (!row) throw new Error("Choose an account from claude accounts list.");
  preferProfile(root, row.id);
  console.log("Preferred Claude account:", row.email ?? row.id);
}

function quoteForBash(value) {
  return "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
}

// Preserve options, including permission and tool restrictions, across a resume.
// Read arity from the installed CLI so a future switch never loses its value.
export function resumeOptions(args, help) {
  const options = new Map();
  for (const line of help.split(/\r?\n/)) {
    const match = /^\s+(?:(-\w), )?(--[\w-]+)(?: ([<[][^>\]]+[>\]]))?(?:\s{2,}|$)/.exec(line);
    if (!match) continue;
    options.set(match[2], match[3] ?? "");
    if (match[1]) options.set(match[1], match[3] ?? "");
  }
  const result = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") break;
    if (!args[i].startsWith("-")) continue; // Original positional prompt is already in the transcript.
    const key = args[i].split("=")[0];
    if (!options.has(key)) throw new Error("Cannot resume automatically with unrecognized Claude option " + key);
    const values = [args[i]];
    const arity = options.get(key);
    if (arity && !args[i].includes("=") && i + 1 < args.length && !args[i + 1].startsWith("-")) {
      values.push(args[++i]);
      if (arity.includes("...")) while (i + 1 < args.length && !args[i + 1].startsWith("-")) values.push(args[++i]);
    }
    if (!["--continue", "-c", "--resume", "-r", "--session-id", "--fork-session", "--from-pr"].includes(key)) result.push(...values);
  }
  return result;
}

function withHook(args, directory) {
  const hook = { matcher: "rate_limit", hooks: [{ type: "command", command:
    [process.execPath, script, "--breadboard-quota-hook"].map(quoteForBash).join(" ") }] };
  if (!args.some(arg => arg === "--settings" || arg.startsWith("--settings="))) {
    const settings = path.join(directory, "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ hooks: { StopFailure: [hook] } }));
    return ["--settings", settings, ...args];
  }
  // A local plugin adds one hook alongside any custom --settings the caller supplied.
  fs.mkdirSync(path.join(directory, ".claude-plugin"));
  fs.writeFileSync(path.join(directory, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "breadboard-account-switch", version: "1.0.0" }));
  fs.mkdirSync(path.join(directory, "hooks"));
  fs.writeFileSync(path.join(directory, "hooks", "hooks.json"), JSON.stringify({ hooks: { StopFailure: [hook] } }));
  return ["--plugin-dir", directory, ...args];
}

function runSession(id, args, directory) {
  const marker = path.join(directory, "quota.json");
  fs.rmSync(marker, { force: true });
  const print = args.includes("-p") || args.includes("--print");
  const bufferOutput = print && !args.includes("stream-json") && !args.includes("--output-format=stream-json");
  const output = path.join(directory, "output");
  const fd = bufferOutput ? fs.openSync(output, "w", 0o600) : null;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["inherit", fd ?? "inherit", "inherit"],
      env: { ...environment(id), BREADBOARD_CLAUDE_QUOTA_MARKER: marker },
    });
    // Interactive Claude stays open at a limit. Switch only after its own hook
    // provides a durable transcript, so tools already executed aren't replayed.
    let handoff;
    const onQuota = () => {
      if (!fs.existsSync(marker)) return;
      const limit = JSON.parse(fs.readFileSync(marker, "utf8"));
      fs.rmSync(marker, { force: true });
      restProfile(root, id, limit.resetAt);
      if (limit.transcript && fs.existsSync(limit.transcript)
          && profileRows(root).some(row => row.id !== id && row.resetAt <= Date.now())) {
        handoff = limit;
        if (!print) child.kill();
      }
    };
    const timer = setInterval(onQuota, 250);
    const interrupt = () => {}; // CTRL+C also goes to the foreground Claude process.
    process.on("SIGINT", interrupt);
    const cleanup = () => {
      clearInterval(timer);
      process.off("SIGINT", interrupt);
      if (fd !== null) fs.closeSync(fd);
    };
    child.once("error", error => { clearInterval(timer); reject(error); });
    child.once("close", code => {
      cleanup();
      onQuota();
      let limit = handoff;
      if (!limit && code !== 0 && bufferOutput) {
        // Some print-mode versions exit before the StopFailure hook finishes.
        try {
          const result = JSON.parse(fs.readFileSync(output, "utf8"));
          if (result.is_error && (result.error === "rate_limit" || /(?:usage|rate|session) limit|hit your .*limit/i.test(result.result))) {
            restProfile(root, id);
            limit = { transcript: sessionTranscript(root, id, result.session_id) };
          }
        } catch { /* Plain text output has no session identifier. */ }
      }
      resolve({ code: code ?? 1, limit, output: bufferOutput ? output : null });
    });
  });
}

async function main(args) {
  if (args[0] === "--breadboard-quota-hook") {
    const event = JSON.parse(fs.readFileSync(0, "utf8"));
    const marker = process.env.BREADBOARD_CLAUDE_QUOTA_MARKER;
    if (marker && event.hook_event_name === "StopFailure" && event.error === "rate_limit" && !event.agent_id) {
      const transcript = typeof event.transcript_path === "string" && path.isAbsolute(event.transcript_path)
        && path.basename(event.transcript_path) === event.session_id + ".jsonl" ? event.transcript_path : null;
      fs.writeFileSync(marker + ".tmp", JSON.stringify({ transcript }), { mode: 0o600 });
      fs.renameSync(marker + ".tmp", marker);
    }
    return 0;
  }
  if (args[0] === "accounts") { await accounts(args.slice(1)); return 0; }
  if (!fs.existsSync(profileStore(root)) || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
      || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CODE_USE_BEDROCK === "1"
      || process.env.CLAUDE_CODE_USE_VERTEX === "1" || process.env.CLAUDE_CODE_USE_FOUNDRY === "1") {
    return invoke("default", args).status ?? 1;
  }
  const rows = profileRows(root);
  const available = rows.filter(row => row.resetAt <= Date.now());
  const first = available[0] ?? rows[0];
  if (args[0] === "auth") {
    const id = first?.id ?? "default";
    const result = invoke(id, args);
    if (result.status === 0 && ["login", "logout"].includes(args[1])) rememberProfile(root, id, status(id));
    return result.status ?? 1;
  }
  if (args.includes("--help") || args.includes("--version") || args.includes("-h") || args.includes("-v")
      || /^(agents|attach|auth|auto-mode|doctor|install|logs|mcp|plugin|plugins|project|remote-control|rm|setup-token|update|upgrade|session|sessions|stop|tasks)$/.test(args[0] ?? "")) {
    return invoke(first?.id ?? "default", args).status ?? 1;
  }
  if (!rows.length) return invoke("default", args).status ?? 1;
  if (!available.length) throw new Error("All Claude accounts are resting. Run claude accounts list for retry times.");
  if (rows.length === 1) return invoke(first.id, args).status ?? 1;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-claude-accounts-"));
  try {
    const initial = withHook(args, directory);
    const hookArgs = initial.slice(0, initial.length - args.length);
    let next = initial;
    while (true) {
      const row = profileRows(root).find(row => row.resetAt <= Date.now());
      if (!row) throw new Error("All Claude accounts are resting. Run claude accounts list for retry times.");
      const result = await runSession(row.id, next, directory);
      const another = profileRows(root).some(other => other.id !== row.id && other.resetAt <= Date.now());
      if (!result.limit?.transcript || !another || !fs.existsSync(result.limit.transcript)) {
        if (result.output) process.stdout.write(fs.readFileSync(result.output));
        return result.code;
      }
      console.error("Claude reached its usage limit. Resuming with the next account.");
      const options = resumeOptions(args, invoke(row.id, ["--help"], true).stdout);
      next = [...hookArgs, ...options, "--resume", result.limit.transcript, "Continue the interrupted request from the saved conversation."];
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
