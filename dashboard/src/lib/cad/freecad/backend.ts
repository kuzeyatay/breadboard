import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CadServiceError } from "../errors.ts";
import { cadServiceConvert, type CadExecuteRequest, type CadExecuteResponse } from "../service.ts";
import { FREECAD_MCP_COMMIT, freecadHome, freecadRoot } from "./config.ts";
import { executeFreeCADMcp, type FreeCADMcpRequest } from "./mcp.ts";

export interface FreeCADBuildInput {
  source: string;
  request: CadExecuteRequest;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  emit?: (type: string, payload: Record<string, unknown>) => void;
  execute?: (input: FreeCADMcpRequest) => Promise<string>;
  convert?: typeof cadServiceConvert;
}

function produced(directory: string, filename: string, maxBytes = 100 * 1024 * 1024): Buffer {
  const target = path.join(directory, filename);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(target); } catch {
    throw new CadServiceError("freecad_export_missing", `FreeCAD did not produce ${filename}.`, { retryable: true });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maxBytes) {
    throw new CadServiceError("freecad_export_invalid", `FreeCAD produced an invalid ${filename}.`, { retryable: true });
  }
  return fs.readFileSync(target);
}

export async function buildWithFreeCAD(input: FreeCADBuildInput): Promise<CadExecuteResponse> {
  const env = input.env ?? process.env;
  input.signal?.throwIfAborted();
  const root = path.join(freecadHome(env), "builds");
  fs.mkdirSync(root, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(root, "build-"));
  const started = Date.now();
  const requestPath = path.join(workspace, "request.json");
  fs.writeFileSync(requestPath, JSON.stringify({
    source: input.source, entrypoint: input.request.entrypoint,
    parameters: input.request.parameters, directory: workspace,
  }), { mode: 0o600 });
  const runner = path.join(freecadRoot(env), "freecad-service", "runner.py");
  // JSON string syntax is also Python string syntax for these path strings.
  const code = `import runpy\nrunpy.run_path(${JSON.stringify(runner)}, init_globals={"REQUEST_PATH": ${JSON.stringify(requestPath)}})\n`;
  input.emit?.("cad.freecad.started", { upstream: "neka-nat/freecad-mcp", commit: FREECAD_MCP_COMMIT });
  try {
    const stdout = await (input.execute ?? executeFreeCADMcp)({
      code, timeoutMs: input.request.timeoutMs, env, signal: input.signal,
    });
    input.signal?.throwIfAborted();
    const receipt = JSON.parse(produced(workspace, "result.json", 1024 * 1024).toString("utf8"));
    if (receipt.ok !== true || typeof receipt.engineVersion !== "string" || !Array.isArray(receipt.bodyNames)) {
      throw new CadServiceError("freecad_build_failed", String(receipt.error || "FreeCAD did not finish the build."), { retryable: true });
    }
    const fcstd = produced(workspace, "model.FCStd");
    const step = produced(workspace, "model.step");
    if (fcstd.subarray(0, 2).toString() !== "PK" || !step.subarray(0, 80).toString().includes("ISO-10303-21")) {
      throw new CadServiceError("freecad_export_invalid", "FreeCAD exports have invalid file headers.", { retryable: true });
    }
    input.emit?.("cad.freecad.exported", { fcstdBytes: fcstd.length, stepBytes: step.length, features: receipt.features });
    const measured = await (input.convert ?? cadServiceConvert)({
      format: "step", contentBase64: step.toString("base64"), timeoutMs: input.request.timeoutMs,
      exports: input.request.exports.filter((item) => item.format !== "step"),
      expectations: input.request.expectations,
      linearTolerance: input.request.linearTolerance, angularTolerance: input.request.angularTolerance,
    }, { env, signal: input.signal });
    if (!measured.ok) return { ...measured, engine: "freecad", engineVersion: receipt.engineVersion };
    const issues = [...measured.issues];
    if (measured.solidCount !== receipt.bodyNames.length || !Number.isFinite(receipt.volume) ||
        measured.volume <= 0 || Math.abs(measured.volume - receipt.volume) / measured.volume > 0.01) {
      issues.push({ code: "freecad_export_mismatch", severity: "error",
        message: "The exported STEP does not match the FreeCAD document's solid count or volume." });
    }
    const extra = [{ format: "fcstd", filename: "model.FCStd", bytes: fcstd },
      { format: "step", filename: "model.step", bytes: step }];
    return {
      ...measured, issues, engine: "freecad", engineVersion: receipt.engineVersion,
      effectiveParameters: receipt.parameters, stdout, durationMs: Date.now() - started,
      files: { ...measured.files, fcstd, step },
      exports: [...measured.exports, ...extra.map(({ format, filename, bytes }) => ({
        format, filename, byteSize: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      }))],
    };
  } finally {
    // Only a directory created by this call, under the application build root.
    if (path.dirname(workspace) === root) fs.rmSync(workspace, { recursive: true, force: true });
  }
}
