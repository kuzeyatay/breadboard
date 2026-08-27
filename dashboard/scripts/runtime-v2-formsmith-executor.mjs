import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MESH_BYTES = 512 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_FAILURE_BYTES = 32 * 1024;
const MAX_WORKSPACE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_WORKSPACE_ENTRIES = 100_000;
const PROBE_TIMEOUT_MS = 90_000;
const RECONSTRUCTION_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const WINDOWS_TREE_KILL_TIMEOUT_MS = 10_000;
const PROCESS_CLOSE_TIMEOUT_MS = 10_000;
const STAGES = new Set(["prepare", "depth", "reconstruct"]);

class FormsmithExecutorError extends Error {
  constructor(code, message, stages = []) {
    super(message);
    this.name = "FormsmithExecutorError";
    this.code = code;
    this.stages = stages;
  }
}

function fail(code, message, stages = []) {
  throw new FormsmithExecutorError(code, message, stages);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function boundedText(value, maximumBytes) {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function absoluteConfigured(value) {
  return boundedText(value, 4_096) && path.isAbsolute(value) ? path.resolve(value) : null;
}

function directDirectory(value) {
  const resolved = absoluteConfigured(value);
  if (!resolved) return null;
  try {
    const metadata = fs.lstatSync(resolved);
    return metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(resolved), resolved)
      ? resolved
      : null;
  } catch {
    return null;
  }
}

function directFile(value) {
  const resolved = absoluteConfigured(value);
  if (!resolved) return null;
  try {
    const metadata = fs.lstatSync(resolved);
    return metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(resolved), resolved)
      ? resolved
      : null;
  } catch {
    return null;
  }
}

function isShapeRClone(root) {
  if (!root) return false;
  return [
    "infer_shape.py",
    path.join("experimental", "workaround_dataproc.py"),
    path.join("model", "flow_matching", "shaper_denoiser.py"),
    path.join("model", "dino_and_ray_feature_extractor.py"),
  ].every((relativePath) => directFile(path.join(root, relativePath)) !== null);
}

function serviceStateRoot(dataRoot, configured) {
  const expected = path.join(dataRoot, "runtime-v2", "services", "formsmith");
  const resolved = absoluteConfigured(configured);
  if (!resolved || !samePath(resolved, expected) || !pathWithin(dataRoot, resolved)) return null;
  const canonicalDataRoot = fs.realpathSync.native(path.resolve(dataRoot));
  if (!samePath(canonicalDataRoot, dataRoot)) return null;
  let current = canonicalDataRoot;
  for (const segment of path.relative(canonicalDataRoot, resolved).split(path.sep)) {
    if (!segment || segment === "." || segment === "..") return null;
    current = path.join(current, segment);
    try {
      const metadata = fs.lstatSync(current);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        !samePath(fs.realpathSync.native(current), current)
      ) return null;
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
      try {
        fs.mkdirSync(current, { recursive: false, mode: 0o700 });
      } catch (mkdirError) {
        // Another admitted Formsmith job may have created the shared cache
        // directory between lstat and mkdir. Revalidate it on the next loop
        // iteration instead of treating that harmless race as unavailable.
        if (mkdirError?.code !== "EEXIST") return null;
      }
      const created = directDirectory(current);
      if (!created) return null;
    }
  }
  return directDirectory(resolved);
}

