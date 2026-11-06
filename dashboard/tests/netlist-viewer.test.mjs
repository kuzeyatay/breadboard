import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseNetlist, spiceTokens } from '../src/lib/netlist-viewer/model.ts';
import { readCircuitDocument } from '../src/lib/netlist-viewer/project.ts';
import { artifactLinkTarget } from '../src/app/components/hermes/artifact-link-context.ts';
import { initialLayout, circuitNets, terminals } from '../src/lib/netlist-viewer/layout.ts';
import { isSpiceNetlistArtifact, MAX_NETLIST_BYTES } from '../src/lib/netlist-viewer/format.ts';
import { inspectArtifactImport, inferArtifactKindForFile } from '../src/lib/hermes/artifact-import.ts';
import { STORED_FILE_ATTACHMENT_FORMATS, storedFileAttachmentFormat } from '../src/lib/stored-file-attachments.ts';

const oscillatorPath = path.resolve(import.meta.dirname, '../../multisim-service/docs/verification/2026-09-22/circuit.cir');
const projectPath = path.join(import.meta.dirname, 'fixtures/netlist-viewer/oscillator.bbcir');

test('portable project opens the exact circuit with routed wires, op amp symbols, model data and unfinished-design warnings', () => {
  const loaded = readCircuitDocument(fs.readFileSync(projectPath, 'utf8'), 'oscillator.bbcir');
  assert.deepEqual(loaded.document.diagnostics, []);
  assert.equal(loaded.project.schematic.wires.length, 58);
  assert.equal(loaded.document.circuits[0].devices.filter(d=>d.symbol==='opamp').length, 12);
  assert.ok(loaded.project.review.warnings.some(w=>w.includes('wiper')));
  assert.equal(loaded.project.review.simulation_status, 'not_run_by_export');
  assert.equal(storedFileAttachmentFormat('oscillator.bbcir'), 'bbcir');
  assert.equal(isSpiceNetlistArtifact({renderer:'binary-file',filename:'oscillator.bbcir'}), true);
  assert.equal(inspectArtifactImport(projectPath, 'code').rendererId, 'spice-netlist');
});

test('project rejects absent wires, false supply labels, mismatched pin endpoints and invalid geometry', () => {
  for (const corrupt of [p=>p.schematic.wires.pop(), p=>p.schematic.wires[0].points[0][0]+=12,
    p=>p.schematic.global_nets.push('wp'), p=>p.circuit.components.pop(), p=>p.schematic.width=1e9,
    p=>p.schematic.wires[0].points.splice(1,0,[1,1]), p=>p.schematic.connected=false]) {
    const value=JSON.parse(fs.readFileSync(projectPath,'utf8')); corrupt(value);
    const loaded=readCircuitDocument(JSON.stringify(value),'test.bbcir');
    assert.equal(loaded.project,null);assert.equal(loaded.document.diagnostics[0].severity,'error');
  }
});

