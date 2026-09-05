import "server-only";

// Cross-platform learned-workflow replay through Hermes Agent's background
// computer-use backend. The Python worker is embedded so it remains part of
// Next's standalone server bundle; the actual desktop implementation stays in
// Hermes (`CuaDriverBackend`) and therefore follows its Windows/macOS/Linux
// behavior and cua-driver compatibility fixes.

import fs from "node:fs";
import path from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import { repositoryRoot } from "../runtime-paths.ts";
import { teachLog, teachWarn } from "./redaction.ts";
import type {
  ActionResult,
  ComputerAction,
  ComputerObservation,
  ObservedElement,
  WorkflowComputerBackend,
} from "./types.ts";

const COMMAND_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 35_000;
const CHECK_TIMEOUT_MS = 10_000;
const AVAILABILITY_TTL_MS = 15_000;

interface PendingCommand {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface HermesWorkerRuntime {
  python: string;
  appDirectory: string;
  env: NodeJS.ProcessEnv;
}

let availabilityCache: {
  key: string;
  checkedAt: number;
  value: { available: boolean; reason?: string };
} | null = null;

const WORKER_SOURCE = String.raw`
from __future__ import annotations

import base64
import json
import os
import sys
from typing import Any, Dict, Optional

from tools.computer_use.cua_backend import CuaDriverBackend, cua_driver_install_hint
from tools.computer_use.tool import _BLOCKED_KEY_COMBOS, _canon_key_combo, _is_blocked_type


def emit(value: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


def create_backend():
    # Hermes owns this test seam. Using it here lets Breadboard verify the
    # protocol without installing or touching a real desktop driver in CI.
    if os.environ.get("HERMES_COMPUTER_USE_BACKEND", "").lower() == "noop":
        from tools.computer_use.tool import _NoopBackend
        return _NoopBackend()
    return CuaDriverBackend()


def availability() -> Dict[str, Any]:
    try:
        backend = create_backend()
        if not backend.is_available():
            return {
                "available": False,
                "platform": sys.platform,
                "reason": cua_driver_install_hint(),
            }
        return {"available": True, "platform": sys.platform}
    except Exception as exc:
        return {"available": False, "platform": sys.platform, "reason": str(exc)}


if len(sys.argv) > 1 and sys.argv[1] == "--check":
    emit(availability())
    raise SystemExit(0)


backend = None
active_target = None


def get_backend():
    global backend
    if backend is None:
        candidate = create_backend()
        if not candidate.is_available():
            raise RuntimeError(cua_driver_install_hint())
        candidate.start()
        backend = candidate
    return backend


def capture_target(mode: str):
    """Capture the run's selected window, never whichever app is frontmost now."""
    global active_target
    control = get_backend()
    if active_target:
        capture = control.capture(
            mode=mode,
            app=active_target.get("app"),
            pid=active_target.get("pid"),
            window_id=active_target.get("window_id"),
        )
    else:
        capture = control.capture(mode=mode)
        resolved = getattr(control, "_last_target", None) or {}
        if resolved.get("pid") and resolved.get("window_id"):
            active_target = {
                "app": capture.app or None,
                "pid": resolved.get("pid"),
                "window_id": resolved.get("window_id"),
            }
    return capture


def ref_index(value: Any) -> Optional[int]:
    if not isinstance(value, str) or not value.startswith("hcu:"):
        return None
    try:
        parsed = int(value.split(":", 1)[1])
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def action_result(result: Any) -> Dict[str, Any]:
    escalation = result.escalation if isinstance(result.escalation, dict) else None
    foreground_recommended = bool(escalation and escalation.get("recommended") == "foreground")
    landed = (
        bool(result.ok)
        and result.effect != "suspected_noop"
        and result.code != "background_unavailable"
        and not foreground_recommended
    )
    detail = {
        "action": result.action,
        "message": result.message,
        "verified": result.verified,
        "effect": result.effect,
        "path": result.path,
        "degraded": result.degraded,
        "deliveryMode": "background",
        "code": result.code,
        "escalation": escalation,
    }
    if foreground_recommended:
        detail["foregroundEscalationSuppressed"] = True
    return {
        "ok": landed,
        "detail": detail,
        **({"error": result.message or "Hermes could not verify that the background action landed."} if not landed else {}),
    }


def element_dict(element: Any) -> Dict[str, Any]:
    attrs = element.attributes if isinstance(element.attributes, dict) else {}
    x, y, width, height = element.bounds
    label = str(element.label or "").strip()
    role = str(element.role or "control").strip()
    describe = role + (" " + json.dumps(label, ensure_ascii=False) if label else "")
    value = attrs.get("value")
    return {
        "ref": f"hcu:{element.index}",
        "describe": describe,
        "name": label or None,
        "role": role or None,
        "automationId": attrs.get("automation_id") or attrs.get("automationId") or attrs.get("identifier"),
        "className": attrs.get("class_name") or attrs.get("className"),
        "value": str(value) if value is not None else None,
        "enabled": attrs.get("enabled") if isinstance(attrs.get("enabled"), bool) else None,
        "isPassword": bool(attrs.get("is_password") or attrs.get("isPassword") or attrs.get("password")),
        "left": x,
        "top": y,
        "width": width,
        "height": height,
    }


def observe(command: Dict[str, Any]) -> Dict[str, Any]:
    control = get_backend()
    capture = capture_target("ax")
    max_elements = command.get("maxElements")
    if not isinstance(max_elements, int) or max_elements <= 0:
        max_elements = 220
    elements = [element_dict(item) for item in capture.elements[:min(max_elements, 1000)]]
    response = {
        "ok": True,
        "foreground": {
            "app": capture.app or None,
            "windowTitle": capture.window_title or None,
        },
        "screen": {"width": capture.width, "height": capture.height},
        "elements": elements,
        "totalElements": len(capture.elements),
    }
    screenshot_path = str(command.get("screenshotPath") or "").strip()
    if screenshot_path and capture.png_b64:
        destination = os.path.abspath(screenshot_path)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        with open(destination, "wb") as handle:
            handle.write(base64.b64decode(capture.png_b64, validate=False))
        response["screenshotPath"] = destination
    if command.get("includeAllWindows"):
        response["windows"] = [
            {
                "app": item.get("app_name") or None,
                "windowTitle": str(item.get("title") or ""),
            }
            for item in control.list_windows()
            if item.get("title") is not None
        ]
    return response


def focus_window(command: Dict[str, Any]) -> Dict[str, Any]:
    global active_target
    control = get_backend()
    app = str(command.get("app") or "").strip()
    title = str(command.get("titleContains") or "").strip()
    windows = control.list_windows()
    candidates = windows
    if app:
        needle = app.casefold()
        candidates = [item for item in candidates if needle in str(item.get("app_name") or "").casefold()]
    if title:
        needle = title.casefold()
        candidates = [item for item in candidates if needle in str(item.get("title") or "").casefold()]
    if not candidates:
        return {"ok": False, "error": f"No background window matched {app or title!r}."}
    target = candidates[0]
    capture = control.capture(
        mode="ax",
        app=str(target.get("app_name") or app),
        pid=int(target["pid"]),
        window_id=int(target["window_id"]),
    )
    if not capture.app and not capture.elements and capture.width == 0 and capture.height == 0:
        return {"ok": False, "error": capture.window_title or "Hermes could not target that window."}
    active_target = {
        "app": str(target.get("app_name") or app) or None,
        "pid": int(target["pid"]),
        "window_id": int(target["window_id"]),
    }
    return {
        "ok": True,
        "detail": {
            "app": capture.app or target.get("app_name"),
            "windowTitle": capture.window_title or target.get("title"),
            "deliveryMode": "background",
        },
    }


def execute(command: Dict[str, Any]) -> Dict[str, Any]:
    control = get_backend()
    op = str(command.get("op") or "")
    if op == "focus_window":
        return focus_window(command)
    if op == "click":
        index = ref_index(command.get("ref"))
        return action_result(control.click(
            element=index,
            x=command.get("x") if index is None else None,
            y=command.get("y") if index is None else None,
            button=str(command.get("button") or "left"),
            click_count=max(1, min(2, int(command.get("clicks") or 1))),
            delivery_mode="background",
            bring_to_front=False,
        ))
    if op == "type":
        text = str(command.get("text") or "")
        blocked = _is_blocked_type(text)
        if blocked:
            return {"ok": False, "error": "Dangerous shell text is hard-blocked by Hermes computer use."}
        index = ref_index(command.get("ref"))
        if index is not None:
            focused = action_result(control.click(element=index, delivery_mode="background", bring_to_front=False))
            if not focused["ok"]:
                return focused
        if command.get("clear"):
            selected = action_result(control.key(
                "cmd+a" if sys.platform == "darwin" else "ctrl+a",
                delivery_mode="background",
                bring_to_front=False,
            ))
            if not selected["ok"]:
                return selected
            cleared = action_result(control.key("backspace", delivery_mode="background", bring_to_front=False))
            if not cleared["ok"]:
                return cleared
        return action_result(control.type_text(text, delivery_mode="background", bring_to_front=False))
    if op == "key":
        key = str(command.get("key") or "")
        modifiers = [str(item) for item in command.get("modifiers", []) if str(item).strip()]
        combo = "+".join([*modifiers, key])
        canonical = _canon_key_combo(combo)
        if any(blocked.issubset(canonical) for blocked in _BLOCKED_KEY_COMBOS):
            return {"ok": False, "error": "This destructive system shortcut is hard-blocked by Hermes computer use."}
        return action_result(control.key(combo, delivery_mode="background", bring_to_front=False))
    if op == "scroll":
        index = ref_index(command.get("ref"))
        notches = int(command.get("notches") or -3)
        return action_result(control.scroll(
            direction="down" if notches < 0 else "up",
            amount=max(1, min(50, abs(notches))),
            element=index,
            delivery_mode="background",
            bring_to_front=False,
        ))
    if op == "screenshot":
        capture = capture_target("vision")
        if not capture.png_b64:
            return {"ok": False, "error": "Hermes returned no background screenshot."}
        raw_destination = str(command.get("path") or "").strip()
        if not raw_destination:
            return {"ok": False, "error": "A screenshot path is required."}
        destination = os.path.abspath(raw_destination)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        with open(destination, "wb") as handle:
            handle.write(base64.b64decode(capture.png_b64, validate=False))
        return {"ok": True, "detail": {"path": destination, "mimeType": capture.image_mime_type}}
    return {"ok": False, "error": f"Unsupported Hermes computer operation: {op}"}


for raw_line in sys.stdin:
    request_id = None
    try:
        command = json.loads(raw_line)
        request_id = command.get("id")
        op = str(command.get("op") or "")
        if op == "ping":
            get_backend()
            response = {"ok": True, "platform": sys.platform, "background": True}
        elif op == "observe":
            response = observe(command)
        elif op == "exit":
            response = {"ok": True}
            emit({**response, "id": request_id})
            break
        else:
            response = execute(command)
        emit({**response, "id": request_id})
    except Exception as exc:
        emit({"ok": False, "id": request_id, "error": str(exc)})

if backend is not None:
    try:
        backend.stop()
    except Exception:
        pass
`;

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function helperEnvironment(appDirectory: string): NodeJS.ProcessEnv {
  const names = [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "SystemDrive",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "USERPROFILE",
    "HOME",
    "USER",
    "LOGNAME",
    "TEMP",
    "TMP",
    "TMPDIR",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
    "HERMES_HOME",
    "HERMES_CUA_DRIVER_CMD",
    "HERMES_COMPUTER_USE_BACKEND",
    "CUA_DRIVER_RS_TELEMETRY_ENABLED",
  ];
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const hermesHome = process.env.BREADBOARD_HERMES_HOME?.trim();
  if (hermesHome) env.HERMES_HOME = hermesHome;
  env.PYTHONPATH = appDirectory;
  env.PYTHONIOENCODING = "utf-8";
  // Breadboard does not opt users into cua-driver telemetry.
  env.CUA_DRIVER_RS_TELEMETRY_ENABLED ??= "0";
  return env;
}

function resolveRuntime(): HermesWorkerRuntime {
  const appDirectory = path.resolve(
    process.env.BREADBOARD_HERMES_APP_DIR?.trim() ||
      path.join(repositoryRoot(), "hermes-agent"),
  );
  const configuredPython = process.env.BREADBOARD_HERMES_PYTHON?.trim();
  const venvPython = path.join(
    appDirectory,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  const python = configuredPython || firstExisting([venvPython]) ||
    (process.platform === "win32" ? "python.exe" : "python3");
  return { python, appDirectory, env: helperEnvironment(appDirectory) };
}

function parseResponseLine(value: string): Record<string, unknown> | null {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Hermes may log a setup note before the protocol response.
    }
  }
  return null;
}

