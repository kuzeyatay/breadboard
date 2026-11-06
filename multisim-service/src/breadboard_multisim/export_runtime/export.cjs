// Local-only adapter around pinned Weave and electronics-workbench-decoder.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function genericSymbol(symbol, geometry) {
  const [left, top, right, bottom] = geometry.bbox;
  const lines = ['Version 4', 'SymbolType CELL',
    `RECTANGLE Normal ${left + 16} ${top} ${right - 16} ${bottom}`,
    `WINDOW 0 0 ${top - 32} Center 2`, `WINDOW 3 0 ${bottom + 32} Center 2`,
    'SYMATTR Prefix X', `SYMATTR Value ${symbol}`];
  geometry.pins.forEach(([x, y], i) => {
    const direction = x < 0 ? 'LEFT' : 'RIGHT';
    lines.push(`LINE Normal ${x} ${y} ${x < 0 ? left + 16 : right - 16} ${y}`,
      `PIN ${x} ${y} ${direction} 8`, `PINATTR PinName ${i + 1}`, `PINATTR SpiceOrder ${i + 1}`);
  });
  return lines.join('\n') + '\n';
}

async function ltspice(input, directory) {
  const { convert, SYMBOLS, rot, genericBlock, SAFE_MODES } = require('./weave/core.js');
  const { connectivity, parseAsc } = require('./weave/verify.js');
  const simple = { resistor: 'res', capacitor: 'cap', inductor: 'ind', diode: 'diode',
    voltage_source: 'voltage', current_source: 'current', opamp: 'Opamps\\opamp2' };
  const comps = input.components.map(c => ({ name: c.id,
    sym: c.type === 'ic' ? genericBlock(c.nodes.length) : c.type === 'bjt' ? c.polarity :
      c.type === 'mosfet' ? c.polarity + '4' : simple[c.type], nets: c.nodes, value: c.value }));
  const expected = new Map();
  for (const c of comps) c.nets.forEach((n, i) => {
    if (!expected.has(n)) expected.set(n, new Set());
    expected.get(n).add(c.name + ':' + i);
  });
  const signature = pins => [...pins].sort().join('|');
  const expectedSignatures = [...expected.values()].map(signature).sort();
  let asc, mode, errors;
  for (let index = 0; index < SAFE_MODES.length; index++) {
    let candidate = await convert('', { ...SAFE_MODES[index], circuit: { comps, directives: [] } });
    const parsed = parseAsc(candidate);
    // Preserve every signal name for probing, model expressions and analysis directives.
    const flags = [];
    for (const symbol of parsed.syms) {
      const component = comps.find(c => c.name === symbol.name);
      if (!component) throw new Error('Unexpected component ' + symbol.name);
      SYMBOLS[symbol.sym].pins.forEach((pin, i) => {
        const [x, y] = rot(pin, symbol.rot);
        flags.push(`FLAG ${symbol.x + x} ${symbol.y + y} ${component.nets[i]}`);
      });
    }
    // Check physical wiring BEFORE adding labels, so labels cannot conceal missing wires.
    const actual = [...connectivity(candidate).values()].map(signature).sort();
    errors = JSON.stringify(actual) !== JSON.stringify(expectedSignatures);
    if (errors) continue;
    candidate = candidate.replace(/^(SHEET[^\n]*\n)/m, '$1' + flags.join('\n') + '\n');
    if (JSON.stringify([...connectivity(candidate).values()].map(signature).sort()) !==
        JSON.stringify(expectedSignatures)) continue;
    asc = candidate; mode = index; break;
  }
  if (!asc) throw new Error('Weave could not route this circuit with identical pin connectivity; no schematic published');
  // Weave's parser/renderer can drop instance parameters and misplace source AC fields.
  // Rewrite attributes from the validated Breadboard IR after placement.
  asc = asc.replace(/SYMBOL [\s\S]*?(?=\nSYMBOL |\nTEXT |$)/g, block => {
    const name = block.match(/^SYMATTR InstName (.+)$/m)?.[1];
    const c = input.components.find(item => item.id === name);
    if (!c) throw new Error('Missing emitted component ' + name);
    const geometry = block.split('\n').filter(line => !line.startsWith('SYMATTR')).join('\n').trimEnd();
    const attributes = [`SYMATTR InstName ${c.id}`, `SYMATTR Prefix ${c.prefix}`, `SYMATTR Value ${c.value}`];
    if (c.ac !== null && c.ac !== undefined) attributes.push(`SYMATTR Value2 AC ${c.ac} ${c.ac_phase}`);
    if (c.parameters) attributes.push(`SYMATTR SpiceLine ${c.parameters}`);
    return geometry + '\n' + attributes.join('\n');
  });
  const ymax = Math.max(800, ...parseAsc(asc).syms.map(s => s.y)) + 256;
  input.directives.forEach((d, i) => { asc += `\nTEXT 0 ${ymax + i * 48} Left 2 !${d}`; });
  asc += '\n';
  const symbols = [];
  for (const c of comps) if (SYMBOLS[c.sym].synthetic && !symbols.includes(c.sym + '.asy')) {
    fs.writeFileSync(path.join(directory, c.sym + '.asy'), genericSymbol(c.sym, SYMBOLS[c.sym]), 'utf8');
    symbols.push(c.sym + '.asy');
  }
  fs.writeFileSync(path.join(directory, 'circuit.asc'), asc, 'utf8');
  return { schematic: 'circuit.asc', symbols, connectivity: 'verified', layout_mode: mode,
    component_count: comps.length, net_count: expected.size };
}

function multisim(input, directory) {
  const { encodeBuffer, decodeBuffer, formatByKey } = require('electronics-workbench-decoder');
  const xml = fs.readFileSync(path.join(directory, 'circuit.ms14.xml'));
  const encoded = encodeBuffer(xml, formatByKey('multisim'));
  const decoded = decodeBuffer(encoded).xml;
  if (!decoded.equals(xml)) throw new Error('Multisim codec round-trip changed the schematic XML');
  fs.writeFileSync(path.join(directory, 'circuit.ms14'), encoded);
  return { schematic: 'circuit.ms14', codec_round_trip: 'verified' };
}

async function main() {
  const [kind, directory] = process.argv.slice(2);
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const result = kind === 'ltspice' ? await ltspice(input, directory) :
    kind === 'multisim' ? multisim(input, directory) : (() => { throw new Error('Unknown export format'); })();
  process.stdout.write(JSON.stringify(result));
}
main().catch(error => { process.stderr.write(String(error.stack || error)); process.exitCode = 1; });
