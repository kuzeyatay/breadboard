import { spawn } from "node:child_process";

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
  const child = spawn(binary, args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    try {
      child.kill();
    } catch {
      // The authoritative Runtime job tree still provides the forced boundary.
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("error", (error) => {
    process.stderr.write(`[runtime-v2-vlm-ocr] launch failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0);
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[runtime-v2-vlm-ocr] startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