export class HermesComputerBackend implements WorkflowComputerBackend {
  readonly platform = process.platform;

  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<ChildProcessWithoutNullStreams> | null = null;
  private readonly pending = new Map<string, PendingCommand>();
  private sequence = 0;
  private stopped = false;
  private stopping: Promise<void> | null = null;

  available(): { available: boolean; reason?: string } {
    if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
      return {
        available: false,
        reason: `Hermes background computer use does not support ${process.platform}.`,
      };
    }
    const runtime = resolveRuntime();
    const cacheKey = [
      runtime.python,
      runtime.appDirectory,
      runtime.env.HERMES_CUA_DRIVER_CMD ?? "",
      runtime.env.HERMES_COMPUTER_USE_BACKEND ?? "",
    ].join("\0");
    if (
      availabilityCache?.key === cacheKey &&
      Date.now() - availabilityCache.checkedAt < AVAILABILITY_TTL_MS
    ) {
      return availabilityCache.value;
    }
    const remember = (value: { available: boolean; reason?: string }) => {
      availabilityCache = { key: cacheKey, checkedAt: Date.now(), value };
      return value;
    };
    if (!fs.existsSync(runtime.appDirectory)) {
      return remember({ available: false, reason: "The Hermes Agent runtime is not installed." });
    }
    const checked = spawnSync(runtime.python, ["-u", "-c", WORKER_SOURCE, "--check"], {
      cwd: runtime.appDirectory,
      env: runtime.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const response = parseResponseLine(checked.stdout ?? "");
    if (checked.error) {
      return remember({
        available: false,
        reason: `Hermes computer use could not start: ${checked.error.message}`,
      });
    }
    if (response?.available === true) return remember({ available: true });
    const reason = typeof response?.reason === "string"
      ? response.reason
      : (checked.stderr || "Hermes computer use is unavailable on this machine.").trim();
    return remember({ available: false, reason });
  }

  private async ensureChild(): Promise<ChildProcessWithoutNullStreams> {
    if (this.stopped) throw new Error("This computer backend has been stopped.");
    if (this.child && this.child.exitCode === null) return this.child;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const runtime = resolveRuntime();
      const child = spawn(runtime.python, ["-u", "-c", WORKER_SOURCE], {
        cwd: runtime.appDirectory,
        env: runtime.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;

      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) this.deliver(line);
          index = buffer.indexOf("\n");
        }
        if (buffer.length > 8 * 1024 * 1024) buffer = "";
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        teachWarn("computer", "Hermes computer-use worker reported a problem", {
          chunk: String(chunk).slice(0, 2_000),
        });
      });
      child.stdin.on("error", () => undefined);
      child.once("exit", (code) => {
        this.child = null;
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`Hermes computer use exited with code ${code}.`));
        }
        this.pending.clear();
      });

      this.child = child;
      await this.send({ op: "ping" }, START_TIMEOUT_MS);
      teachLog("computer", "Hermes background computer use started", {
        platform: this.platform,
      });
      return child;
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private deliver(line: string): void {
    const message = parseResponseLine(line);
    const id = typeof message?.id === "string" ? message.id : null;
    if (!message || !id) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  }

  private send(
    command: Record<string, unknown>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      return Promise.reject(new Error("Hermes computer use is not running."));
    }
    this.sequence += 1;
    const id = `hcu${this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Hermes computer use did not answer in time."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error as Error);
      }
    });
  }

  private async call(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureChild();
    const response = await this.send(command);
    if (response.ok !== true) {
      throw new Error(
        typeof response.error === "string"
          ? response.error
          : "The Hermes background desktop action failed.",
      );
    }
    return response;
  }

  async observe(
    options: { screenshotPath?: string; maxElements?: number; includeAllWindows?: boolean } = {},
  ): Promise<ComputerObservation> {
    const response = await this.call({
      op: "observe",
      maxElements: options.maxElements ?? 220,
      ...(options.screenshotPath ? { screenshotPath: options.screenshotPath } : {}),
      ...(options.includeAllWindows ? { includeAllWindows: true } : {}),
    });
    const rawElements = Array.isArray(response.elements) ? response.elements : [];
    const elements: ObservedElement[] = [];
    for (const raw of rawElements) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.ref !== "string" || typeof item.describe !== "string") continue;
      elements.push({
        ref: item.ref,
        describe: item.describe,
        name: typeof item.name === "string" ? item.name : undefined,
        role: typeof item.role === "string" ? item.role : undefined,
        automationId: typeof item.automationId === "string" ? item.automationId : undefined,
        className: typeof item.className === "string" ? item.className : undefined,
        value: typeof item.value === "string" ? item.value : undefined,
        enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
        isPassword: item.isPassword === true,
        left: typeof item.left === "number" ? item.left : undefined,
        top: typeof item.top === "number" ? item.top : undefined,
        width: typeof item.width === "number" ? item.width : undefined,
        height: typeof item.height === "number" ? item.height : undefined,
      });
    }
    const foreground = (response.foreground ?? {}) as Record<string, unknown>;
    const screen = (response.screen ?? {}) as Record<string, unknown>;
    const windows = Array.isArray(response.windows)
      ? (response.windows as Array<Record<string, unknown>>)
          .filter((item) => typeof item.windowTitle === "string")
          .map((item) => ({
            windowTitle: item.windowTitle as string,
            app: typeof item.app === "string" ? item.app : undefined,
          }))
      : undefined;
    return {
      foreground: {
        app: typeof foreground.app === "string" ? foreground.app : undefined,
        windowTitle: typeof foreground.windowTitle === "string" ? foreground.windowTitle : undefined,
      },
      screen: {
        width: typeof screen.width === "number" ? screen.width : 0,
        height: typeof screen.height === "number" ? screen.height : 0,
      },
      elements,
      ...(windows ? { windows } : {}),
      ...(typeof response.screenshotPath === "string"
        ? { screenshotPath: response.screenshotPath }
        : {}),
    };
  }

  async execute(action: ComputerAction): Promise<ActionResult> {
    try {
      const response = await this.call({
        op: action.kind,
        ...action,
      });
      const detail = response.detail && typeof response.detail === "object"
        ? response.detail as Record<string, unknown>
        : undefined;
      return { ok: true, ...(detail ? { detail } : {}) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopWorker();
    return this.stopping;
  }

  private async stopWorker(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child) return;
    const exited = child.exitCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      if (!child.stdin.writableEnded) {
        child.stdin.write(`${JSON.stringify({ op: "exit", id: "exit" })}\n`);
        child.stdin.end();
      }
    } catch {
      // The worker has already released the pipe.
    }
    const settled = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
    ]);
    if (!settled) {
      try {
        child.kill();
      } catch {
        // Nothing left to stop.
      }
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    this.child = null;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("The learned workflow was stopped."));
    }
    this.pending.clear();
    teachLog("computer", "Hermes background computer use stopped");
  }

  processId(): number | null {
    return this.child?.pid ?? null;
  }
}
