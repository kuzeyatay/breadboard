/**
 * Browser adaptation of f18m/netlist-viewer's svParserSPICE / svCircuit model.
 * See src/vendor/netlist-viewer/README.md for pinned source and notices.
 * Parsing is descriptive only: expressions, includes and commands never execute.
 */
import { MAX_NETLIST_BYTES } from "./format.ts";

export type DeviceKind = "R" | "C" | "L" | "D" | "Q" | "M" | "J" | "V" | "I" | "E" | "G" | "F" | "H" | "B" | "X" | "S" | "W" | "T" | "O";
export type Diagnostic = { line: number; message: string; severity: "warning" | "error" };
export type Pin = { name: string; node: string };
export type Device = { id: string; kind: DeviceKind; pins: Pin[]; value: string; model?: string; modelType?: string; line: number; source: string; subcircuit?: string; symbol?: "opamp" };
export type Circuit = { id: string; name: string; ports: string[]; parameters: string; devices: Device[]; line: number };
export type Netlist = { circuits: Circuit[]; diagnostics: Diagnostic[]; title: string };
type Statement = { text: string; line: number };
const MAX_DEVICES = 2000;
const MAX_PINS = 128;
const key = (s: string) => s.toLowerCase();

function parameterOffset(tokens: string[]): number {
  const index = tokens.findIndex((token) => /^params:/i.test(token) || token.includes("="));
  // SPICE accepts both R=10k and R = 10k. The name belongs to the assignment.
  return index > 0 && tokens[index].startsWith("=") ? index - 1 : index;
}

