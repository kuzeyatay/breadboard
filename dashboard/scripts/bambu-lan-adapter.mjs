// GPL-2.0. Narrow derivative of DMontgomery40/bambu-printer-mcp
// src/printers/bambu.ts at 9e31502e55744f5962e2bb1472bf01732b03058a.
// Modified by Breadboard, 2026-09-07: split upload/start; no generic commands,
// slicer, camera, automatic mapping, client certificate extraction or MCP server.
// See ../third-party/bambu-printer-mcp/NOTICE.md and LICENSE.
import mqtt from "mqtt";
import { Client as FtpClient } from "basic-ftp";
import { enterPassiveModeIPv4_forceControlHostIP } from "basic-ftp/dist/transfer.js";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import { isIP } from "node:net";

const MAX_STATUS_BYTES = 256 * 1024;
const MODELS = new Set(["P1P", "P1S", "X1C", "X1E", "A1", "A1 mini", "H2S"]);
const modelByPrefix = { "01P": "P1S", "01S": "P1P", "00M": "X1C", "03W": "X1E", "030": "A1", "039": "A1 mini", "093": "H2S" };
const stageNames = { 0: "Printing layers", 1: "Bed levelling", 2: "Preheating bed", 3: "Checking motion", 4: "Changing filament", 7: "Heating nozzle", 8: "Calibrating extrusion", 9: "Scanning bed", 10: "Inspecting first layer", 11: "Identifying build plate", 13: "Homing", 14: "Cleaning nozzle" };
const timestamp = () => new Date().toISOString();
function safeError(message = "Printer communication failed.") { return Object.assign(new Error(message), { code: "bambu_transport", status: 502 }); }
function validateAccess(access) {
  if (!access || isIP(access.host) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(access.host) || !/^[A-Z0-9]{8,32}$/.test(access.serial) || !/^[A-Za-z0-9]{8}$/.test(access.accessCode) || !MODELS.has(access.model)) throw safeError("Invalid configured printer access.");
}
function filename(value) { if (!/^bb_[0-9a-f]{32}\.3mf$/.test(value)) throw safeError("Invalid approved remote filename."); return value; }
function trayColor(value) { return typeof value === "string" && /^[0-9a-f]{8}$/i.test(value) ? `#${value.slice(0,6).toUpperCase()}` : null; }
function mergeObjects(previous, delta) {
  if (Array.isArray(delta)) {
    if (!delta.length) return [];
    if (delta.every(item => item && typeof item === "object" && item.id !== undefined)) {
      const result = new Map((Array.isArray(previous) ? previous : []).map(item => [String(item.id), item]));
      for (const item of delta) result.set(String(item.id), mergeObjects(result.get(String(item.id)), item));
      return [...result.values()];
    }
    return delta;
  }
  if (!delta || typeof delta !== "object") return delta;
  const result = { ...(previous && typeof previous === "object" ? previous : {}) };
  for (const [key, value] of Object.entries(delta)) { if (!["__proto__", "prototype", "constructor"].includes(key)) result[key] = mergeObjects(result[key], value); }
  return result;
}
export function mergePrinterReport(previous, delta) {
  const baseName = value => typeof value === "string" ? value.split(/[\\/]/).at(-1) : value;
  const previousFile = previous.gcode_file || previous.subtask_name;
  const nextFile = delta.gcode_file || delta.subtask_name;
  const changed = (nextFile !== undefined && baseName(nextFile) !== baseName(previousFile)) || (delta.task_id !== undefined && previous.task_id !== undefined && delta.task_id !== previous.task_id);
  const base = { ...previous };
  if (changed) for (const key of ["gcode_file","subtask_name","task_id","gcode_state","stg_cur","mc_percent","mc_remaining_time","layer_num","total_layer_num","print_error"]) delete base[key];
  return mergeObjects(base, delta);
}
export function normalizeTelemetry(raw, previous, observedAt = timestamp(), delta = raw) {
  const result = { ...previous, observedAt, connected: true };
  const setNumber = (key, value, min, max) => { if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) result[key] = value; };
  setNumber("progress", raw.mc_percent, 0, 100);
  setNumber("remainingMinutes", raw.mc_remaining_time, 0, 100000);
  setNumber("layer", raw.layer_num, 0, 100000);
  setNumber("totalLayers", raw.total_layer_num, 0, 100000);
  setNumber("nozzleTemperature", raw.nozzle_temper, 0, 400);
  setNumber("bedTemperature", raw.bed_temper, 0, 200);
  if (raw.nozzle_diameter !== undefined) setNumber("nozzleDiameter", Number(raw.nozzle_diameter), 0.1, 2);
  if (typeof raw.print_error === "number") result.printError = raw.print_error;
  if (typeof raw.gcode_state === "string") {
    const states = { IDLE: "idle", READY: "idle", PREPARE: "preparing", RUNNING: raw.stg_cur === 0 || (raw.stg_cur === undefined && raw.layer_num > 0) ? "printing" : "preparing", PAUSE: "paused", FINISH: "completed", FAILED: "failed" };
    if (states[raw.gcode_state]) result.state = states[raw.gcode_state];
    if (delta.gcode_state !== undefined) result.stateObservedAt = observedAt;
  }
  if (Number.isInteger(raw.stg_cur) && raw.stg_cur >= 0 && raw.stg_cur < 255) result.stage = stageNames[raw.stg_cur] ?? `Printer stage ${raw.stg_cur}`;
  const reportedFile = raw.gcode_file || raw.subtask_name;
  if (typeof reportedFile === "string" && reportedFile.length <= 200) result.filename = reportedFile;
  if (typeof raw.task_id === "string" && /^\d{1,12}$/.test(raw.task_id) && raw.task_id !== "0") result.taskId = raw.task_id;
  if (delta.gcode_file || delta.subtask_name) result.identityObservedAt = observedAt;
  const taskChanged = delta.task_id !== undefined && previous?.taskId && String(delta.task_id) !== previous.taskId;
  const explicitFileCleared = (delta.gcode_file !== undefined || delta.subtask_name !== undefined) && !reportedFile;
  if (explicitFileCleared || ((taskChanged || delta.task_id === "0") && !delta.gcode_file && !delta.subtask_name)) {
    delete result.filename; delete result.identityObservedAt; delete result.taskId;
  }
  // Never carry job progress/identity across an explicitly reported different file.
  if ((previous?.filename && result.filename !== previous.filename) || (delta.task_id !== undefined && previous?.taskId && String(delta.task_id) !== previous.taskId)) {
    for (const key of ["progress","layer","totalLayers","remainingMinutes","taskId","state","stateObservedAt","stage"]) delete result[key];
    if (delta.gcode_state !== undefined) { const fresh = normalizeTelemetry(delta, {}, observedAt, delta); result.state = fresh.state; result.stateObservedAt = fresh.stateObservedAt; result.stage = fresh.stage; }
    setNumber("progress", delta.mc_percent, 0, 100); setNumber("layer", delta.layer_num, 0, 100000); setNumber("totalLayers", delta.total_layer_num, 0, 100000); setNumber("remainingMinutes", delta.mc_remaining_time, 0, 100000);
    if (delta.task_id && delta.task_id !== "0") result.taskId = String(delta.task_id);
  }
  const sources = [];
  if (Array.isArray(raw.ams?.ams)) for (const unit of raw.ams.ams.slice(0,8)) {
    if (!/^\d{1,3}$/.test(String(unit.id)) || !Array.isArray(unit.tray)) continue;
    for (const tray of unit.tray.slice(0,4)) {
      if (!/^\d{1,2}$/.test(String(tray.id))) continue;
      const material = typeof tray.tray_type === "string" && /^[A-Za-z0-9 +._-]{1,32}$/.test(tray.tray_type) ? tray.tray_type.toUpperCase() : "";
      sources.push({ id: `ams:${unit.id}:${tray.id}`, unit: Number(unit.id), tray: Number(tray.id), label: `AMS ${Number(unit.id)+1} · Tray ${Number(tray.id)+1}`, material, color: trayColor(tray.tray_color), available: Boolean(material), provenance: "telemetry" });
    }
  }
  if (raw.vt_tray && !Array.isArray(raw.vt_tray)) sources.push({ id: "external", unit: null, tray: null, label: "External spool", material: typeof raw.vt_tray.tray_type === "string" ? raw.vt_tray.tray_type.toUpperCase().slice(0,32) : "", color: trayColor(raw.vt_tray.tray_color), available: Boolean(raw.vt_tray.tray_type), provenance: "telemetry" });
  if (sources.length || Array.isArray(raw.ams?.ams)) result.sources = sources;
  return result;
}

