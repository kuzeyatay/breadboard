import { z } from "zod";
import { record } from "../acestep/client.ts";
export const RESONANT_REVISION = "6ffe24328dce838b261c8ab5e0586bfa08e31b4f";
const ref = z.string().min(1).max(200), beat = z.number().min(0).max(512);
export const ARRANGEMENT_TOOLS = {
  set_clip_notes: z.object({ clip: ref, mode: z.enum(['replace', 'merge']).optional(), notes: z.array(z.object({ step: z.number().int().min(0).max(4095), pitch: z.number().int().min(0).max(127), velocity: z.number().min(0).max(1).optional(), durationSteps: z.number().int().min(1).max(256).optional() }).strict()).max(2000) }).strict(),
  duplicate_clip: z.object({ clip: ref, name: ref.optional(), track: ref.optional(), slot: z.number().int().min(0).max(31).optional() }).strict(),
  set_arrangement: z.object({ mode: z.enum(['replace', 'append']).optional(), blocks: z.array(z.object({ track: ref, clip: ref, startBeat: beat, lengthBeats: z.number().min(0.25).max(512), offsetBeats: beat.optional() }).strict()).max(128) }).strict(),
  set_track_mix: z.object({ track: ref, volume: z.number().min(0).max(1.5).optional(), pan: z.number().min(-1).max(1).optional(), delay: z.number().min(0).max(1).optional(), mute: z.boolean().optional(), solo: z.boolean().optional(), waveform: z.enum(['sine', 'triangle', 'sawtooth', 'square']).optional(), attack: z.number().min(0.001).max(10).optional(), release: z.number().min(0.005).max(20).optional(), filterHz: z.number().min(20).max(24000).optional() }).strict(),
  set_clip_automation: z.object({ clip: ref, values: z.array(z.number().min(0).max(2)).min(1).max(64) }).strict(),
} as const;
export interface ResonantTool {
  name: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}
export interface ResonantTransport {
  tools: ResonantTool[];
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}
const allowed = new Set(['get_capabilities', 'create_project', 'inspect_project', 'import_wav', 'validate_project', 'analyze_mix', 'render_wav', ...Object.keys(ARRANGEMENT_TOOLS)]);
export function resonantResult(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024)
    throw Error('Resonant response exceeded 512 KiB.');
  const envelope = record(value);
  if (envelope.isError === true)
    throw Error('Resonant tool failed or the project revision changed.');
  if (envelope.structuredContent) {
    const result = record(envelope.structuredContent);
    if (result.ok === false)
      throw Error('Resonant operation failed.');
    return result;
  }
  if (!Array.isArray(envelope.content))
    throw Error('Invalid Resonant result.');
  const block = envelope.content.find(item => item?.type === 'text');
  if (typeof block?.text !== 'string')
    throw Error('Invalid Resonant result.');
  const result = record(JSON.parse(block.text));
  if (result.ok === false)
    throw Error('Resonant operation failed.');
  return result;
}
/** Scope and revision are host-owned. The planner cannot call provider/setup/voice tools. */
export class ResonantSession {
  private count = 0;
  revision = '';
  readonly transport: ResonantTransport;
  readonly project: string;
  readonly signal: AbortSignal;
  constructor(transport: ResonantTransport, project: string, signal: AbortSignal) {
    this.transport = transport;
    this.project = project;
    this.signal = signal;
    if (!/^breadboard-music\/conv_[A-Za-z0-9_-]{24}\/music_[a-f0-9]{32}\/project\.resonant$/.test(project))
      throw Error('Invalid scoped Resonant project.');
  }
  async call(name: string, args: Record<string, unknown>) {
    this.signal.throwIfAborted();
    if (++this.count > 36 || !allowed.has(name))
      throw Error('Resonant tool budget or scope exceeded.');
    if (name !== 'get_capabilities' && args.path !== this.project)
      throw Error('Resonant project scope mismatch.');
    const tool = this.transport.tools.find(tool => tool.name === name);
    if (!tool || Object.keys(args).some(key => !(key in (tool.inputSchema.properties ?? {}))) || tool.inputSchema.required?.some(key => !(key in args)))
      throw Error(`Resonant tool schema is incompatible: ${name}`);
    return resonantResult(await this.transport.call(name, args));
  }
  async inspect() {
    const result = await this.call('inspect_project', { path: this.project });
    const project = record(result.project);
    if (typeof project.revision !== 'string' || !/^[a-f0-9]{64}$/i.test(project.revision))
      throw Error('Missing Resonant project revision.');
    this.revision = project.revision;
    return project;
  }
  async mutate(name: keyof typeof ARRANGEMENT_TOOLS, raw: unknown) {
    const args = ARRANGEMENT_TOOLS[name].parse(raw);
    if (!this.revision)
      throw Error('Inspect the Resonant project before mutation.');
    try {
      await this.call(name, { ...args, path: this.project, expectedRevision: this.revision });
    }
    catch {
      await this.inspect();
      throw Error('Resonant mutation failed; the project was re-inspected. Review its current revision before an explicit retry.');
    }
    return this.inspect();
  }
}