test('chat artifact links resolve only same-origin artifact previews/downloads and preserve explicit versions', () => {
  const base='http://localhost:53106';
  assert.deepEqual(artifactLinkTarget('/api/hermes/artifacts/art_123-abc/download?version=2',base),{id:'art_123-abc',version:2});
  for(const href of ['https://elsewhere.test/api/hermes/artifacts/art_123/download','/api/hermes/artifacts/art_123/delete','/api/hermes/artifacts/art_123/download?version=NaN','javascript:alert(1)']) assert.equal(artifactLinkTarget(href,base),null);
});
test('actual Breadboard oscillator retains every terminal, model and subcircuit without executing control commands', () => {
  const parsed = parseNetlist(fs.readFileSync(oscillatorPath, 'utf8'));
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.circuits.map(c => [c.name, c.devices.length]), [['Top level', 46], ['POT100K', 2], ['BB_OPAMP', 4]]);
  const osc = parsed.circuits[0].devices.find(d => d.id === 'XOSC');
  assert.equal(osc.subcircuit, 'bb_opamp');
  assert.deepEqual(osc.pins.map(p => [p.name, p.node]), [['plus','wp'],['minus','nfb'],['vp','vcc'],['vn','vee'],['out','osc']]);
  const pot = parsed.circuits[0].devices.find(d => d.id === 'XPOT');
  assert.equal(pot.pins.length, 3);
  assert.match(pot.value, /POT100K A=/);
  assert.match(parsed.circuits[1].devices[0].value, /\{100000\*\(1-A\)\}/);
  const limit = parsed.circuits[2].devices.find(d => d.id === 'Blimit');
  assert.equal(limit.pins.length, 2);
  assert.match(limit.value, /V=min\(max\(V\(pole\)/);
  assert.equal(parsed.circuits[0].devices.find(d => d.id === 'DAGC1').modelType, 'D');
  const layout = initialLayout(parsed.circuits[0]);
  const nets = circuitNets(parsed.circuits[0], layout.positions);
  assert.ok(nets.get('wp').some(p => p.device === 'XOSC' && p.pin === 'plus'));
  assert.ok(nets.get('0').some(p => p.device === 'RLOAD'));
  assert.equal(new Set(Object.values(layout.positions).map(p => `${p.x},${p.y}`)).size, 46);
});

test('upstream regression decks: passives, sources, transistors and malformed misc resistor', () => {
  for (const [file, count] of [['passives',3],['sources',4],['transistors',3],['misc1',4]]) {
    const parsed = parseNetlist(fs.readFileSync(path.join(import.meta.dirname, `fixtures/netlist-viewer/test_${file}.cir`), 'utf8'));
    assert.equal(parsed.circuits[1].devices.length, count, file);
    if (file === 'misc1') assert.ok(parsed.diagnostics.some(d => d.severity === 'error' && d.message.includes('R1')));
    else assert.equal(parsed.diagnostics.filter(d => d.severity === 'error').length, 0);
    if (file === 'transistors') assert.ok(parsed.diagnostics.some(d => d.message.includes('three-terminal MOSFET')));
  }
});

test('case, titles, continuation, quoted expressions, models and standard four-terminal transistors', () => {
  const parsed = parseNetlist(`RC filter frequency response\n.MODEL pm PMOS(VTO=-1)\n.model np NPN\nR1 IN Out\n+ { 10k * factor } ; user value\nM1 D G S B pm W=10u\nQ1 C BASE E SUB np\nB1 OUT 0 V = { if(V(IN) > 1, 2, 0) }\n.end`);
  assert.equal(parsed.title, 'RC filter frequency response');
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.circuits[0].devices.length, 4);
  const [r, m, q, b] = parsed.circuits[0].devices;
  assert.equal(r.line, 4);
  assert.equal(r.value, '{ 10k * factor }');
  assert.deepEqual(r.pins.map(p => p.node), ['in', 'out']);
  assert.equal(m.pins.length, 4); assert.equal(m.modelType, 'PMOS');
  assert.equal(q.pins.length, 4); assert.equal(q.modelType, 'NPN');
  assert.equal(b.pins.length, 2);
  assert.deepEqual(spiceTokens('B1 x 0 V="a ; b" $ comment'), ['B1','x','0','V="a ; b"']);
});

test('subcircuit parameters never become pins; unresolved or mismatched instances produce diagnostics', () => {
  const parsed = parseNetlist(`* title\nX1 A B DEMO params: R = 1k\nX2 C D E DEMO\nX3 OUT 0 EXTERNAL gain=2\n.subckt DEMO in out params: R=10k\nR1 in out {R}\n.ends DEMO\n.include /do/not/read\n.control\nwrite result.raw all\nshell do-not-run\n.endc\n.end`);
  assert.deepEqual(parsed.circuits[0].devices.map(d => d.pins.length), [2,3,2]);
  assert.equal(parsed.circuits[0].devices[0].subcircuit, 'demo');
  assert.ok(parsed.diagnostics.some(d => /declares 2/.test(d.message)));
  assert.ok(parsed.diagnostics.some(d => /external or undefined/.test(d.message)));
  assert.ok(parsed.diagnostics.some(d => /does not open files/.test(d.message)));
});