function directDescendantDirectory(root, ...segments) {
  let current = directDirectory(root);
  if (!current) return null;
  for (const segment of segments) {
    if (!boundedText(segment, 256) || segment === "." || segment === ".." || path.basename(segment) !== segment) {
      return null;
    }
    current = path.join(current, segment);
    try {
      const metadata = fs.lstatSync(current);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        !samePath(fs.realpathSync.native(current), current)
      ) return null;
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
      try {
        fs.mkdirSync(current, { recursive: false, mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") return null;
      }
      if (!directDirectory(current)) return null;
    }
  }
  return current;
}

function closedToolPath(value, python) {
  if (!boundedText(value, 32 * 1024)) return null;
  const entries = value.split(path.delimiter).filter(Boolean);
  if (entries.length < 1 || entries.length > 64) return null;
  const canonical = entries.map(directDirectory);
  if (canonical.some((entry) => entry === null)) return null;
  const pythonDirectory = path.dirname(python);
  if (!canonical.some((entry) => samePath(entry, pythonDirectory))) return null;
  return [...new Set(canonical)].join(path.delimiter);
}

function inspectTools(env, dataRoot) {
  const configuredRoot = absoluteConfigured(env.SHAPER_ROOT);
  const root = directDirectory(configuredRoot);
  const python = directFile(env.SHAPER_PYTHON);
  const bridge = directFile(env.SHAPER_BRIDGE);
  const stateRoot = serviceStateRoot(dataRoot, env.SHAPER_STATE_ROOT);
  const toolPath = python ? closedToolPath(env.SHAPER_TOOL_PATH, python) : null;
  return {
    configuredRoot,
    root: root && isShapeRClone(root) ? root : null,
    python,
    bridge,
    stateRoot,
    toolPath,
  };
}

function childEnvironment(env, tools, workspacePath) {
  const cacheRoot = directDescendantDirectory(tools.stateRoot, "cache");
  const huggingface = directDescendantDirectory(tools.stateRoot, "cache", "huggingface");
  const huggingfaceHub = directDescendantDirectory(tools.stateRoot, "cache", "huggingface", "hub");
  const transformers = directDescendantDirectory(
    tools.stateRoot,
    "cache",
    "huggingface",
    "transformers",
  );
  const torch = directDescendantDirectory(tools.stateRoot, "cache", "torch");
  const torchHub = directDescendantDirectory(tools.stateRoot, "cache", "torch-hub");
  const torchInductor = directDescendantDirectory(tools.stateRoot, "cache", "torchinductor");
  const triton = directDescendantDirectory(tools.stateRoot, "cache", "triton");
  if (
    !cacheRoot || !huggingface || !huggingfaceHub || !transformers ||
    !torch || !torchHub || !torchInductor || !triton
  ) {
    fail("formsmith_runtime_unavailable", "ShapeR's sealed cache directories are unavailable.");
  }
  const child = {
    PATH: tools.toolPath,
    PYTHONPATH: tools.root,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    HOME: workspacePath,
    USERPROFILE: workspacePath,
    TEMP: workspacePath,
    TMP: workspacePath,
    TMPDIR: workspacePath,
    XDG_CACHE_HOME: cacheRoot,
    HF_HOME: huggingface,
    HUGGINGFACE_HUB_CACHE: huggingfaceHub,
    TRANSFORMERS_CACHE: transformers,
    TORCH_HOME: torch,
    SHAPER_TORCH_HUB_DIR: torchHub,
    TORCHINDUCTOR_CACHE_DIR: torchInductor,
    TRITON_CACHE_DIR: triton,
  };
  for (const key of [
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "WINDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "CUDA_HOME",
    "CUDA_PATH",
    "CUDA_INCLUDE",
    "CUDA_LIB",
    "CUDA_VISIBLE_DEVICES",
    "LD_LIBRARY_PATH",
    "LIBRARY_PATH",
    "CPATH",
    "CFLAGS",
    "CXXFLAGS",
    "OMP_NUM_THREADS",
    "HF_HUB_OFFLINE",
  ]) {
    if (boundedText(env[key], 32 * 1024)) child[key] = env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (/^CUDA_PATH_V\d+_\d+$/u.test(key) && boundedText(value, 4_096)) child[key] = value;
  }
  return child;
}

function terminationFailure(detail) {
  return new FormsmithExecutorError(
    "formsmith_termination_failed",
    `ShapeR cancellation could not verify complete process-tree exit: ${detail}`,
  );
}

function waitForBoundary(promise, timeoutMs, onTimeout, detail) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // The boundary error below remains the deterministic failure record.
      }
      finish(terminationFailure(detail));
    }, timeoutMs);
    promise.then(
      (value) => finish(null, value),
      () => finish(terminationFailure(detail)),
    );
  });
}

