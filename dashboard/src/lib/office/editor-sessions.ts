/**
 * Live GenOffice editor sessions. Each session is one forked Node host
 * (genoffice-host/<app>.cjs) editing a private copy of a Garden file; the
 * browser iframe drives it through /api/office/sessions/<id>. Whenever the
 * copy changes it becomes a new Garden version, and anything the editor saves
 * or exports elsewhere becomes a new Garden file beside the source. Both reach
 * Quartz through the Garden file store's mirror.
 */
import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import type { GardenFileEntry } from "../garden-files/types.ts";
import type { GardenFileScope, GardenFileStore } from "../garden-files/store.ts";

import { officeEditorApp, type OfficeEditorApp } from "./types.ts";
export { officeEditorApp, type OfficeEditorApp };

type HostMessage = { type: string; [key: string]: unknown };
type Subscriber = (message: HostMessage) => void;

/**
 * Where an editor session's document comes from and where its saves go: a
 * Garden file (Spaces) or a chat artifact. `current` is what the editor shell
 * is told about (Garden entry or presented artifact); the shell treats it as
 * opaque apart from echoing it back to the page that embeds it.
 */
export interface OfficeTarget<Current = unknown> {
  name: string;
  read(): Buffer;
  current(): Current;
  save(bytes: Buffer): Promise<Current>;
  /** Files the editor writes elsewhere (Save As, Export). Omitted: they are dropped. */
  exportFile?(name: string, bytes: Buffer): Promise<unknown>;
}

/** A Garden file as an editor target: each save is the next Garden version, exports land beside it. */
export function gardenOfficeTarget(store: GardenFileStore, scope: GardenFileScope, initial: GardenFileEntry): OfficeTarget<GardenFileEntry> {
  let file = initial;
  const stage = (bytes: Buffer) => store.stage(new Blob([new Uint8Array(bytes)]).stream());
  return {
    name: initial.name,
    read: () => fs.readFileSync(store.content(scope, initial.id).path),
    current: () => file,
    async save(bytes) {
      const staged = await stage(bytes);
      try { file = store.save(scope, file.id, file.revision, staged); return file; }
      finally { store.discard(staged); }
    },
    async exportFile(name, bytes) {
      const staged = await stage(bytes);
      try {
        const folder = file.folder ? `${file.folder}/` : "";
        const dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
        const taken = new Set(store.list(scope).filter(entry => entry.folder === file.folder).map(entry => entry.name.toLowerCase()));
        let candidate = name;
        for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
        return store.import(scope, `${folder}${candidate}`, staged);
      } finally { store.discard(staged); }
    },
  };
}

interface Session {
  id: string;
  userId: number;
  app: OfficeEditorApp;
  target: OfficeTarget;
  dir: string;
  docPath: string;
  child: ChildProcess;
  ready: Promise<void>;
  pending: Map<number, (message: HostMessage) => void>;
  subscribers: Set<Subscriber>;
  backlog: HostMessage[];
  syncedHash: string;
  exportsSeen: Map<string, number>;
  syncing: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
  pollTimer?: ReturnType<typeof setInterval>;
  closed: boolean;
}

const sessions = new Map<string, Session>();
let seq = 0;
const IDLE_CLOSE_MS = 90_000;
const POLL_MS = 3_000;

function hostDir(): string {
  const candidates = [process.env.BREADBOARD_GENOFFICE_HOST_DIR, path.join(process.cwd(), "genoffice-host"), path.join(repositoryRoot(), "dashboard", "genoffice-host")];
  for (const candidate of candidates) if (candidate && fs.existsSync(/* turbopackIgnore: true */ candidate)) return candidate;
  throw new Error("Breadboard's Office editors are not installed (genoffice-host is missing).");
}

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 160) || "file";

function broadcast(session: Session, message: HostMessage): void {
  if (!session.subscribers.size) { session.backlog.push(message); return; }
  for (const subscriber of session.subscribers) subscriber(message);
}

export interface OpenSessionInput {
  userId: number;
  target: OfficeTarget;
  theme: "light" | "dark";
  ai: { baseUrl: string; model: string };
}

