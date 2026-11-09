import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as http from "node:http";
import * as path from "node:path";
import { DEFAULT_GESTURE_SETTINGS, gestureSettingsFromConfig, isGestureSettings,
  type GestureControlAction, type GestureControlState, type GestureSettings } from "../shared/gesture-control";

interface Descriptor { version: 1; port: number; pid: number; token: string }
interface Options {
  appRoot: string;
  platform?: string;
  log?: (line: string) => void;
  launch?: (executable: string, args: string[], cwd: string) => ChildProcess;
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Fixed local native-input helper. Renderers cannot choose executables, URLs or keys. */
export class GestureController {
  private readonly root: string;
  private readonly executable: string;
  private readonly launcher: string;
  private readonly descriptorFile: string;
  private readonly settingsFile: string;
  private operation: Promise<unknown> = Promise.resolve();
  private ownedToken: string | null = null;
  private closing = false;
  private lastError: string | undefined;

  constructor(private readonly options: Options) {
    this.root = path.join(options.appRoot, "aircursor");
    this.executable = path.join(this.root, ".venv", "Scripts", "pythonw.exe");
    this.launcher = path.join(this.root, "start_external.pyw");
    this.descriptorFile = path.join(this.root, ".install-tmp", "breadboard-controller.json");
    this.settingsFile = path.join(this.root, "settings.json");
  }

  private available(): boolean {
    return (this.options.platform ?? process.platform) === "win32" &&
      existsSync(this.executable) && existsSync(this.launcher);
  }

  private stopped(error = this.lastError): GestureControlState {
    return { available: this.available(), phase: "stopped", paused: true, status: "Camera off",
      detail: "", display: "External monitor", image: null,
      settingsDefaults: DEFAULT_GESTURE_SETTINGS, ...(error ? { error } : {}) };
  }

  private async descriptor(): Promise<Descriptor | null> {
    try {
      const raw = await readFile(this.descriptorFile, "utf8");
      if (raw.length > 1024) return null;
      const value = JSON.parse(raw) as Partial<Descriptor>;
      if (value.version !== 1 || !Number.isInteger(value.port) || value.port! < 1024 || value.port! > 65535 ||
          !Number.isInteger(value.pid) || value.pid! < 1 || typeof value.token !== "string" ||
          !/^[a-f0-9]{64}$/.test(value.token)) return null;
      return value as Descriptor;
    } catch { return null; }
  }