function requestWindowsTreeKill(taskkill, pid, env) {
  let killer;
  try {
    killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...(env.SYSTEMROOT ? { SYSTEMROOT: env.SYSTEMROOT } : {}),
        ...(env.WINDIR ? { WINDIR: env.WINDIR } : {}),
      },
    });
  } catch {
    return Promise.resolve(false);
  }
  const completed = new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };
    killer.once("error", () => finish(false));
    killer.once("close", (code) => finish(code === 0));
  });
  return waitForBoundary(
    completed,
    WINDOWS_TREE_KILL_TIMEOUT_MS,
    () => {
      try {
        killer.kill();
      } catch {
        // The helper may have crossed its own close boundary concurrently.
      }
    },
    "the trusted Windows tree-termination helper did not finish within its deadline",
  ).catch(() => false);
}

function releaseChildIo(child) {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function terminateTree(child, env, closed) {
  if (!child?.pid) {
    await waitForBoundary(
      closed,
      PROCESS_CLOSE_TIMEOUT_MS,
      () => releaseChildIo(child),
      "the launched process did not publish its close boundary",
    );
    return;
  }
  if (process.platform === "win32") {
    const configured = directFile(env.BREADBOARD_TASKKILL_PATH);
    const fallback = env.SYSTEMROOT
      ? directFile(path.join(env.SYSTEMROOT, "System32", "taskkill.exe"))
      : null;
    const candidates = [configured, fallback]
      .filter(Boolean)
      .filter((candidate, index, entries) =>
        entries.findIndex((entry) => samePath(entry, candidate)) === index,
      );
    let treeKillSucceeded = false;
    for (const taskkill of candidates) {
      if (await requestWindowsTreeKill(taskkill, child.pid, env)) {
        treeKillSucceeded = true;
        break;
      }
    }
    if (!treeKillSucceeded) {
      try {
        child.kill();
      } catch {
        // The child may already be exiting. This is not sufficient tree proof.
      }
      throw terminationFailure(
        "Windows did not confirm recursive termination; the native Runtime Job Object remains authoritative",
      );
    }
    // A zero taskkill exit is the local recursive-tree confirmation. Closing
    // our pipe handles after it succeeds prevents a dead descendant's former
    // inherited handles from holding Node's `close` event open forever.
    releaseChildIo(child);
    await waitForBoundary(
      closed,
      PROCESS_CLOSE_TIMEOUT_MS,
      () => releaseChildIo(child),
      "the recursively terminated process did not publish its close boundary",
    );
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    closed,
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      timer.unref?.();
    }),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  // `exit` can precede `close` while a descendant still owns an inherited
  // pipe. Do not publish cancellation until every stdio handle has closed.
  await closed;
}

function utf8Tail(value, maximumBytes) {
  let bytes = Buffer.from(String(value), "utf8");
  if (bytes.byteLength > maximumBytes) bytes = bytes.subarray(-maximumBytes);
  let result = bytes.toString("utf8").replace(/^\uFFFD+/u, "");
  while (Buffer.byteLength(result, "utf8") > maximumBytes) result = result.slice(1);
  return result;
}

function directoryWithinBounds(root) {
  const pending = [root];
  let total = 0;
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      entries += 1;
      if (entries > MAX_WORKSPACE_ENTRIES) return false;
      const candidate = path.join(directory, name);
      const metadata = fs.lstatSync(candidate);
      if (metadata.isSymbolicLink()) return false;
      if (metadata.isDirectory()) pending.push(candidate);
      else if (metadata.isFile()) {
        total += metadata.size;
        if (total > MAX_WORKSPACE_BYTES) return false;
      }
    }
  }
  return true;
}