test('controlled sources separate control nodes from expressions and coefficients', () => {
  const parsed = parseNetlist(`* title\nE1 a 0 c d 2\nG1 a 0 VALUE={V(c)*2}\nE2 a 0 POLY(2) c d e f 0 1 2\nF1 a 0 VSENSE 4\nH1 a 0 VSENSE 100\n.end`);
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.circuits[0].devices.map(d => d.pins.length), [4,2,6,2,2]);
  assert.deepEqual(parsed.circuits[0].devices[2].pins.map(p => p.node), ['a','0','c','d','e','f']);
});

test('spaced subcircuit assignments without PARAMS do not add fictitious nets', () => {
  const parsed = parseNetlist('* title\nX1 a b demo R = 10k\n.subckt demo in out R =1k\nR1 in out {R}\n.ends');
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.circuits[1].ports, ['in', 'out']);
  assert.equal(parsed.circuits[0].devices[0].subcircuit, 'demo');
  assert.deepEqual(parsed.circuits[0].devices[0].pins.map(p=>p.node), ['a','b']);
});

test('malformed and oversized input is bounded and visible, never silently a complete diagram', () => {
  assert.ok(parseNetlist('x'.repeat(MAX_NETLIST_BYTES + 1)).diagnostics.some(d => /limit/.test(d.message)));
  assert.ok(parseNetlist('\0binary').diagnostics.some(d => /binary/.test(d.message)));
  const many = parseNetlist('* title\n' + Array.from({length:2001}, (_, i) => `R${i} a 0 1k`).join('\n'));
  assert.equal(many.circuits[0].devices.length, 2000);
  assert.ok(many.diagnostics.some(d => /2000/.test(d.message)));
  const broken = parseNetlist('+ orphan\nR1 a 0 1k\nr1 b 0 2k\nK1 L1 L2 .9\n.connect a b\n.control');
  for (const expected of ['Continuation', 'Duplicate', 'coupling', 'connectivity', 'Unclosed']) assert.ok(broken.diagnostics.some(d => d.message.includes(expected)), expected);
});

test('rotating a device rotates terminal connections without changing net membership', () => {
  const d = parseNetlist('R1 a 0 1k').circuits[0].devices[0];
  const p = terminals(d, {x:100,y:100,rotation:90});
  assert.ok(Math.abs(p[0].x - 100) < 1e-9); assert.equal(p[0].y,52);
  assert.equal(p[1].node,'0'); assert.equal(p[1].y,148);
});

test('all SPICE extensions are uploadable, imported with a preview, and recognize legacy artifacts', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-spice-import-'));
  try {
    for (const ext of ['cir','ckt','sp','spice','net']) {
      const filename = `oscillator.${ext.toUpperCase()}`, file = path.join(folder, filename);
      fs.copyFileSync(oscillatorPath, file);
      assert.equal(inferArtifactKindForFile(filename), 'code');
      assert.equal(storedFileAttachmentFormat(filename), ext);
      assert.equal(STORED_FILE_ATTACHMENT_FORMATS[ext].textual, true);
      for (const kind of ['code','unknown']) assert.deepEqual(inspectArtifactImport(file, kind), {rendererId:'spice-netlist',mimeType:'text/x-spice; charset=utf-8',extension:`.${ext}`,previewAvailable:true});
      assert.equal(isSpiceNetlistArtifact({renderer:'binary-file',filename}), true);
    }
    const binary = path.join(folder, 'binary.cir'); fs.writeFileSync(binary, Buffer.from([0,1,2,3]));
    assert.throws(() => inspectArtifactImport(binary, 'code'));
    assert.equal(isSpiceNetlistArtifact({renderer:'code',filename:'circuit.py'}), false);
  } finally { fs.rmSync(folder, {recursive:true,force:true}); }
});