export function startCommand(access, input) {
  validateAccess(access); filename(input.remoteFilename);
  const { snapshot: s } = input;
  if (!s || s.printerId !== access.id || s.review.printerId !== access.id || !/^\d{1,12}$/.test(input.attemptId) || !/^Metadata\/plate_[1-9][0-9]{0,2}\.gcode$/.test(s.plate.path)) throw safeError("Invalid approved execution snapshot.");
  const mapping = Array(Math.max(access.model === "H2S" ? 1 : 5, s.plate.projectFilamentCount)).fill(-1);
  if (mapping.length > 16) throw safeError("Unsupported project filament count.");
  for (const m of s.review.mapping) {
    const match = /^ams:([0-3]):([0-3])$/.exec(m.sourceId);
    if (!Number.isInteger(m.filamentIndex) || m.filamentIndex < 0 || m.filamentIndex >= mapping.length || (!match && m.sourceId !== "external")) throw safeError("Unsupported explicit filament mapping.");
    if (m.sourceId === "external" && s.plate.filaments.length !== 1) throw safeError("External spool requires one filament.");
    mapping[m.filamentIndex] = match ? Number(match[1]) * 4 + Number(match[2]) : 254;
  }
  if (s.plate.filaments.some(f => mapping[f.index] === -1)) throw safeError("Incomplete approved mapping.");
  const h2 = access.model === "H2S";
  // Use project_file for every supported model. The .3mf remote name avoids
  // upstream's .gcode.3mf -> gcode_file branch, which discards plate and AMS options.
  return { print: {
    sequence_id: input.attemptId, command: "project_file", param: s.plate.path,
    url: h2 ? `ftp:///${input.remoteFilename}` : `file:///sdcard/cache/${input.remoteFilename}`,
    file: input.remoteFilename, subtask_name: input.remoteFilename,
    md5: s.plate.gcodeMd5, bed_type: s.plate.buildPlate,
    bed_leveling: h2 ? Number(s.review.options.bedLeveling) : s.review.options.bedLeveling,
    flow_cali: h2 ? Number(s.review.options.flowCalibration) : s.review.options.flowCalibration,
    vibration_cali: h2 ? Number(s.review.options.vibrationCalibration) : s.review.options.vibrationCalibration,
    timelapse: false, layer_inspect: false, use_ams: s.review.mapping.every(m => m.sourceId !== "external"),
    ams_mapping: mapping, ...(h2 ? { ams_mapping2: mapping.map(v => v < 0 ? { ams_id: 255, slot_id: 255 } : v === 254 ? { ams_id: 254, slot_id: 254 } : { ams_id: Math.floor(v / 4), slot_id: v % 4 }), cfg: "0", auto_bed_leveling: Number(s.review.options.bedLeveling), extrude_cali_flag: 0, extrude_cali_manual_mode: 0, nozzle_offset_cali: 2 } : {}),
    profile_id: "0", project_id: input.attemptId, subtask_id: input.attemptId, task_id: input.attemptId,
  } };
}