export async function openOfficeSession(input: OpenSessionInput): Promise<{ id: string; app: OfficeEditorApp }> {
  const app = officeEditorApp(input.target.name);
  if (!app) throw new Error("This file type has no Office editor.");
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), "breadboard-office", id);
  fs.mkdirSync(path.join(dir, "doc"), { recursive: true });
  const docPath = path.join(dir, "doc", safeName(input.target.name));
  const bytes = input.target.read();
  fs.writeFileSync(docPath, bytes);

  const host = hostDir();
  const child = fork(/* turbopackIgnore: true */ path.join(host, `${app}.cjs`), [], {
    cwd: dir,
    serialization: "advanced",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      GENOFFICE_SESSION_DIR: dir,
      GENOFFICE_RESOURCES: path.join(host, "resources"),
      GENOFFICE_AI_BASE_URL: input.ai.baseUrl,
      GENOFFICE_AI_MODEL: input.ai.model,
      GENOFFICE_AI_KEY: process.env.OPENAI_API_KEY || "breadboard",
    },
  });
  // The host's own logging is diagnostics only; keep the pipes drained.
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", chunk => console.warn(`[office:${app}]`, String(chunk).trimEnd()));

  let opened!: () => void, failed!: (error: Error) => void;
  const session: Session = {
    id, userId: input.userId, app, target: input.target, dir, docPath, child,
    ready: new Promise<void>((resolve, reject) => { opened = resolve; failed = reject; }),
    pending: new Map(), subscribers: new Set(), backlog: [], syncedHash: sha(bytes), exportsSeen: new Map(),
    syncing: Promise.resolve(), closed: false,
  };
  session.ready.catch(() => undefined);
  sessions.set(id, session);

  child.on("message", raw => {
    const message = raw as HostMessage;
    switch (message.type) {
      case "booted": child.send({ type: "open", path: docPath, theme: input.theme }); return;
      case "ready": opened(); return;
      case "failed": failed(new Error(String(message.error))); return;
      case "result": case "protocol-result": {
        const waiter = session.pending.get(message.id as number);
        session.pending.delete(message.id as number);
        waiter?.(message);
        return;
      }
      case "host-request": {
        // printToPDF from the editor's hidden print window: rendered here, outside the host.
        const answer = (value: unknown) => { try { child.send({ type: "answer", id: message.id, value }); } catch { /* host gone */ } };
        const payload = message.payload as { url?: string; options?: object } | undefined;
        if (message.kind !== "print-to-pdf" || !payload?.url) { answer({ ok: false, error: "Unknown host request." }); return; }
        void import("./print-pdf.ts").then(({ printHtmlToPdf }) => printHtmlToPdf(payload.url!, payload.options))
          .then(data => answer({ ok: true, data }), error => answer({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return;
      }
      case "log": console.warn(`[office:${app}]`, message.message); return;
      case "quit": return;
      default: broadcast(session, message);
    }
  });
  child.on("exit", code => {
    if (session.closed) return;
    failed(new Error(`The ${app} editor stopped (exit ${code}).`));
    broadcast(session, { type: "ended", error: `The editor stopped unexpectedly (exit ${code}). Your last saved version is in the Garden.` });
    void closeOfficeSession(id);
  });
  session.pollTimer = setInterval(() => scheduleSync(session), POLL_MS);
  scheduleIdleClose(session);
  await Promise.race([session.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("The editor took too long to start.")), 60_000))])
    .catch(async error => { await closeOfficeSession(id); throw error; });
  return { id, app };
}

export function officeSession(id: string, userId: number): Session {
  const session = sessions.get(id);
  if (!session || session.userId !== userId || session.closed) throw Object.assign(new Error("This editor session has ended. Reopen the file."), { status: 404 });
  return session;
}

function request(session: Session, message: HostMessage): Promise<HostMessage> {
  const id = ++seq;
  return new Promise(resolve => { session.pending.set(id, resolve); session.child.send({ ...message, id }); });
}

/** `wc` names a second editor window (the Slides audience popup); 0 is the main editor. */
export async function officeInvoke(session: Session, channel: string, args: unknown[], wc = 0): Promise<unknown> {
  await session.ready;
  const result = await request(session, { type: "invoke", channel, args, wc });
  scheduleSync(session);
  if (!result.ok) throw new Error(String(result.error));
  return result.value;
}

