import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  BULK_READY_MARKER, managedPayloadRoot, managedPayloadTarget, managedVenvRoot,
  markManagedPayloadReady, runtimeBulkDataRoot,
  managedModelCacheEnvironment,
} from "../scripts/runtime-v2-bulk-paths.mjs";
import {executeManagedSetup, MANAGED_SETUP_EXCLUSIVE_OPERATIONS, managedSetupPayloads} from "../scripts/runtime-v2-managed-setup-executor.mjs";
import {validateManagedPythonLaunchPaths} from "../scripts/runtime-v2-managed-python-service.mjs";
import {outerAgentModelCacheEnvironment} from "../scripts/runtime-v2-outer-agent-worker-core.mjs";

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hybrid-"));
  const data = path.join(base, "state-c"), bulk = path.join(base, "bulk-d"), app = path.join(base, "app");
  for (const root of [data, bulk, app]) fs.mkdirSync(root);
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  return {base, data, bulk, app, env: {BREADBOARD_BULK_DATA_DIR: bulk, BREADBOARD_MANAGED_SETUP_EXCLUSION: "2"}};
}
function write(filename, contents = "fixture") {
  fs.mkdirSync(path.dirname(filename), {recursive: true});
  fs.writeFileSync(filename, contents);
}
const pythonRelative = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
function python(venv) { return path.join(venv, ...pythonRelative.split("/")); }

test("new model caches use D while saved state and non-model workers stay independent", t => {
  const {data, bulk, env} = fixture(t);
  const state = path.join(data, "database", "brain.db");write(state,"keep saved state");
  const caches = managedModelCacheEnvironment(data, {...env, HF_HOME:path.join(data,"old-models")});
  assert.equal(caches.HF_HOME,path.join(bulk,"runtime-v2/toolchains/cache/huggingface"));
  assert.equal(caches.HF_HUB_CACHE,path.join(caches.HF_HOME,"hub"));
  assert.equal(caches.HUGGINGFACE_HUB_CACHE,caches.HF_HUB_CACHE);
  assert.equal(caches.TORCH_HOME,path.join(bulk,"runtime-v2/toolchains/cache/torch"));
  assert.deepEqual(outerAgentModelCacheEnvironment("shorts",data,env),caches);
  assert.equal(fs.readFileSync(state,"utf8"),"keep saved state");
  assert.equal(fs.existsSync(caches.HF_HOME),false,"path selection performs no download or write");
  assert.deepEqual(managedModelCacheEnvironment(data,{}),{});
  fs.rmdirSync(bulk);
  assert.deepEqual(outerAgentModelCacheEnvironment("codex",data,env),{});
  assert.deepEqual(outerAgentModelCacheEnvironment("agent-browser",data,env),{});
  assert.throws(()=>outerAgentModelCacheEnvironment("shorts",data,env),/unavailable/u);
});

test("redirected model-cache leaves are rejected before returning any download paths", t => {
  const {data,bulk,base,env}=fixture(t);
  const cache=path.join(bulk,"runtime-v2/toolchains/cache"),outside=path.join(base,"outside-models");
  fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(cache,"huggingface"),process.platform==="win32"?"junction":"dir");
  assert.throws(()=>managedModelCacheEnvironment(data,env),/redirected/u);
  assert.deepEqual(fs.readdirSync(outside),[]);
});

test("verified bulk payloads replace C reads; incomplete or mismatched copies preserve C", t => {
  const {data, bulk, env} = fixture(t);
  const relative = "runtime-v2/services/legal/.venv";
  const legacy = path.join(data, ...relative.split("/")), target = managedPayloadTarget(data, relative, env);
  write(python(legacy), "old working environment");
  assert.equal(managedVenvRoot(data, "legal", env), legacy);
  write(python(target), "copied but not verified");
  assert.equal(managedVenvRoot(data, "legal", env), legacy);
  write(path.join(target, BULK_READY_MARKER), JSON.stringify({version: 1, relative: "runtime-v2/services/shorts/.venv", verifiedAt: new Date().toISOString()}));
  assert.equal(managedVenvRoot(data, "legal", env), legacy);
  markManagedPayloadReady(data, relative, env);
  assert.equal(managedVenvRoot(data, "legal", env), target);
  fs.unlinkSync(python(target));
  assert.equal(managedVenvRoot(data, "legal", env), legacy, "a marker without its interpreter cannot replace C");
  assert.equal(runtimeBulkDataRoot(data, {}), data);
  assert.equal(runtimeBulkDataRoot(data, env), bulk);
  assert.equal(managedPayloadRoot(data, "runtime-v2/toolchains/career-ops", env), path.join(data, "runtime-v2/toolchains/career-ops"));
  assert.equal(managedPayloadRoot(data, "runtime-v2/toolchains/money-printer", env), path.join(data, "runtime-v2/toolchains/money-printer"));
});