function runCapturedProcess({
  executable,
  args,
  cwd,
  env,
  terminationEnv = env,
  signal,
  timeoutMs,
  stdin,
  onLine,
  workspace,
}) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch {
      reject(new FormsmithExecutorError("formsmith_launch_failed", "ShapeR could not start."));
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let lineBuffer = "";
    let outputBytes = 0;
    let settled = false;
    let stopping = false;
    let workspaceTimer = null;
    const closed = new Promise((resolve) => {
      child.once("close", (code, closeSignal) => resolve({ code, closeSignal }));
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (workspaceTimer) clearInterval(workspaceTimer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const stopWith = (error) => {
      if (settled || stopping) return;
      stopping = true;
      void terminateTree(child, terminationEnv, closed).then(
        () => finish(error),
        (terminationError) => finish(terminationError),
      );
    };
    const append = (target, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        stopWith(new FormsmithExecutorError(
          "formsmith_output_too_large",
          "ShapeR exceeded its diagnostic output limit.",
        ));
        return target;
      }
      return Buffer.concat([target, chunk]);
    };
    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk);
      if (!onLine || settled) return;
      lineBuffer += chunk.toString("utf8");
      let newline = lineBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = lineBuffer.slice(0, newline).trim();
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line) {
          try {
            onLine(line);
          } catch (error) {
            stopWith(error);
            return;
          }
        }
        newline = lineBuffer.indexOf("\n");
      }
      if (Buffer.byteLength(lineBuffer, "utf8") > 64 * 1024) {
        stopWith(new FormsmithExecutorError(
          "formsmith_output_too_large",
          "ShapeR emitted an oversized progress record.",
        ));
      }
    });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", () => {
      if (stopping) return;
      finish(new FormsmithExecutorError("formsmith_launch_failed", "ShapeR could not start."));
    });
    const onAbort = () => stopWith(
      signal.reason ?? new DOMException("Runtime cancellation requested", "AbortError"),
    );
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stopWith(new FormsmithExecutorError(
      "formsmith_timeout",
      timeoutMs === PROBE_TIMEOUT_MS
        ? "The ShapeR environment probe timed out."
        : "The reconstruction passed its two-hour limit and was stopped.",
    )), timeoutMs);
    timer.unref?.();
    if (workspace) {
      workspaceTimer = setInterval(() => {
        try {
          if (!directoryWithinBounds(workspace)) {
            stopWith(new FormsmithExecutorError(
              "formsmith_output_too_large",
              "ShapeR exceeded its private workspace limit.",
            ));
          }
        } catch {
          stopWith(new FormsmithExecutorError(
            "formsmith_reconstruction_failed",
            "ShapeR produced an invalid private workspace.",
          ));
        }
      }, 2_000);
      workspaceTimer.unref?.();
    }
    void closed.then(({ code }) => {
      // Cancellation/output/timeout stops deliberately kill the whole tree.
      // Preserve that initiating error instead of racing it with the killed
      // child's non-zero close status.
      if (stopping) return;
      finish(null, {
        code,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
    if (signal.aborted) onAbort();
  });
}

function unavailableHealth(tools, reason, missing = []) {
  return {
    available: false,
    cloned: Boolean(tools.root),
    root: tools.root,
    python: tools.python,
    bridgeFound: Boolean(tools.bridge),
    dependenciesInstalled: false,
    cudaAvailable: false,
    missing,
    reason,
  };
}

async function probeHealth(launch, signal, env) {
  const tools = inspectTools(env, launch.dataRoot);
  if (!tools.root) {
    return unavailableHealth(tools, "The sealed ShapeR checkout is unavailable.");
  }
  if (!tools.python) {
    return unavailableHealth(
      tools,
      "ShapeR is staged, but its Python 3.10 environment is not ready. Follow ShapeR/INSTALL.md or set SHAPER_PYTHON.",
    );
  }
  if (!tools.bridge) {
    return unavailableHealth(tools, "Breadboard's sealed ShapeR bridge is missing.");
  }
  if (!tools.stateRoot || !tools.toolPath) {
    return unavailableHealth(tools, "ShapeR's writable Runtime state or closed tool path is unavailable.");
  }
  const script = [
    "import importlib.util, json, torch",
    "mods=['omegaconf','trimesh','cv2','PIL','numpy','depth_anything_3','fpsample','torchsparse','transformers','diffusers']",
    "missing=[m for m in mods if importlib.util.find_spec(m) is None]",
    "print(json.dumps({'missing':missing,'cuda':bool(torch.cuda.is_available())}))",
  ].join("\n");
  const result = await runCapturedProcess({
    executable: tools.python,
    args: ["-c", script],
    cwd: tools.stateRoot,
    env: childEnvironment(env, tools, launch.workspacePath),
    terminationEnv: env,
    signal,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1) ?? "");
  } catch {
    report = null;
  }
  const missing = Array.isArray(report?.missing)
    ? report.missing.filter((item) => boundedText(item, 256)).slice(0, 64)
    : ["ShapeR environment probe"];
  const cudaAvailable = report?.cuda === true;
  const dependenciesInstalled = result.code === 0 && missing.length === 0;
  return {
    available: dependenciesInstalled && cudaAvailable,
    cloned: true,
    root: tools.root,
    python: tools.python,
    bridgeFound: true,
    dependenciesInstalled,
    cudaAvailable,
    missing,
    reason: !dependenciesInstalled
      ? `The ShapeR environment is missing ${missing.join(", ")}. Follow ShapeR/INSTALL.md.`
      : !cudaAvailable
        ? "ShapeR requires a CUDA GPU, but CUDA is not available in its Python environment."
        : null,
  };
}