export class BambuLanAdapter {
  sessions = new Map();
  constructor({ onUploadProgress = async () => {} } = {}) { this.onUploadProgress = onUploadProgress; }
  async session(access) {
    validateAccess(access);
    const key = access.serial, fingerprint = createHash("sha256").update(JSON.stringify(access)).digest("hex");
    let session = this.sessions.get(key);
    if (session && session.fingerprint !== fingerprint) { await session.client.endAsync(true); this.sessions.delete(key); session = null; }
    if (session) { session.lastUsed = Date.now(); return session; }
    if (this.sessions.size >= 16) throw safeError("Too many active printer connections.");
    const client = mqtt.connect(`mqtts://${access.host}:8883`, { username: "bblp", password: access.accessCode, clientId: `bb_${randomUUID().replace(/-/g, "").slice(0,16)}`, rejectUnauthorized: false, reconnectPeriod: 0, connectTimeout: 8000, clean: true, protocolVersion: 4, resubscribe: false });
    session = { client, fingerprint, lastUsed: Date.now(), createdAt: Date.now(), raw: {}, telemetry: null, connected: false, reachable: false, waiters: new Set() };
    client.stream?.once("secureConnect", () => { session.reachable = true; });
    this.sessions.set(key, session);
    client.on("connect", () => { session.connected = true; client.subscribe(`device/${access.serial}/report`, { qos: 0 }, () => { void this.push(access, session).catch(() => {}); }); });
    client.on("message", (_topic, bytes, packet) => {
      if (packet.retain || bytes.length > MAX_STATUS_BYTES) return;
      try {
        const parsed = JSON.parse(bytes.toString("utf8"));
        const delta = parsed.print;
        if (!delta || typeof delta !== "object" || Array.isArray(delta)) return;
        session.raw = mergePrinterReport(session.raw, delta);
        session.telemetry = normalizeTelemetry(session.raw, session.telemetry, timestamp(), delta);
        const model = modelByPrefix[access.serial.slice(0,3)]; if (model) session.telemetry.model = model;
        for (const notify of session.waiters) notify();
      } catch { /* Malformed status is ignored without logging credentials or raw printer data. */ }
    });
    const disconnected = () => { session.connected = false; for (const notify of session.waiters) notify(); };
    client.on("error", disconnected); client.on("close", disconnected);
    return session;
  }
  async publish(access, session, payload) {
    if (!session.client.connected) throw safeError("Printer is disconnected.");
    let timer;
    try { await Promise.race([session.client.publishAsync(`device/${access.serial}/request`, JSON.stringify(payload), { qos: 0, retain: false }), new Promise((_, reject) => { timer = setTimeout(() => reject(safeError("Printer publish outcome is unconfirmed.")), 8000); timer.unref(); })]); }
    finally { clearTimeout(timer); }
  }
  push(access, session) { return this.publish(access, session, { pushing: { sequence_id: "0", command: "pushall" } }); }
  async observe(access, fresh = false) {
    let session = await this.session(access);
    if (!session.client.connected && Date.now() - session.createdAt > 10000) { await session.client.endAsync(true); this.sessions.delete(access.serial); session = await this.session(access); }
    const since = fresh ? Date.now() : Date.now() - 10000;
    if (session.client.connected) await this.push(access, session);
    if (!session.telemetry || !(Date.parse(session.telemetry.stateObservedAt ?? "") >= since) || !session.connected) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { session.waiters.delete(check); reject(safeError("No fresh authenticated printer status.")); }, 10000);
        const check = () => { if (session.connected && session.telemetry && Date.parse(session.telemetry.stateObservedAt ?? "") >= since) { clearTimeout(timeout); session.waiters.delete(check); resolve(); } };
        session.waiters.add(check); check();
      });
    }
    return { ...session.telemetry, connected: session.connected };
  }
  async test(access) {
    try { return await this.observe(access, true); }
    catch { const session = this.sessions.get(access.serial); return { observedAt:timestamp(), connected:false, reachable:Boolean(session?.reachable), authenticated:Boolean(session?.client.connected) }; }
  }
  async upload(access, input) {
    validateAccess(access); filename(input.remoteFilename);
    const bytes = await fs.readFile(input.localPath);
    if (bytes.length !== input.size || createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw safeError("Staged file integrity changed.");
    const client = new FtpClient(15000);
    client.prepareTransfer = enterPassiveModeIPv4_forceControlHostIP;
    let lastProgress = 0;
    client.trackProgress(info => { if (info.type === "upload" && Date.now() - lastProgress > 500) { lastProgress = Date.now(); void this.onUploadProgress(input.attemptId, info.bytes).catch(() => {}); } });
    try {
      await client.access({ host: access.host, port: 990, user: "bblp", password: access.accessCode, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
      const socket = client.ftp.socket;
      if (typeof socket.getSession === "function" && !socket.getSession()) await new Promise(resolve => { const done = () => { clearTimeout(timer); socket.off("session", done); resolve(); }; const timer = setTimeout(done, 1000); socket.once("session", done); });
      const remote = access.model === "H2S" ? `/${input.remoteFilename}` : `/cache/${input.remoteFilename}`;
      const existing = await client.list(access.model === "H2S" ? "/" : "/cache");
      if (existing.some(file => file.name === input.remoteFilename)) throw safeError("This job filename already exists on the printer. Inspect the prior attempt; it will not be overwritten.");
      await client.uploadFrom(Readable.from(bytes), remote);
      if (await client.size(remote) !== input.size) throw safeError("Remote upload length differs from the approved file.");
      await this.onUploadProgress(input.attemptId, input.size);
      return { verified: "size" }; // FTPS completion + SIZE, not a remotely verified checksum.
    } catch { throw safeError("FTPS upload or remote file length verification failed."); }
    finally { client.close(); }
  }
  async start(access, input) { const session = await this.session(access); await this.publish(access, session, startCommand(access, input)); }
  async control(access, input) {
    filename(input.remoteFilename);
    if (!["pause","resume","cancel"].includes(input.command)) throw safeError("Unsupported control.");
    const telemetry = await this.observe(access, true);
    if (telemetry.filename?.split(/[\\/]/).at(-1) !== input.remoteFilename || Date.now() - Date.parse(telemetry.identityObservedAt ?? "") > 15000 || (telemetry.taskId && telemetry.taskId !== input.taskId) || !["preparing","printing","paused"].includes(telemetry.state)) throw safeError("The active print no longer matches this job.");
    await this.publish(access, await this.session(access), { print: { command: input.command === "cancel" ? "stop" : input.command, sequence_id: "0" } });
  }
  async reap(activeIds) {
    for (const [serial, session] of this.sessions) if (!activeIds.has(serial) && Date.now() - session.lastUsed > 30000) { await session.client.endAsync(true); this.sessions.delete(serial); }
  }
  async close() { await Promise.allSettled([...this.sessions.values()].map(session => session.client.endAsync(true))); this.sessions.clear(); }
}
