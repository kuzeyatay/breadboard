import { spawn } from "node:child_process";

const MAX_CHILD_RESTARTS = 3;
const CHILD_RESTART_BACKOFF_MS = [1_000, 2_000, 4_000];
const STABLE_CHILD_UPTIME_MS = 5 * 60_000;
// The Vulkan-backed llama.cpp child retains native graph allocations across a
// long sequence of unrelated page images. Keep that growth inside the service
// lease by recycling only the native child after a bounded amount of useful
// work. The parent stays alive, so Runtime V2 keeps the lease and endpoint.
const MAX_CHILD_COMPLETED_REQUESTS = 192;
const CHILD_RECYCLE_DELAY_MS = 1_000;
const SLOT_RELEASE_MARKER = "slot      release:";

function fail(message) {
  throw new Error(message);
}

function boundedText(value, fallback, maximum = 4_096) {
  const text = (value ?? "").trim();
  if (!text) return fallback;
  if (Buffer.byteLength(text, "utf8") > maximum || /\p{Cc}/u.test(text)) {
    fail("The sealed VLM OCR service configuration is invalid.");
  }
  return text;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function servicePort(argv) {
  if (argv.length !== 2 || argv[0] !== "--port" || !/^\d{1,5}$/u.test(argv[1])) {
    fail("The Runtime V2 VLM OCR service requires one bounded --port argument.");
  }
  const port = Number(argv[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    fail("The Runtime V2 VLM OCR service port is invalid.");
  }
  return port;
}

function launchShape(port) {
  if (process.env.VLM_OCR_RUNTIME_MANAGED !== "1") {
    fail("The VLM OCR service may only run in Runtime-managed mode.");
  }
  const baseUrl = new URL(boundedText(process.env.VLM_OCR_BASE_URL, ""));
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.hostname !== "127.0.0.1" ||
    Number(baseUrl.port) !== port ||
    baseUrl.pathname.replace(/\/+$/u, "") !== "/v1" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    fail("The allocated VLM OCR endpoint is invalid.");
  }

  const binary = boundedText(process.env.VLM_OCR_SERVER_BINARY, "llama-server", 2_048);
  const contextSize = boundedInteger(process.env.VLM_OCR_CONTEXT_SIZE, 10_240, 2_048, 1_048_576);
  const maximumTokens = boundedInteger(process.env.VLM_OCR_MAX_TOKENS, 4_096, 256, 1_048_576);
  const parallelSlots = boundedInteger(process.env.VLM_OCR_CONCURRENCY, 1, 1, 8);
  const args = [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--alias",
    "hunyuan-ocr",
    "--ctx-size",
    String(contextSize),
    "--n-predict",
    String(maximumTokens),
    "--parallel",
    String(parallelSlots),
    // OCR page images do not share reusable prompt state. llama.cpp otherwise
    // keeps an 8 GiB RAM cache and retains vision allocations across pages.
    "--cache-ram",
    "0",
    "--no-cache-prompt",
    "--jinja",
  ];

  const model = process.env.VLM_OCR_MODEL_PATH?.trim();
  const mmproj = process.env.VLM_OCR_MMPROJ_PATH?.trim();
  if (model || mmproj) {
    if (!model || !mmproj) fail("Both sealed VLM OCR model paths are required together.");
    args.push("--model", model, "--mmproj", mmproj);
  } else {
    args.push(
      "-hf",
      boundedText(
        process.env.VLM_OCR_HF_REPO,
        "ggml-org/HunyuanOCR-GGUF:Q8_0",
        1_024,
      ),
    );
  }

  const gpuLayers = process.env.VLM_OCR_GPU_LAYERS?.trim();
  if (gpuLayers) {
    const parsed = boundedInteger(gpuLayers, -1, 0, 999);
    if (parsed < 0) fail("The sealed VLM OCR GPU layer count is invalid.");
    args.push("--n-gpu-layers", String(parsed));
  }
  return { binary, args };
}

function main() {
  const port = servicePort(process.argv.slice(2));
  const { binary, args } = launchShape(port);
  let stopping = false;
  let child = null;
  let restartTimer = null;
  let restarts = 0;

  const launch = () => {
    if (stopping) return;
    const launchedAt = Date.now();
    const launched = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = launched;
    let terminalObserved = false;
    let completedRequests = 0;
    let releaseScanTail = "";
    let recycleRequested = false;

    const forward = (source, destination, inspect = null) => {
      source?.on("data", (chunk) => {
        inspect?.(chunk);
        if (!destination.write(chunk)) {
          source.pause();
          destination.once("drain", () => source.resume());
        }
      });
    };

    forward(launched.stdout, process.stdout);
    forward(launched.stderr, process.stderr, (chunk) => {
      const text = releaseScanTail + chunk.toString("utf8");
      let from = 0;
      while (true) {
        const found = text.indexOf(SLOT_RELEASE_MARKER, from);
        if (found < 0) break;
        completedRequests += 1;
        from = found + SLOT_RELEASE_MARKER.length;
      }
      releaseScanTail = text.slice(-(SLOT_RELEASE_MARKER.length - 1));

      if (
        completedRequests >= MAX_CHILD_COMPLETED_REQUESTS &&
        !recycleRequested
      ) {
        recycleRequested = true;
        process.stderr.write(
          `[runtime-v2-vlm-ocr] recycling native child after ${completedRequests} completed OCR requests\n`,
        );
        setTimeout(() => {
          if (!stopping && child === launched) launched.kill();
        }, 0);
      }
    });

    const recover = (detail) => {
      if (terminalObserved) return;
      terminalObserved = true;
      if (stopping) {
        process.exitCode = 0;
        return;
      }
      if (recycleRequested) {
        restarts = 0;
        process.stderr.write(
          `[runtime-v2-vlm-ocr] ${detail}; restarting recycled child in ${CHILD_RECYCLE_DELAY_MS}ms\n`,
        );
        restartTimer = setTimeout(launch, CHILD_RECYCLE_DELAY_MS);
        return;
      }
      if (Date.now() - launchedAt >= STABLE_CHILD_UPTIME_MS) restarts = 0;
      if (restarts >= MAX_CHILD_RESTARTS) {
        process.stderr.write(
          `[runtime-v2-vlm-ocr] ${detail}; exhausted ${MAX_CHILD_RESTARTS} in-lease child restarts\n`,
        );
        process.exitCode = 1;
        return;
      }
      const backoff = CHILD_RESTART_BACKOFF_MS[restarts] ?? 4_000;
      restarts += 1;
      process.stderr.write(
        `[runtime-v2-vlm-ocr] ${detail}; restarting child ${restarts}/${MAX_CHILD_RESTARTS} in ${backoff}ms\n`,
      );
      restartTimer = setTimeout(launch, backoff);
    };
    launched.once("error", (error) => recover(`child launch failed: ${error.message}`));
    launched.once("exit", (code, signal) => {
      const reason = signal
        ? `child exited from signal ${signal}`
        : `child exited with code ${code ?? "unknown"}`;
      recover(reason);
    });
  };

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    try {
      child?.kill();
    } catch {
      // The authoritative Runtime job tree still provides the forced boundary.
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  launch();
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[runtime-v2-vlm-ocr] startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