function captionFromFilename(filename) {
  const label = path.basename(filename, path.extname(filename)).replace(/[-_]+/gu, " ").trim();
  return /[a-z]{3}/iu.test(label) && !/^img\s*\d+$/iu.test(label)
    ? `a detailed 3D object: ${label}`.slice(0, 512)
    : "a detailed 3D object";
}

function directMesh(stageRoot, candidate, declaredSize) {
  const expected = path.join(stageRoot, "formsmith.glb");
  const resolved = path.resolve(candidate);
  if (!samePath(resolved, expected) || !pathWithin(stageRoot, resolved) || samePath(stageRoot, resolved)) {
    fail("formsmith_reconstruction_failed", "ShapeR returned a mesh outside its private output stage.");
  }
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== declaredSize ||
    metadata.size < 12 ||
    metadata.size > MAX_MESH_BYTES ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail("formsmith_reconstruction_failed", "ShapeR returned an invalid or oversized GLB mesh.");
  const descriptor = fs.openSync(resolved, "r");
  try {
    const header = Buffer.alloc(12);
    if (
      fs.readSync(descriptor, header, 0, header.length, 0) !== header.length ||
      header.subarray(0, 4).toString("ascii") !== "glTF" ||
      header.readUInt32LE(4) !== 2 ||
      header.readUInt32LE(8) !== metadata.size
    ) fail("formsmith_reconstruction_failed", "ShapeR returned a file that is not binary glTF.");
  } finally {
    fs.closeSync(descriptor);
  }
  return resolved;
}

function imageMagicMatches(filePath, filename) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const count = fs.readSync(descriptor, header, 0, header.length, 0);
    const extension = path.extname(filename).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") {
      return count >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    if (extension === ".png") {
      return count >= 8 && header.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
    if (extension === ".webp") {
      return count >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" &&
        header.subarray(8, 12).toString("ascii") === "WEBP";
    }
    return false;
  } finally {
    fs.closeSync(descriptor);
  }
}

function relativeDataPath(dataRoot, candidate) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(dataRoot, resolved) || samePath(dataRoot, resolved)) {
    fail("formsmith_reconstruction_failed", "ShapeR returned output outside Runtime data.");
  }
  return path.relative(dataRoot, resolved).split(path.sep).join("/");
}