  private exchange(descriptor: Descriptor, action?: "pause" | "stop" | "embed" | "reload-settings"): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const body = action ? JSON.stringify({ action }) : null;
      const request = http.request({ hostname: "127.0.0.1", port: descriptor.port,
        path: action ? "/command" : "/snapshot", method: action ? "POST" : "GET",
        headers: { Authorization: `Bearer ${descriptor.token}`,
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}) },
      }, response => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 1_000_000) { response.destroy(new Error("Gesture preview is too large.")); return; }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) throw new Error("Gesture controller refused the request.");
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) { reject(error); }
        });
      });
      request.setTimeout(1500, () => request.destroy(new Error("Gesture controller did not respond.")));
      request.on("error", reject);
      request.end(body);
    });
  }

  private async snapshot(descriptor: Descriptor): Promise<GestureControlState> {
    const value = await this.exchange(descriptor) as GestureControlState;
    if (!value || !["initializing", "running", "error"].includes(value.phase) || typeof value.paused !== "boolean" ||
        [value.status, value.detail, value.display].some(field => typeof field !== "string" || field.length > 500) ||
        (value.image !== null && (typeof value.image !== "string" || !/^[A-Za-z0-9+/=]+$/.test(value.image)))) {
      throw new Error("Invalid gesture controller response.");
    }
    if (value.phase === "error") this.lastError = value.status;
    const saved = value.settings && isGestureSettings(value.settings) ? value.settings : (await this.saved()).settings;
    return { available: true, phase: value.phase, paused: value.paused, status: value.status,
      detail: value.detail, display: value.display, image: value.image,
      settings: saved, settingsDefaults: DEFAULT_GESTURE_SETTINGS,
      settingsRevision: typeof value.settingsRevision === "string" ? value.settingsRevision.slice(0, 64) : "",
      ...(typeof value.settingsError === "string" ? { settingsError: value.settingsError.slice(0, 500) } : {}),
      ...(value.phase === "error" ? { error: value.status } : {}) };
  }

  private async state(): Promise<GestureControlState> {
    const descriptor = await this.descriptor();
    if (descriptor) {
      try { return await this.snapshot(descriptor); } catch { /* exited or stale descriptor */ }
    }
    try {
      const saved = await this.saved();
      return { ...this.stopped(), settings: saved.settings, settingsRevision: saved.revision };
    } catch (error) {
      return this.stopped(error instanceof Error ? error.message : "Could not read gesture settings.");
    }
  }

  request(action: GestureControlAction, settings?: unknown): Promise<GestureControlState> {
    if (action === "state") return this.state();
    const next = this.operation.then(async () => {
      if (this.closing) return this.stopped();
      try {
        if (action === "save-settings") {
          if (!isGestureSettings(settings)) throw new Error("Invalid gesture settings. Check the values and try again.");
          return await this.save(settings);
        }
        if (action === "start") return await this.start();
        const descriptor = await this.descriptor();
        if (!descriptor) return this.stopped();
        await this.exchange(descriptor, action);
        // Acknowledge the applied action, not merely its queue insertion.
        for (let i = 0; i < 30; i++) {
          await delay(100);
          const state = await this.state();
          if (state.phase === "stopped" || (action === "pause" && state.paused)) return state;
        }
        throw new Error(`Could not ${action} gesture control. Use Ctrl+Alt+Esc to stop it.`);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Gesture control is unavailable.";
        this.options.log?.(`[gestures] ${this.lastError}`);
        const state = await this.state();
        return { ...state, error: this.lastError };
      }
    });
    this.operation = next;
    return next;
  }

  private async saved() {
    let raw = "{}";
    try { raw = await readFile(this.settingsFile, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (raw.length > 64_000) throw new Error("Gesture settings file is too large.");
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid gesture settings file.");
    return { config, raw, settings: gestureSettingsFromConfig(config),
      revision: typeof config.settings_revision === "string" ? config.settings_revision : "" };
  }

  private async writeSettings(raw: string): Promise<void> {
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, raw, { encoding: "utf8", flag: "wx" });
      await rename(temporary, this.settingsFile);
    } finally { await unlink(temporary).catch(() => {}); }
  }

  private async save(settings: GestureSettings): Promise<GestureControlState> {
    if (!this.available()) throw new Error("Gesture control is not installed for this Breadboard desktop.");
    const original = await this.saved();
    let descriptor = await this.descriptor();
    if (descriptor) {
      try {
        const current = await this.snapshot(descriptor);
        if (current.phase !== "running") throw new Error("Wait for the camera to be ready, then apply settings.");
        await this.exchange(descriptor, "pause");
        const deadline = Date.now() + 3000;
        while (!(await this.snapshot(descriptor)).paused) {
          if (Date.now() >= deadline) throw new Error("Could not pause gesture control before applying settings.");
          await delay(100);
        }
      } catch (error) {
        if ((await this.state()).phase !== "stopped") throw error;
        descriptor = null;
      }
    }
    const revision = randomUUID();
    await this.writeSettings(JSON.stringify({ ...original.config, ...settings,
      start_paused: true, settings_revision: revision }, null, 2) + "\n");
    this.lastError = undefined;
    if (!descriptor) return this.state();
    try {
      await this.exchange(descriptor, "reload-settings");
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const state = await this.snapshot(descriptor);
        if (state.settingsError) throw new Error(state.settingsError);
        if (state.settingsRevision === revision && state.paused) return state;
        await delay(100);
      }
      throw new Error("The camera did not apply the new settings.");
    } catch {
      // Roll back only our own write; preserve a concurrent external edit.
      if ((await this.saved()).revision === revision) {
        await this.writeSettings(original.raw);
        await this.exchange(descriptor, "reload-settings").catch(() => {});
      }
      throw new Error("Settings could not be applied. Your previous settings were kept. Reopen the camera and retry.");
    }
  }

  private async start(): Promise<GestureControlState> {
    this.lastError = undefined;
    if (!this.available()) throw new Error("Gesture control is not installed for this Breadboard desktop.");
    let descriptor = await this.descriptor();
    if (descriptor) {
      try {
        const current = await this.snapshot(descriptor);
        if (current.phase === "running") {
          await this.exchange(descriptor, "embed");
          return current;
        }
        if (current.phase === "error") throw new Error(current.status);
      } catch { descriptor = null; }
    }
    let child: ChildProcess | undefined;
    let failure: string | undefined;
    if (!descriptor) {
      const launch = this.options.launch ?? ((executable, args, cwd) => spawn(executable, args,
        { cwd, windowsHide: true, shell: false, stdio: "ignore" }));
      child = launch(this.executable, [this.launcher, "--embedded"], this.root);
      child.once("error", () => { failure = "Could not open the gesture camera. Try again."; });
      child.once("exit", code => {
        if (code !== 0 && !this.lastError) this.lastError = "Gesture control stopped unexpectedly. Try opening the camera again.";
        failure = this.lastError ?? "Gesture control could not open. Close any older AirCursor window and try again.";
      });
    }
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      descriptor = await this.descriptor();
      if (descriptor) {
        try {
          const state = await this.snapshot(descriptor);
          if (child) this.ownedToken = descriptor.token;
          if (state.phase === "error") return state;
          if (state.phase === "running") {
            await this.exchange(descriptor, "embed");
            return state;
          }
        } catch { /* descriptor is published just before the listener starts */ }
      }
      if (failure) throw new Error(failure);
      await delay(100);
    }
    // Ask a partially initialized owned helper to stop once its camera loop is ready.
    if (descriptor && this.ownedToken === descriptor.token) await this.exchange(descriptor, "stop").catch(() => {});
    throw new Error("The gesture camera did not respond. Check that another app is not using it, then retry.");
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.operation;
    const descriptor = await this.descriptor();
    if (descriptor && descriptor.token === this.ownedToken) {
      await this.exchange(descriptor, "stop").catch(() => {});
    }
  }
}