/** Whitespace in expressions/quotes belongs to the value, never to a new pin. */
export function spiceTokens(line: string): string[] {
  const tokens: string[] = [];
  let token = "", depth = 0, quote = "";
  for (const char of line) {
    if (quote) {
      token += char;
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") { quote = char; token += char; }
    else if (char === "{" || char === "(") { depth++; token += char; }
    else if (char === "}" || char === ")") { depth = Math.max(0, depth - 1); token += char; }
    else if (!depth && (char === ";" || char === "$")) break;
    else if (!depth && /\s/.test(char)) { if (token) tokens.push(token); token = ""; }
    else token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}

export function parseNetlist(source: string): Netlist {
  const top: Circuit = { id: "@top", name: "Top level", ports: [], parameters: "", devices: [], line: 1 };
  const result: Netlist = { circuits: [top], diagnostics: [], title: "SPICE netlist" };
  const diag = (line: number, message: string, severity: Diagnostic["severity"] = "warning") => {
    if (result.diagnostics.length < 200) result.diagnostics.push({ line, message, severity });
  };
  if (new TextEncoder().encode(source).length > MAX_NETLIST_BYTES) {
    diag(1, "This netlist exceeds the 2 MiB interactive viewer limit. Download it to inspect the full source.", "error");
    return result;
  }
  if (source.includes("\0")) { diag(1, "This file contains binary data, not a text SPICE netlist.", "error"); return result; }
  const statements: Statement[] = [];
  for (const [index, original] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const text = original.trim();
    if (!text || text.startsWith("*")) continue;
    if (text.startsWith("+")) {
      const previous = statements.at(-1);
      if (previous) previous.text += ` ${text.slice(1).trim()}`;
      else diag(index + 1, "Continuation has no preceding statement.", "error");
    } else statements.push({ text, line: index + 1 });
  }
  const pending = new Map<Circuit, Statement[]>([[top, []]]);
  const models = new Map<Circuit, Map<string, string>>([[top, new Map()]]);
  const definitions = new Map<string, Circuit>();
  let current = top, control = false, first = true;
  for (const statement of statements) {
    const tokens = spiceTokens(statement.text), directive = key(tokens[0] ?? "");
    if (!tokens.length) continue;
    if (directive === ".endc") { control = false; continue; }
    if (control) continue;
    if (directive === ".control") { control = true; continue; }
    if (directive === ".end") break;
    if (directive === ".subckt") {
      if (current !== top) diag(statement.line, "Nested subcircuit definitions are not supported; inspect the source.", "error");
      const name = tokens[1];
      if (!name || definitions.has(key(name))) { diag(statement.line, "Missing or duplicate subcircuit name.", "error"); continue; }
      const args = tokens.slice(2);
      const parameterStart = parameterOffset(args);
      const ports = parameterStart < 0 ? args : args.slice(0, parameterStart);
      current = { id: key(name), name, ports: ports.map(key), parameters: parameterStart < 0 ? "" : args.slice(parameterStart).join(" "), devices: [], line: statement.line };
      definitions.set(current.id, current);
      result.circuits.push(current);
      pending.set(current, []); models.set(current, new Map());
    } else if (directive === ".ends") {
      if (current === top) diag(statement.line, ".ENDS without a subcircuit.", "error");
      else if (tokens[1] && key(tokens[1]) !== current.id) diag(statement.line, ".ENDS name does not match its subcircuit.", "error");
      current = top;
    } else if (directive === ".model") {
      if (tokens[1] && tokens[2]) models.get(current)!.set(key(tokens[1]), tokens[2].split("(")[0].toUpperCase());
      else diag(statement.line, "Incomplete model definition.", "error");
    } else if (directive.startsWith(".")) {
      if ([".include", ".inc", ".lib"].includes(directive)) diag(statement.line, "External model/library reference is shown in source only; the viewer does not open files.");
      else if ([".connect", ".global", ".if", ".elseif", ".else", ".endif"].includes(directive)) diag(statement.line, `${tokens[0]} is not resolved; connectivity may differ from the simulated circuit.`);
    } else if (first && statement.line === 1 && !/^[rcldqmjviegfhbxswto]\S*\d\S*\s+\S+\s+\S+/i.test(statement.text)) {
      result.title = statement.text;
    } else pending.get(current)!.push(statement);
    first = false;
  }
  if (control) diag(statements.at(-1)?.line ?? 1, "Unclosed .CONTROL block.", "error");
  if (current !== top) diag(current.line, "Subcircuit is missing .ENDS.", "error");
  let deviceCount = 0;
  for (const circuit of result.circuits) {
    const seen = new Set<string>();
    const modelType = (name: string) => models.get(circuit)?.get(key(name)) ?? models.get(top)?.get(key(name));
    for (const statement of pending.get(circuit)!) {
      if (deviceCount >= MAX_DEVICES) { diag(statement.line, "Only the first 2000 components are displayed. Inspect the source for the remainder.", "error"); break; }
      const tokens = spiceTokens(statement.text), id = tokens[0];
      const kind = id[0].toUpperCase() as DeviceKind;
      let nodes = 2, names = ["+", "−"], model: string | undefined, subcircuit: string | undefined;
      if (seen.has(key(id))) { diag(statement.line, `Duplicate component ${id}.`, "error"); continue; }
      if (kind === "X") {
        const params = parameterOffset(tokens);
        const modelIndex = (params < 0 ? tokens.length : params) - 1;
        model = tokens[modelIndex]; nodes = modelIndex - 1;
        const definition = definitions.get(key(model ?? ""));
        subcircuit = definition?.id;
        names = definition?.ports ?? Array.from({ length: Math.min(nodes, MAX_PINS) }, (_, i) => `${i + 1}`);
        if (!definition) diag(statement.line, `${id}: subcircuit ${model ?? "?"} is external or undefined; showing its terminals as a block.`);
        else if (definition.ports.length !== nodes) diag(statement.line, `${id}: ${nodes} terminals supplied, but ${model} declares ${definition.ports.length}.`, "error");
      } else if (kind === "M") {
        // Upstream fixtures use a legacy three-terminal MOS declaration.
        nodes = tokens.length === 5 || (!!modelType(tokens[4] ?? "") && !modelType(tokens[5] ?? "")) ? 3 : 4;
        names = ["D", "G", "S", "B"];
        model = tokens[nodes + 1];
        if (nodes === 3) diag(statement.line, `${id}: legacy three-terminal MOSFET; no explicit bulk terminal in source.`);
      } else if (kind === "Q") {
        nodes = modelType(tokens[5] ?? "") ? 4 : 3;
        if (tokens.length > 5 && !modelType(tokens[4] ?? "") && !modelType(tokens[5] ?? "") && !/^(?:off|[-+\d.]|\w+=)/i.test(tokens[5])) {
          diag(statement.line, `${id}: unresolved BJT model; assuming three terminals. Check any optional substrate in source.`);
        }
        names = ["C", "B", "E", "S"]; model = tokens[nodes + 1];
      } else if (kind === "J") { nodes = 3; names = ["D", "G", "S"]; model = tokens[4]; }
      else if (kind === "D") { names = ["A", "K"]; model = tokens[3]; }
      else if (kind === "E" || kind === "G") {
        const expression = tokens[3] ?? "";
        if (/^(?:value|vol|cur|table|laplace)\b/i.test(expression)) nodes = 2;
        else if (/^poly\(/i.test(expression)) {
          // POLY has a selector between the output and control nodes.
          const count = Number(expression.match(/^poly\((\d+)\)$/i)?.[1]);
          if (!count || count > 32) { diag(statement.line, `${id}: unsupported POLY control specification.`, "error"); continue; }
          tokens.splice(3, 1); nodes = 2 + 2 * count;
        } else nodes = 4;
        names = ["+", "−", "control+", "control−"];
      } else if (kind === "S") { nodes = 4; names = ["+", "−", "control+", "control−"]; model = tokens[5]; }
      else if (kind === "W") { model = tokens[4]; }
      else if (kind === "T" || kind === "O") { nodes = 4; names = ["1+", "1−", "2+", "2−"]; }
      else if (["R", "C", "L"].includes(kind)) names = ["1", "2"];
      else if (!["V", "I", "B", "F", "H"].includes(kind)) {
        diag(statement.line, `${id}: ${id[0].toUpperCase() === "K" ? "inductor coupling is retained in source but not drawn" : "unsupported device type; retained in source"}.`);
        continue;
      }
      if (nodes < 1 || nodes > MAX_PINS || tokens.length < nodes + 2) {
        diag(statement.line, `${id}: incomplete statement or more than ${MAX_PINS} terminals.`, "error"); continue;
      }
      const nodeTokens = tokens.slice(1, nodes + 1);
      if (nodeTokens.some((n) => /[={}()]/.test(n))) { diag(statement.line, `${id}: invalid terminal list.`, "error"); continue; }
      seen.add(key(id)); deviceCount++;
      circuit.devices.push({ id, kind, pins: nodeTokens.map((node, i) => ({ node: key(node), name: names[i] ?? `${i + 1}` })), value: tokens.slice(nodes + 1).join(" "), model, modelType: model ? modelType(model) : undefined, subcircuit, line: statement.line, source: statement.text });
    }
  }
  if (!deviceCount) diag(1, "No supported components found. Inspect the source and diagnostics.", "error");
  return result;
}