async function reconstruct(launch, signal, progress, inputPath, env) {
  const startedAt = Date.now();
  const tools = inspectTools(env, launch.dataRoot);
  if (!tools.root || !tools.python || !tools.bridge || !tools.stateRoot || !tools.toolPath) {
    fail("formsmith_runtime_unavailable", "ShapeR's sealed Runtime environment is not ready.");
  }
  const blob = launch.inputBlobs[0];
  if (
    !inputPath ||
    blob.displayName !== launch.request.filename ||
    blob.sizeBytes !== launch.request.sizeBytes ||
    blob.sizeBytes < 1 ||
    blob.sizeBytes > MAX_IMAGE_BYTES ||
    !imageMagicMatches(inputPath, launch.request.filename)
  ) fail("formsmith_invalid_image", "The sealed Formsmith image is invalid.");

  const stageRoot = path.join(launch.workspacePath, "formsmith-stage");
  fs.mkdirSync(stageRoot, { recursive: false, mode: 0o700 });
  if (!samePath(fs.realpathSync.native(stageRoot), stageRoot)) {
    fail("formsmith_reconstruction_failed", "The private Formsmith output stage is unavailable.");
  }
  const stages = [];
  let mesh = null;
  let declaredSize = 0;
  let bridgeError = null;
  const publish = (stage, status) => {
    if (!STAGES.has(stage) || !["running", "completed"].includes(status)) {
      fail("formsmith_reconstruction_failed", "ShapeR emitted an invalid stage record.", stages);
    }
    const prior = stages.at(-1);
    if (!prior || prior.stage !== stage || prior.status !== status) stages.push({ stage, status });
    progress.checkpoint({ operation: "reconstruct", stages });
  };
  let result;
  try {
    result = await runCapturedProcess({
      executable: tools.python,
      args: [tools.bridge],
      cwd: stageRoot,
      env: childEnvironment(env, tools, launch.workspacePath),
      terminationEnv: env,
      signal,
      timeoutMs: RECONSTRUCTION_TIMEOUT_MS,
      workspace: stageRoot,
      stdin: `${JSON.stringify({
        source: inputPath,
        workspace: stageRoot,
        shaperRoot: tools.root,
        shaperStateRoot: tools.stateRoot,
        preset: "speed",
        caption: captionFromFilename(launch.request.filename),
      })}\n`,
      onLine(line) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          fail("formsmith_reconstruction_failed", "ShapeR emitted malformed progress.", stages);
        }
        if (!isRecord(event) || !boundedText(event.event, 64)) {
          fail("formsmith_reconstruction_failed", "ShapeR emitted invalid progress.", stages);
        }
        if (event.event === "stage.started" || event.event === "stage.completed") {
          publish(event.stage, event.event === "stage.started" ? "running" : "completed");
        } else if (event.event === "result") {
          if (!boundedText(event.mesh, 4_096) || !Number.isSafeInteger(event.sizeBytes)) {
            fail("formsmith_reconstruction_failed", "ShapeR emitted invalid mesh metadata.", stages);
          }
          mesh = event.mesh;
          declaredSize = event.sizeBytes;
        } else if (event.event === "error") {
          bridgeError = boundedText(event.message, MAX_FAILURE_BYTES)
            ? event.message
            : "ShapeR could not reconstruct the picture.";
        } else {
          fail("formsmith_reconstruction_failed", "ShapeR emitted an unknown progress event.", stages);
        }
      },
    });
  } catch (error) {
    if (error instanceof FormsmithExecutorError && error.stages.length === 0) error.stages = stages;
    throw error;
  }
  if (result.code !== 0 || !mesh) {
    fail(
      "formsmith_reconstruction_failed",
      utf8Tail(bridgeError ?? result.stderr, MAX_FAILURE_BYTES) ||
        `ShapeR stopped unexpectedly (exit ${result.code ?? "unknown"}).`,
      stages,
    );
  }
  const meshPath = directMesh(stageRoot, mesh, declaredSize);
  for (const name of ["example", "output"]) {
    const target = path.join(stageRoot, name);
    if (pathWithin(stageRoot, target) && !samePath(stageRoot, target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  return {
    ok: true,
    operation: "reconstruct",
    meshRelativePath: relativeDataPath(launch.dataRoot, meshPath),
    meshSizeBytes: fs.statSync(meshPath).size,
    durationMs: Date.now() - startedAt,
    stages,
  };
}

export async function executeFormsmith(launch, signal, progress, inputPath, options = {}) {
  const env = options.env ?? process.env;
  if (launch.request.operation === "probe") {
    return {
      ok: true,
      operation: "probe",
      health: await probeHealth(launch, signal, env),
    };
  }
  return await reconstruct(launch, signal, progress, inputPath, env);
}

export function formsmithExecutionFailure(error) {
  const code = error instanceof FormsmithExecutorError
    ? error.code
    : "formsmith_reconstruction_failed";
  const message = error instanceof FormsmithExecutorError
    ? error.message
    : "ShapeR reconstruction was interrupted.";
  return {
    ok: false,
    operation: "reconstruct",
    error: {
      code: /^[a-z][a-z0-9_]{0,127}$/u.test(code) ? code : "formsmith_reconstruction_failed",
      message: utf8Tail(message, MAX_FAILURE_BYTES) || "ShapeR reconstruction was interrupted.",
    },
    stages: error instanceof FormsmithExecutorError && Array.isArray(error.stages)
      ? error.stages.slice(0, 16)
      : [],
  };
}