test("bulk authority accepts ordinary and extended paths but rejects redirected roots, ancestors and namespaces", t => {
  const {data, bulk, env, base} = fixture(t);
  if (process.platform === "win32") {
    const native = {...env, BREADBOARD_BULK_DATA_DIR: path.toNamespacedPath(bulk)};
    assert.equal(fs.realpathSync.native(runtimeBulkDataRoot(data, native)), fs.realpathSync.native(bulk));
    assert.equal(fs.realpathSync.native(path.dirname(managedPayloadTarget(data, "hyperframes-cli", native))), fs.realpathSync.native(bulk));
  }
  for (const relative of ["../outside", "runtime-v2/services/legal/config.json", "runtime-v2/services/arbitrary/.venv", "runtime-v2/toolchains/arbitrary", "openwork-state"]) {
    assert.throws(() => managedPayloadTarget(data, relative, env), /namespace/u);
  }
  const outside = path.join(base, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(bulk, "runtime-v2"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => managedPayloadTarget(data, "runtime-v2/services/legal/.venv", env), /redirected/u);
  assert.throws(() => runtimeBulkDataRoot(data, {...env, BREADBOARD_BULK_DATA_DIR: path.join(bulk, "runtime-v2")}), /redirected/u);
});

test("native launch authority and JS installers share the same closed payload namespaces", () => {
  const native = fs.readFileSync(new URL("../../native/runtime-core/src/paths/bulk.rs", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../scripts/runtime-v2-bulk-paths.mjs", import.meta.url), "utf8");
  for (const [nativeName, workerName] of [["VENV_IDS", "VENV_SERVICES"], ["TOOLCHAINS", "TOOLCHAINS"], ["TOP_LEVEL", "TOP_LEVEL"]]) {
    const rust = new RegExp(`const ${nativeName}:[^=]+?= &\\[([\\s\\S]*?)\\];`, "u").exec(native)?.[1];
    const javascript = new RegExp(`const ${workerName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`, "u").exec(worker)?.[1];
    assert.ok(rust && javascript, `missing ${nativeName} contract`);
    const values = text => [...text.matchAll(/"([^"\r\n]+)"/gu)].map(match => match[1]).sort();
    assert.deepEqual(values(javascript), values(rust), nativeName);
  }
});

test("a successful Python setup installs and caches only on D while keeping C state and the old environment", async t => {
  const {data, bulk, app, env} = fixture(t);
  for (const relative of ["harness/agent_loop.py", "harness/tools.py", "harness/system_prompt.md", "sandbox/sandbox.py"]) write(path.join(app, "harvey-labs", relative));
  const tools = path.join(app, "tools");
  write(path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv"));
  const relative = "runtime-v2/services/legal/.venv";
  const legacy = path.join(data, relative), target = managedPayloadTarget(data, relative, env);
  write(python(legacy), "keep legacy until explicit Remove");
  write(path.join(data, "database", "brain.db"), "state stays C");
  const launches = [];
  const result = await executeManagedSetup({protocolVersion: 1, operation: "legal", action: "install"}, {
    dataRoot: data, appRoot: app, env: {...env, PATH: tools, PATHEXT: ".EXE"}, signal: new AbortController().signal,
    spawnImpl(command, args, options) {
      launches.push({command, args, options});
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      setImmediate(() => {
        if (args[0] === "venv") write(python(target));
        if (command === python(target)) child.stdout.write("ok\n");
        child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);
      });
      return child;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(managedVenvRoot(data, "legal", env), target);
  assert.equal(fs.readFileSync(python(legacy), "utf8"), "keep legacy until explicit Remove");
  assert.equal(fs.readFileSync(path.join(data, "database", "brain.db"), "utf8"), "state stays C");
  assert.equal(fs.existsSync(path.join(bulk, "database")), false);
  assert.ok(launches.length >= 3);
  for (const {options} of launches) {
    assert.equal(options.env.UV_CACHE_DIR, path.join(bulk, "runtime-v2/toolchains/cache/uv"));
    assert.equal(options.env.UV_PYTHON_INSTALL_DIR, path.join(bulk, "runtime-v2/toolchains/cache/python"));
  }
  const repair = await executeManagedSetup({protocolVersion: 1, operation: "legal", action: "reinstall"}, {
    dataRoot: data, appRoot: app, env: {...env, PATH: tools, PATHEXT: ".EXE"}, signal: new AbortController().signal,
    spawnImpl() {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      setImmediate(() => {child.stderr.write("fixture installation failure"); child.stdout.end(); child.stderr.end(); child.emit("close", 1, null);});
      return child;
    },
  });
  assert.equal(repair.ok, false);
  assert.equal(fs.existsSync(path.join(target, BULK_READY_MARKER)), false);
  assert.equal(managedVenvRoot(data, "legal", env), legacy, "failed repair must not select a partly mutated D environment");
});

test("all nine explicit removals preflight both fixed roots and never reactivate an older environment", async t => {
  const {data, bulk, app, env, base} = fixture(t);
  for (const operation of ["deep-tutor", "deer-flow", "legal", "money-printer", "openexecutive", "shorts", "stock-analyst", "tradingagents", "vibe-trading"]) {
    for (const root of [data, bulk]) {
      write(path.join(root, "runtime-v2/services", operation, ".venv", "dependency.txt"));
      write(path.join(root, "runtime-v2/services", operation, "config.json"), "preserve");
    }
    const result = await executeManagedSetup({protocolVersion: 1, operation, action: "remove"}, {dataRoot: data, appRoot: app, env, signal: new AbortController().signal});
    assert.equal(result.ok, true);
    for (const root of [data, bulk]) {
      assert.equal(fs.existsSync(path.join(root, "runtime-v2/services", operation, ".venv")), false);
      assert.equal(fs.readFileSync(path.join(root, "runtime-v2/services", operation, "config.json"), "utf8"), "preserve");
    }
  }
  const relative = "runtime-v2/services/legal/.venv";
  write(path.join(bulk, relative, "dependency.txt"), "do not touch before full preflight");
  const outside = path.join(base, "outside"); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(data, relative), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(executeManagedSetup({protocolVersion: 1, operation: "legal", action: "remove"}, {dataRoot: data, appRoot: app, env, signal: new AbortController().signal}), /redirected/u);
  assert.equal(fs.readFileSync(path.join(bulk, relative, "dependency.txt"), "utf8"), "do not touch before full preflight");
});

test("all nineteen managed operations have an explicit dependency plan and exclude state roots", t => {
  const {data, bulk, env} = fixture(t);
  assert.equal(MANAGED_SETUP_EXCLUSIVE_OPERATIONS.length, 19);
  for (const operation of MANAGED_SETUP_EXCLUSIVE_OPERATIONS) {
    const action = operation === "career-ops" ? "browsers" : operation === "openmontage" ? "install-dependencies" : "install";
    const payloads = managedSetupPayloads(operation, action);
    assert.ok(payloads.length, operation);
    for (const relative of payloads) {
      assert.ok(managedPayloadTarget(data, relative, env).startsWith(bulk + path.sep), `${operation}: ${relative}`);
      assert.doesNotMatch(relative, /database|config|workspace|state|reports|output/u);
    }
  }
  assert.deepEqual(managedSetupPayloads("career-ops", "install"), [], "mixed candidate state remains on C");
});

test("dashboard databases and service state stay on C even when the bulk drive is unavailable", async t => {
  const {data, bulk, env} = fixture(t);
  const previous = {data: process.env.BREADBOARD_DATA_DIR, bulk: process.env.BREADBOARD_BULK_DATA_DIR};
  process.env.BREADBOARD_DATA_DIR = data; process.env.BREADBOARD_BULK_DATA_DIR = bulk;
  t.after(() => {
    for (const [key, value] of [["BREADBOARD_DATA_DIR", previous.data], ["BREADBOARD_BULK_DATA_DIR", previous.bulk]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const paths = await import("../src/lib/runtime-paths.ts");
  assert.equal(paths.databaseDir(), path.join(data, "database"));
  assert.equal(paths.runtimeV2ServiceRoot("legal"), path.join(data, "runtime-v2/services/legal"));
  assert.equal(paths.runtimeV2BulkRoot(), path.join(bulk, "runtime-v2"));
  fs.renameSync(bulk, `${bulk}-offline`);
  assert.equal(paths.databaseDir(), path.join(data, "database"));
  assert.equal(paths.runtimeV2ServiceRoot("legal"), path.join(data, "runtime-v2/services/legal"));
  assert.throws(() => managedVenvRoot(data, "legal", env), /unavailable/u);
});

test("ACE-Step observes verified D model files using the readiness manifest kept on C", async t => {
  const {data, bulk, env} = fixture(t);
  const previous = process.env.BREADBOARD_BULK_DATA_DIR;
  process.env.BREADBOARD_BULK_DATA_DIR = bulk;
  t.after(() => {if (previous === undefined) delete process.env.BREADBOARD_BULK_DATA_DIR; else process.env.BREADBOARD_BULK_DATA_DIR = previous;});
  const {preparedAceStep, ACESTEP_MODEL_REVISION} = await import("../src/lib/acestep/prepared.ts");
  const {ACESTEP_REVISION} = await import("../src/lib/acestep/capabilities.ts");
  const state = path.join(data, "runtime-v2/services/acestep");
  const relative = "runtime-v2/services/acestep/source";
  const source = managedPayloadTarget(data, relative, env);
  write(path.join(source, "acestep/api_server.py"));
  const files = ["acestep-v15-turbo", "vae", "Qwen3-Embedding-0.6B"].map(name => {
    const relative = `source/checkpoints/${name}/fixture.safetensors`;
    write(path.join(source, relative.slice("source/".length)), "weights");
    return {path: relative, size: 7};
  });
  write(path.join(state, "models-ready.json"), JSON.stringify({sourceRevision: ACESTEP_REVISION, modelRevision: ACESTEP_MODEL_REVISION, model: "acestep-v15-turbo", files, hardware: {cuda: false}}));
  assert.equal(preparedAceStep(state), null, "an unverified copy is not an installed model");
  markManagedPayloadReady(data, relative, env);
  assert.equal(preparedAceStep(state)?.hardware.cuda, false);
  fs.appendFileSync(path.join(source, files[0].path.slice("source/".length)), "changed");
  assert.equal(preparedAceStep(state), null);
  assert.equal(fs.existsSync(path.join(bulk, "runtime-v2/services/acestep/models-ready.json")), false);
});

test("persistent runtime modules reselect verified payloads despite startup-sealed C paths", async t => {
  const {data, bulk, env} = fixture(t);
  const previous = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = data;
  t.after(() => {if (previous === undefined) delete process.env.BREADBOARD_DATA_DIR; else process.env.BREADBOARD_DATA_DIR = previous;});
  const cases = [
    ["hyperframes", "managedCliRoot", "HYPERFRAMES_CLI_ROOT", "hyperframes-cli", ["node_modules/hyperframes/bin/hyperframes.mjs"]],
    ["openscience", "managedCliRoot", "OPENSCIENCE_CLI_ROOT", "openscience-cli", ["node_modules/@synsci/openscience/bin/openscience"]],
    ["openwork", "serverRuntimeRoot", "OPENWORK_SERVER_RUNTIME_ROOT", "openwork-runtime", ["apps/server/src/cli.ts", "apps/server/node_modules/@opencode-ai/sdk/package.json"]],
    ["wardrobe", "wardrobeRuntimeRoot", "WARDROBE_RUNTIME_ROOT", "runtime-v2/toolchains/wardrobe", ["node_modules/vite/bin/vite.js"]],
    ["career-ops", "careerOpsBrowserRoot", "PLAYWRIGHT_BROWSERS_PATH", "runtime-v2/toolchains/career-ops-browsers", []],
  ];
  for (const [agent, name, variable, relative, files] of cases) {
    const module = await import(`../src/lib/${agent}/runtime.ts`);
    const legacy = path.join(data, relative), target = managedPayloadTarget(data, relative, env);
    fs.mkdirSync(legacy, {recursive: true});
    const sealed = {...env, [variable]: process.platform === "win32" ? path.toNamespacedPath(legacy) : legacy};
    assert.equal(module[name](sealed), legacy, agent);
    fs.mkdirSync(target, {recursive: true});
    for (const file of files) write(path.join(target, file));
    assert.equal(module[name](sealed), legacy, `${agent}: partial install`);
    markManagedPayloadReady(data, relative, env);
    assert.equal(module[name](sealed), target, `${agent}: no module or process restart`);
    const custom = path.join(data, `custom-${agent}`);
    assert.equal(module[name]({...env, [variable]: custom}), custom, `${agent}: preserve standalone configuration`);
    fs.unlinkSync(path.join(target, BULK_READY_MARKER));
    assert.equal(module[name]({...env, [variable]: target}), legacy, `${agent}: failed repair invalidates an earlier D selection`);
  }
});

test("all managed runtime modules can load with D disconnected while core C paths remain usable", t => {
  const {data, bulk} = fixture(t);
  fs.renameSync(bulk, `${bulk}-offline`);
  const modules = ["bolt-slides", "career-ops", "deep-tutor", "deer-flow", "hyperframes", "legal", "matraix", "money-printer", "openexecutive", "openmontage", "openscience", "openwork", "resource2skill", "shorts", "stock-analyst", "subsai", "tradingagents", "vibe-trading", "wardrobe"];
  const imports = modules.map(id => new URL(`../src/lib/${id}/runtime.ts`, import.meta.url).href);
  const paths = new URL("../src/lib/runtime-paths.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    for (const specifier of ${JSON.stringify(imports)}) await import(specifier);
    const paths = await import(${JSON.stringify(paths)});
    if (paths.databaseDir() !== ${JSON.stringify(path.join(data, "database"))}) throw new Error("database moved");
    if (paths.runtimeV2ServiceRoot("legal") !== ${JSON.stringify(path.join(data, "runtime-v2/services/legal"))}) throw new Error("state moved");
    let blocked = false;
    try { paths.runtimeV2ServiceVenv("legal"); } catch (error) { blocked = /unavailable/u.test(error.message); }
    if (!blocked) throw new Error("offline dependency access must remain unavailable");
    console.log("offline-core-imports-ok");
  `], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", windowsHide: true, timeout: 20000,
    env: {...process.env, BREADBOARD_DATA_DIR: data, BREADBOARD_BULK_DATA_DIR: bulk},
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  assert.match(child.stdout, /offline-core-imports-ok/u);
});

test("managed Python services reject stale C launch values and indirect D interpreter ancestors", t => {
  const {data, bulk, app, env} = fixture(t);
  for (const service of ["vibe-trading", "stock-analyst"]) {
    const relative = `runtime-v2/services/${service}/.venv`;
    const legacy = path.join(data, relative), target = managedPayloadTarget(data, relative, env);
    write(python(legacy)); write(python(target));
    const source = path.join(app, service); fs.mkdirSync(source);
    const sealed = {...env, BREADBOARD_MANAGED_PYTHON_SOURCE_ROOT: source, BREADBOARD_MANAGED_PYTHON_EXECUTABLE: python(legacy)};
    assert.equal(validateManagedPythonLaunchPaths(service, data, sealed).python, python(legacy));
    markManagedPayloadReady(data, relative, env);
    assert.throws(() => validateManagedPythonLaunchPaths(service, data, sealed), /selected managed environment/u);
    sealed.BREADBOARD_MANAGED_PYTHON_EXECUTABLE = process.platform === "win32" ? path.toNamespacedPath(python(target)) : python(target);
    assert.equal(fs.realpathSync.native(validateManagedPythonLaunchPaths(service, data, sealed).python), fs.realpathSync.native(python(target)));
    assert.equal(validateManagedPythonLaunchPaths(service, data, sealed).python, python(target));
    const executableDirectory = path.dirname(python(target));
    fs.renameSync(executableDirectory, `${executableDirectory}-original`);
    const redirected = path.join(bulk, `redirected-${service}`);
    write(path.join(redirected, path.basename(python(target))), "outside preserved");
    fs.symlinkSync(redirected, executableDirectory, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => validateManagedPythonLaunchPaths(service, data, sealed), /redirected|indirect/u);
    assert.equal(fs.readFileSync(path.join(redirected, path.basename(python(target))), "utf8"), "outside preserved");
  }
});