export function officeSend(session: Session, channel: string, args: unknown[], wc = 0): void {
  session.child.send({ type: "send", channel, args, wc });
  scheduleSync(session);
}

/** The user closed a second editor window in the browser. */
export function officeWindowClosed(session: Session, wc: number): void {
  session.child.send({ type: "window-closed", wc });
}

/** A shortcut key bound to the editor's application menu. */
export function officeMenu(session: Session, accelerator: string): void {
  session.child.send({ type: "menu", accelerator });
  scheduleSync(session);
}

/** Before the editor closes: run its own Save, give the write a moment, then file the result. */
export async function officeFlush(session: Session): Promise<unknown> {
  session.child.send({ type: "menu", accelerator: "Ctrl+S" });
  await new Promise(resolve => setTimeout(resolve, 800));
  scheduleSync(session);
  await session.syncing;
  return session.target.current();
}

export function officeAnswer(session: Session, id: number, value: unknown): void {
  session.child.send({ type: "answer", id, value });
}

export async function officeAsset(session: Session, url: string): Promise<{ status: number; type: string; body: Uint8Array }> {
  const result = await request(session, { type: "protocol", url });
  return { status: Number(result.status) || 500, type: String(result.type || "application/octet-stream"), body: result.body as Uint8Array };
}

/** A file the user picked in an editor's Open dialog, placed where the host can read it. */
export function officeUpload(session: Session, name: string, data: Uint8Array): string {
  const dir = path.join(session.dir, "uploads", randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, safeName(name));
  fs.writeFileSync(target, data);
  return target;
}

export function subscribeOfficeSession(session: Session, subscriber: Subscriber): () => void {
  session.subscribers.add(subscriber);
  clearTimeout(session.idleTimer);
  for (const message of session.backlog.splice(0)) subscriber(message);
  subscriber({ type: "file", file: session.target.current() });
  return () => {
    session.subscribers.delete(subscriber);
    if (!session.subscribers.size) scheduleIdleClose(session);
  };
}

function scheduleIdleClose(session: Session): void {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => { if (!session.subscribers.size) void closeOfficeSession(session.id); }, IDLE_CLOSE_MS);
}

function scheduleSync(session: Session): void {
  session.syncing = session.syncing.then(() => syncSession(session)).catch(error => {
    broadcast(session, { type: "error", error: error instanceof Error ? error.message : String(error), conflict: (error as { status?: number }).status === 409 });
  });
}

/** The edited copy becomes the target's next version; new exports go wherever the target files them. */
async function syncSession(session: Session): Promise<void> {
  if (session.closed) return;
  const bytes = fs.existsSync(session.docPath) ? fs.readFileSync(session.docPath) : null;
  if (bytes?.length && sha(bytes) !== session.syncedHash) {
    const hash = sha(bytes);
    const file = await session.target.save(bytes);
    session.syncedHash = hash;
    broadcast(session, { type: "saved", file });
  }
  const exportsDir = path.join(session.dir, "exports");
  if (!session.target.exportFile || !fs.existsSync(exportsDir)) return;
  for (const name of fs.readdirSync(exportsDir)) {
    const target = path.join(exportsDir, name), stat = fs.statSync(target);
    if (!stat.isFile() || stat.size === 0 || session.exportsSeen.get(name) === stat.mtimeMs) continue;
    // Writers finish before their IPC call returns; a file still growing is picked up on the next pass.
    if (Date.now() - stat.mtimeMs < 1000) continue;
    session.exportsSeen.set(name, stat.mtimeMs);
    const file = await session.target.exportFile(name, fs.readFileSync(target));
    broadcast(session, { type: "exported", file });
  }
}

export async function closeOfficeSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.closed) return;
  clearInterval(session.pollTimer);
  clearTimeout(session.idleTimer);
  scheduleSync(session);
  await session.syncing;
  session.closed = true;
  sessions.delete(id);
  for (const waiter of session.pending.values()) waiter({ type: "result", ok: false, error: "The editor session closed." });
  try { session.child.send({ type: "close" }); } catch { /* already gone */ }
  setTimeout(() => { if (session.child.exitCode === null) session.child.kill(); fs.rmSync(session.dir, { recursive: true, force: true }); }, 2000);
}
