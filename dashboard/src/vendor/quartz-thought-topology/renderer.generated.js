// Generated from ../quartz/quartz/components/scripts/thoughtTopologyViewer.ts. Do not edit by hand.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to3, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to3, key) && key !== except)
        __defProp(to3, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to3;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/rfdc/index.js
var require_rfdc = __commonJS({
  "node_modules/rfdc/index.js"(exports, module) {
    "use strict";
    module.exports = rfdc2;
    function copyBuffer(cur) {
      if (cur instanceof Buffer) {
        return Buffer.from(cur);
      }
      return new cur.constructor(cur.buffer.slice(), cur.byteOffset, cur.length);
    }
    function rfdc2(opts) {
      opts = opts || {};
      if (opts.circles) return rfdcCircles(opts);
      const constructorHandlers = /* @__PURE__ */ new Map();
      constructorHandlers.set(Date, (o) => new Date(o));
      constructorHandlers.set(Map, (o, fn2) => new Map(cloneArray(Array.from(o), fn2)));
      constructorHandlers.set(Set, (o, fn2) => new Set(cloneArray(Array.from(o), fn2)));
      if (opts.constructorHandlers) {
        for (const handler2 of opts.constructorHandlers) {
          constructorHandlers.set(handler2[0], handler2[1]);
        }
      }
      let handler = null;
      return opts.proto ? cloneProto : clone2;
      function cloneArray(a, fn2) {
        const keys = Object.keys(a);
        const a2 = new Array(keys.length);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const cur = a[k];
          if (typeof cur !== "object" || cur === null) {
            a2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            a2[k] = handler(cur, fn2);
          } else if (ArrayBuffer.isView(cur)) {
            a2[k] = copyBuffer(cur);
          } else {
            a2[k] = fn2(cur);
          }
        }
        return a2;
      }
      function clone2(o) {
        if (typeof o !== "object" || o === null) return o;
        if (Array.isArray(o)) return cloneArray(o, clone2);
        if (o.constructor !== Object && (handler = constructorHandlers.get(o.constructor))) {
          return handler(o, clone2);
        }
        const o2 = {};
        for (const k in o) {
          if (Object.hasOwnProperty.call(o, k) === false) continue;
          const cur = o[k];
          if (typeof cur !== "object" || cur === null) {
            o2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            o2[k] = handler(cur, clone2);
          } else if (ArrayBuffer.isView(cur)) {
            o2[k] = copyBuffer(cur);
          } else {
            o2[k] = clone2(cur);
          }
        }
        return o2;
      }
      function cloneProto(o) {
        if (typeof o !== "object" || o === null) return o;
        if (Array.isArray(o)) return cloneArray(o, cloneProto);
        if (o.constructor !== Object && (handler = constructorHandlers.get(o.constructor))) {
          return handler(o, cloneProto);
        }
        const o2 = {};
        for (const k in o) {
          const cur = o[k];
          if (typeof cur !== "object" || cur === null) {
            o2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            o2[k] = handler(cur, cloneProto);
          } else if (ArrayBuffer.isView(cur)) {
            o2[k] = copyBuffer(cur);
          } else {
            o2[k] = cloneProto(cur);
          }
        }
        return o2;
      }
    }
    function rfdcCircles(opts) {
      const refs = [];
      const refsNew = [];
      const constructorHandlers = /* @__PURE__ */ new Map();
      constructorHandlers.set(Date, (o) => new Date(o));
      constructorHandlers.set(Map, (o, fn2) => new Map(cloneArray(Array.from(o), fn2)));
      constructorHandlers.set(Set, (o, fn2) => new Set(cloneArray(Array.from(o), fn2)));
      if (opts.constructorHandlers) {
        for (const handler2 of opts.constructorHandlers) {
          constructorHandlers.set(handler2[0], handler2[1]);
        }
      }
      let handler = null;
      return opts.proto ? cloneProto : clone2;
      function cloneArray(a, fn2) {
        const keys = Object.keys(a);
        const a2 = new Array(keys.length);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const cur = a[k];
          if (typeof cur !== "object" || cur === null) {
            a2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            a2[k] = handler(cur, fn2);
          } else if (ArrayBuffer.isView(cur)) {
            a2[k] = copyBuffer(cur);
          } else {
            const index = refs.indexOf(cur);
            if (index !== -1) {
              a2[k] = refsNew[index];
            } else {
              a2[k] = fn2(cur);
            }
          }
        }
        return a2;
      }
      function clone2(o) {
        if (typeof o !== "object" || o === null) return o;
        if (Array.isArray(o)) return cloneArray(o, clone2);
        if (o.constructor !== Object && (handler = constructorHandlers.get(o.constructor))) {
          return handler(o, clone2);
        }
        const o2 = {};
        refs.push(o);
        refsNew.push(o2);
        for (const k in o) {
          if (Object.hasOwnProperty.call(o, k) === false) continue;
          const cur = o[k];
          if (typeof cur !== "object" || cur === null) {
            o2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            o2[k] = handler(cur, clone2);
          } else if (ArrayBuffer.isView(cur)) {
            o2[k] = copyBuffer(cur);
          } else {
            const i = refs.indexOf(cur);
            if (i !== -1) {
              o2[k] = refsNew[i];
            } else {
              o2[k] = clone2(cur);
            }
          }
        }
        refs.pop();
        refsNew.pop();
        return o2;
      }
      function cloneProto(o) {
        if (typeof o !== "object" || o === null) return o;
        if (Array.isArray(o)) return cloneArray(o, cloneProto);
        if (o.constructor !== Object && (handler = constructorHandlers.get(o.constructor))) {
          return handler(o, cloneProto);
        }
        const o2 = {};
        refs.push(o);
        refsNew.push(o2);
        for (const k in o) {
          const cur = o[k];
          if (typeof cur !== "object" || cur === null) {
            o2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            o2[k] = handler(cur, cloneProto);
          } else if (ArrayBuffer.isView(cur)) {
            o2[k] = copyBuffer(cur);
          } else {
            const i = refs.indexOf(cur);
            if (i !== -1) {
              o2[k] = refsNew[i];
            } else {
              o2[k] = cloneProto(cur);
            }
          }
        }
        refs.pop();
        refsNew.pop();
        return o2;
      }
    }
  }
});

// quartz/components/scripts/topologyPaint.mjs
function mapTone(topicIndex, gardenIndex) {
  return (topicIndex ?? gardenIndex ?? 0) % 8;
}
function mapPointSize(isFolder, selected) {
  return (isFolder ? 10 : 6) + (selected ? 4 : 0);
}
function mapThreadOpacity(structural, strength) {
  return structural ? 0.12 : 0.14 + 0.15 * Math.max(0, Math.min(1, strength));
}

// quartz/components/scripts/topologyAssistant.ts
var normalize = (s) => (s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
var filler = new Set("a an and are as at be between by can connections connection connected connects connecting connect different do does each explain find for from garden gardens give strongest strong how i in inter intra is it link linked links map me most my node nodes of on or page pages path paths please related relate relates relationship relationships show some the these this those through to what which why with across cross within same selected has have any there their they shared tell list trace other overlap your knowledge".split(" "));
var scopeMessage = "I can answer questions about this map\u2019s Gardens, pages, and connections. Try \u201CWhich pages connect across Gardens?\u201D or enter a page title.";
var empty = (text) => ({ text, nodes: [], edges: [] });
var hasWord = (text, phrase) => (" " + text + " ").includes(" " + phrase + " ");
function shortestPath(edges, start, end) {
  const adjacent = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    for (const id3 of [edge.source, edge.target]) {
      const list = adjacent.get(id3);
      if (list) list.push(edge);
      else adjacent.set(id3, [edge]);
    }
  }
  const queue = [start], seen = new Set(queue), previous = /* @__PURE__ */ new Map();
  for (let i = 0; i < queue.length && !seen.has(end); i++) {
    for (const edge of adjacent.get(queue[i]) ?? []) {
      const next = edge.source === queue[i] ? edge.target : edge.source;
      if (seen.has(next)) continue;
      previous.set(next, edge);
      seen.add(next);
      queue.push(next);
    }
  }
  const path = [];
  for (let id3 = end; previous.has(id3); ) {
    const edge = previous.get(id3);
    path.push(edge);
    id3 = edge.source === id3 ? edge.target : edge.source;
  }
  return path.reverse();
}
function answerMapQuestion(nodes, edges, question, context) {
  const text = normalize(question);
  const request = text.replace(/^(?:please |can you |could you )+/, "");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selected = byId.get(context.selectedNodeId ?? "");
  const deictic = /\b(this|these|it|they|selected|those)\b/.test(text);
  const lookup = request.replace(/^(?:what is|what s|tell me about|show me|describe|explain|show|find) /, "").replace(/^(?:the |my )?(?:page|node|garden|folder) (?:named |called )?/, "").replace(/ (?:on|in) (?:this|the|my) (?:knowledge )?map$/, "");
  const subject = nodes.find((n) => normalize(n.title) === lookup) ?? (/^(?:(?:tell me about|describe|what is|what s|explain|show) )?(?:(?:this|the selected) (?:page|node|garden|folder)|it)$/.test(request) ? selected : void 0);
  if (subject) {
    const entry = subject.summary.text?.trim();
    const location = subject.folderTitle ? " in " + subject.folderTitle : "";
    return { text: entry || subject.title + " is a " + subject.kind + location + ".", nodes: [subject], edges: [] };
  }
  const counting = /^(?:how many|count|what is the (?:number|count) of|what s the (?:number|count) of)\b/.test(request);
  const overview = /^(?:(?:show|summarize|describe|explain) (?:me )?(?:this|the|my) (?:knowledge )?map|(?:map )?overview|what(?: s| is) (?:in|on) (?:this|the|my) (?:knowledge )?map)$/.test(request);
  const countSubject = request.replace(/^(?:how many|count|what (?:is|s) the (?:number|count) of) /, "");
  const countWords = new Set("nodes gardens pages links connections and are there shown visible on in does this the my knowledge map have here total".split(" "));
  const globalCount = counting && /\b(nodes|gardens|pages|links|connections)\b/.test(countSubject) && countSubject.split(" ").every((w2) => countWords.has(w2));
  if (overview || globalCount) {
    const gardens = context.multipleGardens ? nodes.filter((n) => n.kind === "folder" && n.id === n.sectorId).length : 1;
    const pages = nodes.filter((n) => n.kind === "page").length;
    return empty("This view shows " + gardens.toLocaleString() + (gardens === 1 ? " Garden, " : " Gardens, ") + nodes.length.toLocaleString() + " nodes (" + pages.toLocaleString() + " pages), and " + context.visibleConnectionCount.toLocaleString() + " connections.");
  }
  if (/^(?:what|why|how)\b.*\b(colou?rs?|colou?red)\b/.test(text) && /\b(map|nodes?|dots?|gardens?|mean|represent)\b/.test(text)) {
    return empty("Pages with a detected topic share its color. Other nodes use their Garden or top-level folder color. Each line takes its colors from its two endpoints.");
  }
  if (/^(?:what|why|how)\b.*\b(pulse|pulses|pulsing|highlighted)\b/.test(text) && /\b(map|nodes?|dots?|links?|connections?)\b/.test(text)) {
    return empty("An answer briefly pulses its cited nodes and links. They stay highlighted until you clear them or ask another question. Recent map activity can also pulse when it arrives.");
  }
  const relation = /\b(?:connect(?:s|ed|ing|ions?)?|relat(?:e[sd]?|ionships?|ions?)|links?|linked|paths?|bridges?|affinit(?:y|ies)|neighbou?rs?|overlap)\b/.test(text);
  const mapRequest = /^(?:what|which|where|how|why|are|is|do|does|find|show|list|tell|give|explain|trace|explore|connect|connections?|links?|paths?|strongest|cross|inter|count)\b/.test(request);
  if (!relation || !mapRequest) return empty(scopeMessage);
  const mentions = nodes.map((n) => ({ node: n, title: normalize(n.title) })).filter((m) => m.title && !filler.has(m.title) && hasWord(text, m.title)).sort((a, b) => b.title.length - a.title.length);
  const named = mentions.filter((m, i) => !mentions.slice(0, i).some((other) => hasWord(other.title, m.title))).sort((a, b) => (" " + text + " ").indexOf(" " + a.title + " ") - (" " + text + " ").indexOf(" " + b.title + " ")).map((m) => m.node);
  if (!named.length && deictic && context.selectedEdge && /\b(link|connection|edge|they|these two|related|connected)\b/.test(text)) {
    return { text: "Here is the connection you selected.", edges: [context.selectedEdge], nodes: [] };
  }
  if (!named.length && deictic && selected) named.push(selected);
  const crossOnly = /\b(?:cross garden|across gardens|between gardens|different gardens)\b/.test(text);
  const withinOnly = /\b(?:inter garden|within (?:a |the |one )?garden|same garden)\b/.test(text);
  const isGarden = (n) => context.multipleGardens && n.kind === "folder" && n.id === n.sectorId;
  const includes = (n, id3) => n.id === id3 || isGarden(n) && byId.get(id3)?.sectorId === n.id;
  const ranked = edges.filter((e) => (!crossOnly || context.multipleGardens && e.crossFolder) && (!withinOnly || !context.multipleGardens || !e.crossFolder)).sort((a, b) => b.strength - a.strength || b.score - a.score || a.id.localeCompare(b.id));
  if (named.length >= 2 && !isGarden(named[0]) && !isGarden(named[1])) {
    const [a, b] = named;
    const path = shortestPath(ranked, a.id, b.id);
    return { text: path.length ? path.length === 1 ? "These pages share a direct link." : "The shortest path uses " + path.length + " links." : "I couldn\u2019t find a path between those nodes with the current filters.", edges: path, nodes: [] };
  }
  const terms = [...new Set(text.split(" ").filter((w2) => !filler.has(w2)))];
  const explicitOverview = /\b(?:strongest|cross garden|across gardens|between gardens|on (?:this|the|my) map|in (?:this|the|my) map)\b/.test(text);
  if (!named.length && !terms.length && deictic && !explicitOverview) return empty("Select a node or connection, or include its name in your question.");
  const nodeText = /* @__PURE__ */ new Map();
  const searchable = (id3) => {
    if (!nodeText.has(id3)) {
      const n = byId.get(id3);
      nodeText.set(id3, n ? normalize([n.title, n.folderTitle, ...n.concepts].join(" ")) : "");
    }
    return nodeText.get(id3);
  };
  const found = ranked.filter((e) => {
    if (named.length > 1) {
      const [a, b] = named;
      return includes(a, e.source) && includes(b, e.target) || includes(a, e.target) && includes(b, e.source);
    }
    if (named.length) return includes(named[0], e.source) || includes(named[0], e.target);
    if (!terms.length) return true;
    const evidence = searchable(e.source) + " " + searchable(e.target) + " " + normalize(e.evidence.map((v) => v.label).join(" "));
    return terms.every((t) => hasWord(evidence, t));
  });
  if (!found.length) return empty("I couldn\u2019t find a matching connection in this view. Try a page title or widen the map filters.");
  if (counting) return { text: found.length.toLocaleString() + (found.length === 1 ? " connection matches" : " connections match") + " in the current map filters.", edges: found.slice(0, 5), nodes: [] };
  const hits = found.slice(0, 5);
  return { text: hits.length === 1 ? "I found one matching connection." : "Here are " + hits.length + " of the strongest matching connections.", edges: hits, nodes: [] };
}

// quartz/components/scripts/vendor/three/three.core.js
var Mc = "186";
var vc = 0;
var Sc = 1;
var Ac = 2;
var Ic = 1;
var zc = 2;
var Bc = 3;
var $n = 0;
var Oa = 1;
var Fc = 2;
var kc = 0;
var Ea = 1;
var Pc = 2;
var Rc = 3;
var Oc = 4;
var Ec = 5;
var Na = 100;
var Lc = 101;
var Vc = 102;
var Dc = 103;
var Uc = 104;
var Wc = 200;
var Gc = 201;
var Hc = 202;
var qc = 203;
var La = 204;
var Va = 205;
var Jc = 206;
var Xc = 207;
var Yc = 208;
var Zc = 209;
var $c = 210;
var Qc = 211;
var jc = 212;
var Kc = 213;
var tu = 214;
var Qn = 0;
var jn = 1;
var Kn = 2;
var ys = 3;
var tr = 4;
var er = 5;
var ir = 6;
var sr = 7;
var gs = 0;
var eu = 1;
var iu = 2;
var su = 0;
var nu = 1;
var ru = 2;
var au = 3;
var ou = 4;
var hu = 5;
var lu = 6;
var cu = 7;
var xs = 300;
var Pi = 301;
var Ua = 302;
var Wa = 303;
var Ga = 304;
var Ha = 306;
var bs = 1e3;
var Ht = 1001;
var Ms = 1002;
var Ct = 1003;
var qa = 1004;
var Ja = 1005;
var Ut = 1006;
var Xa = 1007;
var ws = 1008;
var _s = 1009;
var Ya = 1010;
var Za = 1011;
var $a = 1012;
var Qa = 1013;
var Ri = 1014;
var Re = 1015;
var ja = 1016;
var Ka = 1017;
var to = 1018;
var mu = 1020;
var eo = 35902;
var io = 35899;
var so = 1021;
var no = 1022;
var si = 1023;
var vs = 1026;
var ro = 1027;
var rr = 1028;
var ar = 1029;
var ao = 1030;
var oo = 1031;
var ho = 1033;
var lo = 33776;
var co = 33777;
var uo = 33778;
var po = 33779;
var fo = 35840;
var mo = 35841;
var yo = 35842;
var go = 35843;
var xo = 36196;
var bo = 37492;
var Mo = 37496;
var wo = 37488;
var _o = 37489;
var vo = 37490;
var So = 37491;
var Ao = 37808;
var To = 37809;
var Co = 37810;
var Io = 37811;
var zo = 37812;
var Bo = 37813;
var Fo = 37814;
var ko = 37815;
var Po = 37816;
var Ro = 37817;
var Oo = 37818;
var Eo = 37819;
var No = 37820;
var Lo = 37821;
var Vo = 36492;
var Do = 36494;
var Uo = 36495;
var Wo = 36283;
var Go = 36284;
var Ho = 36285;
var qo = 36286;
var Oi = 2300;
var Ss = 2301;
var As = 2302;
var or = 2303;
var Oe = 2400;
var Ee = 2401;
var Ei = 2402;
var Zo = 3200;
var Ne = 0;
var vu = 1;
var lr = "";
var Et = "srgb";
var cr = "srgb-linear";
var ur = "linear";
var Cs = "srgb";
var Is = 7680;
var $o = 519;
var Uu = 512;
var Wu = 513;
var Gu = 514;
var Hu = 515;
var qu = 516;
var Ju = 517;
var Xu = 518;
var Yu = 519;
var zs = 35044;
var nd = "300 es";
var qt = 2e3;
var Le = 2001;
function cd(l) {
  for (let t = l.length - 1; t >= 0; --t) if (l[t] >= 65535) return true;
  return false;
}
function dr(l) {
  return ArrayBuffer.isView(l) && !(l instanceof DataView);
}
function Ni(l) {
  return document.createElementNS("http://www.w3.org/1999/xhtml", l);
}
function dd() {
  const l = Ni("canvas");
  return l.style.display = "block", l;
}
var Qo = {};
var we = null;
function pr(...l) {
  const t = "THREE." + l.shift();
  we ? we("log", t, ...l) : console.log(t, ...l);
}
function jo(l) {
  const t = l[0];
  if (typeof t == "string" && t.startsWith("TSL:")) {
    const e = l[1];
    e && e.isStackTrace ? l[0] += " " + e.getLocation() : l[1] = 'Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.';
  }
  return l;
}
function V(...l) {
  l = jo(l);
  const t = "THREE." + l.shift();
  if (we) we("warn", t, ...l);
  else {
    const e = l[0];
    e && e.isStackTrace ? console.warn(e.getError(t)) : console.warn(t, ...l);
  }
}
function X(...l) {
  l = jo(l);
  const t = "THREE." + l.shift();
  if (we) we("error", t, ...l);
  else {
    const e = l[0];
    e && e.isStackTrace ? console.error(e.getError(t)) : console.error(t, ...l);
  }
}
function _e(...l) {
  const t = l.join(" ");
  t in Qo || (Qo[t] = true, V(...l));
}
function yd(l, t, e) {
  return new Promise(function(i, s) {
    function n() {
      switch (l.clientWaitSync(t, l.SYNC_FLUSH_COMMANDS_BIT, 0)) {
        case l.WAIT_FAILED:
          s();
          break;
        case l.TIMEOUT_EXPIRED:
          setTimeout(n, e);
          break;
        default:
          i();
      }
    }
    setTimeout(n, e);
  });
}
var gd = { [Qn]: jn, [Kn]: ir, [tr]: sr, [ys]: er, [jn]: Qn, [ir]: Kn, [sr]: tr, [er]: ys };
var se = class {
  addEventListener(t, e) {
    this._listeners === void 0 && (this._listeners = {});
    const i = this._listeners;
    i[t] === void 0 && (i[t] = []), i[t].indexOf(e) === -1 && i[t].push(e);
  }
  hasEventListener(t, e) {
    const i = this._listeners;
    return i === void 0 ? false : i[t] !== void 0 && i[t].indexOf(e) !== -1;
  }
  removeEventListener(t, e) {
    const i = this._listeners;
    if (i === void 0) return;
    const s = i[t];
    if (s !== void 0) {
      const n = s.indexOf(e);
      n !== -1 && s.splice(n, 1);
    }
  }
  dispatchEvent(t) {
    const e = this._listeners;
    if (e === void 0) return;
    const i = e[t.type];
    if (i !== void 0) {
      t.target = this;
      const s = i.slice(0);
      for (let n = 0, r = s.length; n < r; n++) s[n].call(this, t);
      t.target = null;
    }
  }
};
var mt = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "0a", "0b", "0c", "0d", "0e", "0f", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1a", "1b", "1c", "1d", "1e", "1f", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "2a", "2b", "2c", "2d", "2e", "2f", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "3a", "3b", "3c", "3d", "3e", "3f", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "4a", "4b", "4c", "4d", "4e", "4f", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "5a", "5b", "5c", "5d", "5e", "5f", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "6a", "6b", "6c", "6d", "6e", "6f", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "7a", "7b", "7c", "7d", "7e", "7f", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "8a", "8b", "8c", "8d", "8e", "8f", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "9a", "9b", "9c", "9d", "9e", "9f", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "aa", "ab", "ac", "ad", "ae", "af", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "ba", "bb", "bc", "bd", "be", "bf", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "ca", "cb", "cc", "cd", "ce", "cf", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "da", "db", "dc", "dd", "de", "df", "e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "ea", "eb", "ec", "ed", "ee", "ef", "f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "fa", "fb", "fc", "fd", "fe", "ff"];
var Ve = Math.PI / 180;
var ri = 180 / Math.PI;
function Nt() {
  const l = Math.random() * 4294967295 | 0, t = Math.random() * 4294967295 | 0, e = Math.random() * 4294967295 | 0, i = Math.random() * 4294967295 | 0;
  return (mt[l & 255] + mt[l >> 8 & 255] + mt[l >> 16 & 255] + mt[l >> 24 & 255] + "-" + mt[t & 255] + mt[t >> 8 & 255] + "-" + mt[t >> 16 & 15 | 64] + mt[t >> 24 & 255] + "-" + mt[e & 63 | 128] + mt[e >> 8 & 255] + "-" + mt[e >> 16 & 255] + mt[e >> 24 & 255] + mt[i & 255] + mt[i >> 8 & 255] + mt[i >> 16 & 255] + mt[i >> 24 & 255]).toLowerCase();
}
function D(l, t, e) {
  return Math.max(t, Math.min(e, l));
}
function fr(l, t) {
  return (l % t + t) % t;
}
function Li(l, t, e) {
  return (1 - e) * l + e * t;
}
function wt(l, t) {
  switch (t.constructor) {
    case Float32Array:
      return l;
    case Uint32Array:
      return l / 4294967295;
    case Uint16Array:
      return l / 65535;
    case Uint8Array:
    case Uint8ClampedArray:
      return l / 255;
    case Int32Array:
      return Math.max(l / 2147483647, -1);
    case Int16Array:
      return Math.max(l / 32767, -1);
    case Int8Array:
      return Math.max(l / 127, -1);
    default:
      throw new Error("THREE.MathUtils: Invalid component type.");
  }
}
function W(l, t) {
  switch (t.constructor) {
    case Float32Array:
      return l;
    case Uint32Array:
      return Math.round(l * 4294967295);
    case Uint16Array:
      return Math.round(l * 65535);
    case Uint8Array:
    case Uint8ClampedArray:
      return Math.round(l * 255);
    case Int32Array:
      return Math.round(l * 2147483647);
    case Int16Array:
      return Math.round(l * 32767);
    case Int8Array:
      return Math.round(l * 127);
    default:
      throw new Error("THREE.MathUtils: Invalid component type.");
  }
}
var I = class _I {
  static {
    _I.prototype.isVector2 = true;
  }
  constructor(t = 0, e = 0) {
    this.x = t, this.y = e;
  }
  get width() {
    return this.x;
  }
  set width(t) {
    this.x = t;
  }
  get height() {
    return this.y;
  }
  set height(t) {
    this.y = t;
  }
  set(t, e) {
    return this.x = t, this.y = e, this;
  }
  setScalar(t) {
    return this.x = t, this.y = t, this;
  }
  setX(t) {
    return this.x = t, this;
  }
  setY(t) {
    return this.y = t, this;
  }
  setComponent(t, e) {
    switch (t) {
      case 0:
        this.x = e;
        break;
      case 1:
        this.y = e;
        break;
      default:
        throw new Error("THREE.Vector2: index is out of range: " + t);
    }
    return this;
  }
  getComponent(t) {
    switch (t) {
      case 0:
        return this.x;
      case 1:
        return this.y;
      default:
        throw new Error("THREE.Vector2: index is out of range: " + t);
    }
  }
  clone() {
    return new this.constructor(this.x, this.y);
  }
  copy(t) {
    return this.x = t.x, this.y = t.y, this;
  }
  add(t) {
    return this.x += t.x, this.y += t.y, this;
  }
  addScalar(t) {
    return this.x += t, this.y += t, this;
  }
  addVectors(t, e) {
    return this.x = t.x + e.x, this.y = t.y + e.y, this;
  }
  addScaledVector(t, e) {
    return this.x += t.x * e, this.y += t.y * e, this;
  }
  sub(t) {
    return this.x -= t.x, this.y -= t.y, this;
  }
  subScalar(t) {
    return this.x -= t, this.y -= t, this;
  }
  subVectors(t, e) {
    return this.x = t.x - e.x, this.y = t.y - e.y, this;
  }
  multiply(t) {
    return this.x *= t.x, this.y *= t.y, this;
  }
  multiplyScalar(t) {
    return this.x *= t, this.y *= t, this;
  }
  divide(t) {
    return this.x /= t.x, this.y /= t.y, this;
  }
  divideScalar(t) {
    return this.multiplyScalar(1 / t);
  }
  applyMatrix3(t) {
    const e = this.x, i = this.y, s = t.elements;
    return this.x = s[0] * e + s[3] * i + s[6], this.y = s[1] * e + s[4] * i + s[7], this;
  }
  min(t) {
    return this.x = Math.min(this.x, t.x), this.y = Math.min(this.y, t.y), this;
  }
  max(t) {
    return this.x = Math.max(this.x, t.x), this.y = Math.max(this.y, t.y), this;
  }
  clamp(t, e) {
    return this.x = D(this.x, t.x, e.x), this.y = D(this.y, t.y, e.y), this;
  }
  clampScalar(t, e) {
    return this.x = D(this.x, t, e), this.y = D(this.y, t, e), this;
  }
  clampLength(t, e) {
    const i = this.length();
    return this.divideScalar(i || 1).multiplyScalar(D(i, t, e));
  }
  floor() {
    return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this;
  }
  ceil() {
    return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this;
  }
  round() {
    return this.x = Math.round(this.x), this.y = Math.round(this.y), this;
  }
  roundToZero() {
    return this.x = Math.trunc(this.x), this.y = Math.trunc(this.y), this;
  }
  negate() {
    return this.x = -this.x, this.y = -this.y, this;
  }
  dot(t) {
    return this.x * t.x + this.y * t.y;
  }
  cross(t) {
    return this.x * t.y - this.y * t.x;
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  manhattanLength() {
    return Math.abs(this.x) + Math.abs(this.y);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  angle() {
    return Math.atan2(-this.y, -this.x) + Math.PI;
  }
  angleTo(t) {
    const e = Math.sqrt(this.lengthSq() * t.lengthSq());
    if (e === 0) return Math.PI / 2;
    const i = this.dot(t) / e;
    return Math.acos(D(i, -1, 1));
  }
  distanceTo(t) {
    return Math.sqrt(this.distanceToSquared(t));
  }
  distanceToSquared(t) {
    const e = this.x - t.x, i = this.y - t.y;
    return e * e + i * i;
  }
  manhattanDistanceTo(t) {
    return Math.abs(this.x - t.x) + Math.abs(this.y - t.y);
  }
  setLength(t) {
    return this.normalize().multiplyScalar(t);
  }
  lerp(t, e) {
    return this.x += (t.x - this.x) * e, this.y += (t.y - this.y) * e, this;
  }
  lerpVectors(t, e, i) {
    return this.x = t.x + (e.x - t.x) * i, this.y = t.y + (e.y - t.y) * i, this;
  }
  equals(t) {
    return t.x === this.x && t.y === this.y;
  }
  fromArray(t, e = 0) {
    return this.x = t[e], this.y = t[e + 1], this;
  }
  toArray(t = [], e = 0) {
    return t[e] = this.x, t[e + 1] = this.y, t;
  }
  fromBufferAttribute(t, e) {
    return this.x = t.getX(e), this.y = t.getY(e), this;
  }
  rotateAround(t, e) {
    const i = Math.cos(e), s = Math.sin(e), n = this.x - t.x, r = this.y - t.y;
    return this.x = n * i - r * s + t.x, this.y = n * s + r * i + t.y, this;
  }
  random() {
    return this.x = Math.random(), this.y = Math.random(), this;
  }
  *[Symbol.iterator]() {
    yield this.x, yield this.y;
  }
};
var _t = class {
  constructor(t = 0, e = 0, i = 0, s = 1) {
    this.isQuaternion = true, this._x = t, this._y = e, this._z = i, this._w = s;
  }
  static slerpFlat(t, e, i, s, n, r, a) {
    let o = i[s + 0], h = i[s + 1], c = i[s + 2], u = i[s + 3], d = n[r + 0], p = n[r + 1], f = n[r + 2], m = n[r + 3];
    if (u !== m || o !== d || h !== p || c !== f) {
      let y = o * d + h * p + c * f + u * m;
      y < 0 && (d = -d, p = -p, f = -f, m = -m, y = -y);
      let g = 1 - a;
      if (y < 0.9995) {
        const x = Math.acos(y), b = Math.sin(x);
        g = Math.sin(g * x) / b, a = Math.sin(a * x) / b, o = o * g + d * a, h = h * g + p * a, c = c * g + f * a, u = u * g + m * a;
      } else {
        o = o * g + d * a, h = h * g + p * a, c = c * g + f * a, u = u * g + m * a;
        const x = 1 / Math.sqrt(o * o + h * h + c * c + u * u);
        o *= x, h *= x, c *= x, u *= x;
      }
    }
    t[e] = o, t[e + 1] = h, t[e + 2] = c, t[e + 3] = u;
  }
  static multiplyQuaternionsFlat(t, e, i, s, n, r) {
    const a = i[s], o = i[s + 1], h = i[s + 2], c = i[s + 3], u = n[r], d = n[r + 1], p = n[r + 2], f = n[r + 3];
    return t[e] = a * f + c * u + o * p - h * d, t[e + 1] = o * f + c * d + h * u - a * p, t[e + 2] = h * f + c * p + a * d - o * u, t[e + 3] = c * f - a * u - o * d - h * p, t;
  }
  get x() {
    return this._x;
  }
  set x(t) {
    this._x = t, this._onChangeCallback();
  }
  get y() {
    return this._y;
  }
  set y(t) {
    this._y = t, this._onChangeCallback();
  }
  get z() {
    return this._z;
  }
  set z(t) {
    this._z = t, this._onChangeCallback();
  }
  get w() {
    return this._w;
  }
  set w(t) {
    this._w = t, this._onChangeCallback();
  }
  set(t, e, i, s) {
    return this._x = t, this._y = e, this._z = i, this._w = s, this._onChangeCallback(), this;
  }
  clone() {
    return new this.constructor(this._x, this._y, this._z, this._w);
  }
  copy(t) {
    return this._x = t.x, this._y = t.y, this._z = t.z, this._w = t.w, this._onChangeCallback(), this;
  }
  setFromEuler(t, e = true) {
    const i = t._x, s = t._y, n = t._z, r = t._order, a = Math.cos, o = Math.sin, h = a(i / 2), c = a(s / 2), u = a(n / 2), d = o(i / 2), p = o(s / 2), f = o(n / 2);
    switch (r) {
      case "XYZ":
        this._x = d * c * u + h * p * f, this._y = h * p * u - d * c * f, this._z = h * c * f + d * p * u, this._w = h * c * u - d * p * f;
        break;
      case "YXZ":
        this._x = d * c * u + h * p * f, this._y = h * p * u - d * c * f, this._z = h * c * f - d * p * u, this._w = h * c * u + d * p * f;
        break;
      case "ZXY":
        this._x = d * c * u - h * p * f, this._y = h * p * u + d * c * f, this._z = h * c * f + d * p * u, this._w = h * c * u - d * p * f;
        break;
      case "ZYX":
        this._x = d * c * u - h * p * f, this._y = h * p * u + d * c * f, this._z = h * c * f - d * p * u, this._w = h * c * u + d * p * f;
        break;
      case "YZX":
        this._x = d * c * u + h * p * f, this._y = h * p * u + d * c * f, this._z = h * c * f - d * p * u, this._w = h * c * u - d * p * f;
        break;
      case "XZY":
        this._x = d * c * u - h * p * f, this._y = h * p * u - d * c * f, this._z = h * c * f + d * p * u, this._w = h * c * u + d * p * f;
        break;
      default:
        V("Quaternion: .setFromEuler() encountered an unknown order: " + r);
    }
    return e === true && this._onChangeCallback(), this;
  }
  setFromAxisAngle(t, e) {
    const i = e / 2, s = Math.sin(i);
    return this._x = t.x * s, this._y = t.y * s, this._z = t.z * s, this._w = Math.cos(i), this._onChangeCallback(), this;
  }
  setFromRotationMatrix(t) {
    const e = t.elements, i = e[0], s = e[4], n = e[8], r = e[1], a = e[5], o = e[9], h = e[2], c = e[6], u = e[10], d = i + a + u;
    if (d > 0) {
      const p = 0.5 / Math.sqrt(d + 1);
      this._w = 0.25 / p, this._x = (c - o) * p, this._y = (n - h) * p, this._z = (r - s) * p;
    } else if (i > a && i > u) {
      const p = 2 * Math.sqrt(1 + i - a - u);
      this._w = (c - o) / p, this._x = 0.25 * p, this._y = (s + r) / p, this._z = (n + h) / p;
    } else if (a > u) {
      const p = 2 * Math.sqrt(1 + a - i - u);
      this._w = (n - h) / p, this._x = (s + r) / p, this._y = 0.25 * p, this._z = (o + c) / p;
    } else {
      const p = 2 * Math.sqrt(1 + u - i - a);
      this._w = (r - s) / p, this._x = (n + h) / p, this._y = (o + c) / p, this._z = 0.25 * p;
    }
    return this._onChangeCallback(), this;
  }
  setFromUnitVectors(t, e) {
    let i = t.dot(e) + 1;
    return i < 1e-8 ? (i = 0, Math.abs(t.x) > Math.abs(t.z) ? (this._x = -t.y, this._y = t.x, this._z = 0, this._w = i) : (this._x = 0, this._y = -t.z, this._z = t.y, this._w = i)) : (this._x = t.y * e.z - t.z * e.y, this._y = t.z * e.x - t.x * e.z, this._z = t.x * e.y - t.y * e.x, this._w = i), this.normalize();
  }
  angleTo(t) {
    return 2 * Math.acos(Math.abs(D(this.dot(t), -1, 1)));
  }
  rotateTowards(t, e) {
    const i = this.angleTo(t);
    if (i === 0) return this;
    const s = Math.min(1, e / i);
    return this.slerp(t, s), this;
  }
  identity() {
    return this.set(0, 0, 0, 1);
  }
  invert() {
    return this.conjugate();
  }
  conjugate() {
    return this._x *= -1, this._y *= -1, this._z *= -1, this._onChangeCallback(), this;
  }
  dot(t) {
    return this._x * t._x + this._y * t._y + this._z * t._z + this._w * t._w;
  }
  lengthSq() {
    return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
  }
  length() {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
  }
  normalize() {
    let t = this.length();
    return t === 0 ? (this._x = 0, this._y = 0, this._z = 0, this._w = 1) : (t = 1 / t, this._x = this._x * t, this._y = this._y * t, this._z = this._z * t, this._w = this._w * t), this._onChangeCallback(), this;
  }
  multiply(t) {
    return this.multiplyQuaternions(this, t);
  }
  premultiply(t) {
    return this.multiplyQuaternions(t, this);
  }
  multiplyQuaternions(t, e) {
    const i = t._x, s = t._y, n = t._z, r = t._w, a = e._x, o = e._y, h = e._z, c = e._w;
    return this._x = i * c + r * a + s * h - n * o, this._y = s * c + r * o + n * a - i * h, this._z = n * c + r * h + i * o - s * a, this._w = r * c - i * a - s * o - n * h, this._onChangeCallback(), this;
  }
  slerp(t, e) {
    let i = t._x, s = t._y, n = t._z, r = t._w, a = this.dot(t);
    a < 0 && (i = -i, s = -s, n = -n, r = -r, a = -a);
    let o = 1 - e;
    if (a < 0.9995) {
      const h = Math.acos(a), c = Math.sin(h);
      o = Math.sin(o * h) / c, e = Math.sin(e * h) / c, this._x = this._x * o + i * e, this._y = this._y * o + s * e, this._z = this._z * o + n * e, this._w = this._w * o + r * e, this._onChangeCallback();
    } else this._x = this._x * o + i * e, this._y = this._y * o + s * e, this._z = this._z * o + n * e, this._w = this._w * o + r * e, this.normalize();
    return this;
  }
  slerpQuaternions(t, e, i) {
    return this.copy(t).slerp(e, i);
  }
  random() {
    const t = 2 * Math.PI * Math.random(), e = 2 * Math.PI * Math.random(), i = Math.random(), s = Math.sqrt(1 - i), n = Math.sqrt(i);
    return this.set(s * Math.sin(t), s * Math.cos(t), n * Math.sin(e), n * Math.cos(e));
  }
  equals(t) {
    return t._x === this._x && t._y === this._y && t._z === this._z && t._w === this._w;
  }
  fromArray(t, e = 0) {
    return this._x = t[e], this._y = t[e + 1], this._z = t[e + 2], this._w = t[e + 3], this._onChangeCallback(), this;
  }
  toArray(t = [], e = 0) {
    return t[e] = this._x, t[e + 1] = this._y, t[e + 2] = this._z, t[e + 3] = this._w, t;
  }
  fromBufferAttribute(t, e) {
    return this._x = t.getX(e), this._y = t.getY(e), this._z = t.getZ(e), this._w = t.getW(e), this._onChangeCallback(), this;
  }
  toJSON() {
    return this.toArray();
  }
  _onChange(t) {
    return this._onChangeCallback = t, this;
  }
  _onChangeCallback() {
  }
  *[Symbol.iterator]() {
    yield this._x, yield this._y, yield this._z, yield this._w;
  }
};
var w = class _w {
  static {
    _w.prototype.isVector3 = true;
  }
  constructor(t = 0, e = 0, i = 0) {
    this.x = t, this.y = e, this.z = i;
  }
  set(t, e, i) {
    return i === void 0 && (i = this.z), this.x = t, this.y = e, this.z = i, this;
  }
  setScalar(t) {
    return this.x = t, this.y = t, this.z = t, this;
  }
  setX(t) {
    return this.x = t, this;
  }
  setY(t) {
    return this.y = t, this;
  }
  setZ(t) {
    return this.z = t, this;
  }
  setComponent(t, e) {
    switch (t) {
      case 0:
        this.x = e;
        break;
      case 1:
        this.y = e;
        break;
      case 2:
        this.z = e;
        break;
      default:
        throw new Error("THREE.Vector3: index is out of range: " + t);
    }
    return this;
  }
  getComponent(t) {
    switch (t) {
      case 0:
        return this.x;
      case 1:
        return this.y;
      case 2:
        return this.z;
      default:
        throw new Error("THREE.Vector3: index is out of range: " + t);
    }
  }
  clone() {
    return new this.constructor(this.x, this.y, this.z);
  }
  copy(t) {
    return this.x = t.x, this.y = t.y, this.z = t.z, this;
  }
  add(t) {
    return this.x += t.x, this.y += t.y, this.z += t.z, this;
  }
  addScalar(t) {
    return this.x += t, this.y += t, this.z += t, this;
  }
  addVectors(t, e) {
    return this.x = t.x + e.x, this.y = t.y + e.y, this.z = t.z + e.z, this;
  }
  addScaledVector(t, e) {
    return this.x += t.x * e, this.y += t.y * e, this.z += t.z * e, this;
  }
  sub(t) {
    return this.x -= t.x, this.y -= t.y, this.z -= t.z, this;
  }
  subScalar(t) {
    return this.x -= t, this.y -= t, this.z -= t, this;
  }
  subVectors(t, e) {
    return this.x = t.x - e.x, this.y = t.y - e.y, this.z = t.z - e.z, this;
  }
  multiply(t) {
    return this.x *= t.x, this.y *= t.y, this.z *= t.z, this;
  }
  multiplyScalar(t) {
    return this.x *= t, this.y *= t, this.z *= t, this;
  }
  multiplyVectors(t, e) {
    return this.x = t.x * e.x, this.y = t.y * e.y, this.z = t.z * e.z, this;
  }
  applyEuler(t) {
    return this.applyQuaternion(th.setFromEuler(t));
  }
  applyAxisAngle(t, e) {
    return this.applyQuaternion(th.setFromAxisAngle(t, e));
  }
  applyMatrix3(t) {
    const e = this.x, i = this.y, s = this.z, n = t.elements;
    return this.x = n[0] * e + n[3] * i + n[6] * s, this.y = n[1] * e + n[4] * i + n[7] * s, this.z = n[2] * e + n[5] * i + n[8] * s, this;
  }
  applyNormalMatrix(t) {
    return this.applyMatrix3(t).normalize();
  }
  applyMatrix4(t) {
    const e = this.x, i = this.y, s = this.z, n = t.elements, r = 1 / (n[3] * e + n[7] * i + n[11] * s + n[15]);
    return this.x = (n[0] * e + n[4] * i + n[8] * s + n[12]) * r, this.y = (n[1] * e + n[5] * i + n[9] * s + n[13]) * r, this.z = (n[2] * e + n[6] * i + n[10] * s + n[14]) * r, this;
  }
  applyQuaternion(t) {
    const e = this.x, i = this.y, s = this.z, n = t.x, r = t.y, a = t.z, o = t.w, h = 2 * (r * s - a * i), c = 2 * (a * e - n * s), u = 2 * (n * i - r * e);
    return this.x = e + o * h + r * u - a * c, this.y = i + o * c + a * h - n * u, this.z = s + o * u + n * c - r * h, this;
  }
  project(t) {
    return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix);
  }
  unproject(t) {
    return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld);
  }
  transformDirection(t) {
    const e = this.x, i = this.y, s = this.z, n = t.elements;
    return this.x = n[0] * e + n[4] * i + n[8] * s, this.y = n[1] * e + n[5] * i + n[9] * s, this.z = n[2] * e + n[6] * i + n[10] * s, this.normalize();
  }
  divide(t) {
    return this.x /= t.x, this.y /= t.y, this.z /= t.z, this;
  }
  divideScalar(t) {
    return this.multiplyScalar(1 / t);
  }
  min(t) {
    return this.x = Math.min(this.x, t.x), this.y = Math.min(this.y, t.y), this.z = Math.min(this.z, t.z), this;
  }
  max(t) {
    return this.x = Math.max(this.x, t.x), this.y = Math.max(this.y, t.y), this.z = Math.max(this.z, t.z), this;
  }
  clamp(t, e) {
    return this.x = D(this.x, t.x, e.x), this.y = D(this.y, t.y, e.y), this.z = D(this.z, t.z, e.z), this;
  }
  clampScalar(t, e) {
    return this.x = D(this.x, t, e), this.y = D(this.y, t, e), this.z = D(this.z, t, e), this;
  }
  clampLength(t, e) {
    const i = this.length();
    return this.divideScalar(i || 1).multiplyScalar(D(i, t, e));
  }
  floor() {
    return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this.z = Math.floor(this.z), this;
  }
  ceil() {
    return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this.z = Math.ceil(this.z), this;
  }
  round() {
    return this.x = Math.round(this.x), this.y = Math.round(this.y), this.z = Math.round(this.z), this;
  }
  roundToZero() {
    return this.x = Math.trunc(this.x), this.y = Math.trunc(this.y), this.z = Math.trunc(this.z), this;
  }
  negate() {
    return this.x = -this.x, this.y = -this.y, this.z = -this.z, this;
  }
  dot(t) {
    return this.x * t.x + this.y * t.y + this.z * t.z;
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  manhattanLength() {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  setLength(t) {
    return this.normalize().multiplyScalar(t);
  }
  lerp(t, e) {
    return this.x += (t.x - this.x) * e, this.y += (t.y - this.y) * e, this.z += (t.z - this.z) * e, this;
  }
  lerpVectors(t, e, i) {
    return this.x = t.x + (e.x - t.x) * i, this.y = t.y + (e.y - t.y) * i, this.z = t.z + (e.z - t.z) * i, this;
  }
  cross(t) {
    return this.crossVectors(this, t);
  }
  crossVectors(t, e) {
    const i = t.x, s = t.y, n = t.z, r = e.x, a = e.y, o = e.z;
    return this.x = s * o - n * a, this.y = n * r - i * o, this.z = i * a - s * r, this;
  }
  projectOnVector(t) {
    const e = t.lengthSq();
    if (e === 0) return this.set(0, 0, 0);
    const i = t.dot(this) / e;
    return this.copy(t).multiplyScalar(i);
  }
  projectOnPlane(t) {
    return mr.copy(this).projectOnVector(t), this.sub(mr);
  }
  reflect(t) {
    return this.sub(mr.copy(t).multiplyScalar(2 * this.dot(t)));
  }
  angleTo(t) {
    const e = Math.sqrt(this.lengthSq() * t.lengthSq());
    if (e === 0) return Math.PI / 2;
    const i = this.dot(t) / e;
    return Math.acos(D(i, -1, 1));
  }
  distanceTo(t) {
    return Math.sqrt(this.distanceToSquared(t));
  }
  distanceToSquared(t) {
    const e = this.x - t.x, i = this.y - t.y, s = this.z - t.z;
    return e * e + i * i + s * s;
  }
  manhattanDistanceTo(t) {
    return Math.abs(this.x - t.x) + Math.abs(this.y - t.y) + Math.abs(this.z - t.z);
  }
  setFromSpherical(t) {
    return this.setFromSphericalCoords(t.radius, t.phi, t.theta);
  }
  setFromSphericalCoords(t, e, i) {
    const s = Math.sin(e) * t;
    return this.x = s * Math.sin(i), this.y = Math.cos(e) * t, this.z = s * Math.cos(i), this;
  }
  setFromCylindrical(t) {
    return this.setFromCylindricalCoords(t.radius, t.theta, t.y);
  }
  setFromCylindricalCoords(t, e, i) {
    return this.x = t * Math.sin(e), this.y = i, this.z = t * Math.cos(e), this;
  }
  setFromMatrixPosition(t) {
    const e = t.elements;
    return this.x = e[12], this.y = e[13], this.z = e[14], this;
  }
  setFromMatrixScale(t) {
    const e = this.setFromMatrixColumn(t, 0).length(), i = this.setFromMatrixColumn(t, 1).length(), s = this.setFromMatrixColumn(t, 2).length();
    return this.x = e, this.y = i, this.z = s, this;
  }
  setFromMatrixColumn(t, e) {
    return this.fromArray(t.elements, e * 4);
  }
  setFromMatrix3Column(t, e) {
    return this.fromArray(t.elements, e * 3);
  }
  setFromEuler(t) {
    return this.x = t._x, this.y = t._y, this.z = t._z, this;
  }
  setFromColor(t) {
    return this.x = t.r, this.y = t.g, this.z = t.b, this;
  }
  equals(t) {
    return t.x === this.x && t.y === this.y && t.z === this.z;
  }
  fromArray(t, e = 0) {
    return this.x = t[e], this.y = t[e + 1], this.z = t[e + 2], this;
  }
  toArray(t = [], e = 0) {
    return t[e] = this.x, t[e + 1] = this.y, t[e + 2] = this.z, t;
  }
  fromBufferAttribute(t, e) {
    return this.x = t.getX(e), this.y = t.getY(e), this.z = t.getZ(e), this;
  }
  random() {
    return this.x = Math.random(), this.y = Math.random(), this.z = Math.random(), this;
  }
  randomDirection() {
    const t = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1, i = Math.sqrt(1 - e * e);
    return this.x = i * Math.cos(t), this.y = e, this.z = i * Math.sin(t), this;
  }
  *[Symbol.iterator]() {
    yield this.x, yield this.y, yield this.z;
  }
};
var mr = new w();
var th = new _t();
var Kt = class _Kt {
  static {
    _Kt.prototype.isMatrix3 = true;
  }
  constructor(t, e, i, s, n, r, a, o, h) {
    this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1], t !== void 0 && this.set(t, e, i, s, n, r, a, o, h);
  }
  set(t, e, i, s, n, r, a, o, h) {
    const c = this.elements;
    return c[0] = t, c[1] = s, c[2] = a, c[3] = e, c[4] = n, c[5] = o, c[6] = i, c[7] = r, c[8] = h, this;
  }
  identity() {
    return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1), this;
  }
  copy(t) {
    const e = this.elements, i = t.elements;
    return e[0] = i[0], e[1] = i[1], e[2] = i[2], e[3] = i[3], e[4] = i[4], e[5] = i[5], e[6] = i[6], e[7] = i[7], e[8] = i[8], this;
  }
  extractBasis(t, e, i) {
    return t.setFromMatrix3Column(this, 0), e.setFromMatrix3Column(this, 1), i.setFromMatrix3Column(this, 2), this;
  }
  setFromMatrix4(t) {
    const e = t.elements;
    return this.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]), this;
  }
  multiply(t) {
    return this.multiplyMatrices(this, t);
  }
  premultiply(t) {
    return this.multiplyMatrices(t, this);
  }
  multiplyMatrices(t, e) {
    const i = t.elements, s = e.elements, n = this.elements, r = i[0], a = i[3], o = i[6], h = i[1], c = i[4], u = i[7], d = i[2], p = i[5], f = i[8], m = s[0], y = s[3], g = s[6], x = s[1], b = s[4], M = s[7], _ = s[2], v = s[5], A = s[8];
    return n[0] = r * m + a * x + o * _, n[3] = r * y + a * b + o * v, n[6] = r * g + a * M + o * A, n[1] = h * m + c * x + u * _, n[4] = h * y + c * b + u * v, n[7] = h * g + c * M + u * A, n[2] = d * m + p * x + f * _, n[5] = d * y + p * b + f * v, n[8] = d * g + p * M + f * A, this;
  }
  multiplyScalar(t) {
    const e = this.elements;
    return e[0] *= t, e[3] *= t, e[6] *= t, e[1] *= t, e[4] *= t, e[7] *= t, e[2] *= t, e[5] *= t, e[8] *= t, this;
  }
  determinant() {
    const t = this.elements, e = t[0], i = t[1], s = t[2], n = t[3], r = t[4], a = t[5], o = t[6], h = t[7], c = t[8];
    return e * r * c - e * a * h - i * n * c + i * a * o + s * n * h - s * r * o;
  }
  invert() {
    const t = this.elements, e = t[0], i = t[1], s = t[2], n = t[3], r = t[4], a = t[5], o = t[6], h = t[7], c = t[8], u = c * r - a * h, d = a * o - c * n, p = h * n - r * o, f = e * u + i * d + s * p;
    if (f === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    const m = 1 / f;
    return t[0] = u * m, t[1] = (s * h - c * i) * m, t[2] = (a * i - s * r) * m, t[3] = d * m, t[4] = (c * e - s * o) * m, t[5] = (s * n - a * e) * m, t[6] = p * m, t[7] = (i * o - h * e) * m, t[8] = (r * e - i * n) * m, this;
  }
  transpose() {
    let t;
    const e = this.elements;
    return t = e[1], e[1] = e[3], e[3] = t, t = e[2], e[2] = e[6], e[6] = t, t = e[5], e[5] = e[7], e[7] = t, this;
  }
  getNormalMatrix(t) {
    return this.setFromMatrix4(t).invert().transpose();
  }
  transposeIntoArray(t) {
    const e = this.elements;
    return t[0] = e[0], t[1] = e[3], t[2] = e[6], t[3] = e[1], t[4] = e[4], t[5] = e[7], t[6] = e[2], t[7] = e[5], t[8] = e[8], this;
  }
  setUvTransform(t, e, i, s, n, r, a) {
    const o = Math.cos(n), h = Math.sin(n);
    return this.set(i * o, i * h, -i * (o * r + h * a) + r + t, -s * h, s * o, -s * (-h * r + o * a) + a + e, 0, 0, 1), this;
  }
  scale(t, e) {
    return _e("Matrix3: .scale() is deprecated. Use .makeScale() instead."), this.premultiply(yr.makeScale(t, e)), this;
  }
  rotate(t) {
    return _e("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."), this.premultiply(yr.makeRotation(-t)), this;
  }
  translate(t, e) {
    return _e("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."), this.premultiply(yr.makeTranslation(t, e)), this;
  }
  makeTranslation(t, e) {
    return t.isVector2 ? this.set(1, 0, t.x, 0, 1, t.y, 0, 0, 1) : this.set(1, 0, t, 0, 1, e, 0, 0, 1), this;
  }
  makeRotation(t) {
    const e = Math.cos(t), i = Math.sin(t);
    return this.set(e, -i, 0, i, e, 0, 0, 0, 1), this;
  }
  makeScale(t, e) {
    return this.set(t, 0, 0, 0, e, 0, 0, 0, 1), this;
  }
  equals(t) {
    const e = this.elements, i = t.elements;
    for (let s = 0; s < 9; s++) if (e[s] !== i[s]) return false;
    return true;
  }
  fromArray(t, e = 0) {
    for (let i = 0; i < 9; i++) this.elements[i] = t[i + e];
    return this;
  }
  toArray(t = [], e = 0) {
    const i = this.elements;
    return t[e] = i[0], t[e + 1] = i[1], t[e + 2] = i[2], t[e + 3] = i[3], t[e + 4] = i[4], t[e + 5] = i[5], t[e + 6] = i[6], t[e + 7] = i[7], t[e + 8] = i[8], t;
  }
  clone() {
    return new this.constructor().fromArray(this.elements);
  }
};
var yr = new Kt();
var eh = new Kt().set(0.4123908, 0.3575843, 0.1804808, 0.212639, 0.7151687, 0.0721923, 0.0193308, 0.1191948, 0.9505322);
var ih = new Kt().set(3.2409699, -1.5373832, -0.4986108, -0.9692436, 1.8759675, 0.0415551, 0.0556301, -0.203977, 1.0569715);
function Od() {
  const l = { enabled: true, workingColorSpace: cr, spaces: {}, convert: function(s, n, r) {
    return this.enabled === false || n === r || !n || !r || (this.spaces[n].transfer === Cs && (s.r = le(s.r), s.g = le(s.g), s.b = le(s.b)), this.spaces[n].primaries !== this.spaces[r].primaries && (s.applyMatrix3(this.spaces[n].toXYZ), s.applyMatrix3(this.spaces[r].fromXYZ)), this.spaces[r].transfer === Cs && (s.r = ai(s.r), s.g = ai(s.g), s.b = ai(s.b))), s;
  }, workingToColorSpace: function(s, n) {
    return this.convert(s, this.workingColorSpace, n);
  }, colorSpaceToWorking: function(s, n) {
    return this.convert(s, n, this.workingColorSpace);
  }, getPrimaries: function(s) {
    return this.spaces[s].primaries;
  }, getTransfer: function(s) {
    return s === lr ? ur : this.spaces[s].transfer;
  }, getToneMappingMode: function(s) {
    return this.spaces[s].outputColorSpaceConfig.toneMappingMode || "standard";
  }, getLuminanceCoefficients: function(s, n = this.workingColorSpace) {
    return s.fromArray(this.spaces[n].luminanceCoefficients);
  }, define: function(s) {
    Object.assign(this.spaces, s);
  }, _getMatrix: function(s, n, r) {
    return s.copy(this.spaces[n].toXYZ).multiply(this.spaces[r].fromXYZ);
  }, _getDrawingBufferColorSpace: function(s) {
    return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace;
  }, _getUnpackColorSpace: function(s = this.workingColorSpace) {
    return this.spaces[s].workingColorSpaceConfig.unpackColorSpace;
  }, fromWorkingColorSpace: function(s, n) {
    return _e("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."), l.workingToColorSpace(s, n);
  }, toWorkingColorSpace: function(s, n) {
    return _e("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."), l.colorSpaceToWorking(s, n);
  } }, t = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06], e = [0.2126, 0.7152, 0.0722], i = [0.3127, 0.329];
  return l.define({ [cr]: { primaries: t, whitePoint: i, transfer: ur, toXYZ: eh, fromXYZ: ih, luminanceCoefficients: e, workingColorSpaceConfig: { unpackColorSpace: Et }, outputColorSpaceConfig: { drawingBufferColorSpace: Et } }, [Et]: { primaries: t, whitePoint: i, transfer: Cs, toXYZ: eh, fromXYZ: ih, luminanceCoefficients: e, outputColorSpaceConfig: { drawingBufferColorSpace: Et } } }), l;
}
var It = Od();
function le(l) {
  return l < 0.04045 ? l * 0.0773993808 : Math.pow(l * 0.9478672986 + 0.0521327014, 2.4);
}
function ai(l) {
  return l < 31308e-7 ? l * 12.92 : 1.055 * Math.pow(l, 0.41666) - 0.055;
}
var oi;
var sh = class {
  static getDataURL(t, e = "image/png") {
    if (/^data:/i.test(t.src) || typeof HTMLCanvasElement > "u") return t.src;
    let i;
    if (t instanceof HTMLCanvasElement) i = t;
    else {
      oi === void 0 && (oi = Ni("canvas")), oi.width = t.width, oi.height = t.height;
      const s = oi.getContext("2d");
      t instanceof ImageData ? s.putImageData(t, 0, 0) : s.drawImage(t, 0, 0, t.width, t.height), i = oi;
    }
    return i.toDataURL(e);
  }
  static sRGBToLinear(t) {
    if (typeof HTMLImageElement < "u" && t instanceof HTMLImageElement || typeof HTMLCanvasElement < "u" && t instanceof HTMLCanvasElement || typeof ImageBitmap < "u" && t instanceof ImageBitmap) {
      const e = Ni("canvas");
      e.width = t.width, e.height = t.height;
      const i = e.getContext("2d");
      i.drawImage(t, 0, 0, t.width, t.height);
      const s = i.getImageData(0, 0, t.width, t.height), n = s.data;
      for (let r = 0; r < n.length; r++) n[r] = le(n[r] / 255) * 255;
      return i.putImageData(s, 0, 0), e;
    } else if (t.data) {
      const e = t.data.slice(0);
      for (let i = 0; i < e.length; i++) e instanceof Uint8Array || e instanceof Uint8ClampedArray ? e[i] = Math.floor(le(e[i] / 255) * 255) : e[i] = le(e[i]);
      return { data: e, width: t.width, height: t.height };
    } else return V("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."), t;
  }
};
var Ed = 0;
var ce = class {
  constructor(t = null) {
    this.isTextureSource = true, Object.defineProperty(this, "id", { value: Ed++ }), this.uuid = Nt(), this.data = t, this.dataReady = true, this.version = 0;
  }
  getSize(t) {
    const e = this.data;
    return typeof HTMLVideoElement < "u" && e instanceof HTMLVideoElement ? t.set(e.videoWidth, e.videoHeight, 0) : typeof VideoFrame < "u" && e instanceof VideoFrame ? t.set(e.displayWidth, e.displayHeight, 0) : e !== null ? t.set(e.width, e.height, e.depth || 0) : t.set(0, 0, 0), t;
  }
  set needsUpdate(t) {
    t === true && this.version++;
  }
  toJSON(t) {
    const e = t === void 0 || typeof t == "string";
    if (!e && t.images[this.uuid] !== void 0) return t.images[this.uuid];
    const i = { uuid: this.uuid, url: "" }, s = this.data;
    if (s !== null) {
      let n;
      if (Array.isArray(s)) {
        n = [];
        for (let r = 0, a = s.length; r < a; r++) s[r].isDataTexture ? n.push(gr(s[r].image)) : n.push(gr(s[r]));
      } else n = gr(s);
      i.url = n;
    }
    return e || (t.images[this.uuid] = i), i;
  }
};
function gr(l) {
  return typeof HTMLImageElement < "u" && l instanceof HTMLImageElement || typeof HTMLCanvasElement < "u" && l instanceof HTMLCanvasElement || typeof ImageBitmap < "u" && l instanceof ImageBitmap ? sh.getDataURL(l) : l.data ? { data: Array.from(l.data), width: l.width, height: l.height, type: l.data.constructor.name } : (V("Texture: Unable to serialize Texture."), {});
}
var Ld = 0;
var xr = new w();
var ot = class _ot extends se {
  constructor(t = _ot.DEFAULT_IMAGE, e = _ot.DEFAULT_MAPPING, i = Ht, s = Ht, n = Ut, r = ws, a = si, o = _s, h = _ot.DEFAULT_ANISOTROPY, c = lr) {
    super(), this.isTexture = true, Object.defineProperty(this, "id", { value: Ld++ }), this.uuid = Nt(), this.name = "", this.source = new ce(t), this.mipmaps = [], this.mapping = e, this.channel = 0, this.wrapS = i, this.wrapT = s, this.magFilter = n, this.minFilter = r, this.anisotropy = h, this.format = a, this.internalFormat = null, this.type = o, this.offset = new I(0, 0), this.repeat = new I(1, 1), this.center = new I(0, 0), this.rotation = 0, this.matrixAutoUpdate = true, this.matrix = new Kt(), this.generateMipmaps = true, this.premultiplyAlpha = false, this.flipY = true, this.unpackAlignment = 4, this.colorSpace = c, this.userData = {}, this.updateRanges = [], this.version = 0, this.onUpdate = null, this.renderTarget = null, this.isRenderTargetTexture = false, this.isArrayTexture = !!(t && t.depth && t.depth > 1), this.pmremVersion = 0, this.normalized = false;
  }
  get width() {
    return this.source.getSize(xr).x;
  }
  get height() {
    return this.source.getSize(xr).y;
  }
  get depth() {
    return this.source.getSize(xr).z;
  }
  get image() {
    return this.source.data;
  }
  set image(t) {
    this.source.data = t;
  }
  updateMatrix() {
    this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y, this.rotation, this.center.x, this.center.y);
  }
  addUpdateRange(t, e) {
    this.updateRanges.push({ start: t, count: e });
  }
  clearUpdateRanges() {
    this.updateRanges.length = 0;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(t) {
    return this.name = t.name, this.source = t.source, this.mipmaps = t.mipmaps.slice(0), this.mapping = t.mapping, this.channel = t.channel, this.wrapS = t.wrapS, this.wrapT = t.wrapT, this.magFilter = t.magFilter, this.minFilter = t.minFilter, this.anisotropy = t.anisotropy, this.format = t.format, this.internalFormat = t.internalFormat, this.type = t.type, this.normalized = t.normalized, this.offset.copy(t.offset), this.repeat.copy(t.repeat), this.center.copy(t.center), this.rotation = t.rotation, this.matrixAutoUpdate = t.matrixAutoUpdate, this.matrix.copy(t.matrix), this.generateMipmaps = t.generateMipmaps, this.premultiplyAlpha = t.premultiplyAlpha, this.flipY = t.flipY, this.unpackAlignment = t.unpackAlignment, this.colorSpace = t.colorSpace, this.renderTarget = t.renderTarget, this.isRenderTargetTexture = t.isRenderTargetTexture, this.isArrayTexture = t.isArrayTexture, this.userData = JSON.parse(JSON.stringify(t.userData)), this.needsUpdate = true, this;
  }
  setValues(t) {
    for (const e in t) {
      const i = t[e];
      if (i === void 0) {
        V(`Texture.setValues(): parameter '${e}' has value of undefined.`);
        continue;
      }
      const s = this[e];
      if (s === void 0) {
        V(`Texture.setValues(): property '${e}' does not exist.`);
        continue;
      }
      s && i && s.isVector2 && i.isVector2 || s && i && s.isVector3 && i.isVector3 || s && i && s.isMatrix3 && i.isMatrix3 ? s.copy(i) : this[e] = i;
    }
  }
  toJSON(t) {
    const e = t === void 0 || typeof t == "string";
    if (!e && t.textures[this.uuid] !== void 0) return t.textures[this.uuid];
    const i = { metadata: { version: 4.7, type: "Texture", generator: "Texture.toJSON" }, uuid: this.uuid, name: this.name, image: this.source.toJSON(t).uuid, mapping: this.mapping, channel: this.channel, repeat: [this.repeat.x, this.repeat.y], offset: [this.offset.x, this.offset.y], center: [this.center.x, this.center.y], rotation: this.rotation, wrap: [this.wrapS, this.wrapT], format: this.format, internalFormat: this.internalFormat, type: this.type, normalized: this.normalized, colorSpace: this.colorSpace, minFilter: this.minFilter, magFilter: this.magFilter, anisotropy: this.anisotropy, flipY: this.flipY, generateMipmaps: this.generateMipmaps, premultiplyAlpha: this.premultiplyAlpha, unpackAlignment: this.unpackAlignment };
    return Object.keys(this.userData).length > 0 && (i.userData = this.userData), e || (t.textures[this.uuid] = i), i;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
  transformUv(t) {
    if (this.mapping !== xs) return t;
    if (t.applyMatrix3(this.matrix), t.x < 0 || t.x > 1) switch (this.wrapS) {
      case bs:
        t.x = t.x - Math.floor(t.x);
        break;
      case Ht:
        t.x = t.x < 0 ? 0 : 1;
        break;
      case Ms:
        Math.abs(Math.floor(t.x) % 2) === 1 ? t.x = Math.ceil(t.x) - t.x : t.x = t.x - Math.floor(t.x);
        break;
    }
    if (t.y < 0 || t.y > 1) switch (this.wrapT) {
      case bs:
        t.y = t.y - Math.floor(t.y);
        break;
      case Ht:
        t.y = t.y < 0 ? 0 : 1;
        break;
      case Ms:
        Math.abs(Math.floor(t.y) % 2) === 1 ? t.y = Math.ceil(t.y) - t.y : t.y = t.y - Math.floor(t.y);
        break;
    }
    return this.flipY && (t.y = 1 - t.y), t;
  }
  set needsUpdate(t) {
    t === true && (this.version++, this.source.needsUpdate = true);
  }
  set needsPMREMUpdate(t) {
    t === true && this.pmremVersion++;
  }
};
ot.DEFAULT_IMAGE = null, ot.DEFAULT_MAPPING = xs, ot.DEFAULT_ANISOTROPY = 1;
var At = class _At {
  static {
    _At.prototype.isVector4 = true;
  }
  constructor(t = 0, e = 0, i = 0, s = 1) {
    this.x = t, this.y = e, this.z = i, this.w = s;
  }
  get width() {
    return this.z;
  }
  set width(t) {
    this.z = t;
  }
  get height() {
    return this.w;
  }
  set height(t) {
    this.w = t;
  }
  set(t, e, i, s) {
    return this.x = t, this.y = e, this.z = i, this.w = s, this;
  }
  setScalar(t) {
    return this.x = t, this.y = t, this.z = t, this.w = t, this;
  }
  setX(t) {
    return this.x = t, this;
  }
  setY(t) {
    return this.y = t, this;
  }
  setZ(t) {
    return this.z = t, this;
  }
  setW(t) {
    return this.w = t, this;
  }
  setComponent(t, e) {
    switch (t) {
      case 0:
        this.x = e;
        break;
      case 1:
        this.y = e;
        break;
      case 2:
        this.z = e;
        break;
      case 3:
        this.w = e;
        break;
      default:
        throw new Error("THREE.Vector4: index is out of range: " + t);
    }
    return this;
  }
  getComponent(t) {
    switch (t) {
      case 0:
        return this.x;
      case 1:
        return this.y;
      case 2:
        return this.z;
      case 3:
        return this.w;
      default:
        throw new Error("THREE.Vector4: index is out of range: " + t);
    }
  }
  clone() {
    return new this.constructor(this.x, this.y, this.z, this.w);
  }
  copy(t) {
    return this.x = t.x, this.y = t.y, this.z = t.z, this.w = t.w !== void 0 ? t.w : 1, this;
  }
  add(t) {
    return this.x += t.x, this.y += t.y, this.z += t.z, this.w += t.w, this;
  }
  addScalar(t) {
    return this.x += t, this.y += t, this.z += t, this.w += t, this;
  }
  addVectors(t, e) {
    return this.x = t.x + e.x, this.y = t.y + e.y, this.z = t.z + e.z, this.w = t.w + e.w, this;
  }
  addScaledVector(t, e) {
    return this.x += t.x * e, this.y += t.y * e, this.z += t.z * e, this.w += t.w * e, this;
  }
  sub(t) {
    return this.x -= t.x, this.y -= t.y, this.z -= t.z, this.w -= t.w, this;
  }
  subScalar(t) {
    return this.x -= t, this.y -= t, this.z -= t, this.w -= t, this;
  }
  subVectors(t, e) {
    return this.x = t.x - e.x, this.y = t.y - e.y, this.z = t.z - e.z, this.w = t.w - e.w, this;
  }
  multiply(t) {
    return this.x *= t.x, this.y *= t.y, this.z *= t.z, this.w *= t.w, this;
  }
  multiplyScalar(t) {
    return this.x *= t, this.y *= t, this.z *= t, this.w *= t, this;
  }
  applyMatrix4(t) {
    const e = this.x, i = this.y, s = this.z, n = this.w, r = t.elements;
    return this.x = r[0] * e + r[4] * i + r[8] * s + r[12] * n, this.y = r[1] * e + r[5] * i + r[9] * s + r[13] * n, this.z = r[2] * e + r[6] * i + r[10] * s + r[14] * n, this.w = r[3] * e + r[7] * i + r[11] * s + r[15] * n, this;
  }
  divide(t) {
    return this.x /= t.x, this.y /= t.y, this.z /= t.z, this.w /= t.w, this;
  }
  divideScalar(t) {
    return this.multiplyScalar(1 / t);
  }
  setAxisAngleFromQuaternion(t) {
    this.w = 2 * Math.acos(t.w);
    const e = Math.sqrt(1 - t.w * t.w);
    return e < 1e-4 ? (this.x = 1, this.y = 0, this.z = 0) : (this.x = t.x / e, this.y = t.y / e, this.z = t.z / e), this;
  }
  setAxisAngleFromRotationMatrix(t) {
    let e, i, s, n;
    const o = t.elements, h = o[0], c = o[4], u = o[8], d = o[1], p = o[5], f = o[9], m = o[2], y = o[6], g = o[10];
    if (Math.abs(c - d) < 0.01 && Math.abs(u - m) < 0.01 && Math.abs(f - y) < 0.01) {
      if (Math.abs(c + d) < 0.1 && Math.abs(u + m) < 0.1 && Math.abs(f + y) < 0.1 && Math.abs(h + p + g - 3) < 0.1) return this.set(1, 0, 0, 0), this;
      e = Math.PI;
      const b = (h + 1) / 2, M = (p + 1) / 2, _ = (g + 1) / 2, v = (c + d) / 4, A = (u + m) / 4, S = (f + y) / 4;
      return b > M && b > _ ? b < 0.01 ? (i = 0, s = 0.707106781, n = 0.707106781) : (i = Math.sqrt(b), s = v / i, n = A / i) : M > _ ? M < 0.01 ? (i = 0.707106781, s = 0, n = 0.707106781) : (s = Math.sqrt(M), i = v / s, n = S / s) : _ < 0.01 ? (i = 0.707106781, s = 0.707106781, n = 0) : (n = Math.sqrt(_), i = A / n, s = S / n), this.set(i, s, n, e), this;
    }
    let x = Math.sqrt((y - f) * (y - f) + (u - m) * (u - m) + (d - c) * (d - c));
    return Math.abs(x) < 1e-3 && (x = 1), this.x = (y - f) / x, this.y = (u - m) / x, this.z = (d - c) / x, this.w = Math.acos((h + p + g - 1) / 2), this;
  }
  setFromMatrixPosition(t) {
    const e = t.elements;
    return this.x = e[12], this.y = e[13], this.z = e[14], this.w = e[15], this;
  }
  min(t) {
    return this.x = Math.min(this.x, t.x), this.y = Math.min(this.y, t.y), this.z = Math.min(this.z, t.z), this.w = Math.min(this.w, t.w), this;
  }
  max(t) {
    return this.x = Math.max(this.x, t.x), this.y = Math.max(this.y, t.y), this.z = Math.max(this.z, t.z), this.w = Math.max(this.w, t.w), this;
  }
  clamp(t, e) {
    return this.x = D(this.x, t.x, e.x), this.y = D(this.y, t.y, e.y), this.z = D(this.z, t.z, e.z), this.w = D(this.w, t.w, e.w), this;
  }
  clampScalar(t, e) {
    return this.x = D(this.x, t, e), this.y = D(this.y, t, e), this.z = D(this.z, t, e), this.w = D(this.w, t, e), this;
  }
  clampLength(t, e) {
    const i = this.length();
    return this.divideScalar(i || 1).multiplyScalar(D(i, t, e));
  }
  floor() {
    return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this.z = Math.floor(this.z), this.w = Math.floor(this.w), this;
  }
  ceil() {
    return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this.z = Math.ceil(this.z), this.w = Math.ceil(this.w), this;
  }
  round() {
    return this.x = Math.round(this.x), this.y = Math.round(this.y), this.z = Math.round(this.z), this.w = Math.round(this.w), this;
  }
  roundToZero() {
    return this.x = Math.trunc(this.x), this.y = Math.trunc(this.y), this.z = Math.trunc(this.z), this.w = Math.trunc(this.w), this;
  }
  negate() {
    return this.x = -this.x, this.y = -this.y, this.z = -this.z, this.w = -this.w, this;
  }
  dot(t) {
    return this.x * t.x + this.y * t.y + this.z * t.z + this.w * t.w;
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }
  manhattanLength() {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  setLength(t) {
    return this.normalize().multiplyScalar(t);
  }
  lerp(t, e) {
    return this.x += (t.x - this.x) * e, this.y += (t.y - this.y) * e, this.z += (t.z - this.z) * e, this.w += (t.w - this.w) * e, this;
  }
  lerpVectors(t, e, i) {
    return this.x = t.x + (e.x - t.x) * i, this.y = t.y + (e.y - t.y) * i, this.z = t.z + (e.z - t.z) * i, this.w = t.w + (e.w - t.w) * i, this;
  }
  equals(t) {
    return t.x === this.x && t.y === this.y && t.z === this.z && t.w === this.w;
  }
  fromArray(t, e = 0) {
    return this.x = t[e], this.y = t[e + 1], this.z = t[e + 2], this.w = t[e + 3], this;
  }
  toArray(t = [], e = 0) {
    return t[e] = this.x, t[e + 1] = this.y, t[e + 2] = this.z, t[e + 3] = this.w, t;
  }
  fromBufferAttribute(t, e) {
    return this.x = t.getX(e), this.y = t.getY(e), this.z = t.getZ(e), this.w = t.getW(e), this;
  }
  random() {
    return this.x = Math.random(), this.y = Math.random(), this.z = Math.random(), this.w = Math.random(), this;
  }
  *[Symbol.iterator]() {
    yield this.x, yield this.y, yield this.z, yield this.w;
  }
};
var br = class extends se {
  constructor(t = 1, e = 1, i = {}) {
    super(), i = Object.assign({ generateMipmaps: false, internalFormat: null, minFilter: Ut, depthBuffer: true, stencilBuffer: false, resolveColorBuffer: true, resolveDepthBuffer: true, resolveStencilBuffer: true, storeMultisampledColorBuffer: true, storeMultisampledDepthBuffer: true, storeMultisampledStencilBuffer: true, depthTexture: null, samples: 0, count: 1, depth: 1, multiview: false, useArrayDepthTexture: false }, i), this.isRenderTarget = true, this.width = t, this.height = e, this.depth = i.depth, this.scissor = new At(0, 0, t, e), this.scissorTest = false, this.viewport = new At(0, 0, t, e), this.textures = [];
    const s = { width: t, height: e, depth: i.depth }, n = new ot(s), r = i.count;
    for (let a = 0; a < r; a++) this.textures[a] = n.clone(), this.textures[a].isRenderTargetTexture = true, this.textures[a].renderTarget = this;
    this._setTextureOptions(i), this.depthBuffer = i.depthBuffer, this.stencilBuffer = i.stencilBuffer, this.resolveColorBuffer = i.resolveColorBuffer, this.resolveDepthBuffer = i.resolveDepthBuffer, this.resolveStencilBuffer = i.resolveStencilBuffer, this.storeMultisampledColorBuffer = i.storeMultisampledColorBuffer, this.storeMultisampledDepthBuffer = i.storeMultisampledDepthBuffer, this.storeMultisampledStencilBuffer = i.storeMultisampledStencilBuffer, this._depthTexture = null, this.depthTexture = i.depthTexture, this.samples = i.samples, this.multiview = i.multiview, this.useArrayDepthTexture = i.useArrayDepthTexture;
  }
  _setTextureOptions(t = {}) {
    const e = { minFilter: Ut, generateMipmaps: false, flipY: false, internalFormat: null };
    t.mapping !== void 0 && (e.mapping = t.mapping), t.wrapS !== void 0 && (e.wrapS = t.wrapS), t.wrapT !== void 0 && (e.wrapT = t.wrapT), t.wrapR !== void 0 && (e.wrapR = t.wrapR), t.magFilter !== void 0 && (e.magFilter = t.magFilter), t.minFilter !== void 0 && (e.minFilter = t.minFilter), t.format !== void 0 && (e.format = t.format), t.type !== void 0 && (e.type = t.type), t.anisotropy !== void 0 && (e.anisotropy = t.anisotropy), t.colorSpace !== void 0 && (e.colorSpace = t.colorSpace), t.flipY !== void 0 && (e.flipY = t.flipY), t.generateMipmaps !== void 0 && (e.generateMipmaps = t.generateMipmaps), t.internalFormat !== void 0 && (e.internalFormat = t.internalFormat);
    for (let i = 0; i < this.textures.length; i++) this.textures[i].setValues(e);
  }
  get texture() {
    return this.textures[0];
  }
  set texture(t) {
    this.textures[0] = t;
  }
  set depthTexture(t) {
    this._depthTexture !== null && this._depthTexture.renderTarget === this && (this._depthTexture.renderTarget = null), t !== null && t.renderTarget === null && (t.renderTarget = this), this._depthTexture = t;
  }
  get depthTexture() {
    return this._depthTexture;
  }
  setSize(t, e, i = 1) {
    if (this.width !== t || this.height !== e || this.depth !== i) {
      this.width = t, this.height = e, this.depth = i;
      for (let s = 0, n = this.textures.length; s < n; s++) this.textures[s].image.width = t, this.textures[s].image.height = e, this.textures[s].image.depth = i, this.textures[s].isData3DTexture !== true && (this.textures[s].isArrayTexture = this.textures[s].image.depth > 1);
      this.dispose();
    }
    this.viewport.set(0, 0, t, e), this.scissor.set(0, 0, t, e);
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(t) {
    this.width = t.width, this.height = t.height, this.depth = t.depth, this.scissor.copy(t.scissor), this.scissorTest = t.scissorTest, this.viewport.copy(t.viewport), this.textures.length = 0;
    for (let e = 0, i = t.textures.length; e < i; e++) {
      this.textures[e] = t.textures[e].clone(), this.textures[e].isRenderTargetTexture = true, this.textures[e].renderTarget = this;
      const s = Object.assign({}, t.textures[e].image);
      this.textures[e].source = new ce(s);
    }
    if (this.depthBuffer = t.depthBuffer, this.stencilBuffer = t.stencilBuffer, this.resolveColorBuffer = t.resolveColorBuffer, this.resolveDepthBuffer = t.resolveDepthBuffer, this.resolveStencilBuffer = t.resolveStencilBuffer, this.storeMultisampledColorBuffer = t.storeMultisampledColorBuffer, this.storeMultisampledDepthBuffer = t.storeMultisampledDepthBuffer, this.storeMultisampledStencilBuffer = t.storeMultisampledStencilBuffer, t.depthTexture !== null) if (t.depthTexture.renderTarget === t) {
      const e = t.depthTexture.clone();
      e.renderTarget = null, this.depthTexture = e;
    } else this.depthTexture = t.depthTexture;
    return this.samples = t.samples, this.multiview = t.multiview, this.useArrayDepthTexture = t.useArrayDepthTexture, this;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
};
var Mr = class extends br {
  constructor(t = 1, e = 1, i = {}) {
    super(t, e, i), this.isWebGLRenderTarget = true;
  }
};
var nh = class extends ot {
  constructor(t = null, e = 1, i = 1, s = 1) {
    super(null), this.isDataArrayTexture = true, this.image = { data: t, width: e, height: i, depth: s }, this.magFilter = Ct, this.minFilter = Ct, this.wrapR = Ht, this.generateMipmaps = false, this.flipY = false, this.unpackAlignment = 1, this.layerUpdates = /* @__PURE__ */ new Set();
  }
  copy(t) {
    return super.copy(t), this.wrapR = t.wrapR, this;
  }
  addLayerUpdate(t) {
    this.layerUpdates.add(t);
  }
  clearLayerUpdates() {
    this.layerUpdates.clear();
  }
};
var wr = class extends ot {
  constructor(t = null, e = 1, i = 1, s = 1) {
    super(null), this.isData3DTexture = true, this.image = { data: t, width: e, height: i, depth: s }, this.magFilter = Ct, this.minFilter = Ct, this.wrapR = Ht, this.generateMipmaps = false, this.flipY = false, this.unpackAlignment = 1;
  }
  copy(t) {
    return super.copy(t), this.wrapR = t.wrapR, this;
  }
};
var G = class _G {
  static {
    _G.prototype.isMatrix4 = true;
  }
  constructor(t, e, i, s, n, r, a, o, h, c, u, d, p, f, m, y) {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], t !== void 0 && this.set(t, e, i, s, n, r, a, o, h, c, u, d, p, f, m, y);
  }
  set(t, e, i, s, n, r, a, o, h, c, u, d, p, f, m, y) {
    const g = this.elements;
    return g[0] = t, g[4] = e, g[8] = i, g[12] = s, g[1] = n, g[5] = r, g[9] = a, g[13] = o, g[2] = h, g[6] = c, g[10] = u, g[14] = d, g[3] = p, g[7] = f, g[11] = m, g[15] = y, this;
  }
  identity() {
    return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), this;
  }
  clone() {
    return new _G().fromArray(this.elements);
  }
  copy(t) {
    const e = this.elements, i = t.elements;
    return e[0] = i[0], e[1] = i[1], e[2] = i[2], e[3] = i[3], e[4] = i[4], e[5] = i[5], e[6] = i[6], e[7] = i[7], e[8] = i[8], e[9] = i[9], e[10] = i[10], e[11] = i[11], e[12] = i[12], e[13] = i[13], e[14] = i[14], e[15] = i[15], this;
  }
  copyPosition(t) {
    const e = this.elements, i = t.elements;
    return e[12] = i[12], e[13] = i[13], e[14] = i[14], this;
  }
  setFromMatrix3(t) {
    const e = t.elements;
    return this.set(e[0], e[3], e[6], 0, e[1], e[4], e[7], 0, e[2], e[5], e[8], 0, 0, 0, 0, 1), this;
  }
  extractBasis(t, e, i) {
    return this.determinantAffine() === 0 ? (t.set(1, 0, 0), e.set(0, 1, 0), i.set(0, 0, 1), this) : (t.setFromMatrixColumn(this, 0), e.setFromMatrixColumn(this, 1), i.setFromMatrixColumn(this, 2), this);
  }
  makeBasis(t, e, i) {
    return this.set(t.x, e.x, i.x, 0, t.y, e.y, i.y, 0, t.z, e.z, i.z, 0, 0, 0, 0, 1), this;
  }
  extractRotation(t) {
    if (t.determinantAffine() === 0) return this.identity();
    const e = this.elements, i = t.elements, s = 1 / hi.setFromMatrixColumn(t, 0).length(), n = 1 / hi.setFromMatrixColumn(t, 1).length(), r = 1 / hi.setFromMatrixColumn(t, 2).length();
    return e[0] = i[0] * s, e[1] = i[1] * s, e[2] = i[2] * s, e[3] = 0, e[4] = i[4] * n, e[5] = i[5] * n, e[6] = i[6] * n, e[7] = 0, e[8] = i[8] * r, e[9] = i[9] * r, e[10] = i[10] * r, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, this;
  }
  makeRotationFromEuler(t) {
    const e = this.elements, i = t.x, s = t.y, n = t.z, r = Math.cos(i), a = Math.sin(i), o = Math.cos(s), h = Math.sin(s), c = Math.cos(n), u = Math.sin(n);
    if (t.order === "XYZ") {
      const d = r * c, p = r * u, f = a * c, m = a * u;
      e[0] = o * c, e[4] = -o * u, e[8] = h, e[1] = p + f * h, e[5] = d - m * h, e[9] = -a * o, e[2] = m - d * h, e[6] = f + p * h, e[10] = r * o;
    } else if (t.order === "YXZ") {
      const d = o * c, p = o * u, f = h * c, m = h * u;
      e[0] = d + m * a, e[4] = f * a - p, e[8] = r * h, e[1] = r * u, e[5] = r * c, e[9] = -a, e[2] = p * a - f, e[6] = m + d * a, e[10] = r * o;
    } else if (t.order === "ZXY") {
      const d = o * c, p = o * u, f = h * c, m = h * u;
      e[0] = d - m * a, e[4] = -r * u, e[8] = f + p * a, e[1] = p + f * a, e[5] = r * c, e[9] = m - d * a, e[2] = -r * h, e[6] = a, e[10] = r * o;
    } else if (t.order === "ZYX") {
      const d = r * c, p = r * u, f = a * c, m = a * u;
      e[0] = o * c, e[4] = f * h - p, e[8] = d * h + m, e[1] = o * u, e[5] = m * h + d, e[9] = p * h - f, e[2] = -h, e[6] = a * o, e[10] = r * o;
    } else if (t.order === "YZX") {
      const d = r * o, p = r * h, f = a * o, m = a * h;
      e[0] = o * c, e[4] = m - d * u, e[8] = f * u + p, e[1] = u, e[5] = r * c, e[9] = -a * c, e[2] = -h * c, e[6] = p * u + f, e[10] = d - m * u;
    } else if (t.order === "XZY") {
      const d = r * o, p = r * h, f = a * o, m = a * h;
      e[0] = o * c, e[4] = -u, e[8] = h * c, e[1] = d * u + m, e[5] = r * c, e[9] = p * u - f, e[2] = f * u - p, e[6] = a * c, e[10] = m * u + d;
    }
    return e[3] = 0, e[7] = 0, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, this;
  }
  makeRotationFromQuaternion(t) {
    return this.compose(Ud, t, Wd);
  }
  lookAt(t, e, i) {
    const s = this.elements;
    return Lt.subVectors(t, e), Lt.lengthSq() === 0 && (Lt.z = 1), Lt.normalize(), ve.crossVectors(i, Lt), ve.lengthSq() === 0 && (Math.abs(i.z) === 1 ? Lt.x += 1e-4 : Lt.z += 1e-4, Lt.normalize(), ve.crossVectors(i, Lt)), ve.normalize(), Bs.crossVectors(Lt, ve), s[0] = ve.x, s[4] = Bs.x, s[8] = Lt.x, s[1] = ve.y, s[5] = Bs.y, s[9] = Lt.y, s[2] = ve.z, s[6] = Bs.z, s[10] = Lt.z, this;
  }
  multiply(t) {
    return this.multiplyMatrices(this, t);
  }
  premultiply(t) {
    return this.multiplyMatrices(t, this);
  }
  multiplyMatrices(t, e) {
    const i = t.elements, s = e.elements, n = this.elements, r = i[0], a = i[4], o = i[8], h = i[12], c = i[1], u = i[5], d = i[9], p = i[13], f = i[2], m = i[6], y = i[10], g = i[14], x = i[3], b = i[7], M = i[11], _ = i[15], v = s[0], A = s[4], S = s[8], T = s[12], C = s[1], B = s[5], R = s[9], L = s[13], J = s[2], N = s[6], Q = s[10], K = s[14], ut = s[3], j = s[7], tt = s[11], et = s[15];
    return n[0] = r * v + a * C + o * J + h * ut, n[4] = r * A + a * B + o * N + h * j, n[8] = r * S + a * R + o * Q + h * tt, n[12] = r * T + a * L + o * K + h * et, n[1] = c * v + u * C + d * J + p * ut, n[5] = c * A + u * B + d * N + p * j, n[9] = c * S + u * R + d * Q + p * tt, n[13] = c * T + u * L + d * K + p * et, n[2] = f * v + m * C + y * J + g * ut, n[6] = f * A + m * B + y * N + g * j, n[10] = f * S + m * R + y * Q + g * tt, n[14] = f * T + m * L + y * K + g * et, n[3] = x * v + b * C + M * J + _ * ut, n[7] = x * A + b * B + M * N + _ * j, n[11] = x * S + b * R + M * Q + _ * tt, n[15] = x * T + b * L + M * K + _ * et, this;
  }
  multiplyScalar(t) {
    const e = this.elements;
    return e[0] *= t, e[4] *= t, e[8] *= t, e[12] *= t, e[1] *= t, e[5] *= t, e[9] *= t, e[13] *= t, e[2] *= t, e[6] *= t, e[10] *= t, e[14] *= t, e[3] *= t, e[7] *= t, e[11] *= t, e[15] *= t, this;
  }
  determinant() {
    const t = this.elements, e = t[0], i = t[4], s = t[8], n = t[12], r = t[1], a = t[5], o = t[9], h = t[13], c = t[2], u = t[6], d = t[10], p = t[14], f = t[3], m = t[7], y = t[11], g = t[15], x = o * p - h * d, b = a * p - h * u, M = a * d - o * u, _ = r * p - h * c, v = r * d - o * c, A = r * u - a * c;
    return e * (m * x - y * b + g * M) - i * (f * x - y * _ + g * v) + s * (f * b - m * _ + g * A) - n * (f * M - m * v + y * A);
  }
  determinantAffine() {
    const t = this.elements, e = t[0], i = t[4], s = t[8], n = t[1], r = t[5], a = t[9], o = t[2], h = t[6], c = t[10];
    return e * (r * c - a * h) - i * (n * c - a * o) + s * (n * h - r * o);
  }
  transpose() {
    const t = this.elements;
    let e;
    return e = t[1], t[1] = t[4], t[4] = e, e = t[2], t[2] = t[8], t[8] = e, e = t[6], t[6] = t[9], t[9] = e, e = t[3], t[3] = t[12], t[12] = e, e = t[7], t[7] = t[13], t[13] = e, e = t[11], t[11] = t[14], t[14] = e, this;
  }
  setPosition(t, e, i) {
    const s = this.elements;
    return t.isVector3 ? (s[12] = t.x, s[13] = t.y, s[14] = t.z) : (s[12] = t, s[13] = e, s[14] = i), this;
  }
  invert() {
    const t = this.elements, e = t[0], i = t[1], s = t[2], n = t[3], r = t[4], a = t[5], o = t[6], h = t[7], c = t[8], u = t[9], d = t[10], p = t[11], f = t[12], m = t[13], y = t[14], g = t[15], x = e * a - i * r, b = e * o - s * r, M = e * h - n * r, _ = i * o - s * a, v = i * h - n * a, A = s * h - n * o, S = c * m - u * f, T = c * y - d * f, C = c * g - p * f, B = u * y - d * m, R = u * g - p * m, L = d * g - p * y, J = x * L - b * R + M * B + _ * C - v * T + A * S;
    if (J === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const N = 1 / J;
    return t[0] = (a * L - o * R + h * B) * N, t[1] = (s * R - i * L - n * B) * N, t[2] = (m * A - y * v + g * _) * N, t[3] = (d * v - u * A - p * _) * N, t[4] = (o * C - r * L - h * T) * N, t[5] = (e * L - s * C + n * T) * N, t[6] = (y * M - f * A - g * b) * N, t[7] = (c * A - d * M + p * b) * N, t[8] = (r * R - a * C + h * S) * N, t[9] = (i * C - e * R - n * S) * N, t[10] = (f * v - m * M + g * x) * N, t[11] = (u * M - c * v - p * x) * N, t[12] = (a * T - r * B - o * S) * N, t[13] = (e * B - i * T + s * S) * N, t[14] = (m * b - f * _ - y * x) * N, t[15] = (c * _ - u * b + d * x) * N, this;
  }
  scale(t) {
    const e = this.elements, i = t.x, s = t.y, n = t.z;
    return e[0] *= i, e[4] *= s, e[8] *= n, e[1] *= i, e[5] *= s, e[9] *= n, e[2] *= i, e[6] *= s, e[10] *= n, e[3] *= i, e[7] *= s, e[11] *= n, this;
  }
  getMaxScaleOnAxis() {
    const t = this.elements, e = t[0] * t[0] + t[1] * t[1] + t[2] * t[2], i = t[4] * t[4] + t[5] * t[5] + t[6] * t[6], s = t[8] * t[8] + t[9] * t[9] + t[10] * t[10];
    return Math.sqrt(Math.max(e, i, s));
  }
  makeTranslation(t, e, i) {
    return t.isVector3 ? this.set(1, 0, 0, t.x, 0, 1, 0, t.y, 0, 0, 1, t.z, 0, 0, 0, 1) : this.set(1, 0, 0, t, 0, 1, 0, e, 0, 0, 1, i, 0, 0, 0, 1), this;
  }
  makeRotationX(t) {
    const e = Math.cos(t), i = Math.sin(t);
    return this.set(1, 0, 0, 0, 0, e, -i, 0, 0, i, e, 0, 0, 0, 0, 1), this;
  }
  makeRotationY(t) {
    const e = Math.cos(t), i = Math.sin(t);
    return this.set(e, 0, i, 0, 0, 1, 0, 0, -i, 0, e, 0, 0, 0, 0, 1), this;
  }
  makeRotationZ(t) {
    const e = Math.cos(t), i = Math.sin(t);
    return this.set(e, -i, 0, 0, i, e, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), this;
  }
  makeRotationAxis(t, e) {
    const i = Math.cos(e), s = Math.sin(e), n = 1 - i, r = t.x, a = t.y, o = t.z, h = n * r, c = n * a;
    return this.set(h * r + i, h * a - s * o, h * o + s * a, 0, h * a + s * o, c * a + i, c * o - s * r, 0, h * o - s * a, c * o + s * r, n * o * o + i, 0, 0, 0, 0, 1), this;
  }
  makeScale(t, e, i) {
    return this.set(t, 0, 0, 0, 0, e, 0, 0, 0, 0, i, 0, 0, 0, 0, 1), this;
  }
  makeShear(t, e, i, s, n, r) {
    return this.set(1, i, n, 0, t, 1, r, 0, e, s, 1, 0, 0, 0, 0, 1), this;
  }
  compose(t, e, i) {
    const s = this.elements, n = e._x, r = e._y, a = e._z, o = e._w, h = n + n, c = r + r, u = a + a, d = n * h, p = n * c, f = n * u, m = r * c, y = r * u, g = a * u, x = o * h, b = o * c, M = o * u, _ = i.x, v = i.y, A = i.z;
    return s[0] = (1 - (m + g)) * _, s[1] = (p + M) * _, s[2] = (f - b) * _, s[3] = 0, s[4] = (p - M) * v, s[5] = (1 - (d + g)) * v, s[6] = (y + x) * v, s[7] = 0, s[8] = (f + b) * A, s[9] = (y - x) * A, s[10] = (1 - (d + m)) * A, s[11] = 0, s[12] = t.x, s[13] = t.y, s[14] = t.z, s[15] = 1, this;
  }
  decompose(t, e, i) {
    const s = this.elements;
    t.x = s[12], t.y = s[13], t.z = s[14];
    const n = this.determinantAffine();
    if (n === 0) return i.set(1, 1, 1), e.identity(), this;
    let r = hi.set(s[0], s[1], s[2]).length();
    const a = hi.set(s[4], s[5], s[6]).length(), o = hi.set(s[8], s[9], s[10]).length();
    n < 0 && (r = -r), Jt.copy(this);
    const h = 1 / r, c = 1 / a, u = 1 / o;
    return Jt.elements[0] *= h, Jt.elements[1] *= h, Jt.elements[2] *= h, Jt.elements[4] *= c, Jt.elements[5] *= c, Jt.elements[6] *= c, Jt.elements[8] *= u, Jt.elements[9] *= u, Jt.elements[10] *= u, e.setFromRotationMatrix(Jt), i.x = r, i.y = a, i.z = o, this;
  }
  makePerspective(t, e, i, s, n, r, a = qt, o = false) {
    const h = this.elements, c = 2 * n / (e - t), u = 2 * n / (i - s), d = (e + t) / (e - t), p = (i + s) / (i - s);
    let f, m;
    if (o) f = n / (r - n), m = r * n / (r - n);
    else if (a === qt) f = -(r + n) / (r - n), m = -2 * r * n / (r - n);
    else if (a === Le) f = -r / (r - n), m = -r * n / (r - n);
    else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: " + a);
    return h[0] = c, h[4] = 0, h[8] = d, h[12] = 0, h[1] = 0, h[5] = u, h[9] = p, h[13] = 0, h[2] = 0, h[6] = 0, h[10] = f, h[14] = m, h[3] = 0, h[7] = 0, h[11] = -1, h[15] = 0, this;
  }
  makeOrthographic(t, e, i, s, n, r, a = qt, o = false) {
    const h = this.elements, c = 2 / (e - t), u = 2 / (i - s), d = -(e + t) / (e - t), p = -(i + s) / (i - s);
    let f, m;
    if (o) f = 1 / (r - n), m = r / (r - n);
    else if (a === qt) f = -2 / (r - n), m = -(r + n) / (r - n);
    else if (a === Le) f = -1 / (r - n), m = -n / (r - n);
    else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: " + a);
    return h[0] = c, h[4] = 0, h[8] = 0, h[12] = d, h[1] = 0, h[5] = u, h[9] = 0, h[13] = p, h[2] = 0, h[6] = 0, h[10] = f, h[14] = m, h[3] = 0, h[7] = 0, h[11] = 0, h[15] = 1, this;
  }
  equals(t) {
    const e = this.elements, i = t.elements;
    for (let s = 0; s < 16; s++) if (e[s] !== i[s]) return false;
    return true;
  }
  fromArray(t, e = 0) {
    for (let i = 0; i < 16; i++) this.elements[i] = t[i + e];
    return this;
  }
  toArray(t = [], e = 0) {
    const i = this.elements;
    return t[e] = i[0], t[e + 1] = i[1], t[e + 2] = i[2], t[e + 3] = i[3], t[e + 4] = i[4], t[e + 5] = i[5], t[e + 6] = i[6], t[e + 7] = i[7], t[e + 8] = i[8], t[e + 9] = i[9], t[e + 10] = i[10], t[e + 11] = i[11], t[e + 12] = i[12], t[e + 13] = i[13], t[e + 14] = i[14], t[e + 15] = i[15], t;
  }
};
var hi = new w();
var Jt = new G();
var Ud = new w(0, 0, 0);
var Wd = new w(1, 1, 1);
var ve = new w();
var Bs = new w();
var Lt = new w();
var rh = new G();
var ah = new _t();
var te = class _te {
  constructor(t = 0, e = 0, i = 0, s = _te.DEFAULT_ORDER) {
    this.isEuler = true, this._x = t, this._y = e, this._z = i, this._order = s;
  }
  get x() {
    return this._x;
  }
  set x(t) {
    this._x = t, this._onChangeCallback();
  }
  get y() {
    return this._y;
  }
  set y(t) {
    this._y = t, this._onChangeCallback();
  }
  get z() {
    return this._z;
  }
  set z(t) {
    this._z = t, this._onChangeCallback();
  }
  get order() {
    return this._order;
  }
  set order(t) {
    this._order = t, this._onChangeCallback();
  }
  set(t, e, i, s = this._order) {
    return this._x = t, this._y = e, this._z = i, this._order = s, this._onChangeCallback(), this;
  }
  clone() {
    return new this.constructor(this._x, this._y, this._z, this._order);
  }
  copy(t) {
    return this._x = t._x, this._y = t._y, this._z = t._z, this._order = t._order, this._onChangeCallback(), this;
  }
  setFromRotationMatrix(t, e = this._order, i = true) {
    const s = t.elements, n = s[0], r = s[4], a = s[8], o = s[1], h = s[5], c = s[9], u = s[2], d = s[6], p = s[10];
    switch (e) {
      case "XYZ":
        this._y = Math.asin(D(a, -1, 1)), Math.abs(a) < 0.9999999 ? (this._x = Math.atan2(-c, p), this._z = Math.atan2(-r, n)) : (this._x = Math.atan2(d, h), this._z = 0);
        break;
      case "YXZ":
        this._x = Math.asin(-D(c, -1, 1)), Math.abs(c) < 0.9999999 ? (this._y = Math.atan2(a, p), this._z = Math.atan2(o, h)) : (this._y = Math.atan2(-u, n), this._z = 0);
        break;
      case "ZXY":
        this._x = Math.asin(D(d, -1, 1)), Math.abs(d) < 0.9999999 ? (this._y = Math.atan2(-u, p), this._z = Math.atan2(-r, h)) : (this._y = 0, this._z = Math.atan2(o, n));
        break;
      case "ZYX":
        this._y = Math.asin(-D(u, -1, 1)), Math.abs(u) < 0.9999999 ? (this._x = Math.atan2(d, p), this._z = Math.atan2(o, n)) : (this._x = 0, this._z = Math.atan2(-r, h));
        break;
      case "YZX":
        this._z = Math.asin(D(o, -1, 1)), Math.abs(o) < 0.9999999 ? (this._x = Math.atan2(-c, h), this._y = Math.atan2(-u, n)) : (this._x = 0, this._y = Math.atan2(a, p));
        break;
      case "XZY":
        this._z = Math.asin(-D(r, -1, 1)), Math.abs(r) < 0.9999999 ? (this._x = Math.atan2(d, h), this._y = Math.atan2(a, n)) : (this._x = Math.atan2(-c, p), this._y = 0);
        break;
      default:
        V("Euler: .setFromRotationMatrix() encountered an unknown order: " + e);
    }
    return this._order = e, i === true && this._onChangeCallback(), this;
  }
  setFromQuaternion(t, e, i) {
    return rh.makeRotationFromQuaternion(t), this.setFromRotationMatrix(rh, e, i);
  }
  setFromVector3(t, e = this._order) {
    return this.set(t.x, t.y, t.z, e);
  }
  reorder(t) {
    return ah.setFromEuler(this), this.setFromQuaternion(ah, t);
  }
  equals(t) {
    return t._x === this._x && t._y === this._y && t._z === this._z && t._order === this._order;
  }
  fromArray(t) {
    return this._x = t[0], this._y = t[1], this._z = t[2], t[3] !== void 0 && (this._order = t[3]), this._onChangeCallback(), this;
  }
  toArray(t = [], e = 0) {
    return t[e] = this._x, t[e + 1] = this._y, t[e + 2] = this._z, t[e + 3] = this._order, t;
  }
  _onChange(t) {
    return this._onChangeCallback = t, this;
  }
  _onChangeCallback() {
  }
  *[Symbol.iterator]() {
    yield this._x, yield this._y, yield this._z, yield this._order;
  }
};
te.DEFAULT_ORDER = "XYZ";
var _r = class {
  constructor() {
    this.mask = 1;
  }
  set(t) {
    this.mask = (1 << t | 0) >>> 0;
  }
  enable(t) {
    this.mask |= 1 << t | 0;
  }
  enableAll() {
    this.mask = -1;
  }
  toggle(t) {
    this.mask ^= 1 << t | 0;
  }
  disable(t) {
    this.mask &= ~(1 << t | 0);
  }
  disableAll() {
    this.mask = 0;
  }
  test(t) {
    return (this.mask & t.mask) !== 0;
  }
  isEnabled(t) {
    return (this.mask & (1 << t | 0)) !== 0;
  }
};
var Gd = 0;
var oh = new w();
var li = new _t();
var ue = new G();
var Fs = new w();
var Vi = new w();
var Hd = new w();
var qd = new _t();
var hh = new w(1, 0, 0);
var lh = new w(0, 1, 0);
var ch = new w(0, 0, 1);
var uh = { type: "added" };
var Jd = { type: "removed" };
var ci = { type: "childadded", child: null };
var vr = { type: "childremoved", child: null };
var Y = class _Y extends se {
  constructor() {
    super(), this.isObject3D = true, Object.defineProperty(this, "id", { value: Gd++ }), this.uuid = Nt(), this.name = "", this.type = "Object3D", this.parent = null, this.children = [], this.up = _Y.DEFAULT_UP.clone();
    const t = new w(), e = new te(), i = new _t(), s = new w(1, 1, 1);
    function n() {
      i.setFromEuler(e, false);
    }
    function r() {
      e.setFromQuaternion(i, void 0, false);
    }
    e._onChange(n), i._onChange(r), Object.defineProperties(this, { position: { configurable: true, enumerable: true, value: t }, rotation: { configurable: true, enumerable: true, value: e }, quaternion: { configurable: true, enumerable: true, value: i }, scale: { configurable: true, enumerable: true, value: s }, modelViewMatrix: { value: new G() }, normalMatrix: { value: new Kt() } }), this.matrix = new G(), this.matrixWorld = new G(), this.matrixAutoUpdate = _Y.DEFAULT_MATRIX_AUTO_UPDATE, this.matrixWorldAutoUpdate = _Y.DEFAULT_MATRIX_WORLD_AUTO_UPDATE, this.matrixWorldNeedsUpdate = false, this.layers = new _r(), this.visible = true, this.castShadow = false, this.receiveShadow = false, this.frustumCulled = true, this.renderOrder = 0, this.animations = [], this.customDepthMaterial = void 0, this.customDistanceMaterial = void 0, this.static = false, this.userData = {}, this.pivot = null;
  }
  onBeforeShadow() {
  }
  onAfterShadow() {
  }
  onBeforeRender() {
  }
  onAfterRender() {
  }
  applyMatrix4(t) {
    this.matrixAutoUpdate && this.updateMatrix(), this.matrix.premultiply(t), this.matrix.decompose(this.position, this.quaternion, this.scale);
  }
  applyQuaternion(t) {
    return this.quaternion.premultiply(t), this;
  }
  setRotationFromAxisAngle(t, e) {
    this.quaternion.setFromAxisAngle(t, e);
  }
  setRotationFromEuler(t) {
    this.quaternion.setFromEuler(t, true);
  }
  setRotationFromMatrix(t) {
    this.quaternion.setFromRotationMatrix(t);
  }
  setRotationFromQuaternion(t) {
    this.quaternion.copy(t);
  }
  rotateOnAxis(t, e) {
    return li.setFromAxisAngle(t, e), this.quaternion.multiply(li), this;
  }
  rotateOnWorldAxis(t, e) {
    return li.setFromAxisAngle(t, e), this.quaternion.premultiply(li), this;
  }
  rotateX(t) {
    return this.rotateOnAxis(hh, t);
  }
  rotateY(t) {
    return this.rotateOnAxis(lh, t);
  }
  rotateZ(t) {
    return this.rotateOnAxis(ch, t);
  }
  translateOnAxis(t, e) {
    return oh.copy(t).applyQuaternion(this.quaternion), this.position.add(oh.multiplyScalar(e)), this;
  }
  translateX(t) {
    return this.translateOnAxis(hh, t);
  }
  translateY(t) {
    return this.translateOnAxis(lh, t);
  }
  translateZ(t) {
    return this.translateOnAxis(ch, t);
  }
  localToWorld(t) {
    return this.updateWorldMatrix(true, false), t.applyMatrix4(this.matrixWorld);
  }
  worldToLocal(t) {
    return this.updateWorldMatrix(true, false), t.applyMatrix4(ue.copy(this.matrixWorld).invert());
  }
  lookAt(t, e, i) {
    t.isVector3 ? Fs.copy(t) : Fs.set(t, e, i);
    const s = this.parent;
    this.updateWorldMatrix(true, false), Vi.setFromMatrixPosition(this.matrixWorld), this.isCamera || this.isLight ? ue.lookAt(Vi, Fs, this.up) : ue.lookAt(Fs, Vi, this.up), this.quaternion.setFromRotationMatrix(ue), s && (ue.extractRotation(s.matrixWorld), li.setFromRotationMatrix(ue), this.quaternion.premultiply(li.invert()));
  }
  add(t) {
    if (arguments.length > 1) {
      for (let e = 0; e < arguments.length; e++) this.add(arguments[e]);
      return this;
    }
    return t === this ? (X("Object3D.add: object can't be added as a child of itself.", t), this) : (t && t.isObject3D ? (t.removeFromParent(), t.parent = this, this.children.push(t), t.dispatchEvent(uh), ci.child = t, this.dispatchEvent(ci), ci.child = null) : X("Object3D.add: object not an instance of THREE.Object3D.", t), this);
  }
  remove(t) {
    if (arguments.length > 1) {
      for (let i = 0; i < arguments.length; i++) this.remove(arguments[i]);
      return this;
    }
    const e = this.children.indexOf(t);
    return e !== -1 && (t.parent = null, this.children.splice(e, 1), t.dispatchEvent(Jd), vr.child = t, this.dispatchEvent(vr), vr.child = null), this;
  }
  removeFromParent() {
    const t = this.parent;
    return t !== null && t.remove(this), this;
  }
  clear() {
    return this.remove(...this.children);
  }
  attach(t) {
    return this.updateWorldMatrix(true, false), ue.copy(this.matrixWorld).invert(), t.parent !== null && (t.parent.updateWorldMatrix(true, false), ue.multiply(t.parent.matrixWorld)), t.applyMatrix4(ue), t.removeFromParent(), t.parent = this, this.children.push(t), t.updateWorldMatrix(false, true), t.dispatchEvent(uh), ci.child = t, this.dispatchEvent(ci), ci.child = null, this;
  }
  getObjectById(t) {
    return this.getObjectByProperty("id", t);
  }
  getObjectByName(t) {
    return this.getObjectByProperty("name", t);
  }
  getObjectByProperty(t, e) {
    if (this[t] === e) return this;
    for (let i = 0, s = this.children.length; i < s; i++) {
      const r = this.children[i].getObjectByProperty(t, e);
      if (r !== void 0) return r;
    }
  }
  getObjectsByProperty(t, e, i = []) {
    this[t] === e && i.push(this);
    const s = this.children;
    for (let n = 0, r = s.length; n < r; n++) s[n].getObjectsByProperty(t, e, i);
    return i;
  }
  getWorldPosition(t) {
    return this.updateWorldMatrix(true, false), t.setFromMatrixPosition(this.matrixWorld);
  }
  getWorldQuaternion(t) {
    return this.updateWorldMatrix(true, false), this.matrixWorld.decompose(Vi, t, Hd), t;
  }
  getWorldScale(t) {
    return this.updateWorldMatrix(true, false), this.matrixWorld.decompose(Vi, qd, t), t;
  }
  getWorldDirection(t) {
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    return t.set(e[8], e[9], e[10]).normalize();
  }
  raycast() {
  }
  intersectsFrustum() {
  }
  traverse(t) {
    t(this);
    const e = this.children;
    for (let i = 0, s = e.length; i < s; i++) e[i].traverse(t);
  }
  traverseVisible(t) {
    if (this.visible === false) return;
    t(this);
    const e = this.children;
    for (let i = 0, s = e.length; i < s; i++) e[i].traverseVisible(t);
  }
  traverseAncestors(t) {
    const e = this.parent;
    e !== null && (t(e), e.traverseAncestors(t));
  }
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    const t = this.pivot;
    if (t !== null) {
      const e = t.x, i = t.y, s = t.z, n = this.matrix.elements;
      n[12] += e - n[0] * e - n[4] * i - n[8] * s, n[13] += i - n[1] * e - n[5] * i - n[9] * s, n[14] += s - n[2] * e - n[6] * i - n[10] * s;
    }
    this.matrixWorldNeedsUpdate = true;
  }
  updateMatrixWorld(t) {
    this.matrixAutoUpdate && this.updateMatrix(), (this.matrixWorldNeedsUpdate || t) && (this.matrixWorldAutoUpdate === true && (this.parent === null ? this.matrixWorld.copy(this.matrix) : this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)), this.matrixWorldNeedsUpdate = false, t = true);
    const e = this.children;
    for (let i = 0, s = e.length; i < s; i++) e[i].updateMatrixWorld(t);
  }
  updateWorldMatrix(t, e, i = false) {
    const s = this.parent;
    if (t === true && s !== null && s.updateWorldMatrix(true, false), this.matrixAutoUpdate && this.updateMatrix(), (this.matrixWorldNeedsUpdate || i) && (this.matrixWorldAutoUpdate === true && (this.parent === null ? this.matrixWorld.copy(this.matrix) : this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)), this.matrixWorldNeedsUpdate = false, i = true), e === true) {
      const n = this.children;
      for (let r = 0, a = n.length; r < a; r++) n[r].updateWorldMatrix(false, true, i);
    }
  }
  toJSON(t) {
    const e = t === void 0 || typeof t == "string", i = {};
    e && (t = { geometries: {}, materials: {}, textures: {}, images: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} }, i.metadata = { version: 4.7, type: "Object", generator: "Object3D.toJSON" });
    const s = {};
    s.uuid = this.uuid, s.type = this.type, s.name = this.name, s.castShadow = this.castShadow, s.receiveShadow = this.receiveShadow, s.visible = this.visible, s.frustumCulled = this.frustumCulled, s.renderOrder = this.renderOrder, s.static = this.static, s.matrixAutoUpdate = this.matrixAutoUpdate, Object.keys(this.userData).length > 0 && (s.userData = this.userData), s.layers = this.layers.mask, s.matrix = this.matrix.toArray(), s.up = this.up.toArray(), this.pivot !== null && (s.pivot = this.pivot.toArray()), this.morphTargetDictionary !== void 0 && (s.morphTargetDictionary = Object.assign({}, this.morphTargetDictionary)), this.morphTargetInfluences !== void 0 && (s.morphTargetInfluences = this.morphTargetInfluences.slice()), this.isInstancedMesh && (s.type = "InstancedMesh", s.count = this.count, s.instanceMatrix = this.instanceMatrix.toJSON(), this.instanceColor !== null && (s.instanceColor = this.instanceColor.toJSON())), this.isBatchedMesh && (s.type = "BatchedMesh", s.perObjectFrustumCulled = this.perObjectFrustumCulled, s.sortObjects = this.sortObjects, s.drawRanges = this._drawRanges, s.reservedRanges = this._reservedRanges, s.geometryInfo = this._geometryInfo.map((a) => ({ ...a, boundingBox: a.boundingBox ? a.boundingBox.toJSON() : void 0, boundingSphere: a.boundingSphere ? a.boundingSphere.toJSON() : void 0 })), s.instanceInfo = this._instanceInfo.map((a) => ({ ...a })), s.availableInstanceIds = this._availableInstanceIds.slice(), s.availableGeometryIds = this._availableGeometryIds.slice(), s.nextIndexStart = this._nextIndexStart, s.nextVertexStart = this._nextVertexStart, s.geometryCount = this._geometryCount, s.maxInstanceCount = this._maxInstanceCount, s.maxVertexCount = this._maxVertexCount, s.maxIndexCount = this._maxIndexCount, s.geometryInitialized = this._geometryInitialized, s.matricesTexture = this._matricesTexture.toJSON(t), s.indirectTexture = this._indirectTexture.toJSON(t), this._colorsTexture !== null && (s.colorsTexture = this._colorsTexture.toJSON(t)), this.boundingSphere !== null && (s.boundingSphere = this.boundingSphere.toJSON()), this.boundingBox !== null && (s.boundingBox = this.boundingBox.toJSON()));
    function n(a, o) {
      return a[o.uuid] === void 0 && (a[o.uuid] = o.toJSON(t)), o.uuid;
    }
    if (this.isScene) this.background && (this.background.isColor ? s.background = this.background.toJSON() : this.background.isTexture && (s.background = this.background.toJSON(t).uuid)), this.environment && this.environment.isTexture && this.environment.isRenderTargetTexture !== true && (s.environment = this.environment.toJSON(t).uuid);
    else if (this.isMesh || this.isLine || this.isPoints) {
      s.geometry = n(t.geometries, this.geometry);
      const a = this.geometry.parameters;
      if (a !== void 0 && a.shapes !== void 0) {
        const o = a.shapes;
        if (Array.isArray(o)) for (let h = 0, c = o.length; h < c; h++) {
          const u = o[h];
          n(t.shapes, u);
        }
        else n(t.shapes, o);
      }
    }
    if (this.isSkinnedMesh && (s.bindMode = this.bindMode, s.bindMatrix = this.bindMatrix.toArray(), this.skeleton !== void 0 && (n(t.skeletons, this.skeleton), s.skeleton = this.skeleton.uuid)), this.material !== void 0) if (Array.isArray(this.material)) {
      const a = [];
      for (let o = 0, h = this.material.length; o < h; o++) a.push(n(t.materials, this.material[o]));
      s.material = a;
    } else s.material = n(t.materials, this.material);
    if (this.children.length > 0) {
      s.children = [];
      for (let a = 0; a < this.children.length; a++) s.children.push(this.children[a].toJSON(t).object);
    }
    if (this.animations.length > 0) {
      s.animations = [];
      for (let a = 0; a < this.animations.length; a++) {
        const o = this.animations[a];
        s.animations.push(n(t.animations, o));
      }
    }
    if (e) {
      const a = r(t.geometries), o = r(t.materials), h = r(t.textures), c = r(t.images), u = r(t.shapes), d = r(t.skeletons), p = r(t.animations), f = r(t.nodes);
      a.length > 0 && (i.geometries = a), o.length > 0 && (i.materials = o), h.length > 0 && (i.textures = h), c.length > 0 && (i.images = c), u.length > 0 && (i.shapes = u), d.length > 0 && (i.skeletons = d), p.length > 0 && (i.animations = p), f.length > 0 && (i.nodes = f);
    }
    return i.object = s, i;
    function r(a) {
      const o = [];
      for (const h in a) {
        const c = a[h];
        delete c.metadata, o.push(c);
      }
      return o;
    }
  }
  clone(t) {
    return new this.constructor().copy(this, t);
  }
  copy(t, e = true) {
    if (this.name = t.name, this.up.copy(t.up), this.position.copy(t.position), this.rotation.order = t.rotation.order, this.quaternion.copy(t.quaternion), this.scale.copy(t.scale), this.pivot = t.pivot !== null ? t.pivot.clone() : null, this.matrix.copy(t.matrix), this.matrixWorld.copy(t.matrixWorld), this.matrixAutoUpdate = t.matrixAutoUpdate, this.matrixWorldAutoUpdate = t.matrixWorldAutoUpdate, this.matrixWorldNeedsUpdate = t.matrixWorldNeedsUpdate, this.layers.mask = t.layers.mask, this.visible = t.visible, this.castShadow = t.castShadow, this.receiveShadow = t.receiveShadow, this.frustumCulled = t.frustumCulled, this.renderOrder = t.renderOrder, this.static = t.static, this.animations = t.animations.slice(), this.userData = JSON.parse(JSON.stringify(t.userData)), e === true) for (let i = 0; i < t.children.length; i++) {
      const s = t.children[i];
      this.add(s.clone());
    }
    return this;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
};
Y.DEFAULT_UP = new w(0, 1, 0), Y.DEFAULT_MATRIX_AUTO_UPDATE = true, Y.DEFAULT_MATRIX_WORLD_AUTO_UPDATE = true;
var ui = class extends Y {
  constructor() {
    super(), this.isGroup = true, this.type = "Group";
  }
};
var Xd = { type: "move" };
var Yd = class {
  constructor() {
    this._targetRay = null, this._grip = null, this._hand = null;
  }
  getHandSpace() {
    return this._hand === null && (this._hand = new ui(), this._hand.matrixAutoUpdate = false, this._hand.visible = false, this._hand.joints = {}, this._hand.inputState = { pinching: false }), this._hand;
  }
  getTargetRaySpace() {
    return this._targetRay === null && (this._targetRay = new ui(), this._targetRay.matrixAutoUpdate = false, this._targetRay.visible = false, this._targetRay.hasLinearVelocity = false, this._targetRay.linearVelocity = new w(), this._targetRay.hasAngularVelocity = false, this._targetRay.angularVelocity = new w()), this._targetRay;
  }
  getGripSpace() {
    return this._grip === null && (this._grip = new ui(), this._grip.matrixAutoUpdate = false, this._grip.visible = false, this._grip.hasLinearVelocity = false, this._grip.linearVelocity = new w(), this._grip.hasAngularVelocity = false, this._grip.angularVelocity = new w(), this._grip.eventsEnabled = false), this._grip;
  }
  dispatchEvent(t) {
    return this._targetRay !== null && this._targetRay.dispatchEvent(t), this._grip !== null && this._grip.dispatchEvent(t), this._hand !== null && this._hand.dispatchEvent(t), this;
  }
  connect(t) {
    if (t && t.hand) {
      const e = this._hand;
      if (e) for (const i of t.hand.values()) this._getHandJoint(e, i);
    }
    return this.dispatchEvent({ type: "connected", data: t }), this;
  }
  disconnect(t) {
    return this.dispatchEvent({ type: "disconnected", data: t }), this._targetRay !== null && (this._targetRay.visible = false), this._grip !== null && (this._grip.visible = false), this._hand !== null && (this._hand.visible = false), this;
  }
  update(t, e, i) {
    let s = null, n = null, r = null;
    const a = this._targetRay, o = this._grip, h = this._hand;
    if (t && e.session.visibilityState !== "visible-blurred") {
      if (h && t.hand) {
        r = true;
        for (const m of t.hand.values()) {
          const y = e.getJointPose(m, i), g = this._getHandJoint(h, m);
          y !== null && (g.matrix.fromArray(y.transform.matrix), g.matrix.decompose(g.position, g.rotation, g.scale), g.matrixWorldNeedsUpdate = true, g.jointRadius = y.radius), g.visible = y !== null;
        }
        const c = h.joints["index-finger-tip"], u = h.joints["thumb-tip"], d = c.position.distanceTo(u.position), p = 0.02, f = 5e-3;
        h.inputState.pinching && d > p + f ? (h.inputState.pinching = false, this.dispatchEvent({ type: "pinchend", handedness: t.handedness, target: this })) : !h.inputState.pinching && d <= p - f && (h.inputState.pinching = true, this.dispatchEvent({ type: "pinchstart", handedness: t.handedness, target: this }));
      } else o !== null && t.gripSpace && (n = e.getPose(t.gripSpace, i), n !== null && (o.matrix.fromArray(n.transform.matrix), o.matrix.decompose(o.position, o.rotation, o.scale), o.matrixWorldNeedsUpdate = true, n.linearVelocity ? (o.hasLinearVelocity = true, o.linearVelocity.copy(n.linearVelocity)) : o.hasLinearVelocity = false, n.angularVelocity ? (o.hasAngularVelocity = true, o.angularVelocity.copy(n.angularVelocity)) : o.hasAngularVelocity = false, o.eventsEnabled && o.dispatchEvent({ type: "gripUpdated", data: t, target: this })));
      a !== null && (s = e.getPose(t.targetRaySpace, i), s === null && n !== null && (s = n), s !== null && (a.matrix.fromArray(s.transform.matrix), a.matrix.decompose(a.position, a.rotation, a.scale), a.matrixWorldNeedsUpdate = true, s.linearVelocity ? (a.hasLinearVelocity = true, a.linearVelocity.copy(s.linearVelocity)) : a.hasLinearVelocity = false, s.angularVelocity ? (a.hasAngularVelocity = true, a.angularVelocity.copy(s.angularVelocity)) : a.hasAngularVelocity = false, this.dispatchEvent(Xd)));
    }
    return a !== null && (a.visible = s !== null), o !== null && (o.visible = n !== null), h !== null && (h.visible = r !== null), this;
  }
  _getHandJoint(t, e) {
    if (t.joints[e.jointName] === void 0) {
      const i = new ui();
      i.matrixAutoUpdate = false, i.visible = false, t.joints[e.jointName] = i, t.add(i);
    }
    return t.joints[e.jointName];
  }
};
var dh = { aliceblue: 15792383, antiquewhite: 16444375, aqua: 65535, aquamarine: 8388564, azure: 15794175, beige: 16119260, bisque: 16770244, black: 0, blanchedalmond: 16772045, blue: 255, blueviolet: 9055202, brown: 10824234, burlywood: 14596231, cadetblue: 6266528, chartreuse: 8388352, chocolate: 13789470, coral: 16744272, cornflowerblue: 6591981, cornsilk: 16775388, crimson: 14423100, cyan: 65535, darkblue: 139, darkcyan: 35723, darkgoldenrod: 12092939, darkgray: 11119017, darkgreen: 25600, darkgrey: 11119017, darkkhaki: 12433259, darkmagenta: 9109643, darkolivegreen: 5597999, darkorange: 16747520, darkorchid: 10040012, darkred: 9109504, darksalmon: 15308410, darkseagreen: 9419919, darkslateblue: 4734347, darkslategray: 3100495, darkslategrey: 3100495, darkturquoise: 52945, darkviolet: 9699539, deeppink: 16716947, deepskyblue: 49151, dimgray: 6908265, dimgrey: 6908265, dodgerblue: 2003199, firebrick: 11674146, floralwhite: 16775920, forestgreen: 2263842, fuchsia: 16711935, gainsboro: 14474460, ghostwhite: 16316671, gold: 16766720, goldenrod: 14329120, gray: 8421504, green: 32768, greenyellow: 11403055, grey: 8421504, honeydew: 15794160, hotpink: 16738740, indianred: 13458524, indigo: 4915330, ivory: 16777200, khaki: 15787660, lavender: 15132410, lavenderblush: 16773365, lawngreen: 8190976, lemonchiffon: 16775885, lightblue: 11393254, lightcoral: 15761536, lightcyan: 14745599, lightgoldenrodyellow: 16448210, lightgray: 13882323, lightgreen: 9498256, lightgrey: 13882323, lightpink: 16758465, lightsalmon: 16752762, lightseagreen: 2142890, lightskyblue: 8900346, lightslategray: 7833753, lightslategrey: 7833753, lightsteelblue: 11584734, lightyellow: 16777184, lime: 65280, limegreen: 3329330, linen: 16445670, magenta: 16711935, maroon: 8388608, mediumaquamarine: 6737322, mediumblue: 205, mediumorchid: 12211667, mediumpurple: 9662683, mediumseagreen: 3978097, mediumslateblue: 8087790, mediumspringgreen: 64154, mediumturquoise: 4772300, mediumvioletred: 13047173, midnightblue: 1644912, mintcream: 16121850, mistyrose: 16770273, moccasin: 16770229, navajowhite: 16768685, navy: 128, oldlace: 16643558, olive: 8421376, olivedrab: 7048739, orange: 16753920, orangered: 16729344, orchid: 14315734, palegoldenrod: 15657130, palegreen: 10025880, paleturquoise: 11529966, palevioletred: 14381203, papayawhip: 16773077, peachpuff: 16767673, peru: 13468991, pink: 16761035, plum: 14524637, powderblue: 11591910, purple: 8388736, rebeccapurple: 6697881, red: 16711680, rosybrown: 12357519, royalblue: 4286945, saddlebrown: 9127187, salmon: 16416882, sandybrown: 16032864, seagreen: 3050327, seashell: 16774638, sienna: 10506797, silver: 12632256, skyblue: 8900331, slateblue: 6970061, slategray: 7372944, slategrey: 7372944, snow: 16775930, springgreen: 65407, steelblue: 4620980, tan: 13808780, teal: 32896, thistle: 14204888, tomato: 16737095, turquoise: 4251856, violet: 15631086, wheat: 16113331, white: 16777215, whitesmoke: 16119285, yellow: 16776960, yellowgreen: 10145074 };
var Se = { h: 0, s: 0, l: 0 };
var ks = { h: 0, s: 0, l: 0 };
function Sr(l, t, e) {
  return e < 0 && (e += 1), e > 1 && (e -= 1), e < 1 / 6 ? l + (t - l) * 6 * e : e < 1 / 2 ? t : e < 2 / 3 ? l + (t - l) * 6 * (2 / 3 - e) : l;
}
var U = class {
  constructor(t, e, i) {
    return this.isColor = true, this.r = 1, this.g = 1, this.b = 1, this.set(t, e, i);
  }
  set(t, e, i) {
    if (e === void 0 && i === void 0) {
      const s = t;
      s && s.isColor ? this.copy(s) : typeof s == "number" ? this.setHex(s) : typeof s == "string" && this.setStyle(s);
    } else this.setRGB(t, e, i);
    return this;
  }
  setScalar(t) {
    return this.r = t, this.g = t, this.b = t, this;
  }
  setHex(t, e = Et) {
    return t = Math.floor(t), this.r = (t >> 16 & 255) / 255, this.g = (t >> 8 & 255) / 255, this.b = (t & 255) / 255, It.colorSpaceToWorking(this, e), this;
  }
  setRGB(t, e, i, s = It.workingColorSpace) {
    return this.r = t, this.g = e, this.b = i, It.colorSpaceToWorking(this, s), this;
  }
  setHSL(t, e, i, s = It.workingColorSpace) {
    if (t = fr(t, 1), e = D(e, 0, 1), i = D(i, 0, 1), e === 0) this.r = this.g = this.b = i;
    else {
      const n = i <= 0.5 ? i * (1 + e) : i + e - i * e, r = 2 * i - n;
      this.r = Sr(r, n, t + 1 / 3), this.g = Sr(r, n, t), this.b = Sr(r, n, t - 1 / 3);
    }
    return It.colorSpaceToWorking(this, s), this;
  }
  setStyle(t, e = Et) {
    function i(n) {
      n !== void 0 && parseFloat(n) < 1 && V("Color: Alpha component of " + t + " will be ignored.");
    }
    let s;
    if (s = /^(\w+)\(([^\)]*)\)/.exec(t)) {
      let n;
      const r = s[1], a = s[2];
      switch (r) {
        case "rgb":
        case "rgba":
          if (n = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a)) return i(n[4]), this.setRGB(Math.min(255, parseInt(n[1], 10)) / 255, Math.min(255, parseInt(n[2], 10)) / 255, Math.min(255, parseInt(n[3], 10)) / 255, e);
          if (n = /^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a)) return i(n[4]), this.setRGB(Math.min(100, parseInt(n[1], 10)) / 100, Math.min(100, parseInt(n[2], 10)) / 100, Math.min(100, parseInt(n[3], 10)) / 100, e);
          break;
        case "hsl":
        case "hsla":
          if (n = /^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a)) return i(n[4]), this.setHSL(parseFloat(n[1]) / 360, parseFloat(n[2]) / 100, parseFloat(n[3]) / 100, e);
          break;
        default:
          V("Color: Unknown color model " + t);
      }
    } else if (s = /^\#([A-Fa-f\d]+)$/.exec(t)) {
      const n = s[1], r = n.length;
      if (r === 3) return this.setRGB(parseInt(n.charAt(0), 16) / 15, parseInt(n.charAt(1), 16) / 15, parseInt(n.charAt(2), 16) / 15, e);
      if (r === 6) return this.setHex(parseInt(n, 16), e);
      V("Color: Invalid hex color " + t);
    } else if (t && t.length > 0) return this.setColorName(t, e);
    return this;
  }
  setColorName(t, e = Et) {
    const i = dh[t.toLowerCase()];
    return i !== void 0 ? this.setHex(i, e) : V("Color: Unknown color " + t), this;
  }
  clone() {
    return new this.constructor(this.r, this.g, this.b);
  }
  copy(t) {
    return this.r = t.r, this.g = t.g, this.b = t.b, this;
  }
  copySRGBToLinear(t) {
    return this.r = le(t.r), this.g = le(t.g), this.b = le(t.b), this;
  }
  copyLinearToSRGB(t) {
    return this.r = ai(t.r), this.g = ai(t.g), this.b = ai(t.b), this;
  }
  convertSRGBToLinear() {
    return this.copySRGBToLinear(this), this;
  }
  convertLinearToSRGB() {
    return this.copyLinearToSRGB(this), this;
  }
  getHex(t = Et) {
    return It.workingToColorSpace(yt.copy(this), t), Math.round(D(yt.r * 255, 0, 255)) * 65536 + Math.round(D(yt.g * 255, 0, 255)) * 256 + Math.round(D(yt.b * 255, 0, 255));
  }
  getHexString(t = Et) {
    return ("000000" + this.getHex(t).toString(16)).slice(-6);
  }
  getHSL(t, e = It.workingColorSpace) {
    It.workingToColorSpace(yt.copy(this), e);
    const i = yt.r, s = yt.g, n = yt.b, r = Math.max(i, s, n), a = Math.min(i, s, n);
    let o, h;
    const c = (a + r) / 2;
    if (a === r) o = 0, h = 0;
    else {
      const u = r - a;
      switch (h = c <= 0.5 ? u / (r + a) : u / (2 - r - a), r) {
        case i:
          o = (s - n) / u + (s < n ? 6 : 0);
          break;
        case s:
          o = (n - i) / u + 2;
          break;
        case n:
          o = (i - s) / u + 4;
          break;
      }
      o /= 6;
    }
    return t.h = o, t.s = h, t.l = c, t;
  }
  getRGB(t, e = It.workingColorSpace) {
    return It.workingToColorSpace(yt.copy(this), e), t.r = yt.r, t.g = yt.g, t.b = yt.b, t;
  }
  getStyle(t = Et) {
    It.workingToColorSpace(yt.copy(this), t);
    const e = yt.r, i = yt.g, s = yt.b;
    return t !== Et ? `color(${t} ${e.toFixed(3)} ${i.toFixed(3)} ${s.toFixed(3)})` : `rgb(${Math.round(e * 255)},${Math.round(i * 255)},${Math.round(s * 255)})`;
  }
  offsetHSL(t, e, i) {
    return this.getHSL(Se), this.setHSL(Se.h + t, Se.s + e, Se.l + i);
  }
  add(t) {
    return this.r += t.r, this.g += t.g, this.b += t.b, this;
  }
  addColors(t, e) {
    return this.r = t.r + e.r, this.g = t.g + e.g, this.b = t.b + e.b, this;
  }
  addScalar(t) {
    return this.r += t, this.g += t, this.b += t, this;
  }
  sub(t) {
    return this.r = Math.max(0, this.r - t.r), this.g = Math.max(0, this.g - t.g), this.b = Math.max(0, this.b - t.b), this;
  }
  multiply(t) {
    return this.r *= t.r, this.g *= t.g, this.b *= t.b, this;
  }
  multiplyScalar(t) {
    return this.r *= t, this.g *= t, this.b *= t, this;
  }
  lerp(t, e) {
    return this.r += (t.r - this.r) * e, this.g += (t.g - this.g) * e, this.b += (t.b - this.b) * e, this;
  }
  lerpColors(t, e, i) {
    return this.r = t.r + (e.r - t.r) * i, this.g = t.g + (e.g - t.g) * i, this.b = t.b + (e.b - t.b) * i, this;
  }
  lerpHSL(t, e) {
    this.getHSL(Se), t.getHSL(ks);
    const i = Li(Se.h, ks.h, e), s = Li(Se.s, ks.s, e), n = Li(Se.l, ks.l, e);
    return this.setHSL(i, s, n), this;
  }
  setFromVector3(t) {
    return this.r = t.x, this.g = t.y, this.b = t.z, this;
  }
  applyMatrix3(t) {
    const e = this.r, i = this.g, s = this.b, n = t.elements;
    return this.r = n[0] * e + n[3] * i + n[6] * s, this.g = n[1] * e + n[4] * i + n[7] * s, this.b = n[2] * e + n[5] * i + n[8] * s, this;
  }
  equals(t) {
    return t.r === this.r && t.g === this.g && t.b === this.b;
  }
  fromArray(t, e = 0) {
    return this.r = t[e], this.g = t[e + 1], this.b = t[e + 2], this;
  }
  toArray(t = [], e = 0) {
    return t[e] = this.r, t[e + 1] = this.g, t[e + 2] = this.b, t;
  }
  fromBufferAttribute(t, e) {
    return this.r = t.getX(e), this.g = t.getY(e), this.b = t.getZ(e), this;
  }
  toJSON() {
    return this.getHex();
  }
  *[Symbol.iterator]() {
    yield this.r, yield this.g, yield this.b;
  }
};
var yt = new U();
U.NAMES = dh;
var ph = class extends Y {
  constructor() {
    super(), this.isScene = true, this.type = "Scene", this.background = null, this.environment = null, this.fog = null, this.backgroundBlurriness = 0, this.backgroundIntensity = 1, this.backgroundRotation = new te(), this.environmentIntensity = 1, this.environmentRotation = new te(), this.overrideMaterial = null, typeof __THREE_DEVTOOLS__ < "u" && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", { detail: this }));
  }
  copy(t, e) {
    return super.copy(t, e), t.background !== null && (this.background = t.background.clone()), t.environment !== null && (this.environment = t.environment.clone()), t.fog !== null && (this.fog = t.fog.clone()), this.backgroundBlurriness = t.backgroundBlurriness, this.backgroundIntensity = t.backgroundIntensity, this.backgroundRotation.copy(t.backgroundRotation), this.environmentIntensity = t.environmentIntensity, this.environmentRotation.copy(t.environmentRotation), t.overrideMaterial !== null && (this.overrideMaterial = t.overrideMaterial.clone()), this.matrixAutoUpdate = t.matrixAutoUpdate, this;
  }
  toJSON(t) {
    const e = super.toJSON(t);
    return this.fog !== null && (e.object.fog = this.fog.toJSON()), e.object.backgroundBlurriness = this.backgroundBlurriness, e.object.backgroundIntensity = this.backgroundIntensity, e.object.backgroundRotation = this.backgroundRotation.toArray(), e.object.environmentIntensity = this.environmentIntensity, e.object.environmentRotation = this.environmentRotation.toArray(), e;
  }
};
var Xt = new w();
var de = new w();
var Ar = new w();
var pe = new w();
var di = new w();
var pi = new w();
var fh = new w();
var Tr = new w();
var Cr = new w();
var Ir = new w();
var zr = new At();
var Br = new At();
var Fr = new At();
var kt = class _kt {
  constructor(t = new w(), e = new w(), i = new w()) {
    this.a = t, this.b = e, this.c = i;
  }
  static getNormal(t, e, i, s) {
    s.subVectors(i, e), Xt.subVectors(t, e), s.cross(Xt);
    const n = s.lengthSq();
    return n > 0 ? s.multiplyScalar(1 / Math.sqrt(n)) : s.set(0, 0, 0);
  }
  static getBarycoord(t, e, i, s, n) {
    Xt.subVectors(s, e), de.subVectors(i, e), Ar.subVectors(t, e);
    const r = Xt.dot(Xt), a = Xt.dot(de), o = Xt.dot(Ar), h = de.dot(de), c = de.dot(Ar), u = r * h - a * a;
    if (u === 0) return n.set(0, 0, 0), null;
    const d = 1 / u, p = (h * o - a * c) * d, f = (r * c - a * o) * d;
    return n.set(1 - p - f, f, p);
  }
  static containsPoint(t, e, i, s) {
    return this.getBarycoord(t, e, i, s, pe) === null ? false : pe.x >= 0 && pe.y >= 0 && pe.x + pe.y <= 1;
  }
  static getInterpolation(t, e, i, s, n, r, a, o) {
    return this.getBarycoord(t, e, i, s, pe) === null ? (o.x = 0, o.y = 0, "z" in o && (o.z = 0), "w" in o && (o.w = 0), null) : (o.setScalar(0), o.addScaledVector(n, pe.x), o.addScaledVector(r, pe.y), o.addScaledVector(a, pe.z), o);
  }
  static getInterpolatedAttribute(t, e, i, s, n, r) {
    return zr.setScalar(0), Br.setScalar(0), Fr.setScalar(0), zr.fromBufferAttribute(t, e), Br.fromBufferAttribute(t, i), Fr.fromBufferAttribute(t, s), r.setScalar(0), r.addScaledVector(zr, n.x), r.addScaledVector(Br, n.y), r.addScaledVector(Fr, n.z), r;
  }
  static isFrontFacing(t, e, i, s) {
    return Xt.subVectors(i, e), de.subVectors(t, e), Xt.cross(de).dot(s) < 0;
  }
  set(t, e, i) {
    return this.a.copy(t), this.b.copy(e), this.c.copy(i), this;
  }
  setFromPointsAndIndices(t, e, i, s) {
    return this.a.copy(t[e]), this.b.copy(t[i]), this.c.copy(t[s]), this;
  }
  setFromAttributeAndIndices(t, e, i, s) {
    return this.a.fromBufferAttribute(t, e), this.b.fromBufferAttribute(t, i), this.c.fromBufferAttribute(t, s), this;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(t) {
    return this.a.copy(t.a), this.b.copy(t.b), this.c.copy(t.c), this;
  }
  getArea() {
    return Xt.subVectors(this.c, this.b), de.subVectors(this.a, this.b), Xt.cross(de).length() * 0.5;
  }
  getMidpoint(t) {
    return t.addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3);
  }
  getNormal(t) {
    return _kt.getNormal(this.a, this.b, this.c, t);
  }
  getPlane(t) {
    return t.setFromCoplanarPoints(this.a, this.b, this.c);
  }
  getBarycoord(t, e) {
    return _kt.getBarycoord(t, this.a, this.b, this.c, e);
  }
  getInterpolation(t, e, i, s, n) {
    return _kt.getInterpolation(t, this.a, this.b, this.c, e, i, s, n);
  }
  containsPoint(t) {
    return _kt.containsPoint(t, this.a, this.b, this.c);
  }
  isFrontFacing(t) {
    return _kt.isFrontFacing(this.a, this.b, this.c, t);
  }
  intersectsBox(t) {
    return t.intersectsTriangle(this);
  }
  closestPointToPoint(t, e) {
    const i = this.a, s = this.b, n = this.c;
    let r, a;
    di.subVectors(s, i), pi.subVectors(n, i), Tr.subVectors(t, i);
    const o = di.dot(Tr), h = pi.dot(Tr);
    if (o <= 0 && h <= 0) return e.copy(i);
    Cr.subVectors(t, s);
    const c = di.dot(Cr), u = pi.dot(Cr);
    if (c >= 0 && u <= c) return e.copy(s);
    const d = o * u - c * h;
    if (d <= 0 && o >= 0 && c <= 0) return r = o / (o - c), e.copy(i).addScaledVector(di, r);
    Ir.subVectors(t, n);
    const p = di.dot(Ir), f = pi.dot(Ir);
    if (f >= 0 && p <= f) return e.copy(n);
    const m = p * h - o * f;
    if (m <= 0 && h >= 0 && f <= 0) return a = h / (h - f), e.copy(i).addScaledVector(pi, a);
    const y = c * f - p * u;
    if (y <= 0 && u - c >= 0 && p - f >= 0) return fh.subVectors(n, s), a = (u - c) / (u - c + (p - f)), e.copy(s).addScaledVector(fh, a);
    const g = 1 / (y + m + d);
    return r = m * g, a = d * g, e.copy(i).addScaledVector(di, r).addScaledVector(pi, a);
  }
  equals(t) {
    return t.a.equals(this.a) && t.b.equals(this.b) && t.c.equals(this.c);
  }
};
var gt = class {
  constructor(t = new w(1 / 0, 1 / 0, 1 / 0), e = new w(-1 / 0, -1 / 0, -1 / 0)) {
    this.isBox3 = true, this.min = t, this.max = e;
  }
  set(t, e) {
    return this.min.copy(t), this.max.copy(e), this;
  }
  setFromArray(t) {
    this.makeEmpty();
    for (let e = 0, i = t.length; e < i; e += 3) this.expandByPoint(Yt.fromArray(t, e));
    return this;
  }
  setFromBufferAttribute(t) {
    this.makeEmpty();
    for (let e = 0, i = t.count; e < i; e++) this.expandByPoint(Yt.fromBufferAttribute(t, e));
    return this;
  }
  setFromPoints(t) {
    this.makeEmpty();
    for (let e = 0, i = t.length; e < i; e++) this.expandByPoint(t[e]);
    return this;
  }
  setFromCenterAndSize(t, e) {
    const i = Yt.copy(e).multiplyScalar(0.5);
    return this.min.copy(t).sub(i), this.max.copy(t).add(i), this;
  }
  setFromObject(t, e = false) {
    return this.makeEmpty(), this.expandByObject(t, e);
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(t) {
    return this.min.copy(t.min), this.max.copy(t.max), this;
  }
  makeEmpty() {
    return this.min.x = this.min.y = this.min.z = 1 / 0, this.max.x = this.max.y = this.max.z = -1 / 0, this;
  }
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
  getCenter(t) {
    return this.isEmpty() ? t.set(0, 0, 0) : t.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
  getSize(t) {
    return this.isEmpty() ? t.set(0, 0, 0) : t.subVectors(this.max, this.min);
  }
  expandByPoint(t) {
    return this.min.min(t), this.max.max(t), this;
  }
  expandByVector(t) {
    return this.min.sub(t), this.max.add(t), this;
  }
  expandByScalar(t) {
    return this.min.addScalar(-t), this.max.addScalar(t), this;
  }
  expandByObject(t, e = false) {
    t.updateWorldMatrix(false, false);
    const i = t.geometry;
    if (i !== void 0) {
      const n = i.getAttribute("position");
      if (e === true && n !== void 0 && t.isInstancedMesh !== true) for (let r = 0, a = n.count; r < a; r++) t.isMesh === true ? t.getVertexPosition(r, Yt) : Yt.fromBufferAttribute(n, r), Yt.applyMatrix4(t.matrixWorld), this.expandByPoint(Yt);
      else t.boundingBox !== void 0 ? (t.boundingBox === null && t.computeBoundingBox(), Ps.copy(t.boundingBox)) : (i.boundingBox === null && i.computeBoundingBox(), Ps.copy(i.boundingBox)), Ps.applyMatrix4(t.matrixWorld), this.union(Ps);
    }
    const s = t.children;
    for (let n = 0, r = s.length; n < r; n++) this.expandByObject(s[n], e);
    return this;
  }
  containsPoint(t) {
    return t.x >= this.min.x && t.x <= this.max.x && t.y >= this.min.y && t.y <= this.max.y && t.z >= this.min.z && t.z <= this.max.z;
  }
  containsBox(t) {
    return this.min.x <= t.min.x && t.max.x <= this.max.x && this.min.y <= t.min.y && t.max.y <= this.max.y && this.min.z <= t.min.z && t.max.z <= this.max.z;
  }
  getParameter(t, e) {
    return e.set((t.x - this.min.x) / (this.max.x - this.min.x), (t.y - this.min.y) / (this.max.y - this.min.y), (t.z - this.min.z) / (this.max.z - this.min.z));
  }
  intersectsBox(t) {
    return t.max.x >= this.min.x && t.min.x <= this.max.x && t.max.y >= this.min.y && t.min.y <= this.max.y && t.max.z >= this.min.z && t.min.z <= this.max.z;
  }
  intersectsSphere(t) {
    return this.clampPoint(t.center, Yt), Yt.distanceToSquared(t.center) <= t.radius * t.radius;
  }
  intersectsPlane(t) {
    let e, i;
    return t.normal.x > 0 ? (e = t.normal.x * this.min.x, i = t.normal.x * this.max.x) : (e = t.normal.x * this.max.x, i = t.normal.x * this.min.x), t.normal.y > 0 ? (e += t.normal.y * this.min.y, i += t.normal.y * this.max.y) : (e += t.normal.y * this.max.y, i += t.normal.y * this.min.y), t.normal.z > 0 ? (e += t.normal.z * this.min.z, i += t.normal.z * this.max.z) : (e += t.normal.z * this.max.z, i += t.normal.z * this.min.z), e <= -t.constant && i >= -t.constant;
  }
  intersectsTriangle(t) {
    if (this.isEmpty()) return false;
    this.getCenter(Di), Rs.subVectors(this.max, Di), fi.subVectors(t.a, Di), mi.subVectors(t.b, Di), yi.subVectors(t.c, Di), Ae.subVectors(mi, fi), Te.subVectors(yi, mi), De.subVectors(fi, yi);
    let e = [0, -Ae.z, Ae.y, 0, -Te.z, Te.y, 0, -De.z, De.y, Ae.z, 0, -Ae.x, Te.z, 0, -Te.x, De.z, 0, -De.x, -Ae.y, Ae.x, 0, -Te.y, Te.x, 0, -De.y, De.x, 0];
    return !kr(e, fi, mi, yi, Rs) || (e = [1, 0, 0, 0, 1, 0, 0, 0, 1], !kr(e, fi, mi, yi, Rs)) ? false : (Os.crossVectors(Ae, Te), e = [Os.x, Os.y, Os.z], kr(e, fi, mi, yi, Rs));
  }
  clampPoint(t, e) {
    return e.copy(t).clamp(this.min, this.max);
  }
  distanceToPoint(t) {
    return this.clampPoint(t, Yt).distanceTo(t);
  }
  getBoundingSphere(t) {
    return this.isEmpty() ? t.makeEmpty() : (this.getCenter(t.center), t.radius = this.getSize(Yt).length() * 0.5), t;
  }
  intersect(t) {
    return this.min.max(t.min), this.max.min(t.max), this.isEmpty() && this.makeEmpty(), this;
  }
  union(t) {
    return this.min.min(t.min), this.max.max(t.max), this;
  }
  applyMatrix4(t) {
    return this.isEmpty() ? this : (fe[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(t), fe[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(t), fe[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(t), fe[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(t), fe[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(t), fe[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(t), fe[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(t), fe[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(t), this.setFromPoints(fe), this);
  }
  translate(t) {
    return this.min.add(t), this.max.add(t), this;
  }
  equals(t) {
    return t.min.equals(this.min) && t.max.equals(this.max);
  }
  toJSON() {
    return { min: this.min.toArray(), max: this.max.toArray() };
  }
  fromJSON(t) {
    return this.min.fromArray(t.min), this.max.fromArray(t.max), this;
  }
};
var fe = [new w(), new w(), new w(), new w(), new w(), new w(), new w(), new w()];
var Yt = new w();
var Ps = new gt();
var fi = new w();
var mi = new w();
var yi = new w();
var Ae = new w();
var Te = new w();
var De = new w();
var Di = new w();
var Rs = new w();
var Os = new w();
var Ue = new w();
function kr(l, t, e, i, s) {
  for (let n = 0, r = l.length - 3; n <= r; n += 3) {
    Ue.fromArray(l, n);
    const a = s.x * Math.abs(Ue.x) + s.y * Math.abs(Ue.y) + s.z * Math.abs(Ue.z), o = t.dot(Ue), h = e.dot(Ue), c = i.dot(Ue);
    if (Math.max(-Math.max(o, h, c), Math.min(o, h, c)) > a) return false;
  }
  return true;
}
var me = Zd();
function Zd() {
  const l = new ArrayBuffer(4), t = new Float32Array(l), e = new Uint32Array(l), i = new Uint32Array(512), s = new Uint32Array(512);
  for (let o = 0; o < 256; ++o) {
    const h = o - 127;
    h < -27 ? (i[o] = 0, i[o | 256] = 32768, s[o] = 24, s[o | 256] = 24) : h < -14 ? (i[o] = 1024 >> -h - 14, i[o | 256] = 1024 >> -h - 14 | 32768, s[o] = -h - 1, s[o | 256] = -h - 1) : h <= 15 ? (i[o] = h + 15 << 10, i[o | 256] = h + 15 << 10 | 32768, s[o] = 13, s[o | 256] = 13) : h < 128 ? (i[o] = 31744, i[o | 256] = 64512, s[o] = 24, s[o | 256] = 24) : (i[o] = 31744, i[o | 256] = 64512, s[o] = 13, s[o | 256] = 13);
  }
  const n = new Uint32Array(2048), r = new Uint32Array(64), a = new Uint32Array(64);
  for (let o = 1; o < 1024; ++o) {
    let h = o << 13, c = 0;
    for (; (h & 8388608) === 0; ) h <<= 1, c -= 8388608;
    h &= -8388609, c += 947912704, n[o] = h | c;
  }
  for (let o = 1024; o < 2048; ++o) n[o] = 939524096 + (o - 1024 << 13);
  for (let o = 1; o < 31; ++o) r[o] = o << 23;
  r[31] = 1199570944, r[32] = 2147483648;
  for (let o = 33; o < 63; ++o) r[o] = 2147483648 + (o - 32 << 23);
  r[63] = 3347054592;
  for (let o = 1; o < 64; ++o) o !== 32 && (a[o] = 1024);
  return { floatView: t, uint32View: e, baseTable: i, shiftTable: s, mantissaTable: n, exponentTable: r, offsetTable: a };
}
var lt = new w();
var Es = new I();
var Qd = 0;
var st = class extends se {
  constructor(t, e, i = false) {
    if (super(), Array.isArray(t)) throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");
    this.isBufferAttribute = true, Object.defineProperty(this, "id", { value: Qd++ }), this.name = "", this.array = t, this.itemSize = e, this.count = t !== void 0 ? t.length / e : 0, this.normalized = i, this.usage = zs, this.updateRanges = [], this.gpuType = Re, this.version = 0;
  }
  onUploadCallback() {
  }
  set needsUpdate(t) {
    t === true && this.version++;
  }
  setUsage(t) {
    return this.usage = t, this;
  }
  addUpdateRange(t, e) {
    this.updateRanges.push({ start: t, count: e });
  }
  clearUpdateRanges() {
    this.updateRanges.length = 0;
  }
  copy(t) {
    return this.name = t.name, this.array = new t.array.constructor(t.array), this.itemSize = t.itemSize, this.count = t.count, this.normalized = t.normalized, this.usage = t.usage, this.gpuType = t.gpuType, this;
  }
  copyAt(t, e, i) {
    t *= this.itemSize, i *= e.itemSize;
    for (let s = 0, n = this.itemSize; s < n; s++) this.array[t + s] = e.array[i + s];
    return this;
  }
  copyArray(t) {
    return this.array.set(t), this;
  }
  applyMatrix3(t) {
    if (this.itemSize === 2) for (let e = 0, i = this.count; e < i; e++) Es.fromBufferAttribute(this, e), Es.applyMatrix3(t), this.setXY(e, Es.x, Es.y);
    else if (this.itemSize === 3) for (let e = 0, i = this.count; e < i; e++) lt.fromBufferAttribute(this, e), lt.applyMatrix3(t), this.setXYZ(e, lt.x, lt.y, lt.z);
    return this;
  }
  applyMatrix4(t) {
    for (let e = 0, i = this.count; e < i; e++) lt.fromBufferAttribute(this, e), lt.applyMatrix4(t), this.setXYZ(e, lt.x, lt.y, lt.z);
    return this;
  }
  applyNormalMatrix(t) {
    for (let e = 0, i = this.count; e < i; e++) lt.fromBufferAttribute(this, e), lt.applyNormalMatrix(t), this.setXYZ(e, lt.x, lt.y, lt.z);
    return this;
  }
  transformDirection(t) {
    for (let e = 0, i = this.count; e < i; e++) lt.fromBufferAttribute(this, e), lt.transformDirection(t), this.setXYZ(e, lt.x, lt.y, lt.z);
    return this;
  }
  set(t, e = 0) {
    return this.array.set(t, e), this;
  }
  getComponent(t, e) {
    let i = this.array[t * this.itemSize + e];
    return this.normalized && (i = wt(i, this.array)), i;
  }
  setComponent(t, e, i) {
    return this.normalized && (i = W(i, this.array)), this.array[t * this.itemSize + e] = i, this;
  }
  getX(t) {
    let e = this.array[t * this.itemSize];
    return this.normalized && (e = wt(e, this.array)), e;
  }
  setX(t, e) {
    return this.normalized && (e = W(e, this.array)), this.array[t * this.itemSize] = e, this;
  }
  getY(t) {
    let e = this.array[t * this.itemSize + 1];
    return this.normalized && (e = wt(e, this.array)), e;
  }
  setY(t, e) {
    return this.normalized && (e = W(e, this.array)), this.array[t * this.itemSize + 1] = e, this;
  }
  getZ(t) {
    let e = this.array[t * this.itemSize + 2];
    return this.normalized && (e = wt(e, this.array)), e;
  }
  setZ(t, e) {
    return this.normalized && (e = W(e, this.array)), this.array[t * this.itemSize + 2] = e, this;
  }
  getW(t) {
    let e = this.array[t * this.itemSize + 3];
    return this.normalized && (e = wt(e, this.array)), e;
  }
  setW(t, e) {
    return this.normalized && (e = W(e, this.array)), this.array[t * this.itemSize + 3] = e, this;
  }
  setXY(t, e, i) {
    return t *= this.itemSize, this.normalized && (e = W(e, this.array), i = W(i, this.array)), this.array[t + 0] = e, this.array[t + 1] = i, this;
  }
  setXYZ(t, e, i, s) {
    return t *= this.itemSize, this.normalized && (e = W(e, this.array), i = W(i, this.array), s = W(s, this.array)), this.array[t + 0] = e, this.array[t + 1] = i, this.array[t + 2] = s, this;
  }
  setXYZW(t, e, i, s, n) {
    return t *= this.itemSize, this.normalized && (e = W(e, this.array), i = W(i, this.array), s = W(s, this.array), n = W(n, this.array)), this.array[t + 0] = e, this.array[t + 1] = i, this.array[t + 2] = s, this.array[t + 3] = n, this;
  }
  onUpload(t) {
    return this.onUploadCallback = t, this;
  }
  clone() {
    return new this.constructor(this.array, this.itemSize).copy(this);
  }
  toJSON() {
    const t = { itemSize: this.itemSize, type: this.array.constructor.name, array: Array.from(this.array), normalized: this.normalized };
    return t.name = this.name, t.usage = this.usage, t.gpuType = this.gpuType, t;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
};
var mh = class extends st {
  constructor(t, e, i) {
    super(new Uint16Array(t), e, i);
  }
};
var yh = class extends st {
  constructor(t, e, i) {
    super(new Uint32Array(t), e, i);
  }
};
var P = class extends st {
  constructor(t, e, i) {
    super(new Float32Array(t), e, i);
  }
};
var np = new gt();
var Wi = new w();
var Pr = new w();
var pt = class {
  constructor(t = new w(), e = -1) {
    this.isSphere = true, this.center = t, this.radius = e;
  }
  set(t, e) {
    return this.center.copy(t), this.radius = e, this;
  }
  setFromPoints(t, e) {
    const i = this.center;
    e !== void 0 ? i.copy(e) : np.setFromPoints(t).getCenter(i);
    let s = 0;
    for (let n = 0, r = t.length; n < r; n++) s = Math.max(s, i.distanceToSquared(t[n]));
    return this.radius = Math.sqrt(s), this;
  }
  copy(t) {
    return this.center.copy(t.center), this.radius = t.radius, this;
  }
  isEmpty() {
    return this.radius < 0;
  }
  makeEmpty() {
    return this.center.set(0, 0, 0), this.radius = -1, this;
  }
  containsPoint(t) {
    return t.distanceToSquared(this.center) <= this.radius * this.radius;
  }
  distanceToPoint(t) {
    return t.distanceTo(this.center) - this.radius;
  }
  intersectsSphere(t) {
    const e = this.radius + t.radius;
    return t.center.distanceToSquared(this.center) <= e * e;
  }
  intersectsBox(t) {
    return t.intersectsSphere(this);
  }
  intersectsPlane(t) {
    return Math.abs(t.distanceToPoint(this.center)) <= this.radius;
  }
  clampPoint(t, e) {
    const i = this.center.distanceToSquared(t);
    return e.copy(t), i > this.radius * this.radius && (e.sub(this.center).normalize(), e.multiplyScalar(this.radius).add(this.center)), e;
  }
  getBoundingBox(t) {
    return this.isEmpty() ? (t.makeEmpty(), t) : (t.set(this.center, this.center), t.expandByScalar(this.radius), t);
  }
  applyMatrix4(t) {
    return this.center.applyMatrix4(t), this.radius = this.radius * t.getMaxScaleOnAxis(), this;
  }
  translate(t) {
    return this.center.add(t), this;
  }
  expandByPoint(t) {
    if (this.isEmpty()) return this.center.copy(t), this.radius = 0, this;
    Wi.subVectors(t, this.center);
    const e = Wi.lengthSq();
    if (e > this.radius * this.radius) {
      const i = Math.sqrt(e), s = (i - this.radius) * 0.5;
      this.center.addScaledVector(Wi, s / i), this.radius += s;
    }
    return this;
  }
  union(t) {
    return t.isEmpty() ? this : this.isEmpty() ? (this.copy(t), this) : (this.center.equals(t.center) === true ? this.radius = Math.max(this.radius, t.radius) : (Pr.subVectors(t.center, this.center).setLength(t.radius), this.expandByPoint(Wi.copy(t.center).add(Pr)), this.expandByPoint(Wi.copy(t.center).sub(Pr))), this);
  }
  equals(t) {
    return t.center.equals(this.center) && t.radius === this.radius;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  toJSON() {
    return { radius: this.radius, center: this.center.toArray() };
  }
  fromJSON(t) {
    return this.radius = t.radius, this.center.fromArray(t.center), this;
  }
};
var rp = 0;
var Wt = new G();
var Rr = new Y();
var gi = new w();
var Vt = new gt();
var Gi = new gt();
var dt = new w();
var H = class _H extends se {
  constructor() {
    super(), this.isBufferGeometry = true, Object.defineProperty(this, "id", { value: rp++ }), this.uuid = Nt(), this.name = "", this.type = "BufferGeometry", this.index = null, this.indirect = null, this.indirectOffset = 0, this.attributes = {}, this.morphAttributes = {}, this.morphTargetsRelative = false, this.groups = [], this.boundingBox = null, this.boundingSphere = null, this.drawRange = { start: 0, count: 1 / 0 }, this.userData = {}, this._transformed = false;
  }
  getIndex() {
    return this.index;
  }
  setIndex(t) {
    return Array.isArray(t) ? this.index = new (cd(t) ? yh : mh)(t, 1) : this.index = t, this;
  }
  setIndirect(t, e = 0) {
    return this.indirect = t, this.indirectOffset = e, this;
  }
  getIndirect() {
    return this.indirect;
  }
  getAttribute(t) {
    return this.attributes[t];
  }
  setAttribute(t, e) {
    return this.attributes[t] = e, this;
  }
  deleteAttribute(t) {
    return delete this.attributes[t], this;
  }
  hasAttribute(t) {
    return this.attributes[t] !== void 0;
  }
  addGroup(t, e, i = 0) {
    this.groups.push({ start: t, count: e, materialIndex: i });
  }
  clearGroups() {
    this.groups = [];
  }
  setDrawRange(t, e) {
    this.drawRange.start = t, this.drawRange.count = e;
  }
  applyMatrix4(t) {
    const e = this.attributes.position;
    e !== void 0 && (e.applyMatrix4(t), e.needsUpdate = true);
    const i = this.attributes.normal;
    if (i !== void 0) {
      const n = new Kt().getNormalMatrix(t);
      i.applyNormalMatrix(n), i.needsUpdate = true;
    }
    const s = this.attributes.tangent;
    return s !== void 0 && (s.transformDirection(t), s.needsUpdate = true), this.boundingBox !== null && this.computeBoundingBox(), this.boundingSphere !== null && this.computeBoundingSphere(), this._transformed = true, this;
  }
  applyQuaternion(t) {
    return Wt.makeRotationFromQuaternion(t), this.applyMatrix4(Wt), this;
  }
  rotateX(t) {
    return Wt.makeRotationX(t), this.applyMatrix4(Wt), this;
  }
  rotateY(t) {
    return Wt.makeRotationY(t), this.applyMatrix4(Wt), this;
  }
  rotateZ(t) {
    return Wt.makeRotationZ(t), this.applyMatrix4(Wt), this;
  }
  translate(t, e, i) {
    return Wt.makeTranslation(t, e, i), this.applyMatrix4(Wt), this;
  }
  scale(t, e, i) {
    return Wt.makeScale(t, e, i), this.applyMatrix4(Wt), this;
  }
  lookAt(t) {
    return Rr.lookAt(t), Rr.updateMatrix(), this.applyMatrix4(Rr.matrix), this;
  }
  center() {
    return this.computeBoundingBox(), this.boundingBox.getCenter(gi).negate(), this.translate(gi.x, gi.y, gi.z), this;
  }
  setFromPoints(t) {
    const e = this.getAttribute("position");
    if (e === void 0) {
      const i = [];
      for (let s = 0, n = t.length; s < n; s++) {
        const r = t[s];
        i.push(r.x, r.y, r.z || 0);
      }
      this.setAttribute("position", new P(i, 3));
    } else {
      const i = Math.min(t.length, e.count);
      for (let s = 0; s < i; s++) {
        const n = t[s];
        e.setXYZ(s, n.x, n.y, n.z || 0);
      }
      t.length > e.count && V("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."), e.needsUpdate = true;
    }
    return this;
  }
  computeBoundingBox() {
    this.boundingBox === null && (this.boundingBox = new gt());
    const t = this.attributes.position, e = this.morphAttributes.position;
    if (t && t.isGLBufferAttribute) {
      X("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.", this), this.boundingBox.set(new w(-1 / 0, -1 / 0, -1 / 0), new w(1 / 0, 1 / 0, 1 / 0));
      return;
    }
    if (t !== void 0) {
      if (this.boundingBox.setFromBufferAttribute(t), e) for (let i = 0, s = e.length; i < s; i++) {
        const n = e[i];
        Vt.setFromBufferAttribute(n), this.morphTargetsRelative ? (dt.addVectors(this.boundingBox.min, Vt.min), this.boundingBox.expandByPoint(dt), dt.addVectors(this.boundingBox.max, Vt.max), this.boundingBox.expandByPoint(dt)) : (this.boundingBox.expandByPoint(Vt.min), this.boundingBox.expandByPoint(Vt.max));
      }
    } else this.boundingBox.makeEmpty();
    (isNaN(this.boundingBox.min.x) || isNaN(this.boundingBox.min.y) || isNaN(this.boundingBox.min.z)) && X('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.', this);
  }
  computeBoundingSphere() {
    this.boundingSphere === null && (this.boundingSphere = new pt());
    const t = this.attributes.position, e = this.morphAttributes.position;
    if (t && t.isGLBufferAttribute) {
      X("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.", this), this.boundingSphere.set(new w(), 1 / 0);
      return;
    }
    if (t) {
      const i = this.boundingSphere.center;
      if (Vt.setFromBufferAttribute(t), e) for (let n = 0, r = e.length; n < r; n++) {
        const a = e[n];
        Gi.setFromBufferAttribute(a), this.morphTargetsRelative ? (dt.addVectors(Vt.min, Gi.min), Vt.expandByPoint(dt), dt.addVectors(Vt.max, Gi.max), Vt.expandByPoint(dt)) : (Vt.expandByPoint(Gi.min), Vt.expandByPoint(Gi.max));
      }
      Vt.getCenter(i);
      let s = 0;
      for (let n = 0, r = t.count; n < r; n++) dt.fromBufferAttribute(t, n), s = Math.max(s, i.distanceToSquared(dt));
      if (e) for (let n = 0, r = e.length; n < r; n++) {
        const a = e[n], o = this.morphTargetsRelative;
        for (let h = 0, c = a.count; h < c; h++) dt.fromBufferAttribute(a, h), o && (gi.fromBufferAttribute(t, h), dt.add(gi)), s = Math.max(s, i.distanceToSquared(dt));
      }
      this.boundingSphere.radius = Math.sqrt(s), isNaN(this.boundingSphere.radius) && X('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', this);
    }
  }
  computeTangents() {
    const t = this.index, e = this.attributes;
    if (t === null || e.position === void 0 || e.normal === void 0 || e.uv === void 0) {
      X("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");
      return;
    }
    const i = e.position, s = e.normal, n = e.uv;
    let r = this.getAttribute("tangent");
    (r === void 0 || r.count !== i.count) && (r = new st(new Float32Array(4 * i.count), 4), this.setAttribute("tangent", r));
    const a = [], o = [];
    for (let S = 0; S < i.count; S++) a[S] = new w(), o[S] = new w();
    const h = new w(), c = new w(), u = new w(), d = new I(), p = new I(), f = new I(), m = new w(), y = new w();
    function g(S, T, C) {
      h.fromBufferAttribute(i, S), c.fromBufferAttribute(i, T), u.fromBufferAttribute(i, C), d.fromBufferAttribute(n, S), p.fromBufferAttribute(n, T), f.fromBufferAttribute(n, C), c.sub(h), u.sub(h), p.sub(d), f.sub(d);
      const B = 1 / (p.x * f.y - f.x * p.y);
      isFinite(B) && (m.copy(c).multiplyScalar(f.y).addScaledVector(u, -p.y).multiplyScalar(B), y.copy(u).multiplyScalar(p.x).addScaledVector(c, -f.x).multiplyScalar(B), a[S].add(m), a[T].add(m), a[C].add(m), o[S].add(y), o[T].add(y), o[C].add(y));
    }
    let x = this.groups;
    x.length === 0 && (x = [{ start: 0, count: t.count }]);
    for (let S = 0, T = x.length; S < T; ++S) {
      const C = x[S], B = C.start, R = C.count;
      for (let L = B, J = B + R; L < J; L += 3) g(t.getX(L + 0), t.getX(L + 1), t.getX(L + 2));
    }
    const b = new w(), M = new w(), _ = new w(), v = new w();
    function A(S) {
      _.fromBufferAttribute(s, S), v.copy(_);
      const T = a[S];
      b.copy(T), b.sub(_.multiplyScalar(_.dot(T))).normalize(), M.crossVectors(v, T);
      const B = M.dot(o[S]) < 0 ? -1 : 1;
      r.setXYZW(S, b.x, b.y, b.z, B);
    }
    for (let S = 0, T = x.length; S < T; ++S) {
      const C = x[S], B = C.start, R = C.count;
      for (let L = B, J = B + R; L < J; L += 3) A(t.getX(L + 0)), A(t.getX(L + 1)), A(t.getX(L + 2));
    }
    this._transformed = true;
  }
  computeVertexNormals() {
    const t = this.index, e = this.getAttribute("position");
    if (e !== void 0) {
      let i = this.getAttribute("normal");
      if (i === void 0 || i.count !== e.count) i = new st(new Float32Array(e.count * 3), 3), this.setAttribute("normal", i);
      else for (let d = 0, p = i.count; d < p; d++) i.setXYZ(d, 0, 0, 0);
      const s = new w(), n = new w(), r = new w(), a = new w(), o = new w(), h = new w(), c = new w(), u = new w();
      if (t) for (let d = 0, p = t.count; d < p; d += 3) {
        const f = t.getX(d + 0), m = t.getX(d + 1), y = t.getX(d + 2);
        s.fromBufferAttribute(e, f), n.fromBufferAttribute(e, m), r.fromBufferAttribute(e, y), c.subVectors(r, n), u.subVectors(s, n), c.cross(u), a.fromBufferAttribute(i, f), o.fromBufferAttribute(i, m), h.fromBufferAttribute(i, y), a.add(c), o.add(c), h.add(c), i.setXYZ(f, a.x, a.y, a.z), i.setXYZ(m, o.x, o.y, o.z), i.setXYZ(y, h.x, h.y, h.z);
      }
      else for (let d = 0, p = e.count; d < p; d += 3) s.fromBufferAttribute(e, d + 0), n.fromBufferAttribute(e, d + 1), r.fromBufferAttribute(e, d + 2), c.subVectors(r, n), u.subVectors(s, n), c.cross(u), i.setXYZ(d + 0, c.x, c.y, c.z), i.setXYZ(d + 1, c.x, c.y, c.z), i.setXYZ(d + 2, c.x, c.y, c.z);
      this.normalizeNormals(), i.needsUpdate = true;
    }
  }
  normalizeNormals() {
    const t = this.attributes.normal;
    for (let e = 0, i = t.count; e < i; e++) dt.fromBufferAttribute(t, e), dt.normalize(), t.setXYZ(e, dt.x, dt.y, dt.z);
  }
  toNonIndexed() {
    function t(a, o) {
      const h = a.array, c = a.itemSize, u = a.normalized, d = new h.constructor(o.length * c);
      let p = 0, f = 0;
      for (let m = 0, y = o.length; m < y; m++) {
        a.isInterleavedBufferAttribute ? p = o[m] * a.data.stride + a.offset : p = o[m] * c;
        for (let g = 0; g < c; g++) d[f++] = h[p++];
      }
      return new st(d, c, u);
    }
    if (this.index === null) return V("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."), this;
    const e = new _H(), i = this.index.array, s = this.attributes;
    for (const a in s) {
      const o = s[a], h = t(o, i);
      e.setAttribute(a, h);
    }
    const n = this.morphAttributes;
    for (const a in n) {
      const o = [], h = n[a];
      for (let c = 0, u = h.length; c < u; c++) {
        const d = h[c], p = t(d, i);
        o.push(p);
      }
      e.morphAttributes[a] = o;
    }
    e.morphTargetsRelative = this.morphTargetsRelative;
    const r = this.groups;
    for (let a = 0, o = r.length; a < o; a++) {
      const h = r[a];
      e.addGroup(h.start, h.count, h.materialIndex);
    }
    return e;
  }
  toJSON() {
    const t = { metadata: { version: 4.7, type: "BufferGeometry", generator: "BufferGeometry.toJSON" } };
    if (t.uuid = this.uuid, t.type = this.parameters !== void 0 && this._transformed === true ? "BufferGeometry" : this.type, t.name = this.name, Object.keys(this.userData).length > 0 && (t.userData = this.userData), this.parameters !== void 0 && this._transformed !== true) {
      const o = this.parameters;
      for (const h in o) o[h] !== void 0 && (t[h] = o[h]);
      return t;
    }
    t.data = { attributes: {} };
    const e = this.index;
    e !== null && (t.data.index = { type: e.array.constructor.name, array: Array.prototype.slice.call(e.array) });
    const i = this.attributes;
    for (const o in i) {
      const h = i[o];
      t.data.attributes[o] = h.toJSON(t.data);
    }
    const s = {};
    let n = false;
    for (const o in this.morphAttributes) {
      const h = this.morphAttributes[o], c = [];
      for (let u = 0, d = h.length; u < d; u++) {
        const p = h[u];
        c.push(p.toJSON(t.data));
      }
      c.length > 0 && (s[o] = c, n = true);
    }
    n && (t.data.morphAttributes = s, t.data.morphTargetsRelative = this.morphTargetsRelative);
    const r = this.groups;
    r.length > 0 && (t.data.groups = JSON.parse(JSON.stringify(r)));
    const a = this.boundingSphere;
    return a !== null && (t.data.boundingSphere = a.toJSON()), t;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(t) {
    this.index = null, this.attributes = {}, this.morphAttributes = {}, this.groups = [], this.boundingBox = null, this.boundingSphere = null;
    const e = {};
    this.name = t.name;
    const i = t.index;
    i !== null && this.setIndex(i.clone());
    const s = t.attributes;
    for (const h in s) {
      const c = s[h];
      this.setAttribute(h, c.clone(e));
    }
    const n = t.morphAttributes;
    for (const h in n) {
      const c = [], u = n[h];
      for (let d = 0, p = u.length; d < p; d++) c.push(u[d].clone(e));
      this.morphAttributes[h] = c;
    }
    this.morphTargetsRelative = t.morphTargetsRelative;
    const r = t.groups;
    for (let h = 0, c = r.length; h < c; h++) {
      const u = r[h];
      this.addGroup(u.start, u.count, u.materialIndex);
    }
    const a = t.boundingBox;
    a !== null && (this.boundingBox = a.clone());
    const o = t.boundingSphere;
    return o !== null && (this.boundingSphere = o.clone()), this.drawRange.start = t.drawRange.start, this.drawRange.count = t.drawRange.count, this.userData = t.userData, this._transformed = t._transformed, this;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
};
var vt = new w();
var Or = new w();
var ap = new w();
var op = new Kt();
var Ce = class {
  constructor(t = new w(1, 0, 0), e = 0) {
    this.isPlane = true, this.normal = t, this.constant = e;
  }
  set(t, e) {
    return this.normal.copy(t), this.constant = e, this;
  }
  setComponents(t, e, i, s) {
    return this.normal.set(t, e, i), this.constant = s, this;
  }
  setFromNormalAndCoplanarPoint(t, e) {
    return this.normal.copy(t), this.constant = -e.dot(this.normal), this;
  }
  setFromCoplanarPoints(t, e, i) {
    const s = Or.subVectors(i, e).cross(ap.subVectors(t, e)).normalize();
    return this.setFromNormalAndCoplanarPoint(s, t), this;
  }
  copy(t) {
    return this.normal.copy(t.normal), this.constant = t.constant, this;
  }
  normalize() {
    const t = 1 / this.normal.length();
    return this.normal.multiplyScalar(t), this.constant *= t, this;
  }
  negate() {
    return this.constant *= -1, this.normal.negate(), this;
  }
  distanceToPoint(t) {
    return this.normal.dot(t) + this.constant;
  }
  distanceToSphere(t) {
    return this.distanceToPoint(t.center) - t.radius;
  }
  projectPoint(t, e) {
    return e.copy(t).addScaledVector(this.normal, -this.distanceToPoint(t));
  }
  intersectLine(t, e, i = true) {
    const s = t.delta(Or), n = this.normal.dot(s);
    if (n === 0) return this.distanceToPoint(t.start) === 0 ? e.copy(t.start) : null;
    const r = -(t.start.dot(this.normal) + this.constant) / n;
    return i === true && (r < 0 || r > 1) ? null : e.copy(t.start).addScaledVector(s, r);
  }
  intersectsLine(t) {
    const e = this.distanceToPoint(t.start), i = this.distanceToPoint(t.end);
    return e < 0 && i > 0 || i < 0 && e > 0;
  }
  intersectsBox(t) {
    return t.intersectsPlane(this);
  }
  intersectsSphere(t) {
    return t.intersectsPlane(this);
  }
  coplanarPoint(t) {
    return t.copy(this.normal).multiplyScalar(-this.constant);
  }
  applyMatrix4(t, e) {
    const i = e || op.getNormalMatrix(t), s = this.coplanarPoint(Or).applyMatrix4(t), n = this.normal.applyMatrix3(i).normalize();
    return this.constant = -s.dot(n), this;
  }
  translate(t) {
    return this.constant -= t.dot(this.normal), this;
  }
  equals(t) {
    return t.normal.equals(this.normal) && t.constant === this.constant;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  toJSON() {
    return { normal: this.normal.toArray(), constant: this.constant };
  }
  fromJSON(t) {
    return this.normal.fromArray(t.normal), this.constant = t.constant, this;
  }
};
var hp = 0;
var ft = class extends se {
  constructor() {
    super(), this.isMaterial = true, Object.defineProperty(this, "id", { value: hp++ }), this.uuid = Nt(), this.name = "", this.type = "Material", this.blending = Ea, this.side = $n, this.vertexColors = false, this.opacity = 1, this.transparent = false, this.alphaHash = false, this.blendSrc = La, this.blendDst = Va, this.blendEquation = Na, this.blendSrcAlpha = null, this.blendDstAlpha = null, this.blendEquationAlpha = null, this.blendColor = new U(0, 0, 0), this.blendAlpha = 0, this.depthFunc = ys, this.depthTest = true, this.depthWrite = true, this.stencilWriteMask = 255, this.stencilFunc = $o, this.stencilRef = 0, this.stencilFuncMask = 255, this.stencilFail = Is, this.stencilZFail = Is, this.stencilZPass = Is, this.stencilWrite = false, this.clippingPlanes = null, this.clipIntersection = false, this.clipShadows = false, this.shadowSide = null, this.colorWrite = true, this.precision = null, this.polygonOffset = false, this.polygonOffsetFactor = 0, this.polygonOffsetUnits = 0, this.dithering = false, this.alphaToCoverage = false, this.premultipliedAlpha = false, this.forceSinglePass = false, this.allowOverride = true, this.visible = true, this.toneMapped = true, this.userData = {}, this.version = 0, this._alphaTest = 0;
  }
  get alphaTest() {
    return this._alphaTest;
  }
  set alphaTest(t) {
    this._alphaTest > 0 != t > 0 && this.version++, this._alphaTest = t;
  }
  onBeforeRender() {
  }
  onBeforeCompile() {
  }
  customProgramCacheKey() {
    return this.onBeforeCompile.toString();
  }
  setValues(t) {
    if (t !== void 0) for (const e in t) {
      const i = t[e];
      if (i === void 0) {
        V(`Material: parameter '${e}' has value of undefined.`);
        continue;
      }
      const s = this[e];
      if (s === void 0) {
        V(`Material: '${e}' is not a property of THREE.${this.type}.`);
        continue;
      }
      s && s.isColor ? s.set(i) : s && s.isVector2 && i && i.isVector2 || s && s.isEuler && i && i.isEuler || s && s.isVector3 && i && i.isVector3 ? s.copy(i) : this[e] = i;
    }
  }
  toJSON(t) {
    const e = t === void 0 || typeof t == "string";
    e && (t = { textures: {}, images: {} });
    const i = { metadata: { version: 4.7, type: "Material", generator: "Material.toJSON" } };
    i.uuid = this.uuid, i.type = this.type, i.blending = this.blending, i.side = this.side, i.shadowSide = this.shadowSide, i.vertexColors = this.vertexColors, i.opacity = this.opacity, i.transparent = this.transparent, i.blendSrc = this.blendSrc, i.blendDst = this.blendDst, i.blendEquation = this.blendEquation, i.blendSrcAlpha = this.blendSrcAlpha, i.blendDstAlpha = this.blendDstAlpha, i.blendEquationAlpha = this.blendEquationAlpha, i.blendColor = this.blendColor.getHex(), i.blendAlpha = this.blendAlpha, i.depthFunc = this.depthFunc, i.depthTest = this.depthTest, i.depthWrite = this.depthWrite, i.colorWrite = this.colorWrite, i.clipIntersection = this.clipIntersection, i.clipShadows = this.clipShadows, i.stencilWriteMask = this.stencilWriteMask, i.stencilFunc = this.stencilFunc, i.stencilRef = this.stencilRef, i.stencilFuncMask = this.stencilFuncMask, i.stencilFail = this.stencilFail, i.stencilZFail = this.stencilZFail, i.stencilZPass = this.stencilZPass, i.stencilWrite = this.stencilWrite, i.polygonOffset = this.polygonOffset, i.polygonOffsetFactor = this.polygonOffsetFactor, i.polygonOffsetUnits = this.polygonOffsetUnits, i.dithering = this.dithering, i.alphaTest = this.alphaTest, i.alphaHash = this.alphaHash, i.alphaToCoverage = this.alphaToCoverage, i.premultipliedAlpha = this.premultipliedAlpha, i.forceSinglePass = this.forceSinglePass, i.allowOverride = this.allowOverride, i.visible = this.visible, i.toneMapped = this.toneMapped, i.name = this.name, this.color && this.color.isColor && (i.color = this.color.getHex()), this.roughness !== void 0 && (i.roughness = this.roughness), this.metalness !== void 0 && (i.metalness = this.metalness), this.sheen !== void 0 && (i.sheen = this.sheen), this.sheenColor && this.sheenColor.isColor && (i.sheenColor = this.sheenColor.getHex()), this.sheenRoughness !== void 0 && (i.sheenRoughness = this.sheenRoughness), this.emissive && this.emissive.isColor && (i.emissive = this.emissive.getHex()), this.emissiveIntensity !== void 0 && (i.emissiveIntensity = this.emissiveIntensity), this.specular && this.specular.isColor && (i.specular = this.specular.getHex()), this.specularIntensity !== void 0 && (i.specularIntensity = this.specularIntensity), this.specularColor && this.specularColor.isColor && (i.specularColor = this.specularColor.getHex()), this.shininess !== void 0 && (i.shininess = this.shininess), this.clearcoat !== void 0 && (i.clearcoat = this.clearcoat), this.clearcoatRoughness !== void 0 && (i.clearcoatRoughness = this.clearcoatRoughness), this.clearcoatMap && this.clearcoatMap.isTexture && (i.clearcoatMap = this.clearcoatMap.toJSON(t).uuid), this.clearcoatRoughnessMap && this.clearcoatRoughnessMap.isTexture && (i.clearcoatRoughnessMap = this.clearcoatRoughnessMap.toJSON(t).uuid), this.clearcoatNormalMap && this.clearcoatNormalMap.isTexture && (i.clearcoatNormalMap = this.clearcoatNormalMap.toJSON(t).uuid, i.clearcoatNormalScale = this.clearcoatNormalScale.toArray()), this.sheenColorMap && this.sheenColorMap.isTexture && (i.sheenColorMap = this.sheenColorMap.toJSON(t).uuid), this.sheenRoughnessMap && this.sheenRoughnessMap.isTexture && (i.sheenRoughnessMap = this.sheenRoughnessMap.toJSON(t).uuid), this.dispersion !== void 0 && (i.dispersion = this.dispersion), this.retroreflectivity !== void 0 && (i.retroreflectivity = this.retroreflectivity), this.iridescence !== void 0 && (i.iridescence = this.iridescence), this.iridescenceIOR !== void 0 && (i.iridescenceIOR = this.iridescenceIOR), this.iridescenceThicknessRange !== void 0 && (i.iridescenceThicknessRange = this.iridescenceThicknessRange), this.iridescenceMap && this.iridescenceMap.isTexture && (i.iridescenceMap = this.iridescenceMap.toJSON(t).uuid), this.iridescenceThicknessMap && this.iridescenceThicknessMap.isTexture && (i.iridescenceThicknessMap = this.iridescenceThicknessMap.toJSON(t).uuid), this.anisotropy !== void 0 && (i.anisotropy = this.anisotropy), this.anisotropyRotation !== void 0 && (i.anisotropyRotation = this.anisotropyRotation), this.anisotropyMap && this.anisotropyMap.isTexture && (i.anisotropyMap = this.anisotropyMap.toJSON(t).uuid), this.map && this.map.isTexture && (i.map = this.map.toJSON(t).uuid), this.matcap && this.matcap.isTexture && (i.matcap = this.matcap.toJSON(t).uuid), this.alphaMap && this.alphaMap.isTexture && (i.alphaMap = this.alphaMap.toJSON(t).uuid), this.lightMap && this.lightMap.isTexture && (i.lightMap = this.lightMap.toJSON(t).uuid, i.lightMapIntensity = this.lightMapIntensity), this.aoMap && this.aoMap.isTexture && (i.aoMap = this.aoMap.toJSON(t).uuid, i.aoMapIntensity = this.aoMapIntensity), this.bumpMap && this.bumpMap.isTexture && (i.bumpMap = this.bumpMap.toJSON(t).uuid, i.bumpScale = this.bumpScale), this.normalMap && this.normalMap.isTexture && (i.normalMap = this.normalMap.toJSON(t).uuid, i.normalMapType = this.normalMapType, i.normalScale = this.normalScale.toArray()), this.displacementMap && this.displacementMap.isTexture && (i.displacementMap = this.displacementMap.toJSON(t).uuid, i.displacementScale = this.displacementScale, i.displacementBias = this.displacementBias), this.roughnessMap && this.roughnessMap.isTexture && (i.roughnessMap = this.roughnessMap.toJSON(t).uuid), this.metalnessMap && this.metalnessMap.isTexture && (i.metalnessMap = this.metalnessMap.toJSON(t).uuid), this.emissiveMap && this.emissiveMap.isTexture && (i.emissiveMap = this.emissiveMap.toJSON(t).uuid), this.specularMap && this.specularMap.isTexture && (i.specularMap = this.specularMap.toJSON(t).uuid), this.specularIntensityMap && this.specularIntensityMap.isTexture && (i.specularIntensityMap = this.specularIntensityMap.toJSON(t).uuid), this.specularColorMap && this.specularColorMap.isTexture && (i.specularColorMap = this.specularColorMap.toJSON(t).uuid), this.envMap && this.envMap.isTexture && (i.envMap = this.envMap.toJSON(t).uuid, this.combine !== void 0 && (i.combine = this.combine)), this.envMapRotation !== void 0 && (i.envMapRotation = this.envMapRotation.toArray()), this.envMapIntensity !== void 0 && (i.envMapIntensity = this.envMapIntensity), this.reflectivity !== void 0 && (i.reflectivity = this.reflectivity), this.refractionRatio !== void 0 && (i.refractionRatio = this.refractionRatio), this.gradientMap && this.gradientMap.isTexture && (i.gradientMap = this.gradientMap.toJSON(t).uuid), this.transmission !== void 0 && (i.transmission = this.transmission), this.transmissionMap && this.transmissionMap.isTexture && (i.transmissionMap = this.transmissionMap.toJSON(t).uuid), this.thickness !== void 0 && (i.thickness = this.thickness), this.thicknessMap && this.thicknessMap.isTexture && (i.thicknessMap = this.thicknessMap.toJSON(t).uuid), this.attenuationDistance !== void 0 && (i.attenuationDistance = this.attenuationDistance), this.attenuationColor !== void 0 && (i.attenuationColor = this.attenuationColor.getHex()), this.size !== void 0 && (i.size = this.size), this.sizeAttenuation !== void 0 && (i.sizeAttenuation = this.sizeAttenuation), Array.isArray(this.clippingPlanes) && this.clippingPlanes.length > 0 && (i.clippingPlanes = this.clippingPlanes.map((n) => n.toJSON())), this.rotation !== void 0 && (i.rotation = this.rotation), this.depthPacking !== void 0 && (i.depthPacking = this.depthPacking), this.linewidth !== void 0 && (i.linewidth = this.linewidth), this.linecap !== void 0 && (i.linecap = this.linecap), this.linejoin !== void 0 && (i.linejoin = this.linejoin), this.dashSize !== void 0 && (i.dashSize = this.dashSize), this.gapSize !== void 0 && (i.gapSize = this.gapSize), this.scale !== void 0 && (i.scale = this.scale), this.wireframe !== void 0 && (i.wireframe = this.wireframe), this.wireframeLinewidth !== void 0 && (i.wireframeLinewidth = this.wireframeLinewidth), this.wireframeLinecap !== void 0 && (i.wireframeLinecap = this.wireframeLinecap), this.wireframeLinejoin !== void 0 && (i.wireframeLinejoin = this.wireframeLinejoin), this.flatShading !== void 0 && (i.flatShading = this.flatShading), this.fog !== void 0 && (i.fog = this.fog), Object.keys(this.userData).length > 0 && (i.userData = this.userData);
    function s(n) {
      const r = [];
      for (const a in n) {
        const o = n[a];
        delete o.metadata, r.push(o);
      }
      return r;
    }
    if (e) {
      const n = s(t.textures), r = s(t.images);
      n.length > 0 && (i.textures = n), r.length > 0 && (i.images = r);
    }
    return i;
  }
  fromJSON(t, e) {
    if (t.uuid !== void 0 && (this.uuid = t.uuid), t.name !== void 0 && (this.name = t.name), t.color !== void 0 && this.color !== void 0 && this.color.setHex(t.color), t.roughness !== void 0 && (this.roughness = t.roughness), t.metalness !== void 0 && (this.metalness = t.metalness), t.sheen !== void 0 && (this.sheen = t.sheen), t.sheenColor !== void 0 && (this.sheenColor = new U().setHex(t.sheenColor)), t.sheenRoughness !== void 0 && (this.sheenRoughness = t.sheenRoughness), t.emissive !== void 0 && this.emissive !== void 0 && this.emissive.setHex(t.emissive), t.specular !== void 0 && this.specular !== void 0 && this.specular.setHex(t.specular), t.specularIntensity !== void 0 && (this.specularIntensity = t.specularIntensity), t.specularColor !== void 0 && this.specularColor !== void 0 && this.specularColor.setHex(t.specularColor), t.shininess !== void 0 && (this.shininess = t.shininess), t.clearcoat !== void 0 && (this.clearcoat = t.clearcoat), t.clearcoatRoughness !== void 0 && (this.clearcoatRoughness = t.clearcoatRoughness), t.dispersion !== void 0 && (this.dispersion = t.dispersion), t.retroreflectivity !== void 0 && (this.retroreflectivity = t.retroreflectivity), t.iridescence !== void 0 && (this.iridescence = t.iridescence), t.iridescenceIOR !== void 0 && (this.iridescenceIOR = t.iridescenceIOR), t.iridescenceThicknessRange !== void 0 && (this.iridescenceThicknessRange = t.iridescenceThicknessRange), t.transmission !== void 0 && (this.transmission = t.transmission), t.thickness !== void 0 && (this.thickness = t.thickness), t.attenuationDistance !== void 0 && (this.attenuationDistance = t.attenuationDistance), t.attenuationColor !== void 0 && this.attenuationColor !== void 0 && this.attenuationColor.setHex(t.attenuationColor), t.anisotropy !== void 0 && (this.anisotropy = t.anisotropy), t.anisotropyRotation !== void 0 && (this.anisotropyRotation = t.anisotropyRotation), t.fog !== void 0 && (this.fog = t.fog), t.flatShading !== void 0 && (this.flatShading = t.flatShading), t.blending !== void 0 && (this.blending = t.blending), t.combine !== void 0 && (this.combine = t.combine), t.side !== void 0 && (this.side = t.side), t.shadowSide !== void 0 && (this.shadowSide = t.shadowSide), t.opacity !== void 0 && (this.opacity = t.opacity), t.transparent !== void 0 && (this.transparent = t.transparent), t.alphaTest !== void 0 && (this.alphaTest = t.alphaTest), t.alphaHash !== void 0 && (this.alphaHash = t.alphaHash), t.depthFunc !== void 0 && (this.depthFunc = t.depthFunc), t.depthTest !== void 0 && (this.depthTest = t.depthTest), t.depthWrite !== void 0 && (this.depthWrite = t.depthWrite), t.colorWrite !== void 0 && (this.colorWrite = t.colorWrite), t.clippingPlanes !== void 0 && (this.clippingPlanes = t.clippingPlanes.map((i) => new Ce().fromJSON(i))), t.clipIntersection !== void 0 && (this.clipIntersection = t.clipIntersection), t.clipShadows !== void 0 && (this.clipShadows = t.clipShadows), t.depthPacking !== void 0 && (this.depthPacking = t.depthPacking), t.blendSrc !== void 0 && (this.blendSrc = t.blendSrc), t.blendDst !== void 0 && (this.blendDst = t.blendDst), t.blendEquation !== void 0 && (this.blendEquation = t.blendEquation), t.blendSrcAlpha !== void 0 && (this.blendSrcAlpha = t.blendSrcAlpha), t.blendDstAlpha !== void 0 && (this.blendDstAlpha = t.blendDstAlpha), t.blendEquationAlpha !== void 0 && (this.blendEquationAlpha = t.blendEquationAlpha), t.blendColor !== void 0 && this.blendColor !== void 0 && this.blendColor.setHex(t.blendColor), t.blendAlpha !== void 0 && (this.blendAlpha = t.blendAlpha), t.stencilWriteMask !== void 0 && (this.stencilWriteMask = t.stencilWriteMask), t.stencilFunc !== void 0 && (this.stencilFunc = t.stencilFunc), t.stencilRef !== void 0 && (this.stencilRef = t.stencilRef), t.stencilFuncMask !== void 0 && (this.stencilFuncMask = t.stencilFuncMask), t.stencilFail !== void 0 && (this.stencilFail = t.stencilFail), t.stencilZFail !== void 0 && (this.stencilZFail = t.stencilZFail), t.stencilZPass !== void 0 && (this.stencilZPass = t.stencilZPass), t.stencilWrite !== void 0 && (this.stencilWrite = t.stencilWrite), t.wireframe !== void 0 && (this.wireframe = t.wireframe), t.wireframeLinewidth !== void 0 && (this.wireframeLinewidth = t.wireframeLinewidth), t.wireframeLinecap !== void 0 && (this.wireframeLinecap = t.wireframeLinecap), t.wireframeLinejoin !== void 0 && (this.wireframeLinejoin = t.wireframeLinejoin), t.rotation !== void 0 && (this.rotation = t.rotation), t.linewidth !== void 0 && (this.linewidth = t.linewidth), t.linecap !== void 0 && (this.linecap = t.linecap), t.linejoin !== void 0 && (this.linejoin = t.linejoin), t.dashSize !== void 0 && (this.dashSize = t.dashSize), t.gapSize !== void 0 && (this.gapSize = t.gapSize), t.scale !== void 0 && (this.scale = t.scale), t.polygonOffset !== void 0 && (this.polygonOffset = t.polygonOffset), t.polygonOffsetFactor !== void 0 && (this.polygonOffsetFactor = t.polygonOffsetFactor), t.polygonOffsetUnits !== void 0 && (this.polygonOffsetUnits = t.polygonOffsetUnits), t.dithering !== void 0 && (this.dithering = t.dithering), t.alphaToCoverage !== void 0 && (this.alphaToCoverage = t.alphaToCoverage), t.premultipliedAlpha !== void 0 && (this.premultipliedAlpha = t.premultipliedAlpha), t.forceSinglePass !== void 0 && (this.forceSinglePass = t.forceSinglePass), t.allowOverride !== void 0 && (this.allowOverride = t.allowOverride), t.visible !== void 0 && (this.visible = t.visible), t.toneMapped !== void 0 && (this.toneMapped = t.toneMapped), t.userData !== void 0 && (this.userData = t.userData), t.vertexColors !== void 0 && (typeof t.vertexColors == "number" ? this.vertexColors = t.vertexColors > 0 : this.vertexColors = t.vertexColors), t.size !== void 0 && (this.size = t.size), t.sizeAttenuation !== void 0 && (this.sizeAttenuation = t.sizeAttenuation), t.map !== void 0 && (this.map = e[t.map] || null), t.matcap !== void 0 && (this.matcap = e[t.matcap] || null), t.alphaMap !== void 0 && (this.alphaMap = e[t.alphaMap] || null), t.bumpMap !== void 0 && (this.bumpMap = e[t.bumpMap] || null), t.bumpScale !== void 0 && (this.bumpScale = t.bumpScale), t.normalMap !== void 0 && (this.normalMap = e[t.normalMap] || null), t.normalMapType !== void 0 && (this.normalMapType = t.normalMapType), t.normalScale !== void 0) {
      let i = t.normalScale;
      Array.isArray(i) === false && (i = [i, i]), this.normalScale = new I().fromArray(i);
    }
    return t.displacementMap !== void 0 && (this.displacementMap = e[t.displacementMap] || null), t.displacementScale !== void 0 && (this.displacementScale = t.displacementScale), t.displacementBias !== void 0 && (this.displacementBias = t.displacementBias), t.roughnessMap !== void 0 && (this.roughnessMap = e[t.roughnessMap] || null), t.metalnessMap !== void 0 && (this.metalnessMap = e[t.metalnessMap] || null), t.emissiveMap !== void 0 && (this.emissiveMap = e[t.emissiveMap] || null), t.emissiveIntensity !== void 0 && (this.emissiveIntensity = t.emissiveIntensity), t.specularMap !== void 0 && (this.specularMap = e[t.specularMap] || null), t.specularIntensityMap !== void 0 && (this.specularIntensityMap = e[t.specularIntensityMap] || null), t.specularColorMap !== void 0 && (this.specularColorMap = e[t.specularColorMap] || null), t.envMap !== void 0 && (this.envMap = e[t.envMap] || null), t.envMapRotation !== void 0 && this.envMapRotation.fromArray(t.envMapRotation), t.envMapIntensity !== void 0 && (this.envMapIntensity = t.envMapIntensity), t.reflectivity !== void 0 && (this.reflectivity = t.reflectivity), t.refractionRatio !== void 0 && (this.refractionRatio = t.refractionRatio), t.lightMap !== void 0 && (this.lightMap = e[t.lightMap] || null), t.lightMapIntensity !== void 0 && (this.lightMapIntensity = t.lightMapIntensity), t.aoMap !== void 0 && (this.aoMap = e[t.aoMap] || null), t.aoMapIntensity !== void 0 && (this.aoMapIntensity = t.aoMapIntensity), t.gradientMap !== void 0 && (this.gradientMap = e[t.gradientMap] || null), t.clearcoatMap !== void 0 && (this.clearcoatMap = e[t.clearcoatMap] || null), t.clearcoatRoughnessMap !== void 0 && (this.clearcoatRoughnessMap = e[t.clearcoatRoughnessMap] || null), t.clearcoatNormalMap !== void 0 && (this.clearcoatNormalMap = e[t.clearcoatNormalMap] || null), t.clearcoatNormalScale !== void 0 && (this.clearcoatNormalScale = new I().fromArray(t.clearcoatNormalScale)), t.iridescenceMap !== void 0 && (this.iridescenceMap = e[t.iridescenceMap] || null), t.iridescenceThicknessMap !== void 0 && (this.iridescenceThicknessMap = e[t.iridescenceThicknessMap] || null), t.transmissionMap !== void 0 && (this.transmissionMap = e[t.transmissionMap] || null), t.thicknessMap !== void 0 && (this.thicknessMap = e[t.thicknessMap] || null), t.anisotropyMap !== void 0 && (this.anisotropyMap = e[t.anisotropyMap] || null), t.sheenColorMap !== void 0 && (this.sheenColorMap = e[t.sheenColorMap] || null), t.sheenRoughnessMap !== void 0 && (this.sheenRoughnessMap = e[t.sheenRoughnessMap] || null), this;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(t) {
    this.name = t.name, this.blending = t.blending, this.side = t.side, this.vertexColors = t.vertexColors, this.opacity = t.opacity, this.transparent = t.transparent, this.blendSrc = t.blendSrc, this.blendDst = t.blendDst, this.blendEquation = t.blendEquation, this.blendSrcAlpha = t.blendSrcAlpha, this.blendDstAlpha = t.blendDstAlpha, this.blendEquationAlpha = t.blendEquationAlpha, this.blendColor.copy(t.blendColor), this.blendAlpha = t.blendAlpha, this.depthFunc = t.depthFunc, this.depthTest = t.depthTest, this.depthWrite = t.depthWrite, this.stencilWriteMask = t.stencilWriteMask, this.stencilFunc = t.stencilFunc, this.stencilRef = t.stencilRef, this.stencilFuncMask = t.stencilFuncMask, this.stencilFail = t.stencilFail, this.stencilZFail = t.stencilZFail, this.stencilZPass = t.stencilZPass, this.stencilWrite = t.stencilWrite;
    const e = t.clippingPlanes;
    let i = null;
    if (e !== null) {
      const s = e.length;
      i = new Array(s);
      for (let n = 0; n !== s; ++n) i[n] = e[n].clone();
    }
    return this.clippingPlanes = i, this.clipIntersection = t.clipIntersection, this.clipShadows = t.clipShadows, this.shadowSide = t.shadowSide, this.colorWrite = t.colorWrite, this.precision = t.precision, this.polygonOffset = t.polygonOffset, this.polygonOffsetFactor = t.polygonOffsetFactor, this.polygonOffsetUnits = t.polygonOffsetUnits, this.dithering = t.dithering, this.alphaTest = t.alphaTest, this.alphaHash = t.alphaHash, this.alphaToCoverage = t.alphaToCoverage, this.premultipliedAlpha = t.premultipliedAlpha, this.forceSinglePass = t.forceSinglePass, this.allowOverride = t.allowOverride, this.visible = t.visible, this.toneMapped = t.toneMapped, this.userData = JSON.parse(JSON.stringify(t.userData)), this;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
  set needsUpdate(t) {
    t === true && this.version++;
  }
};
var Hi = new w();
var bi = new w();
var Mi = new w();
var wi = new I();
var qi = new I();
var gh = new G();
var Ls = new w();
var Ji = new w();
var Vs = new w();
var xh = new I();
var Nr = new I();
var bh = new I();
var Us = new w();
var wh = new w();
var ye = new w();
var Lr = new w();
var Ws = new w();
var Gs = new w();
var _i = class {
  constructor(t = new w(), e = new w(0, 0, -1)) {
    this.origin = t, this.direction = e;
  }
  set(t, e) {
    return this.origin.copy(t), this.direction.copy(e), this;
  }
  copy(t) {
    return this.origin.copy(t.origin), this.direction.copy(t.direction), this;
  }
  at(t, e) {
    return e.copy(this.origin).addScaledVector(this.direction, t);
  }
  lookAt(t) {
    return this.direction.copy(t).sub(this.origin).normalize(), this;
  }
  recast(t) {
    return this.origin.copy(this.at(t, ye)), this;
  }
  closestPointToPoint(t, e) {
    e.subVectors(t, this.origin);
    const i = e.dot(this.direction);
    return i < 0 ? e.copy(this.origin) : e.copy(this.origin).addScaledVector(this.direction, i);
  }
  distanceToPoint(t) {
    return Math.sqrt(this.distanceSqToPoint(t));
  }
  distanceSqToPoint(t) {
    const e = ye.subVectors(t, this.origin).dot(this.direction);
    return e < 0 ? this.origin.distanceToSquared(t) : (ye.copy(this.origin).addScaledVector(this.direction, e), ye.distanceToSquared(t));
  }
  distanceSqToSegment(t, e, i, s) {
    Lr.copy(t).add(e).multiplyScalar(0.5), Ws.copy(e).sub(t).normalize(), Gs.copy(this.origin).sub(Lr);
    const n = t.distanceTo(e) * 0.5, r = -this.direction.dot(Ws), a = Gs.dot(this.direction), o = -Gs.dot(Ws), h = Gs.lengthSq(), c = Math.abs(1 - r * r);
    let u, d, p, f;
    if (c > 0) if (u = r * o - a, d = r * a - o, f = n * c, u >= 0) if (d >= -f) if (d <= f) {
      const m = 1 / c;
      u *= m, d *= m, p = u * (u + r * d + 2 * a) + d * (r * u + d + 2 * o) + h;
    } else d = n, u = Math.max(0, -(r * d + a)), p = -u * u + d * (d + 2 * o) + h;
    else d = -n, u = Math.max(0, -(r * d + a)), p = -u * u + d * (d + 2 * o) + h;
    else d <= -f ? (u = Math.max(0, -(-r * n + a)), d = u > 0 ? -n : Math.min(Math.max(-n, -o), n), p = -u * u + d * (d + 2 * o) + h) : d <= f ? (u = 0, d = Math.min(Math.max(-n, -o), n), p = d * (d + 2 * o) + h) : (u = Math.max(0, -(r * n + a)), d = u > 0 ? n : Math.min(Math.max(-n, -o), n), p = -u * u + d * (d + 2 * o) + h);
    else d = r > 0 ? -n : n, u = Math.max(0, -(r * d + a)), p = -u * u + d * (d + 2 * o) + h;
    return i && i.copy(this.origin).addScaledVector(this.direction, u), s && s.copy(Lr).addScaledVector(Ws, d), p;
  }
  intersectSphere(t, e) {
    if (t.radius < 0) return null;
    ye.subVectors(t.center, this.origin);
    const i = ye.dot(this.direction), s = ye.dot(ye) - i * i, n = t.radius * t.radius;
    if (s > n) return null;
    const r = Math.sqrt(n - s), a = i - r, o = i + r;
    return o < 0 ? null : a < 0 ? this.at(o, e) : this.at(a, e);
  }
  intersectsSphere(t) {
    return t.radius < 0 ? false : this.distanceSqToPoint(t.center) <= t.radius * t.radius;
  }
  distanceToPlane(t) {
    const e = t.normal.dot(this.direction);
    if (e === 0) return t.distanceToPoint(this.origin) === 0 ? 0 : null;
    const i = -(this.origin.dot(t.normal) + t.constant) / e;
    return i >= 0 ? i : null;
  }
  intersectPlane(t, e) {
    const i = this.distanceToPlane(t);
    return i === null ? null : this.at(i, e);
  }
  intersectsPlane(t) {
    const e = t.distanceToPoint(this.origin);
    return e === 0 || t.normal.dot(this.direction) * e < 0;
  }
  intersectBox(t, e) {
    let i, s, n, r, a, o;
    const h = 1 / this.direction.x, c = 1 / this.direction.y, u = 1 / this.direction.z, d = this.origin;
    return h >= 0 ? (i = (t.min.x - d.x) * h, s = (t.max.x - d.x) * h) : (i = (t.max.x - d.x) * h, s = (t.min.x - d.x) * h), c >= 0 ? (n = (t.min.y - d.y) * c, r = (t.max.y - d.y) * c) : (n = (t.max.y - d.y) * c, r = (t.min.y - d.y) * c), i > r || n > s || ((n > i || isNaN(i)) && (i = n), (r < s || isNaN(s)) && (s = r), u >= 0 ? (a = (t.min.z - d.z) * u, o = (t.max.z - d.z) * u) : (a = (t.max.z - d.z) * u, o = (t.min.z - d.z) * u), i > o || a > s) || ((a > i || i !== i) && (i = a), (o < s || s !== s) && (s = o), s < 0) ? null : this.at(i >= 0 ? i : s, e);
  }
  intersectsBox(t) {
    return this.intersectBox(t, ye) !== null;
  }
  intersectTriangle(t, e, i, s, n) {
    const r = this.origin, a = this.direction, o = a.x, h = a.y, c = a.z, u = t.x - r.x, d = t.y - r.y, p = t.z - r.z, f = e.x - r.x, m = e.y - r.y, y = e.z - r.z, g = i.x - r.x, x = i.y - r.y, b = i.z - r.z, M = Math.abs(o), _ = Math.abs(h), v = Math.abs(c);
    let A, S, T, C, B, R, L, J, N, Q, K, ut;
    if (M >= _ && M >= v ? (T = o, R = u, N = f, ut = g, o >= 0 ? (A = h, S = c, C = d, B = p, L = m, J = y, Q = x, K = b) : (A = c, S = h, C = p, B = d, L = y, J = m, Q = b, K = x)) : _ >= v ? (T = h, R = d, N = m, ut = x, h >= 0 ? (A = c, S = o, C = p, B = u, L = y, J = f, Q = b, K = g) : (A = o, S = c, C = u, B = p, L = f, J = y, Q = g, K = b)) : (T = c, R = p, N = y, ut = b, c >= 0 ? (A = o, S = h, C = u, B = d, L = f, J = m, Q = g, K = x) : (A = h, S = o, C = d, B = u, L = m, J = f, Q = x, K = g)), T === 0) return null;
    const j = A / T, tt = S / T, et = 1 / T, Tt = C - j * R, bt = B - tt * R, oe = L - j * N, be = J - tt * N, fs2 = Q - j * ut, ms2 = K - tt * ut, Me = fs2 * be - ms2 * oe, Mt = Tt * ms2 - bt * fs2, ie = oe * bt - be * Tt;
    if (s) {
      if (Me < 0 || Mt < 0 || ie < 0) return null;
    } else if ((Me < 0 || Mt < 0 || ie < 0) && (Me > 0 || Mt > 0 || ie > 0)) return null;
    const ki = Me + Mt + ie;
    if (ki === 0) return null;
    const Pt = et * (Me * R + Mt * N + ie * ut);
    return (ki > 0 ? Pt < 0 : Pt > 0) ? null : this.at(Pt / ki, n);
  }
  applyMatrix4(t) {
    return this.origin.applyMatrix4(t), this.direction.transformDirection(t), this;
  }
  equals(t) {
    return t.origin.equals(this.origin) && t.direction.equals(this.direction);
  }
  clone() {
    return new this.constructor().copy(this);
  }
};
var We = class extends ft {
  constructor(t) {
    super(), this.isMeshBasicMaterial = true, this.type = "MeshBasicMaterial", this.color = new U(16777215), this.map = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.specularMap = null, this.alphaMap = null, this.envMap = null, this.envMapRotation = new te(), this.combine = gs, this.reflectivity = 1, this.refractionRatio = 0.98, this.wireframe = false, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.fog = true, this.setValues(t);
  }
  copy(t) {
    return super.copy(t), this.color.copy(t.color), this.map = t.map, this.lightMap = t.lightMap, this.lightMapIntensity = t.lightMapIntensity, this.aoMap = t.aoMap, this.aoMapIntensity = t.aoMapIntensity, this.specularMap = t.specularMap, this.alphaMap = t.alphaMap, this.envMap = t.envMap, this.envMapRotation.copy(t.envMapRotation), this.combine = t.combine, this.reflectivity = t.reflectivity, this.refractionRatio = t.refractionRatio, this.wireframe = t.wireframe, this.wireframeLinewidth = t.wireframeLinewidth, this.wireframeLinecap = t.wireframeLinecap, this.wireframeLinejoin = t.wireframeLinejoin, this.fog = t.fog, this;
  }
};
var vh = new G();
var Ge = new _i();
var Hs = new pt();
var Sh = new w();
var qs = new w();
var Js = new w();
var Xs = new w();
var Vr = new w();
var Ys = new w();
var Ah = new w();
var Zs = new w();
var Zt = class extends Y {
  constructor(t = new H(), e = new We()) {
    super(), this.isMesh = true, this.type = "Mesh", this.geometry = t, this.material = e, this.morphTargetDictionary = void 0, this.morphTargetInfluences = void 0, this.count = 1, this.updateMorphTargets();
  }
  copy(t, e) {
    return super.copy(t, e), t.morphTargetInfluences !== void 0 && (this.morphTargetInfluences = t.morphTargetInfluences.slice()), t.morphTargetDictionary !== void 0 && (this.morphTargetDictionary = Object.assign({}, t.morphTargetDictionary)), this.material = Array.isArray(t.material) ? t.material.slice() : t.material, this.geometry = t.geometry, this;
  }
  updateMorphTargets() {
    const e = this.geometry.morphAttributes, i = Object.keys(e);
    if (i.length > 0) {
      const s = e[i[0]];
      if (s !== void 0) {
        this.morphTargetInfluences = [], this.morphTargetDictionary = {};
        for (let n = 0, r = s.length; n < r; n++) {
          const a = s[n].name || String(n);
          this.morphTargetInfluences.push(0), this.morphTargetDictionary[a] = n;
        }
      }
    }
  }
  getVertexPosition(t, e) {
    const i = this.geometry, s = i.attributes.position, n = i.morphAttributes.position, r = i.morphTargetsRelative;
    e.fromBufferAttribute(s, t);
    const a = this.morphTargetInfluences;
    if (n && a) {
      Ys.set(0, 0, 0);
      for (let o = 0, h = n.length; o < h; o++) {
        const c = a[o], u = n[o];
        c !== 0 && (Vr.fromBufferAttribute(u, t), r ? Ys.addScaledVector(Vr, c) : Ys.addScaledVector(Vr.sub(e), c));
      }
      e.add(Ys);
    }
    return e;
  }
  intersectsFrustum(t) {
    return t.intersectsObject(this);
  }
  raycast(t, e) {
    const i = this.geometry, s = this.material, n = this.matrixWorld;
    s !== void 0 && (i.boundingSphere === null && i.computeBoundingSphere(), Hs.copy(i.boundingSphere), Hs.applyMatrix4(n), Ge.copy(t.ray).recast(t.near), !(Hs.containsPoint(Ge.origin) === false && (Ge.intersectSphere(Hs, Sh) === null || Ge.origin.distanceToSquared(Sh) > (t.far - t.near) ** 2)) && (vh.copy(n).invert(), Ge.copy(t.ray).applyMatrix4(vh), !(i.boundingBox !== null && Ge.intersectsBox(i.boundingBox) === false) && this._computeIntersections(t, e, Ge)));
  }
  _computeIntersections(t, e, i) {
    let s;
    const n = this.geometry, r = this.material, a = n.index, o = n.attributes.position, h = n.attributes.uv, c = n.attributes.uv1, u = n.attributes.normal, d = n.groups, p = n.drawRange;
    if (a !== null) if (Array.isArray(r)) for (let f = 0, m = d.length; f < m; f++) {
      const y = d[f], g = r[y.materialIndex], x = Math.max(y.start, p.start), b = Math.min(a.count, Math.min(y.start + y.count, p.start + p.count));
      for (let M = x, _ = b; M < _; M += 3) {
        const v = a.getX(M), A = a.getX(M + 1), S = a.getX(M + 2);
        s = $s(this, g, t, i, h, c, u, v, A, S), s && (s.faceIndex = Math.floor(M / 3), s.face.materialIndex = y.materialIndex, e.push(s));
      }
    }
    else {
      const f = Math.max(0, p.start), m = Math.min(a.count, p.start + p.count);
      for (let y = f, g = m; y < g; y += 3) {
        const x = a.getX(y), b = a.getX(y + 1), M = a.getX(y + 2);
        s = $s(this, r, t, i, h, c, u, x, b, M), s && (s.faceIndex = Math.floor(y / 3), e.push(s));
      }
    }
    else if (o !== void 0) if (Array.isArray(r)) for (let f = 0, m = d.length; f < m; f++) {
      const y = d[f], g = r[y.materialIndex], x = Math.max(y.start, p.start), b = Math.min(o.count, Math.min(y.start + y.count, p.start + p.count));
      for (let M = x, _ = b; M < _; M += 3) {
        const v = M, A = M + 1, S = M + 2;
        s = $s(this, g, t, i, h, c, u, v, A, S), s && (s.faceIndex = Math.floor(M / 3), s.face.materialIndex = y.materialIndex, e.push(s));
      }
    }
    else {
      const f = Math.max(0, p.start), m = Math.min(o.count, p.start + p.count);
      for (let y = f, g = m; y < g; y += 3) {
        const x = y, b = y + 1, M = y + 2;
        s = $s(this, r, t, i, h, c, u, x, b, M), s && (s.faceIndex = Math.floor(y / 3), e.push(s));
      }
    }
  }
};
function lp(l, t, e, i, s, n, r, a) {
  let o;
  if (t.side === Oa ? o = i.intersectTriangle(r, n, s, true, a) : o = i.intersectTriangle(s, n, r, t.side === $n, a), o === null) return null;
  Zs.copy(a), Zs.applyMatrix4(l.matrixWorld);
  const h = e.ray.origin.distanceTo(Zs);
  return h < e.near || h > e.far ? null : { distance: h, point: Zs.clone(), object: l };
}
function $s(l, t, e, i, s, n, r, a, o, h) {
  l.getVertexPosition(a, qs), l.getVertexPosition(o, Js), l.getVertexPosition(h, Xs);
  const c = lp(l, t, e, i, qs, Js, Xs, Ah);
  if (c) {
    const u = new w();
    kt.getBarycoord(Ah, qs, Js, Xs, u), s && (c.uv = kt.getInterpolatedAttribute(s, a, o, h, u, new I())), n && (c.uv1 = kt.getInterpolatedAttribute(n, a, o, h, u, new I())), r && (c.normal = kt.getInterpolatedAttribute(r, a, o, h, u, new w()), c.normal.dot(i.direction) > 0 && c.normal.multiplyScalar(-1));
    const d = { a, b: o, c: h, normal: new w(), materialIndex: 0 };
    kt.getNormal(qs, Js, Xs, d.normal), c.face = d, c.barycoord = u;
  }
  return c;
}
var Xi = new At();
var Th = new At();
var Ch = new At();
var cp = new At();
var Ih = new G();
var Qs = new w();
var Dr = new pt();
var zh = new G();
var Ur = new _i();
var $t = class extends ot {
  constructor(t = null, e = 1, i = 1, s, n, r, a, o, h = Ct, c = Ct, u, d) {
    super(null, r, a, o, h, c, s, n, u, d), this.isDataTexture = true, this.image = { data: t, width: e, height: i }, this.generateMipmaps = false, this.flipY = false, this.unpackAlignment = 1;
  }
};
var Fh = new G();
var up = new G();
var Si = new G();
var kh = new G();
var Ph = new gt();
var dp = new G();
var Yi = new Zt();
var Zi = new pt();
var He = new pt();
var pp = new I(0.5, 0.5);
var Ks = new w();
var $i = class {
  constructor(t = new Ce(), e = new Ce(), i = new Ce(), s = new Ce(), n = new Ce(), r = new Ce()) {
    this.planes = [t, e, i, s, n, r];
  }
  set(t, e, i, s, n, r) {
    const a = this.planes;
    return a[0].copy(t), a[1].copy(e), a[2].copy(i), a[3].copy(s), a[4].copy(n), a[5].copy(r), this;
  }
  copy(t) {
    const e = this.planes;
    for (let i = 0; i < 6; i++) e[i].copy(t.planes[i]);
    return this;
  }
  setFromProjectionMatrix(t, e = qt, i = false) {
    const s = this.planes, n = t.elements, r = n[0], a = n[1], o = n[2], h = n[3], c = n[4], u = n[5], d = n[6], p = n[7], f = n[8], m = n[9], y = n[10], g = n[11], x = n[12], b = n[13], M = n[14], _ = n[15];
    if (s[0].setComponents(h - r, p - c, g - f, _ - x).normalize(), s[1].setComponents(h + r, p + c, g + f, _ + x).normalize(), s[2].setComponents(h + a, p + u, g + m, _ + b).normalize(), s[3].setComponents(h - a, p - u, g - m, _ - b).normalize(), i) s[4].setComponents(o, d, y, M).normalize(), s[5].setComponents(h - o, p - d, g - y, _ - M).normalize();
    else if (s[4].setComponents(h - o, p - d, g - y, _ - M).normalize(), e === qt) s[5].setComponents(h + o, p + d, g + y, _ + M).normalize();
    else if (e === Le) s[5].setComponents(o, d, y, M).normalize();
    else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: " + e);
    return this;
  }
  intersectsObject(t) {
    if (t.boundingSphere !== void 0) t.boundingSphere === null && t.computeBoundingSphere(), He.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);
    else {
      const e = t.geometry;
      e.boundingSphere === null && e.computeBoundingSphere(), He.copy(e.boundingSphere).applyMatrix4(t.matrixWorld);
    }
    return this.intersectsSphere(He);
  }
  intersectsSprite(t) {
    He.center.set(0, 0, 0);
    const e = pp.distanceTo(t.center);
    return He.radius = 0.7071067811865476 + e, He.applyMatrix4(t.matrixWorld), this.intersectsSphere(He);
  }
  intersectsSphere(t) {
    const e = this.planes, i = t.center, s = -t.radius;
    for (let n = 0; n < 6; n++) if (e[n].distanceToPoint(i) < s) return false;
    return true;
  }
  intersectsBox(t) {
    const e = this.planes;
    for (let i = 0; i < 6; i++) {
      const s = e[i];
      if (Ks.x = s.normal.x > 0 ? t.max.x : t.min.x, Ks.y = s.normal.y > 0 ? t.max.y : t.min.y, Ks.z = s.normal.z > 0 ? t.max.z : t.min.z, s.distanceToPoint(Ks) < 0) return false;
    }
    return true;
  }
  containsPoint(t) {
    const e = this.planes;
    for (let i = 0; i < 6; i++) if (e[i].distanceToPoint(t) < 0) return false;
    return true;
  }
  clone() {
    return new this.constructor().copy(this);
  }
};
var Oh = new G();
var Rn = class _Rn {
  constructor() {
    this.coordinateSystem = qt, this._frustums = [], this._count = 0;
  }
  setFromArrayCamera(t) {
    const e = t.cameras, i = this._frustums;
    for (let s = 0; s < e.length; s++) {
      const n = e[s];
      Oh.multiplyMatrices(n.projectionMatrix, n.matrixWorldInverse), i[s] === void 0 && (i[s] = new $i()), i[s].setFromProjectionMatrix(Oh, n.coordinateSystem, n.reversedDepth);
    }
    return this._count = e.length, this;
  }
  intersectsObject(t) {
    const e = this._frustums;
    for (let i = 0; i < this._count; i++) if (e[i].intersectsObject(t)) return true;
    return false;
  }
  intersectsSprite(t) {
    const e = this._frustums;
    for (let i = 0; i < this._count; i++) if (e[i].intersectsSprite(t)) return true;
    return false;
  }
  intersectsSphere(t) {
    const e = this._frustums;
    for (let i = 0; i < this._count; i++) if (e[i].intersectsSphere(t)) return true;
    return false;
  }
  intersectsBox(t) {
    const e = this._frustums;
    for (let i = 0; i < this._count; i++) if (e[i].intersectsBox(t)) return true;
    return false;
  }
  containsPoint(t) {
    const e = this._frustums;
    for (let i = 0; i < this._count; i++) if (e[i].containsPoint(t)) return true;
    return false;
  }
  copy(t) {
    this.coordinateSystem = t.coordinateSystem;
    const e = this._frustums, i = t._frustums;
    for (let s = 0; s < t._count; s++) e[s] === void 0 && (e[s] = new $i()), e[s].copy(i[s]);
    return this._count = t._count, this;
  }
  clone() {
    return new _Rn().copy(this);
  }
};
var yp = class {
  constructor() {
    this.index = 0, this.pool = [], this.list = [];
  }
  push(t, e, i, s) {
    const n = this.pool, r = this.list;
    this.index >= n.length && n.push({ start: -1, count: -1, z: -1, index: -1 });
    const a = n[this.index];
    r.push(a), this.index++, a.start = t, a.count = e, a.z = i, a.index = s;
  }
  reset() {
    this.list.length = 0, this.index = 0;
  }
};
var Bt = new G();
var gp = new U(1, 1, 1);
var xp = new $i();
var bp = new Rn();
var tn = new gt();
var qe = new pt();
var Qi = new w();
var Eh = new w();
var Mp = new w();
var Hr = new yp();
var xt = new Zt();
var St = class extends ft {
  constructor(t) {
    super(), this.isLineBasicMaterial = true, this.type = "LineBasicMaterial", this.color = new U(16777215), this.map = null, this.linewidth = 1, this.linecap = "round", this.linejoin = "round", this.fog = true, this.setValues(t);
  }
  copy(t) {
    return super.copy(t), this.color.copy(t.color), this.map = t.map, this.linewidth = t.linewidth, this.linecap = t.linecap, this.linejoin = t.linejoin, this.fog = t.fog, this;
  }
};
var sn = new w();
var nn = new w();
var Lh = new G();
var ji = new _i();
var rn = new pt();
var qr = new w();
var Vh = new w();
var Ie = class extends Y {
  constructor(t = new H(), e = new St()) {
    super(), this.isLine = true, this.type = "Line", this.geometry = t, this.material = e, this.morphTargetDictionary = void 0, this.morphTargetInfluences = void 0, this.updateMorphTargets();
  }
  copy(t, e) {
    return super.copy(t, e), this.material = Array.isArray(t.material) ? t.material.slice() : t.material, this.geometry = t.geometry, this;
  }
  computeLineDistances() {
    const t = this.geometry;
    if (t.index === null) {
      const e = t.attributes.position, i = [0];
      for (let s = 1, n = e.count; s < n; s++) sn.fromBufferAttribute(e, s - 1), nn.fromBufferAttribute(e, s), i[s] = i[s - 1], i[s] += sn.distanceTo(nn);
      t.setAttribute("lineDistance", new P(i, 1));
    } else V("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");
    return this;
  }
  intersectsFrustum(t) {
    return t.intersectsObject(this);
  }
  raycast(t, e) {
    const i = this.geometry, s = this.matrixWorld, n = t.params.Line.threshold, r = i.drawRange;
    if (i.boundingSphere === null && i.computeBoundingSphere(), rn.copy(i.boundingSphere), rn.applyMatrix4(s), rn.radius += n, t.ray.intersectsSphere(rn) === false) return;
    Lh.copy(s).invert(), ji.copy(t.ray).applyMatrix4(Lh);
    const a = n / ((this.scale.x + this.scale.y + this.scale.z) / 3), o = a * a, h = this.isLineSegments ? 2 : 1, c = i.index, d = i.attributes.position;
    if (c !== null) {
      const p = Math.max(0, r.start), f = Math.min(c.count, r.start + r.count);
      for (let m = p, y = f - 1; m < y; m += h) {
        const g = c.getX(m), x = c.getX(m + 1), b = an(this, t, ji, o, g, x, m);
        b && e.push(b);
      }
      if (this.isLineLoop) {
        const m = c.getX(f - 1), y = c.getX(p), g = an(this, t, ji, o, m, y, f - 1);
        g && e.push(g);
      }
    } else {
      const p = Math.max(0, r.start), f = Math.min(d.count, r.start + r.count);
      for (let m = p, y = f - 1; m < y; m += h) {
        const g = an(this, t, ji, o, m, m + 1, m);
        g && e.push(g);
      }
      if (this.isLineLoop) {
        const m = an(this, t, ji, o, f - 1, p, f - 1);
        m && e.push(m);
      }
    }
  }
  updateMorphTargets() {
    const e = this.geometry.morphAttributes, i = Object.keys(e);
    if (i.length > 0) {
      const s = e[i[0]];
      if (s !== void 0) {
        this.morphTargetInfluences = [], this.morphTargetDictionary = {};
        for (let n = 0, r = s.length; n < r; n++) {
          const a = s[n].name || String(n);
          this.morphTargetInfluences.push(0), this.morphTargetDictionary[a] = n;
        }
      }
    }
  }
};
function an(l, t, e, i, s, n, r) {
  const a = l.geometry.attributes.position;
  if (sn.fromBufferAttribute(a, s), nn.fromBufferAttribute(a, n), e.distanceSqToSegment(sn, nn, qr, Vh) > i) return;
  qr.applyMatrix4(l.matrixWorld);
  const h = t.ray.origin.distanceTo(qr);
  if (!(h < t.near || h > t.far)) return { distance: h, point: Vh.clone().applyMatrix4(l.matrixWorld), index: r, face: null, faceIndex: null, barycoord: null, object: l };
}
var Dh = new w();
var Uh = new w();
var ne = class extends Ie {
  constructor(t, e) {
    super(t, e), this.isLineSegments = true, this.type = "LineSegments";
  }
  computeLineDistances() {
    const t = this.geometry;
    if (t.index === null) {
      const e = t.attributes.position, i = [];
      for (let s = 0, n = e.count; s < n; s += 2) Dh.fromBufferAttribute(e, s), Uh.fromBufferAttribute(e, s + 1), i[s] = s === 0 ? 0 : i[s - 1], i[s + 1] = i[s] + Dh.distanceTo(Uh);
      t.setAttribute("lineDistance", new P(i, 1));
    } else V("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");
    return this;
  }
};
var Jr = class extends ft {
  constructor(t) {
    super(), this.isPointsMaterial = true, this.type = "PointsMaterial", this.color = new U(16777215), this.map = null, this.alphaMap = null, this.size = 1, this.sizeAttenuation = true, this.fog = true, this.setValues(t);
  }
  copy(t) {
    return super.copy(t), this.color.copy(t.color), this.map = t.map, this.alphaMap = t.alphaMap, this.size = t.size, this.sizeAttenuation = t.sizeAttenuation, this.fog = t.fog, this;
  }
};
var Gh = new G();
var Xr = new _i();
var on = new pt();
var hn = new w();
var Hh = class extends Y {
  constructor(t = new H(), e = new Jr()) {
    super(), this.isPoints = true, this.type = "Points", this.geometry = t, this.material = e, this.morphTargetDictionary = void 0, this.morphTargetInfluences = void 0, this.updateMorphTargets();
  }
  copy(t, e) {
    return super.copy(t, e), this.material = Array.isArray(t.material) ? t.material.slice() : t.material, this.geometry = t.geometry, this;
  }
  intersectsFrustum(t) {
    return t.intersectsObject(this);
  }
  raycast(t, e) {
    const i = this.geometry, s = this.matrixWorld, n = t.params.Points.threshold, r = i.drawRange;
    if (i.boundingSphere === null && i.computeBoundingSphere(), on.copy(i.boundingSphere), on.applyMatrix4(s), on.radius += n, t.ray.intersectsSphere(on) === false) return;
    Gh.copy(s).invert(), Xr.copy(t.ray).applyMatrix4(Gh);
    const a = n / ((this.scale.x + this.scale.y + this.scale.z) / 3), o = a * a, h = i.index, u = i.attributes.position;
    if (h !== null) {
      const d = Math.max(0, r.start), p = Math.min(h.count, r.start + r.count);
      for (let f = d, m = p; f < m; f++) {
        const y = h.getX(f);
        hn.fromBufferAttribute(u, y), qh(hn, y, o, s, t, e, this);
      }
    } else {
      const d = Math.max(0, r.start), p = Math.min(u.count, r.start + r.count);
      for (let f = d, m = p; f < m; f++) hn.fromBufferAttribute(u, f), qh(hn, f, o, s, t, e, this);
    }
  }
  updateMorphTargets() {
    const e = this.geometry.morphAttributes, i = Object.keys(e);
    if (i.length > 0) {
      const s = e[i[0]];
      if (s !== void 0) {
        this.morphTargetInfluences = [], this.morphTargetDictionary = {};
        for (let n = 0, r = s.length; n < r; n++) {
          const a = s[n].name || String(n);
          this.morphTargetInfluences.push(0), this.morphTargetDictionary[a] = n;
        }
      }
    }
  }
};
function qh(l, t, e, i, s, n, r) {
  const a = Xr.distanceSqToPoint(l);
  if (a < e) {
    const o = new w();
    Xr.closestPointToPoint(l, o), o.applyMatrix4(i);
    const h = s.ray.origin.distanceTo(o);
    if (h < s.near || h > s.far) return;
    n.push({ distance: h, distanceToRay: Math.sqrt(a), point: o, index: t, face: null, faceIndex: null, barycoord: null, object: r });
  }
}
var Yr = class extends ot {
  constructor(t = [], e = Pi, i, s, n, r, a, o, h, c) {
    super(t, e, i, s, n, r, a, o, h, c), this.isCubeTexture = true, this.flipY = false;
  }
  get images() {
    return this.image;
  }
  set images(t) {
    this.image = t;
  }
};
var Xh = class extends ot {
  constructor(t, e, i = Ri, s, n, r, a = Ct, o = Ct, h, c = vs, u = 1) {
    if (c !== vs && c !== ro) throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");
    const d = { width: t, height: e, depth: u };
    super(d, s, n, r, a, o, c, i, h), this.isDepthTexture = true, this.flipY = false, this.generateMipmaps = false, this.compareFunction = null;
  }
  copy(t) {
    return super.copy(t), this.source = new ce(Object.assign({}, t.image)), this.compareFunction = t.compareFunction, this;
  }
  toJSON(t) {
    const e = super.toJSON(t);
    return e.compareFunction = this.compareFunction, e;
  }
};
var Ip = class extends Xh {
  constructor(t, e = Ri, i = Pi, s, n, r = Ct, a = Ct, o, h = vs) {
    const c = { width: t, height: t, depth: 1 }, u = [c, c, c, c, c, c];
    super(t, t, e, i, s, n, r, a, o, h), this.image = u, this.isCubeDepthTexture = true, this.isCubeTexture = true;
  }
  get images() {
    return this.image;
  }
  set images(t) {
    this.image = t;
  }
};
var zp = class extends ot {
  constructor(t = null) {
    super(), this.sourceTexture = t, this.isExternalTexture = true;
  }
  copy(t) {
    return super.copy(t), this.sourceTexture = t.sourceTexture, this;
  }
};
var On = class _On extends H {
  constructor(t = 1, e = 1, i = 1, s = 1, n = 1, r = 1) {
    super(), this.type = "BoxGeometry", this.parameters = { width: t, height: e, depth: i, widthSegments: s, heightSegments: n, depthSegments: r };
    const a = this;
    s = Math.floor(s), n = Math.floor(n), r = Math.floor(r);
    const o = [], h = [], c = [], u = [];
    let d = 0, p = 0;
    f("z", "y", "x", -1, -1, i, e, t, r, n, 0), f("z", "y", "x", 1, -1, i, e, -t, r, n, 1), f("x", "z", "y", 1, 1, t, i, e, s, r, 2), f("x", "z", "y", 1, -1, t, i, -e, s, r, 3), f("x", "y", "z", 1, -1, t, e, i, s, n, 4), f("x", "y", "z", -1, -1, t, e, -i, s, n, 5), this.setIndex(o), this.setAttribute("position", new P(h, 3)), this.setAttribute("normal", new P(c, 3)), this.setAttribute("uv", new P(u, 2));
    function f(m, y, g, x, b, M, _, v, A, S, T) {
      const C = M / A, B = _ / S, R = M / 2, L = _ / 2, J = v / 2, N = A + 1, Q = S + 1;
      let K = 0, ut = 0;
      const j = new w();
      for (let tt = 0; tt < Q; tt++) {
        const et = tt * B - L;
        for (let Tt = 0; Tt < N; Tt++) {
          const bt = Tt * C - R;
          j[m] = bt * x, j[y] = et * b, j[g] = J, h.push(j.x, j.y, j.z), j[m] = 0, j[y] = 0, j[g] = v > 0 ? 1 : -1, c.push(j.x, j.y, j.z), u.push(Tt / A), u.push(1 - tt / S), K += 1;
        }
      }
      for (let tt = 0; tt < S; tt++) for (let et = 0; et < A; et++) {
        const Tt = d + et + N * tt, bt = d + et + N * (tt + 1), oe = d + (et + 1) + N * (tt + 1), be = d + (et + 1) + N * tt;
        o.push(Tt, bt, be), o.push(bt, oe, be), ut += 6;
      }
      a.addGroup(p, ut, T), p += ut, d += K;
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _On(t.width, t.height, t.depth, t.widthSegments, t.heightSegments, t.depthSegments);
  }
};
var En = class _En extends H {
  constructor(t = 1, e = 1, i = 4, s = 8, n = 1) {
    super(), this.type = "CapsuleGeometry", this.parameters = { radius: t, height: e, capSegments: i, radialSegments: s, heightSegments: n }, e = Math.max(0, e), i = Math.max(1, Math.floor(i)), s = Math.max(3, Math.floor(s)), n = Math.max(1, Math.floor(n));
    const r = [], a = [], o = [], h = [], c = e / 2, u = Math.PI / 2 * t, d = e, p = 2 * u + d, f = i * 2 + n, m = s + 1, y = new w(), g = new w();
    for (let x = 0; x <= f; x++) {
      let b = 0, M = 0, _ = 0, v = 0;
      if (x <= i) {
        const T = x / i, C = T * Math.PI / 2;
        M = -c - t * Math.cos(C), _ = t * Math.sin(C), v = -t * Math.cos(C), b = T * u;
      } else if (x <= i + n) {
        const T = (x - i) / n;
        M = -c + T * e, _ = t, v = 0, b = u + T * d;
      } else {
        const T = (x - i - n) / i, C = T * Math.PI / 2;
        M = c + t * Math.sin(C), _ = t * Math.cos(C), v = t * Math.sin(C), b = u + d + T * u;
      }
      const A = Math.max(0, Math.min(1, b / p));
      let S = 0;
      x === 0 ? S = 0.5 / s : x === f && (S = -0.5 / s);
      for (let T = 0; T <= s; T++) {
        const C = T / s, B = C * Math.PI * 2, R = Math.sin(B), L = Math.cos(B);
        g.x = -_ * L, g.y = M, g.z = _ * R, a.push(g.x, g.y, g.z), y.set(-_ * L, v, _ * R), y.normalize(), o.push(y.x, y.y, y.z), h.push(C + S, A);
      }
      if (x > 0) {
        const T = (x - 1) * m;
        for (let C = 0; C < s; C++) {
          const B = T + C, R = T + C + 1, L = x * m + C, J = x * m + C + 1;
          r.push(B, R, L), r.push(R, J, L);
        }
      }
    }
    this.setIndex(r), this.setAttribute("position", new P(a, 3)), this.setAttribute("normal", new P(o, 3)), this.setAttribute("uv", new P(h, 2));
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _En(t.radius, t.height, t.capSegments, t.radialSegments, t.heightSegments);
  }
};
var Nn = class _Nn extends H {
  constructor(t = 1, e = 32, i = 0, s = Math.PI * 2) {
    super(), this.type = "CircleGeometry", this.parameters = { radius: t, segments: e, thetaStart: i, thetaLength: s }, e = Math.max(3, e);
    const n = [], r = [], a = [], o = [], h = new w(), c = new I();
    r.push(0, 0, 0), a.push(0, 0, 1), o.push(0.5, 0.5);
    for (let u = 0, d = 3; u <= e; u++, d += 3) {
      const p = i + u / e * s;
      h.x = t * Math.cos(p), h.y = t * Math.sin(p), r.push(h.x, h.y, h.z), a.push(0, 0, 1), c.x = (r[d] / t + 1) / 2, c.y = (r[d + 1] / t + 1) / 2, o.push(c.x, c.y);
    }
    for (let u = 1; u <= e; u++) n.push(u, u + 1, 0);
    this.setIndex(n), this.setAttribute("position", new P(r, 3)), this.setAttribute("normal", new P(a, 3)), this.setAttribute("uv", new P(o, 2));
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _Nn(t.radius, t.segments, t.thetaStart, t.thetaLength);
  }
};
var cs = class _cs extends H {
  constructor(t = 1, e = 1, i = 1, s = 32, n = 1, r = false, a = 0, o = Math.PI * 2) {
    super(), this.type = "CylinderGeometry", this.parameters = { radiusTop: t, radiusBottom: e, height: i, radialSegments: s, heightSegments: n, openEnded: r, thetaStart: a, thetaLength: o };
    const h = this;
    s = Math.floor(s), n = Math.floor(n);
    const c = [], u = [], d = [], p = [];
    let f = 0;
    const m = [], y = i / 2;
    let g = 0;
    x(), r === false && (t > 0 && b(true), e > 0 && b(false)), this.setIndex(c), this.setAttribute("position", new P(u, 3)), this.setAttribute("normal", new P(d, 3)), this.setAttribute("uv", new P(p, 2));
    function x() {
      const M = new w(), _ = new w();
      let v = 0;
      const A = (e - t) / i;
      for (let S = 0; S <= n; S++) {
        const T = [], C = S / n, B = C * (e - t) + t;
        for (let R = 0; R <= s; R++) {
          const L = R / s, J = L * o + a, N = Math.sin(J), Q = Math.cos(J);
          _.x = B * N, _.y = -C * i + y, _.z = B * Q, u.push(_.x, _.y, _.z), M.set(N, A, Q).normalize(), d.push(M.x, M.y, M.z), p.push(L, 1 - C), T.push(f++);
        }
        m.push(T);
      }
      for (let S = 0; S < s; S++) for (let T = 0; T < n; T++) {
        const C = m[T][S], B = m[T + 1][S], R = m[T + 1][S + 1], L = m[T][S + 1];
        (t > 0 || T !== 0) && (c.push(C, B, L), v += 3), (e > 0 || T !== n - 1) && (c.push(B, R, L), v += 3);
      }
      h.addGroup(g, v, 0), g += v;
    }
    function b(M) {
      const _ = f, v = new I(), A = new w();
      let S = 0;
      const T = M === true ? t : e, C = M === true ? 1 : -1;
      for (let R = 1; R <= s; R++) u.push(0, y * C, 0), d.push(0, C, 0), p.push(0.5, 0.5), f++;
      const B = f;
      for (let R = 0; R <= s; R++) {
        const J = R / s * o + a, N = Math.cos(J), Q = Math.sin(J);
        A.x = T * Q, A.y = y * C, A.z = T * N, u.push(A.x, A.y, A.z), d.push(0, C, 0), v.x = N * 0.5 + 0.5, v.y = Q * 0.5 * C + 0.5, p.push(v.x, v.y), f++;
      }
      for (let R = 0; R < s; R++) {
        const L = _ + R, J = B + R;
        M === true ? c.push(J, J + 1, L) : c.push(J + 1, J, L), S += 3;
      }
      h.addGroup(g, S, M === true ? 1 : 2), g += S;
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _cs(t.radiusTop, t.radiusBottom, t.height, t.radialSegments, t.heightSegments, t.openEnded, t.thetaStart, t.thetaLength);
  }
};
var us = class _us extends cs {
  constructor(t = 1, e = 1, i = 32, s = 1, n = false, r = 0, a = Math.PI * 2) {
    super(0, t, e, i, s, n, r, a), this.type = "ConeGeometry", this.parameters = { radius: t, height: e, radialSegments: i, heightSegments: s, openEnded: n, thetaStart: r, thetaLength: a };
  }
  static fromJSON(t) {
    return new _us(t.radius, t.height, t.radialSegments, t.heightSegments, t.openEnded, t.thetaStart, t.thetaLength);
  }
};
var ke = class _ke extends H {
  constructor(t = [], e = [], i = 1, s = 0) {
    super(), this.type = "PolyhedronGeometry", this.parameters = { vertices: t, indices: e, radius: i, detail: s };
    const n = [], r = [];
    a(s), h(i), c(), this.setAttribute("position", new P(n, 3)), this.setAttribute("normal", new P(n.slice(), 3)), this.setAttribute("uv", new P(r, 2)), s === 0 ? this.computeVertexNormals() : this.normalizeNormals();
    function a(x) {
      const b = new w(), M = new w(), _ = new w();
      for (let v = 0; v < e.length; v += 3) p(e[v + 0], b), p(e[v + 1], M), p(e[v + 2], _), o(b, M, _, x);
    }
    function o(x, b, M, _) {
      const v = _ + 1, A = [];
      for (let S = 0; S <= v; S++) {
        A[S] = [];
        const T = x.clone().lerp(M, S / v), C = b.clone().lerp(M, S / v), B = v - S;
        for (let R = 0; R <= B; R++) R === 0 && S === v ? A[S][R] = T : A[S][R] = T.clone().lerp(C, R / B);
      }
      for (let S = 0; S < v; S++) for (let T = 0; T < 2 * (v - S) - 1; T++) {
        const C = Math.floor(T / 2);
        T % 2 === 0 ? (d(A[S][C + 1]), d(A[S + 1][C]), d(A[S][C])) : (d(A[S][C + 1]), d(A[S + 1][C + 1]), d(A[S + 1][C]));
      }
    }
    function h(x) {
      const b = new w();
      for (let M = 0; M < n.length; M += 3) b.x = n[M + 0], b.y = n[M + 1], b.z = n[M + 2], b.normalize().multiplyScalar(x), n[M + 0] = b.x, n[M + 1] = b.y, n[M + 2] = b.z;
    }
    function c() {
      const x = new w();
      for (let b = 0; b < n.length; b += 3) {
        x.x = n[b + 0], x.y = n[b + 1], x.z = n[b + 2];
        const M = y(x) / 2 / Math.PI + 0.5, _ = g(x) / Math.PI + 0.5;
        r.push(M, 1 - _);
      }
      f(), u();
    }
    function u() {
      for (let x = 0; x < r.length; x += 6) {
        const b = r[x + 0], M = r[x + 2], _ = r[x + 4], v = Math.max(b, M, _), A = Math.min(b, M, _);
        v > 0.9 && A < 0.1 && (b < 0.2 && (r[x + 0] += 1), M < 0.2 && (r[x + 2] += 1), _ < 0.2 && (r[x + 4] += 1));
      }
    }
    function d(x) {
      n.push(x.x, x.y, x.z);
    }
    function p(x, b) {
      const M = x * 3;
      b.x = t[M + 0], b.y = t[M + 1], b.z = t[M + 2];
    }
    function f() {
      const x = new w(), b = new w(), M = new w(), _ = new w(), v = new I(), A = new I(), S = new I();
      for (let T = 0, C = 0; T < n.length; T += 9, C += 6) {
        x.set(n[T + 0], n[T + 1], n[T + 2]), b.set(n[T + 3], n[T + 4], n[T + 5]), M.set(n[T + 6], n[T + 7], n[T + 8]), v.set(r[C + 0], r[C + 1]), A.set(r[C + 2], r[C + 3]), S.set(r[C + 4], r[C + 5]), _.copy(x).add(b).add(M).divideScalar(3);
        const B = y(_);
        m(v, C + 0, x, B), m(A, C + 2, b, B), m(S, C + 4, M, B);
      }
    }
    function m(x, b, M, _) {
      _ < 0 && x.x === 1 && (r[b] = x.x - 1), M.x === 0 && M.z === 0 && (r[b] = _ / 2 / Math.PI + 0.5);
    }
    function y(x) {
      return Math.atan2(x.z, -x.x);
    }
    function g(x) {
      return Math.atan2(-x.y, Math.sqrt(x.x * x.x + x.z * x.z));
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _ke(t.vertices, t.indices, t.radius, t.detail);
  }
};
var Ln = class _Ln extends ke {
  constructor(t = 1, e = 0) {
    const i = (1 + Math.sqrt(5)) / 2, s = 1 / i, n = [-1, -1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1, 0, -s, -i, 0, -s, i, 0, s, -i, 0, s, i, -s, -i, 0, -s, i, 0, s, -i, 0, s, i, 0, -i, 0, -s, i, 0, -s, -i, 0, s, i, 0, s], r = [3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15, 17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10, 0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15, 2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3, 4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7, 19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9];
    super(n, r, t, e), this.type = "DodecahedronGeometry", this.parameters = { radius: t, detail: e };
  }
  static fromJSON(t) {
    return new _Ln(t.radius, t.detail);
  }
};
var cn = new w();
var un = new w();
var Zr = new w();
var dn = new kt();
var Yh = class extends H {
  constructor(t = null, e = 1) {
    if (super(), this.type = "EdgesGeometry", this.parameters = { geometry: t, thresholdAngle: e }, t !== null) {
      const s = Math.pow(10, 4), n = Math.cos(Ve * e), r = t.getIndex(), a = t.getAttribute("position"), o = r ? r.count : a.count, h = [0, 0, 0], c = ["a", "b", "c"], u = new Array(3), d = {}, p = [];
      for (let f = 0; f < o; f += 3) {
        r ? (h[0] = r.getX(f), h[1] = r.getX(f + 1), h[2] = r.getX(f + 2)) : (h[0] = f, h[1] = f + 1, h[2] = f + 2);
        const { a: m, b: y, c: g } = dn;
        if (m.fromBufferAttribute(a, h[0]), y.fromBufferAttribute(a, h[1]), g.fromBufferAttribute(a, h[2]), dn.getNormal(Zr), u[0] = `${Math.round(m.x * s)},${Math.round(m.y * s)},${Math.round(m.z * s)}`, u[1] = `${Math.round(y.x * s)},${Math.round(y.y * s)},${Math.round(y.z * s)}`, u[2] = `${Math.round(g.x * s)},${Math.round(g.y * s)},${Math.round(g.z * s)}`, !(u[0] === u[1] || u[1] === u[2] || u[2] === u[0])) for (let x = 0; x < 3; x++) {
          const b = (x + 1) % 3, M = u[x], _ = u[b], v = dn[c[x]], A = dn[c[b]], S = `${M}_${_}`, T = `${_}_${M}`;
          T in d && d[T] ? (Zr.dot(d[T].normal) <= n && (p.push(v.x, v.y, v.z), p.push(A.x, A.y, A.z)), d[T] = null) : S in d || (d[S] = { index0: h[x], index1: h[b], normal: Zr.clone() });
        }
      }
      for (const f in d) if (d[f]) {
        const { index0: m, index1: y } = d[f];
        cn.fromBufferAttribute(a, m), un.fromBufferAttribute(a, y), p.push(cn.x, cn.y, cn.z), p.push(un.x, un.y, un.z);
      }
      this.setAttribute("position", new P(p, 3));
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
};
var Qt = class {
  constructor() {
    this.type = "Curve", this.arcLengthDivisions = 200, this.needsUpdate = false, this.cacheArcLengths = null;
  }
  getPoint() {
    V("Curve: .getPoint() not implemented.");
  }
  getPointAt(t, e) {
    const i = this.getUtoTmapping(t);
    return this.getPoint(i, e);
  }
  getPoints(t = 5) {
    const e = [];
    for (let i = 0; i <= t; i++) e.push(this.getPoint(i / t));
    return e;
  }
  getSpacedPoints(t = 5) {
    const e = [];
    for (let i = 0; i <= t; i++) e.push(this.getPointAt(i / t));
    return e;
  }
  getLength() {
    const t = this.getLengths();
    return t[t.length - 1];
  }
  getLengths(t = this.arcLengthDivisions) {
    if (this.cacheArcLengths && this.cacheArcLengths.length === t + 1 && !this.needsUpdate) return this.cacheArcLengths;
    this.needsUpdate = false;
    const e = [];
    let i, s = this.getPoint(0), n = 0;
    e.push(0);
    for (let r = 1; r <= t; r++) i = this.getPoint(r / t), n += i.distanceTo(s), e.push(n), s = i;
    return this.cacheArcLengths = e, e;
  }
  updateArcLengths() {
    this.needsUpdate = true, this.getLengths();
  }
  getUtoTmapping(t, e = null) {
    const i = this.getLengths();
    let s = 0;
    const n = i.length;
    let r;
    e ? r = e : r = t * i[n - 1];
    let a = 0, o = n - 1, h;
    for (; a <= o; ) if (s = Math.floor(a + (o - a) / 2), h = i[s] - r, h < 0) a = s + 1;
    else if (h > 0) o = s - 1;
    else {
      o = s;
      break;
    }
    if (s = o, i[s] === r) return s / (n - 1);
    const c = i[s], d = i[s + 1] - c, p = (r - c) / d;
    return (s + p) / (n - 1);
  }
  getTangent(t, e) {
    let s = t - 1e-4, n = t + 1e-4;
    s < 0 && (s = 0), n > 1 && (n = 1);
    const r = this.getPoint(s), a = this.getPoint(n), o = e || (r.isVector2 ? new I() : new w());
    return o.copy(a).sub(r).normalize(), o;
  }
  getTangentAt(t, e) {
    const i = this.getUtoTmapping(t);
    return this.getTangent(i, e);
  }
  computeFrenetFrames(t, e = false) {
    const i = new w(), s = [], n = [], r = [], a = new w(), o = new G();
    for (let p = 0; p <= t; p++) {
      const f = p / t;
      s[p] = this.getTangentAt(f, new w());
    }
    n[0] = new w(), r[0] = new w();
    let h = Number.MAX_VALUE;
    const c = Math.abs(s[0].x), u = Math.abs(s[0].y), d = Math.abs(s[0].z);
    c <= h && (h = c, i.set(1, 0, 0)), u <= h && (h = u, i.set(0, 1, 0)), d <= h && i.set(0, 0, 1), a.crossVectors(s[0], i).normalize(), n[0].crossVectors(s[0], a), r[0].crossVectors(s[0], n[0]);
    for (let p = 1; p <= t; p++) {
      if (n[p] = n[p - 1].clone(), r[p] = r[p - 1].clone(), a.crossVectors(s[p - 1], s[p]), a.length() > Number.EPSILON) {
        a.normalize();
        const f = Math.acos(D(s[p - 1].dot(s[p]), -1, 1));
        n[p].applyMatrix4(o.makeRotationAxis(a, f));
      }
      r[p].crossVectors(s[p], n[p]);
    }
    if (e === true) {
      let p = Math.acos(D(n[0].dot(n[t]), -1, 1));
      p /= t, s[0].dot(a.crossVectors(n[0], n[t])) > 0 && (p = -p);
      for (let f = 1; f <= t; f++) n[f].applyMatrix4(o.makeRotationAxis(s[f], p * f)), r[f].crossVectors(s[f], n[f]);
    }
    return { tangents: s, normals: n, binormals: r };
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(t) {
    return this.arcLengthDivisions = t.arcLengthDivisions, this;
  }
  toJSON() {
    const t = { metadata: { version: 4.7, type: "Curve", generator: "Curve.toJSON" } };
    return t.arcLengthDivisions = this.arcLengthDivisions, t.type = this.type, t;
  }
  fromJSON(t) {
    return this.arcLengthDivisions = t.arcLengthDivisions, this;
  }
};
var pn = class extends Qt {
  constructor(t = 0, e = 0, i = 1, s = 1, n = 0, r = Math.PI * 2, a = false, o = 0) {
    super(), this.isEllipseCurve = true, this.type = "EllipseCurve", this.aX = t, this.aY = e, this.xRadius = i, this.yRadius = s, this.aStartAngle = n, this.aEndAngle = r, this.aClockwise = a, this.aRotation = o;
  }
  getPoint(t, e = new I()) {
    const i = e, s = Math.PI * 2;
    let n = this.aEndAngle - this.aStartAngle;
    const r = Math.abs(n) < Number.EPSILON;
    for (; n < 0; ) n += s;
    for (; n > s; ) n -= s;
    n < Number.EPSILON && (r ? n = 0 : n = s), this.aClockwise === true && !r && (n === s ? n = -s : n = n - s);
    const a = this.aStartAngle + t * n;
    let o = this.aX + this.xRadius * Math.cos(a), h = this.aY + this.yRadius * Math.sin(a);
    if (this.aRotation !== 0) {
      const c = Math.cos(this.aRotation), u = Math.sin(this.aRotation), d = o - this.aX, p = h - this.aY;
      o = d * c - p * u + this.aX, h = d * u + p * c + this.aY;
    }
    return i.set(o, h);
  }
  copy(t) {
    return super.copy(t), this.aX = t.aX, this.aY = t.aY, this.xRadius = t.xRadius, this.yRadius = t.yRadius, this.aStartAngle = t.aStartAngle, this.aEndAngle = t.aEndAngle, this.aClockwise = t.aClockwise, this.aRotation = t.aRotation, this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.aX = this.aX, t.aY = this.aY, t.xRadius = this.xRadius, t.yRadius = this.yRadius, t.aStartAngle = this.aStartAngle, t.aEndAngle = this.aEndAngle, t.aClockwise = this.aClockwise, t.aRotation = this.aRotation, t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.aX = t.aX, this.aY = t.aY, this.xRadius = t.xRadius, this.yRadius = t.yRadius, this.aStartAngle = t.aStartAngle, this.aEndAngle = t.aEndAngle, this.aClockwise = t.aClockwise, this.aRotation = t.aRotation, this;
  }
};
var Zh = class extends pn {
  constructor(t, e, i, s, n, r) {
    super(t, e, i, i, s, n, r), this.isArcCurve = true, this.type = "ArcCurve";
  }
};
function $r() {
  let l = 0, t = 0, e = 0, i = 0;
  function s(n, r, a, o) {
    l = n, t = a, e = -3 * n + 3 * r - 2 * a - o, i = 2 * n - 2 * r + a + o;
  }
  return { initCatmullRom: function(n, r, a, o, h) {
    s(r, a, h * (a - n), h * (o - r));
  }, initNonuniformCatmullRom: function(n, r, a, o, h, c, u) {
    let d = (r - n) / h - (a - n) / (h + c) + (a - r) / c, p = (a - r) / c - (o - r) / (c + u) + (o - a) / u;
    d *= c, p *= c, s(r, a, d, p);
  }, calc: function(n) {
    const r = n * n, a = r * n;
    return l + t * n + e * r + i * a;
  } };
}
var $h = new w();
var Qh = new w();
var Qr = new $r();
var jr = new $r();
var Kr = new $r();
var jh = class extends Qt {
  constructor(t = [], e = false, i = "centripetal", s = 0.5) {
    super(), this.isCatmullRomCurve3 = true, this.type = "CatmullRomCurve3", this.points = t, this.closed = e, this.curveType = i, this.tension = s;
  }
  getPoint(t, e = new w()) {
    const i = e, s = this.points, n = s.length, r = (n - (this.closed ? 0 : 1)) * t;
    let a = Math.floor(r), o = r - a;
    this.closed ? a += a > 0 ? 0 : (Math.floor(Math.abs(a) / n) + 1) * n : o === 0 && a === n - 1 && (a = n - 2, o = 1);
    let h, c;
    this.closed || a > 0 ? h = s[(a - 1) % n] : (Qh.subVectors(s[0], s[1]).add(s[0]), h = Qh);
    const u = s[a % n], d = s[(a + 1) % n];
    if (this.closed || a + 2 < n ? c = s[(a + 2) % n] : ($h.subVectors(s[n - 1], s[n - 2]).add(s[n - 1]), c = $h), this.curveType === "centripetal" || this.curveType === "chordal") {
      const p = this.curveType === "chordal" ? 0.5 : 0.25;
      let f = Math.pow(h.distanceToSquared(u), p), m = Math.pow(u.distanceToSquared(d), p), y = Math.pow(d.distanceToSquared(c), p);
      m < 1e-4 && (m = 1), f < 1e-4 && (f = m), y < 1e-4 && (y = m), Qr.initNonuniformCatmullRom(h.x, u.x, d.x, c.x, f, m, y), jr.initNonuniformCatmullRom(h.y, u.y, d.y, c.y, f, m, y), Kr.initNonuniformCatmullRom(h.z, u.z, d.z, c.z, f, m, y);
    } else this.curveType === "catmullrom" && (Qr.initCatmullRom(h.x, u.x, d.x, c.x, this.tension), jr.initCatmullRom(h.y, u.y, d.y, c.y, this.tension), Kr.initCatmullRom(h.z, u.z, d.z, c.z, this.tension));
    return i.set(Qr.calc(o), jr.calc(o), Kr.calc(o)), i;
  }
  copy(t) {
    super.copy(t), this.points = [];
    for (let e = 0, i = t.points.length; e < i; e++) {
      const s = t.points[e];
      this.points.push(s.clone());
    }
    return this.closed = t.closed, this.curveType = t.curveType, this.tension = t.tension, this;
  }
  toJSON() {
    const t = super.toJSON();
    t.points = [];
    for (let e = 0, i = this.points.length; e < i; e++) {
      const s = this.points[e];
      t.points.push(s.toArray());
    }
    return t.closed = this.closed, t.curveType = this.curveType, t.tension = this.tension, t;
  }
  fromJSON(t) {
    super.fromJSON(t), this.points = [];
    for (let e = 0, i = t.points.length; e < i; e++) {
      const s = t.points[e];
      this.points.push(new w().fromArray(s));
    }
    return this.closed = t.closed, this.curveType = t.curveType, this.tension = t.tension, this;
  }
};
function Kh(l, t, e, i, s) {
  const n = (i - t) * 0.5, r = (s - e) * 0.5, a = l * l, o = l * a;
  return (2 * e - 2 * i + n + r) * o + (-3 * e + 3 * i - 2 * n - r) * a + n * l + e;
}
function Bp(l, t) {
  const e = 1 - l;
  return e * e * t;
}
function Fp(l, t) {
  return 2 * (1 - l) * l * t;
}
function kp(l, t) {
  return l * l * t;
}
function Ki(l, t, e, i) {
  return Bp(l, t) + Fp(l, e) + kp(l, i);
}
function Pp(l, t) {
  const e = 1 - l;
  return e * e * e * t;
}
function Rp(l, t) {
  const e = 1 - l;
  return 3 * e * e * l * t;
}
function Op(l, t) {
  return 3 * (1 - l) * l * l * t;
}
function Ep(l, t) {
  return l * l * l * t;
}
function ts(l, t, e, i, s) {
  return Pp(l, t) + Rp(l, e) + Op(l, i) + Ep(l, s);
}
var ta = class extends Qt {
  constructor(t = new I(), e = new I(), i = new I(), s = new I()) {
    super(), this.isCubicBezierCurve = true, this.type = "CubicBezierCurve", this.v0 = t, this.v1 = e, this.v2 = i, this.v3 = s;
  }
  getPoint(t, e = new I()) {
    const i = e, s = this.v0, n = this.v1, r = this.v2, a = this.v3;
    return i.set(ts(t, s.x, n.x, r.x, a.x), ts(t, s.y, n.y, r.y, a.y)), i;
  }
  copy(t) {
    return super.copy(t), this.v0.copy(t.v0), this.v1.copy(t.v1), this.v2.copy(t.v2), this.v3.copy(t.v3), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.v0 = this.v0.toArray(), t.v1 = this.v1.toArray(), t.v2 = this.v2.toArray(), t.v3 = this.v3.toArray(), t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.v0.fromArray(t.v0), this.v1.fromArray(t.v1), this.v2.fromArray(t.v2), this.v3.fromArray(t.v3), this;
  }
};
var tl = class extends Qt {
  constructor(t = new w(), e = new w(), i = new w(), s = new w()) {
    super(), this.isCubicBezierCurve3 = true, this.type = "CubicBezierCurve3", this.v0 = t, this.v1 = e, this.v2 = i, this.v3 = s;
  }
  getPoint(t, e = new w()) {
    const i = e, s = this.v0, n = this.v1, r = this.v2, a = this.v3;
    return i.set(ts(t, s.x, n.x, r.x, a.x), ts(t, s.y, n.y, r.y, a.y), ts(t, s.z, n.z, r.z, a.z)), i;
  }
  copy(t) {
    return super.copy(t), this.v0.copy(t.v0), this.v1.copy(t.v1), this.v2.copy(t.v2), this.v3.copy(t.v3), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.v0 = this.v0.toArray(), t.v1 = this.v1.toArray(), t.v2 = this.v2.toArray(), t.v3 = this.v3.toArray(), t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.v0.fromArray(t.v0), this.v1.fromArray(t.v1), this.v2.fromArray(t.v2), this.v3.fromArray(t.v3), this;
  }
};
var ea = class extends Qt {
  constructor(t = new I(), e = new I()) {
    super(), this.isLineCurve = true, this.type = "LineCurve", this.v1 = t, this.v2 = e;
  }
  getPoint(t, e = new I()) {
    const i = e;
    return t === 1 ? i.copy(this.v2) : (i.copy(this.v2).sub(this.v1), i.multiplyScalar(t).add(this.v1)), i;
  }
  getPointAt(t, e) {
    return this.getPoint(t, e);
  }
  getTangent(t, e = new I()) {
    return e.subVectors(this.v2, this.v1).normalize();
  }
  getTangentAt(t, e) {
    return this.getTangent(t, e);
  }
  copy(t) {
    return super.copy(t), this.v1.copy(t.v1), this.v2.copy(t.v2), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.v1 = this.v1.toArray(), t.v2 = this.v2.toArray(), t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.v1.fromArray(t.v1), this.v2.fromArray(t.v2), this;
  }
};
var el = class extends Qt {
  constructor(t = new w(), e = new w()) {
    super(), this.isLineCurve3 = true, this.type = "LineCurve3", this.v1 = t, this.v2 = e;
  }
  getPoint(t, e = new w()) {
    const i = e;
    return t === 1 ? i.copy(this.v2) : (i.copy(this.v2).sub(this.v1), i.multiplyScalar(t).add(this.v1)), i;
  }
  getPointAt(t, e) {
    return this.getPoint(t, e);
  }
  getTangent(t, e = new w()) {
    return e.subVectors(this.v2, this.v1).normalize();
  }
  getTangentAt(t, e) {
    return this.getTangent(t, e);
  }
  copy(t) {
    return super.copy(t), this.v1.copy(t.v1), this.v2.copy(t.v2), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.v1 = this.v1.toArray(), t.v2 = this.v2.toArray(), t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.v1.fromArray(t.v1), this.v2.fromArray(t.v2), this;
  }
};
var ia = class extends Qt {
  constructor(t = new I(), e = new I(), i = new I()) {
    super(), this.isQuadraticBezierCurve = true, this.type = "QuadraticBezierCurve", this.v0 = t, this.v1 = e, this.v2 = i;
  }
  getPoint(t, e = new I()) {
    const i = e, s = this.v0, n = this.v1, r = this.v2;
    return i.set(Ki(t, s.x, n.x, r.x), Ki(t, s.y, n.y, r.y)), i;
  }
  copy(t) {
    return super.copy(t), this.v0.copy(t.v0), this.v1.copy(t.v1), this.v2.copy(t.v2), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.v0 = this.v0.toArray(), t.v1 = this.v1.toArray(), t.v2 = this.v2.toArray(), t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.v0.fromArray(t.v0), this.v1.fromArray(t.v1), this.v2.fromArray(t.v2), this;
  }
};
var sa = class extends Qt {
  constructor(t = new w(), e = new w(), i = new w()) {
    super(), this.isQuadraticBezierCurve3 = true, this.type = "QuadraticBezierCurve3", this.v0 = t, this.v1 = e, this.v2 = i;
  }
  getPoint(t, e = new w()) {
    const i = e, s = this.v0, n = this.v1, r = this.v2;
    return i.set(Ki(t, s.x, n.x, r.x), Ki(t, s.y, n.y, r.y), Ki(t, s.z, n.z, r.z)), i;
  }
  copy(t) {
    return super.copy(t), this.v0.copy(t.v0), this.v1.copy(t.v1), this.v2.copy(t.v2), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.v0 = this.v0.toArray(), t.v1 = this.v1.toArray(), t.v2 = this.v2.toArray(), t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.v0.fromArray(t.v0), this.v1.fromArray(t.v1), this.v2.fromArray(t.v2), this;
  }
};
var na = class extends Qt {
  constructor(t = []) {
    super(), this.isSplineCurve = true, this.type = "SplineCurve", this.points = t;
  }
  getPoint(t, e = new I()) {
    const i = e, s = this.points, n = (s.length - 1) * t, r = Math.floor(n), a = n - r, o = s[r === 0 ? r : r - 1], h = s[r], c = s[r > s.length - 2 ? s.length - 1 : r + 1], u = s[r > s.length - 3 ? s.length - 1 : r + 2];
    return i.set(Kh(a, o.x, h.x, c.x, u.x), Kh(a, o.y, h.y, c.y, u.y)), i;
  }
  copy(t) {
    super.copy(t), this.points = [];
    for (let e = 0, i = t.points.length; e < i; e++) {
      const s = t.points[e];
      this.points.push(s.clone());
    }
    return this;
  }
  toJSON() {
    const t = super.toJSON();
    t.points = [];
    for (let e = 0, i = this.points.length; e < i; e++) {
      const s = this.points[e];
      t.points.push(s.toArray());
    }
    return t;
  }
  fromJSON(t) {
    super.fromJSON(t), this.points = [];
    for (let e = 0, i = t.points.length; e < i; e++) {
      const s = t.points[e];
      this.points.push(new I().fromArray(s));
    }
    return this;
  }
};
var fn = Object.freeze({ __proto__: null, ArcCurve: Zh, CatmullRomCurve3: jh, CubicBezierCurve: ta, CubicBezierCurve3: tl, EllipseCurve: pn, LineCurve: ea, LineCurve3: el, QuadraticBezierCurve: ia, QuadraticBezierCurve3: sa, SplineCurve: na });
var il = class extends Qt {
  constructor() {
    super(), this.type = "CurvePath", this.curves = [], this.autoClose = false;
  }
  add(t) {
    this.curves.push(t);
  }
  closePath() {
    const t = this.curves[0].getPoint(0), e = this.curves[this.curves.length - 1].getPoint(1);
    if (!t.equals(e)) {
      const i = t.isVector2 === true ? "LineCurve" : "LineCurve3";
      this.curves.push(new fn[i](e, t));
    }
    return this;
  }
  getPoint(t, e) {
    const i = t * this.getLength(), s = this.getCurveLengths();
    let n = 0;
    for (; n < s.length; ) {
      if (s[n] >= i) {
        const r = s[n] - i, a = this.curves[n], o = a.getLength(), h = o === 0 ? 0 : 1 - r / o;
        return a.getPointAt(h, e);
      }
      n++;
    }
    return null;
  }
  getLength() {
    const t = this.getCurveLengths();
    return t[t.length - 1];
  }
  updateArcLengths() {
    this.needsUpdate = true, this.cacheLengths = null, this.getCurveLengths();
  }
  getCurveLengths() {
    if (this.cacheLengths && this.cacheLengths.length === this.curves.length) return this.cacheLengths;
    const t = [];
    let e = 0;
    for (let i = 0, s = this.curves.length; i < s; i++) e += this.curves[i].getLength(), t.push(e);
    return this.cacheLengths = t, t;
  }
  getSpacedPoints(t = 40) {
    const e = [];
    for (let i = 0; i <= t; i++) e.push(this.getPoint(i / t));
    return this.autoClose && e.push(e[0]), e;
  }
  getPoints(t = 12) {
    const e = [];
    let i;
    for (let s = 0, n = this.curves; s < n.length; s++) {
      const r = n[s], a = r.isEllipseCurve ? t * 2 : r.isLineCurve || r.isLineCurve3 ? 1 : r.isSplineCurve ? t * r.points.length : t, o = r.getPoints(a);
      for (let h = 0; h < o.length; h++) {
        const c = o[h];
        i && i.equals(c) || (e.push(c), i = c);
      }
    }
    return this.autoClose && e.length > 1 && !e[e.length - 1].equals(e[0]) && e.push(e[0]), e;
  }
  copy(t) {
    super.copy(t), this.curves = [];
    for (let e = 0, i = t.curves.length; e < i; e++) {
      const s = t.curves[e];
      this.curves.push(s.clone());
    }
    return this.autoClose = t.autoClose, this;
  }
  toJSON() {
    const t = super.toJSON();
    t.autoClose = this.autoClose, t.curves = [];
    for (let e = 0, i = this.curves.length; e < i; e++) {
      const s = this.curves[e];
      t.curves.push(s.toJSON());
    }
    return t;
  }
  fromJSON(t) {
    super.fromJSON(t), this.autoClose = t.autoClose, this.curves = [];
    for (let e = 0, i = t.curves.length; e < i; e++) {
      const s = t.curves[e];
      this.curves.push(new fn[s.type]().fromJSON(s));
    }
    return this;
  }
};
var es = class extends il {
  constructor(t) {
    super(), this.type = "Path", this.currentPoint = new I(), t && this.setFromPoints(t);
  }
  setFromPoints(t) {
    this.moveTo(t[0].x, t[0].y);
    for (let e = 1, i = t.length; e < i; e++) this.lineTo(t[e].x, t[e].y);
    return this;
  }
  moveTo(t, e) {
    return this.currentPoint.set(t, e), this;
  }
  lineTo(t, e) {
    const i = new ea(this.currentPoint.clone(), new I(t, e));
    return this.curves.push(i), this.currentPoint.set(t, e), this;
  }
  quadraticCurveTo(t, e, i, s) {
    const n = new ia(this.currentPoint.clone(), new I(t, e), new I(i, s));
    return this.curves.push(n), this.currentPoint.set(i, s), this;
  }
  bezierCurveTo(t, e, i, s, n, r) {
    const a = new ta(this.currentPoint.clone(), new I(t, e), new I(i, s), new I(n, r));
    return this.curves.push(a), this.currentPoint.set(n, r), this;
  }
  splineThru(t) {
    const e = [this.currentPoint.clone()].concat(t), i = new na(e);
    return this.curves.push(i), this.currentPoint.copy(t[t.length - 1]), this;
  }
  arc(t, e, i, s, n, r) {
    const a = this.currentPoint.x, o = this.currentPoint.y;
    return this.absarc(t + a, e + o, i, s, n, r), this;
  }
  absarc(t, e, i, s, n, r) {
    return this.absellipse(t, e, i, i, s, n, r), this;
  }
  ellipse(t, e, i, s, n, r, a, o) {
    const h = this.currentPoint.x, c = this.currentPoint.y;
    return this.absellipse(t + h, e + c, i, s, n, r, a, o), this;
  }
  absellipse(t, e, i, s, n, r, a, o) {
    const h = new pn(t, e, i, s, n, r, a, o);
    if (this.curves.length > 0) {
      const u = h.getPoint(0);
      u.equals(this.currentPoint) || this.lineTo(u.x, u.y);
    }
    this.curves.push(h);
    const c = h.getPoint(1);
    return this.currentPoint.copy(c), this;
  }
  copy(t) {
    return super.copy(t), this.currentPoint.copy(t.currentPoint), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.currentPoint = this.currentPoint.toArray(), t;
  }
  fromJSON(t) {
    return super.fromJSON(t), this.currentPoint.fromArray(t.currentPoint), this;
  }
};
var is = class extends es {
  constructor(t) {
    super(t), this.uuid = Nt(), this.type = "Shape", this.holes = [];
  }
  getPointsHoles(t) {
    const e = [];
    for (let i = 0, s = this.holes.length; i < s; i++) e[i] = this.holes[i].getPoints(t);
    return e;
  }
  extractPoints(t) {
    return { shape: this.getPoints(t), holes: this.getPointsHoles(t) };
  }
  copy(t) {
    super.copy(t), this.holes = [];
    for (let e = 0, i = t.holes.length; e < i; e++) {
      const s = t.holes[e];
      this.holes.push(s.clone());
    }
    return this;
  }
  toJSON() {
    const t = super.toJSON();
    t.uuid = this.uuid, t.holes = [];
    for (let e = 0, i = this.holes.length; e < i; e++) {
      const s = this.holes[e];
      t.holes.push(s.toJSON());
    }
    return t;
  }
  fromJSON(t) {
    super.fromJSON(t), this.uuid = t.uuid, this.holes = [];
    for (let e = 0, i = t.holes.length; e < i; e++) {
      const s = t.holes[e];
      this.holes.push(new es().fromJSON(s));
    }
    return this;
  }
};
function Np(l, t, e = 2) {
  const i = t && t.length, s = i ? t[0] * e : l.length;
  let n = sl(l, 0, s, e, true);
  const r = [];
  if (!n || n.next === n.prev) return r;
  let a, o, h;
  if (i && (n = Wp(l, t, n, e)), l.length > 80 * e) {
    a = l[0], o = l[1];
    let c = a, u = o;
    for (let d = e; d < s; d += e) {
      const p = l[d], f = l[d + 1];
      p < a && (a = p), f < o && (o = f), p > c && (c = p), f > u && (u = f);
    }
    h = Math.max(c - a, u - o), h = h !== 0 ? 32767 / h : 0;
  }
  return ss(n, r, e, a, o, h, 0), r;
}
function sl(l, t, e, i, s) {
  let n;
  if (s === Kp(l, t, e, i) > 0) for (let r = t; r < e; r += i) n = ol(r / i | 0, l[r], l[r + 1], n);
  else for (let r = e - i; r >= t; r -= i) n = ol(r / i | 0, l[r], l[r + 1], n);
  return n && Ai(n, n.next) && (as(n), n = n.next), n;
}
function Xe(l, t) {
  if (!l) return l;
  t || (t = l);
  let e = l, i;
  do
    if (i = false, !e.steiner && (Ai(e, e.next) || rt(e.prev, e, e.next) === 0)) {
      if (as(e), e = t = e.prev, e === e.next) break;
      i = true;
    } else e = e.next;
  while (i || e !== t);
  return t;
}
function ss(l, t, e, i, s, n, r) {
  if (!l) return;
  !r && n && Xp(l, i, s, n);
  let a = l;
  for (; l.prev !== l.next; ) {
    const o = l.prev, h = l.next;
    if (n ? Vp(l, i, s, n) : Lp(l)) {
      t.push(o.i, l.i, h.i), as(l), l = h.next, a = h.next;
      continue;
    }
    if (l = h, l === a) {
      r ? r === 1 ? (l = Dp(Xe(l), t), ss(l, t, e, i, s, n, 2)) : r === 2 && Up(l, t, e, i, s, n) : ss(Xe(l), t, e, i, s, n, 1);
      break;
    }
  }
}
function Lp(l) {
  const t = l.prev, e = l, i = l.next;
  if (rt(t, e, i) >= 0) return false;
  const s = t.x, n = e.x, r = i.x, a = t.y, o = e.y, h = i.y, c = Math.min(s, n, r), u = Math.min(a, o, h), d = Math.max(s, n, r), p = Math.max(a, o, h);
  let f = i.next;
  for (; f !== t; ) {
    if (f.x >= c && f.x <= d && f.y >= u && f.y <= p && ns(s, a, n, o, r, h, f.x, f.y) && rt(f.prev, f, f.next) >= 0) return false;
    f = f.next;
  }
  return true;
}
function Vp(l, t, e, i) {
  const s = l.prev, n = l, r = l.next;
  if (rt(s, n, r) >= 0) return false;
  const a = s.x, o = n.x, h = r.x, c = s.y, u = n.y, d = r.y, p = Math.min(a, o, h), f = Math.min(c, u, d), m = Math.max(a, o, h), y = Math.max(c, u, d), g = ra(p, f, t, e, i), x = ra(m, y, t, e, i);
  let b = l.prevZ, M = l.nextZ;
  for (; b && b.z >= g && M && M.z <= x; ) {
    if (b.x >= p && b.x <= m && b.y >= f && b.y <= y && b !== s && b !== r && ns(a, c, o, u, h, d, b.x, b.y) && rt(b.prev, b, b.next) >= 0 || (b = b.prevZ, M.x >= p && M.x <= m && M.y >= f && M.y <= y && M !== s && M !== r && ns(a, c, o, u, h, d, M.x, M.y) && rt(M.prev, M, M.next) >= 0)) return false;
    M = M.nextZ;
  }
  for (; b && b.z >= g; ) {
    if (b.x >= p && b.x <= m && b.y >= f && b.y <= y && b !== s && b !== r && ns(a, c, o, u, h, d, b.x, b.y) && rt(b.prev, b, b.next) >= 0) return false;
    b = b.prevZ;
  }
  for (; M && M.z <= x; ) {
    if (M.x >= p && M.x <= m && M.y >= f && M.y <= y && M !== s && M !== r && ns(a, c, o, u, h, d, M.x, M.y) && rt(M.prev, M, M.next) >= 0) return false;
    M = M.nextZ;
  }
  return true;
}
function Dp(l, t) {
  let e = l;
  do {
    const i = e.prev, s = e.next.next;
    !Ai(i, s) && rl(i, e, e.next, s) && rs(i, s) && rs(s, i) && (t.push(i.i, e.i, s.i), as(e), as(e.next), e = l = s), e = e.next;
  } while (e !== l);
  return Xe(e);
}
function Up(l, t, e, i, s, n) {
  let r = l;
  do {
    let a = r.next.next;
    for (; a !== r.prev; ) {
      if (r.i !== a.i && $p(r, a)) {
        let o = al(r, a);
        r = Xe(r, r.next), o = Xe(o, o.next), ss(r, t, e, i, s, n, 0), ss(o, t, e, i, s, n, 0);
        return;
      }
      a = a.next;
    }
    r = r.next;
  } while (r !== l);
}
function Wp(l, t, e, i) {
  const s = [];
  for (let n = 0, r = t.length; n < r; n++) {
    const a = t[n] * i, o = n < r - 1 ? t[n + 1] * i : l.length, h = sl(l, a, o, i, false);
    h === h.next && (h.steiner = true), s.push(Zp(h));
  }
  s.sort(Gp);
  for (let n = 0; n < s.length; n++) e = Hp(s[n], e);
  return e;
}
function Gp(l, t) {
  let e = l.x - t.x;
  if (e === 0 && (e = l.y - t.y, e === 0)) {
    const i = (l.next.y - l.y) / (l.next.x - l.x), s = (t.next.y - t.y) / (t.next.x - t.x);
    e = i - s;
  }
  return e;
}
function Hp(l, t) {
  const e = qp(l, t);
  if (!e) return t;
  const i = al(e, l);
  return Xe(i, i.next), Xe(e, e.next);
}
function qp(l, t) {
  let e = t;
  const i = l.x, s = l.y;
  let n = -1 / 0, r;
  if (Ai(l, e)) return e;
  do {
    if (Ai(l, e.next)) return e.next;
    if (s <= e.y && s >= e.next.y && e.next.y !== e.y) {
      const u = e.x + (s - e.y) * (e.next.x - e.x) / (e.next.y - e.y);
      if (u <= i && u > n && (n = u, r = e.x < e.next.x ? e : e.next, u === i)) return r;
    }
    e = e.next;
  } while (e !== t);
  if (!r) return null;
  const a = r, o = r.x, h = r.y;
  let c = 1 / 0;
  e = r;
  do {
    if (i >= e.x && e.x >= o && i !== e.x && nl(s < h ? i : n, s, o, h, s < h ? n : i, s, e.x, e.y)) {
      const u = Math.abs(s - e.y) / (i - e.x);
      rs(e, l) && (u < c || u === c && (e.x > r.x || e.x === r.x && Jp(r, e))) && (r = e, c = u);
    }
    e = e.next;
  } while (e !== a);
  return r;
}
function Jp(l, t) {
  return rt(l.prev, l, t.prev) < 0 && rt(t.next, l, l.next) < 0;
}
function Xp(l, t, e, i) {
  let s = l;
  do
    s.z === 0 && (s.z = ra(s.x, s.y, t, e, i)), s.prevZ = s.prev, s.nextZ = s.next, s = s.next;
  while (s !== l);
  s.prevZ.nextZ = null, s.prevZ = null, Yp(s);
}
function Yp(l) {
  let t, e = 1;
  do {
    let i = l, s;
    l = null;
    let n = null;
    for (t = 0; i; ) {
      t++;
      let r = i, a = 0;
      for (let h = 0; h < e && (a++, r = r.nextZ, !!r); h++) ;
      let o = e;
      for (; a > 0 || o > 0 && r; ) a !== 0 && (o === 0 || !r || i.z <= r.z) ? (s = i, i = i.nextZ, a--) : (s = r, r = r.nextZ, o--), n ? n.nextZ = s : l = s, s.prevZ = n, n = s;
      i = r;
    }
    n.nextZ = null, e *= 2;
  } while (t > 1);
  return l;
}
function ra(l, t, e, i, s) {
  return l = (l - e) * s | 0, t = (t - i) * s | 0, l = (l | l << 8) & 16711935, l = (l | l << 4) & 252645135, l = (l | l << 2) & 858993459, l = (l | l << 1) & 1431655765, t = (t | t << 8) & 16711935, t = (t | t << 4) & 252645135, t = (t | t << 2) & 858993459, t = (t | t << 1) & 1431655765, l | t << 1;
}
function Zp(l) {
  let t = l, e = l;
  do
    (t.x < e.x || t.x === e.x && t.y < e.y) && (e = t), t = t.next;
  while (t !== l);
  return e;
}
function nl(l, t, e, i, s, n, r, a) {
  return (s - r) * (t - a) >= (l - r) * (n - a) && (l - r) * (i - a) >= (e - r) * (t - a) && (e - r) * (n - a) >= (s - r) * (i - a);
}
function ns(l, t, e, i, s, n, r, a) {
  return !(l === r && t === a) && nl(l, t, e, i, s, n, r, a);
}
function $p(l, t) {
  return l.next.i !== t.i && l.prev.i !== t.i && !Qp(l, t) && (rs(l, t) && rs(t, l) && jp(l, t) && (rt(l.prev, l, t.prev) || rt(l, t.prev, t)) || Ai(l, t) && rt(l.prev, l, l.next) > 0 && rt(t.prev, t, t.next) > 0);
}
function rt(l, t, e) {
  return (t.y - l.y) * (e.x - t.x) - (t.x - l.x) * (e.y - t.y);
}
function Ai(l, t) {
  return l.x === t.x && l.y === t.y;
}
function rl(l, t, e, i) {
  const s = yn(rt(l, t, e)), n = yn(rt(l, t, i)), r = yn(rt(e, i, l)), a = yn(rt(e, i, t));
  return !!(s !== n && r !== a || s === 0 && mn(l, e, t) || n === 0 && mn(l, i, t) || r === 0 && mn(e, l, i) || a === 0 && mn(e, t, i));
}
function mn(l, t, e) {
  return t.x <= Math.max(l.x, e.x) && t.x >= Math.min(l.x, e.x) && t.y <= Math.max(l.y, e.y) && t.y >= Math.min(l.y, e.y);
}
function yn(l) {
  return l > 0 ? 1 : l < 0 ? -1 : 0;
}
function Qp(l, t) {
  let e = l;
  do {
    if (e.i !== l.i && e.next.i !== l.i && e.i !== t.i && e.next.i !== t.i && rl(e, e.next, l, t)) return true;
    e = e.next;
  } while (e !== l);
  return false;
}
function rs(l, t) {
  return rt(l.prev, l, l.next) < 0 ? rt(l, t, l.next) >= 0 && rt(l, l.prev, t) >= 0 : rt(l, t, l.prev) < 0 || rt(l, l.next, t) < 0;
}
function jp(l, t) {
  let e = l, i = false;
  const s = (l.x + t.x) / 2, n = (l.y + t.y) / 2;
  do
    e.y > n != e.next.y > n && e.next.y !== e.y && s < (e.next.x - e.x) * (n - e.y) / (e.next.y - e.y) + e.x && (i = !i), e = e.next;
  while (e !== l);
  return i;
}
function al(l, t) {
  const e = aa(l.i, l.x, l.y), i = aa(t.i, t.x, t.y), s = l.next, n = t.prev;
  return l.next = t, t.prev = l, e.next = s, s.prev = e, i.next = e, e.prev = i, n.next = i, i.prev = n, i;
}
function ol(l, t, e, i) {
  const s = aa(l, t, e);
  return i ? (s.next = i.next, s.prev = i, i.next.prev = s, i.next = s) : (s.prev = s, s.next = s), s;
}
function as(l) {
  l.next.prev = l.prev, l.prev.next = l.next, l.prevZ && (l.prevZ.nextZ = l.nextZ), l.nextZ && (l.nextZ.prevZ = l.prevZ);
}
function aa(l, t, e) {
  return { i: l, x: t, y: e, prev: null, next: null, z: 0, prevZ: null, nextZ: null, steiner: false };
}
function Kp(l, t, e, i) {
  let s = 0;
  for (let n = t, r = e - i; n < e; n += i) s += (l[r] - l[n]) * (l[n + 1] + l[r + 1]), r = n;
  return s;
}
var tf = class {
  static triangulate(t, e, i = 2) {
    return Np(t, e, i);
  }
};
var ee = class _ee {
  static area(t) {
    const e = t.length;
    let i = 0;
    for (let s = e - 1, n = 0; n < e; s = n++) i += t[s].x * t[n].y - t[n].x * t[s].y;
    return i * 0.5;
  }
  static isClockWise(t) {
    return _ee.area(t) < 0;
  }
  static triangulateShape(t, e) {
    const i = [], s = [], n = [];
    hl(t), ll(i, t);
    let r = t.length;
    e.forEach(hl);
    for (let o = 0; o < e.length; o++) s.push(r), r += e[o].length, ll(i, e[o]);
    const a = tf.triangulate(i, s);
    for (let o = 0; o < a.length; o += 3) n.push(a.slice(o, o + 3));
    return n;
  }
};
function hl(l) {
  const t = l.length;
  t > 2 && l[t - 1].equals(l[0]) && l.pop();
}
function ll(l, t) {
  for (let e = 0; e < t.length; e++) l.push(t[e].x), l.push(t[e].y);
}
var Vn = class _Vn extends H {
  constructor(t = new is([new I(0.5, 0.5), new I(-0.5, 0.5), new I(-0.5, -0.5), new I(0.5, -0.5)]), e = {}) {
    super(), this.type = "ExtrudeGeometry", this.parameters = { shapes: t, options: e }, t = Array.isArray(t) ? t : [t];
    const i = this, s = [], n = [];
    for (let a = 0, o = t.length; a < o; a++) {
      const h = t[a];
      r(h);
    }
    this.setAttribute("position", new P(s, 3)), this.setAttribute("uv", new P(n, 2)), this.computeVertexNormals();
    function r(a) {
      const o = [], h = e.curveSegments !== void 0 ? e.curveSegments : 12, c = e.steps !== void 0 ? e.steps : 1, u = e.depth !== void 0 ? e.depth : 1;
      let d = e.bevelEnabled !== void 0 ? e.bevelEnabled : true, p = e.bevelThickness !== void 0 ? e.bevelThickness : 0.2, f = e.bevelSize !== void 0 ? e.bevelSize : p - 0.1, m = e.bevelOffset !== void 0 ? e.bevelOffset : 0, y = e.bevelSegments !== void 0 ? e.bevelSegments : 3;
      const g = e.extrudePath, x = e.UVGenerator !== void 0 ? e.UVGenerator : ef;
      let b, M = false, _, v, A, S;
      if (g) {
        b = g.getSpacedPoints(c), M = true, d = false;
        const z = g.isCatmullRomCurve3 ? g.closed : false;
        _ = g.computeFrenetFrames(c, z), v = new w(), A = new w(), S = new w();
      }
      d || (y = 0, p = 0, f = 0, m = 0);
      const T = a.extractPoints(h);
      let C = T.shape;
      const B = T.holes;
      if (!ee.isClockWise(C)) {
        C = C.reverse();
        for (let z = 0, F = B.length; z < F; z++) {
          const k = B[z];
          ee.isClockWise(k) && (B[z] = k.reverse());
        }
      }
      function L(z) {
        const k = 10000000000000001e-36;
        let E = z[0];
        for (let O = 1; O <= z.length; O++) {
          const $ = O % z.length, q = z[$], it = q.x - E.x, nt = q.y - E.y, ct2 = it * it + nt * nt, Rt2 = Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(E.x), Math.abs(E.y)), Pe2 = k * Rt2 * Rt2;
          if (ct2 <= Pe2) {
            z.splice($, 1), O--;
            continue;
          }
          E = q;
        }
      }
      L(C), B.forEach(L);
      const J = B.length, N = C;
      for (let z = 0; z < J; z++) {
        const F = B[z];
        C = C.concat(F);
      }
      function Q(z, F, k) {
        return F || X("ExtrudeGeometry: vec does not exist"), z.clone().addScaledVector(F, k);
      }
      const K = C.length;
      function ut(z, F, k) {
        let E, O, $;
        const q = z.x - F.x, it = z.y - F.y, nt = k.x - z.x, ct2 = k.y - z.y, Rt2 = q * q + it * it, Pe2 = q * ct2 - it * nt;
        if (Math.abs(Pe2) > Number.EPSILON) {
          const Ot = Math.sqrt(Rt2), Ba2 = Math.sqrt(nt * nt + ct2 * ct2), Fa2 = F.x - it / Ot, ka2 = F.y + q / Ot, xc2 = k.x - ct2 / Ba2, bc2 = k.y + nt / Ba2, Pa = ((xc2 - Fa2) * ct2 - (bc2 - ka2) * nt) / (q * ct2 - it * nt);
          E = Fa2 + q * Pa - z.x, O = ka2 + it * Pa - z.y;
          const Ra = E * E + O * O;
          if (Ra <= 2) return new I(E, O);
          $ = Math.sqrt(Ra / 2);
        } else {
          let Ot = false;
          q > Number.EPSILON ? nt > Number.EPSILON && (Ot = true) : q < -Number.EPSILON ? nt < -Number.EPSILON && (Ot = true) : Math.sign(it) === Math.sign(ct2) && (Ot = true), Ot ? (E = -it, O = q, $ = Math.sqrt(Rt2)) : (E = q, O = it, $ = Math.sqrt(Rt2 / 2));
        }
        return new I(E / $, O / $);
      }
      const j = [];
      for (let z = 0, F = N.length, k = F - 1, E = z + 1; z < F; z++, k++, E++) k === F && (k = 0), E === F && (E = 0), j[z] = ut(N[z], N[k], N[E]);
      const tt = [];
      let et, Tt = j.concat();
      for (let z = 0, F = J; z < F; z++) {
        const k = B[z];
        et = [];
        for (let E = 0, O = k.length, $ = O - 1, q = E + 1; E < O; E++, $++, q++) $ === O && ($ = 0), q === O && (q = 0), et[E] = ut(k[E], k[$], k[q]);
        tt.push(et), Tt = Tt.concat(et);
      }
      let bt;
      if (y === 0) bt = ee.triangulateShape(N, B);
      else {
        const z = [], F = [];
        for (let k = 0; k < y; k++) {
          const E = k / y, O = p * Math.cos(E * Math.PI / 2), $ = f * Math.sin(E * Math.PI / 2) + m;
          for (let q = 0, it = N.length; q < it; q++) {
            const nt = Q(N[q], j[q], $);
            Mt(nt.x, nt.y, -O), E === 0 && z.push(nt);
          }
          for (let q = 0, it = J; q < it; q++) {
            const nt = B[q];
            et = tt[q];
            const ct2 = [];
            for (let Rt2 = 0, Pe2 = nt.length; Rt2 < Pe2; Rt2++) {
              const Ot = Q(nt[Rt2], et[Rt2], $);
              Mt(Ot.x, Ot.y, -O), E === 0 && ct2.push(Ot);
            }
            E === 0 && F.push(ct2);
          }
        }
        bt = ee.triangulateShape(z, F);
      }
      const oe = bt.length, be = f + m;
      for (let z = 0; z < K; z++) {
        const F = d ? Q(C[z], Tt[z], be) : C[z];
        M ? (A.copy(_.normals[0]).multiplyScalar(F.x), v.copy(_.binormals[0]).multiplyScalar(F.y), S.copy(b[0]).add(A).add(v), Mt(S.x, S.y, S.z)) : Mt(F.x, F.y, 0);
      }
      for (let z = 1; z <= c; z++) for (let F = 0; F < K; F++) {
        const k = d ? Q(C[F], Tt[F], be) : C[F];
        M ? (A.copy(_.normals[z]).multiplyScalar(k.x), v.copy(_.binormals[z]).multiplyScalar(k.y), S.copy(b[z]).add(A).add(v), Mt(S.x, S.y, S.z)) : Mt(k.x, k.y, u / c * z);
      }
      for (let z = y - 1; z >= 0; z--) {
        const F = z / y, k = p * Math.cos(F * Math.PI / 2), E = f * Math.sin(F * Math.PI / 2) + m;
        for (let O = 0, $ = N.length; O < $; O++) {
          const q = Q(N[O], j[O], E);
          Mt(q.x, q.y, u + k);
        }
        for (let O = 0, $ = B.length; O < $; O++) {
          const q = B[O];
          et = tt[O];
          for (let it = 0, nt = q.length; it < nt; it++) {
            const ct2 = Q(q[it], et[it], E);
            M ? Mt(ct2.x, ct2.y + b[c - 1].y, b[c - 1].x + k) : Mt(ct2.x, ct2.y, u + k);
          }
        }
      }
      fs2(), ms2();
      function fs2() {
        const z = s.length / 3;
        if (d) {
          let F = 0, k = K * F;
          for (let E = 0; E < oe; E++) {
            const O = bt[E];
            ie(O[2] + k, O[1] + k, O[0] + k);
          }
          F = c + y * 2, k = K * F;
          for (let E = 0; E < oe; E++) {
            const O = bt[E];
            ie(O[0] + k, O[1] + k, O[2] + k);
          }
        } else {
          for (let F = 0; F < oe; F++) {
            const k = bt[F];
            ie(k[2], k[1], k[0]);
          }
          for (let F = 0; F < oe; F++) {
            const k = bt[F];
            ie(k[0] + K * c, k[1] + K * c, k[2] + K * c);
          }
        }
        i.addGroup(z, s.length / 3 - z, 0);
      }
      function ms2() {
        const z = s.length / 3;
        let F = 0;
        Me(N, F), F += N.length;
        for (let k = 0, E = B.length; k < E; k++) {
          const O = B[k];
          Me(O, F), F += O.length;
        }
        i.addGroup(z, s.length / 3 - z, 1);
      }
      function Me(z, F) {
        let k = z.length;
        for (; --k >= 0; ) {
          const E = k;
          let O = k - 1;
          O < 0 && (O = z.length - 1);
          for (let $ = 0, q = c + y * 2; $ < q; $++) {
            const it = K * $, nt = K * ($ + 1), ct2 = F + E + it, Rt2 = F + O + it, Pe2 = F + O + nt, Ot = F + E + nt;
            ki(ct2, Rt2, Pe2, Ot);
          }
        }
      }
      function Mt(z, F, k) {
        o.push(z), o.push(F), o.push(k);
      }
      function ie(z, F, k) {
        Pt(z), Pt(F), Pt(k);
        const E = s.length / 3, O = x.generateTopUV(i, s, E - 3, E - 2, E - 1);
        he(O[0]), he(O[1]), he(O[2]);
      }
      function ki(z, F, k, E) {
        Pt(z), Pt(F), Pt(E), Pt(F), Pt(k), Pt(E);
        const O = s.length / 3, $ = x.generateSideWallUV(i, s, O - 6, O - 3, O - 2, O - 1);
        he($[0]), he($[1]), he($[3]), he($[1]), he($[2]), he($[3]);
      }
      function Pt(z) {
        s.push(o[z * 3 + 0]), s.push(o[z * 3 + 1]), s.push(o[z * 3 + 2]);
      }
      function he(z) {
        n.push(z.x), n.push(z.y);
      }
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  toJSON() {
    const t = super.toJSON(), e = this.parameters.shapes, i = this.parameters.options;
    return sf(e, i, t);
  }
  static fromJSON(t, e) {
    const i = [];
    for (let n = 0, r = t.shapes.length; n < r; n++) {
      const a = e[t.shapes[n]];
      i.push(a);
    }
    const s = t.options.extrudePath;
    return s !== void 0 && (t.options.extrudePath = new fn[s.type]().fromJSON(s)), new _Vn(i, t.options);
  }
};
var ef = { generateTopUV: function(l, t, e, i, s) {
  const n = t[e * 3], r = t[e * 3 + 1], a = t[i * 3], o = t[i * 3 + 1], h = t[s * 3], c = t[s * 3 + 1];
  return [new I(n, r), new I(a, o), new I(h, c)];
}, generateSideWallUV: function(l, t, e, i, s, n) {
  const r = t[e * 3], a = t[e * 3 + 1], o = t[e * 3 + 2], h = t[i * 3], c = t[i * 3 + 1], u = t[i * 3 + 2], d = t[s * 3], p = t[s * 3 + 1], f = t[s * 3 + 2], m = t[n * 3], y = t[n * 3 + 1], g = t[n * 3 + 2];
  return Math.abs(a - c) < Math.abs(r - h) ? [new I(r, 1 - o), new I(h, 1 - u), new I(d, 1 - f), new I(m, 1 - g)] : [new I(a, 1 - o), new I(c, 1 - u), new I(p, 1 - f), new I(y, 1 - g)];
} };
function sf(l, t, e) {
  if (e.shapes = [], Array.isArray(l)) for (let i = 0, s = l.length; i < s; i++) {
    const n = l[i];
    e.shapes.push(n.uuid);
  }
  else e.shapes.push(l.uuid);
  return e.options = Object.assign({}, t), t.extrudePath !== void 0 && (e.options.extrudePath = t.extrudePath.toJSON()), e;
}
var Dn = class _Dn extends ke {
  constructor(t = 1, e = 0) {
    const i = (1 + Math.sqrt(5)) / 2, s = [-1, i, 0, 1, i, 0, -1, -i, 0, 1, -i, 0, 0, -1, i, 0, 1, i, 0, -1, -i, 0, 1, -i, i, 0, -1, i, 0, 1, -i, 0, -1, -i, 0, 1], n = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    super(s, n, t, e), this.type = "IcosahedronGeometry", this.parameters = { radius: t, detail: e };
  }
  static fromJSON(t) {
    return new _Dn(t.radius, t.detail);
  }
};
var Un = class _Un extends H {
  constructor(t = [new I(0, -0.5), new I(0.5, 0), new I(0, 0.5)], e = 12, i = 0, s = Math.PI * 2) {
    super(), this.type = "LatheGeometry", this.parameters = { points: t, segments: e, phiStart: i, phiLength: s }, e = Math.floor(e), s = D(s, 0, Math.PI * 2);
    const n = [], r = [], a = [], o = [], h = [], c = 1 / e, u = new w(), d = new I(), p = new w(), f = new w(), m = new w();
    let y = 0, g = 0;
    for (let x = 0; x <= t.length - 1; x++) switch (x) {
      case 0:
        y = t[x + 1].x - t[x].x, g = t[x + 1].y - t[x].y, p.x = g * 1, p.y = -y, p.z = g * 0, m.copy(p), p.normalize(), o.push(p.x, p.y, p.z);
        break;
      case t.length - 1:
        o.push(m.x, m.y, m.z);
        break;
      default:
        y = t[x + 1].x - t[x].x, g = t[x + 1].y - t[x].y, p.x = g * 1, p.y = -y, p.z = g * 0, f.copy(p), p.x += m.x, p.y += m.y, p.z += m.z, p.normalize(), o.push(p.x, p.y, p.z), m.copy(f);
    }
    for (let x = 0; x <= e; x++) {
      const b = i + x * c * s, M = Math.sin(b), _ = Math.cos(b);
      for (let v = 0; v <= t.length - 1; v++) {
        u.x = t[v].x * M, u.y = t[v].y, u.z = t[v].x * _, r.push(u.x, u.y, u.z), d.x = x / e, d.y = v / (t.length - 1), a.push(d.x, d.y);
        const A = o[3 * v + 0] * M, S = o[3 * v + 1], T = o[3 * v + 0] * _;
        h.push(A, S, T);
      }
    }
    for (let x = 0; x < e; x++) for (let b = 0; b < t.length - 1; b++) {
      const M = b + x * t.length, _ = M, v = M + t.length, A = M + t.length + 1, S = M + 1;
      n.push(_, v, S), n.push(A, S, v);
    }
    this.setIndex(n), this.setAttribute("position", new P(r, 3)), this.setAttribute("uv", new P(a, 2)), this.setAttribute("normal", new P(h, 3));
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _Un(t.points, t.segments, t.phiStart, t.phiLength);
  }
};
var ds = class _ds extends ke {
  constructor(t = 1, e = 0) {
    const i = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1], s = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2];
    super(i, s, t, e), this.type = "OctahedronGeometry", this.parameters = { radius: t, detail: e };
  }
  static fromJSON(t) {
    return new _ds(t.radius, t.detail);
  }
};
var Wn = class _Wn extends H {
  constructor(t = 1, e = 1, i = 1, s = 1) {
    super(), this.type = "PlaneGeometry", this.parameters = { width: t, height: e, widthSegments: i, heightSegments: s };
    const n = t / 2, r = e / 2, a = Math.floor(i), o = Math.floor(s), h = a + 1, c = o + 1, u = t / a, d = e / o, p = [], f = [], m = [], y = [];
    for (let g = 0; g < c; g++) {
      const x = g * d - r;
      for (let b = 0; b < h; b++) {
        const M = b * u - n;
        f.push(M, -x, 0), m.push(0, 0, 1), y.push(b / a), y.push(1 - g / o);
      }
    }
    for (let g = 0; g < o; g++) for (let x = 0; x < a; x++) {
      const b = x + h * g, M = x + h * (g + 1), _ = x + 1 + h * (g + 1), v = x + 1 + h * g;
      p.push(b, M, v), p.push(M, _, v);
    }
    this.setIndex(p), this.setAttribute("position", new P(f, 3)), this.setAttribute("normal", new P(m, 3)), this.setAttribute("uv", new P(y, 2));
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _Wn(t.width, t.height, t.widthSegments, t.heightSegments);
  }
};
var Gn = class _Gn extends H {
  constructor(t = 0.5, e = 1, i = 32, s = 1, n = 0, r = Math.PI * 2) {
    super(), this.type = "RingGeometry", this.parameters = { innerRadius: t, outerRadius: e, thetaSegments: i, phiSegments: s, thetaStart: n, thetaLength: r }, i = Math.max(3, i), s = Math.max(1, s);
    const a = [], o = [], h = [], c = [];
    let u = t;
    const d = (e - t) / s, p = new w(), f = new I();
    for (let m = 0; m <= s; m++) {
      for (let y = 0; y <= i; y++) {
        const g = n + y / i * r;
        p.x = u * Math.cos(g), p.y = u * Math.sin(g), o.push(p.x, p.y, p.z), h.push(0, 0, 1), f.x = (p.x / e + 1) / 2, f.y = (p.y / e + 1) / 2, c.push(f.x, f.y);
      }
      u += d;
    }
    for (let m = 0; m < s; m++) {
      const y = m * (i + 1);
      for (let g = 0; g < i; g++) {
        const x = g + y, b = x, M = x + i + 1, _ = x + i + 2, v = x + 1;
        a.push(b, M, v), a.push(M, _, v);
      }
    }
    this.setIndex(a), this.setAttribute("position", new P(o, 3)), this.setAttribute("normal", new P(h, 3)), this.setAttribute("uv", new P(c, 2));
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _Gn(t.innerRadius, t.outerRadius, t.thetaSegments, t.phiSegments, t.thetaStart, t.thetaLength);
  }
};
var Hn = class _Hn extends H {
  constructor(t = new is([new I(0, 0.5), new I(-0.5, -0.5), new I(0.5, -0.5)]), e = 12) {
    super(), this.type = "ShapeGeometry", this.parameters = { shapes: t, curveSegments: e };
    const i = [], s = [], n = [], r = [];
    let a = 0, o = 0;
    if (Array.isArray(t) === false) h(t);
    else for (let c = 0; c < t.length; c++) h(t[c]), this.addGroup(a, o, c), a += o, o = 0;
    this.setIndex(i), this.setAttribute("position", new P(s, 3)), this.setAttribute("normal", new P(n, 3)), this.setAttribute("uv", new P(r, 2));
    function h(c) {
      const u = s.length / 3, d = c.extractPoints(e);
      let p = d.shape;
      const f = d.holes;
      ee.isClockWise(p) === false && (p = p.reverse());
      for (let y = 0, g = f.length; y < g; y++) {
        const x = f[y];
        ee.isClockWise(x) === true && (f[y] = x.reverse());
      }
      const m = ee.triangulateShape(p, f);
      for (let y = 0, g = f.length; y < g; y++) {
        const x = f[y];
        p = p.concat(x);
      }
      for (let y = 0, g = p.length; y < g; y++) {
        const x = p[y];
        s.push(x.x, x.y, 0), n.push(0, 0, 1), r.push(x.x, x.y);
      }
      for (let y = 0, g = m.length; y < g; y++) {
        const x = m[y], b = x[0] + u, M = x[1] + u, _ = x[2] + u;
        i.push(b, M, _), o += 3;
      }
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  toJSON() {
    const t = super.toJSON(), e = this.parameters.shapes;
    return nf(e, t);
  }
  static fromJSON(t, e) {
    const i = [];
    for (let s = 0, n = t.shapes.length; s < n; s++) {
      const r = e[t.shapes[s]];
      i.push(r);
    }
    return new _Hn(i, t.curveSegments);
  }
};
function nf(l, t) {
  if (t.shapes = [], Array.isArray(l)) for (let e = 0, i = l.length; e < i; e++) {
    const s = l[e];
    t.shapes.push(s.uuid);
  }
  else t.shapes.push(l.uuid);
  return t;
}
var ps = class _ps extends H {
  constructor(t = 1, e = 32, i = 16, s = 0, n = Math.PI * 2, r = 0, a = Math.PI) {
    super(), this.type = "SphereGeometry", this.parameters = { radius: t, widthSegments: e, heightSegments: i, phiStart: s, phiLength: n, thetaStart: r, thetaLength: a }, e = Math.max(3, Math.floor(e)), i = Math.max(2, Math.floor(i));
    const o = Math.min(r + a, Math.PI);
    let h = 0;
    const c = [], u = new w(), d = new w(), p = [], f = [], m = [], y = [];
    for (let g = 0; g <= i; g++) {
      const x = [], b = g / i, M = r + b * a, _ = t * Math.cos(M), v = Math.sqrt(t * t - _ * _);
      let A = 0;
      g === 0 && r === 0 ? A = 0.5 / e : g === i && o === Math.PI && (A = -0.5 / e);
      for (let S = 0; S <= e; S++) {
        const T = S / e, C = s + T * n;
        u.x = -v * Math.cos(C), u.y = _, u.z = v * Math.sin(C), f.push(u.x, u.y, u.z), d.copy(u).normalize(), m.push(d.x, d.y, d.z), y.push(T + A, 1 - b), x.push(h++);
      }
      c.push(x);
    }
    for (let g = 0; g < i; g++) for (let x = 0; x < e; x++) {
      const b = c[g][x + 1], M = c[g][x], _ = c[g + 1][x], v = c[g + 1][x + 1];
      (g !== 0 || r > 0) && p.push(b, M, v), (g !== i - 1 || o < Math.PI) && p.push(M, _, v);
    }
    this.setIndex(p), this.setAttribute("position", new P(f, 3)), this.setAttribute("normal", new P(m, 3)), this.setAttribute("uv", new P(y, 2));
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _ps(t.radius, t.widthSegments, t.heightSegments, t.phiStart, t.phiLength, t.thetaStart, t.thetaLength);
  }
};
var qn = class _qn extends ke {
  constructor(t = 1, e = 0) {
    const i = [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1], s = [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1];
    super(i, s, t, e), this.type = "TetrahedronGeometry", this.parameters = { radius: t, detail: e };
  }
  static fromJSON(t) {
    return new _qn(t.radius, t.detail);
  }
};
var Jn = class _Jn extends H {
  constructor(t = 1, e = 0.4, i = 12, s = 48, n = Math.PI * 2, r = 0, a = Math.PI * 2) {
    super(), this.type = "TorusGeometry", this.parameters = { radius: t, tube: e, radialSegments: i, tubularSegments: s, arc: n, thetaStart: r, thetaLength: a }, i = Math.floor(i), s = Math.floor(s);
    const o = [], h = [], c = [], u = [], d = new w(), p = new w(), f = new w();
    for (let m = 0; m <= i; m++) {
      const y = r + m / i * a;
      for (let g = 0; g <= s; g++) {
        const x = g / s * n;
        p.x = (t + e * Math.cos(y)) * Math.cos(x), p.y = (t + e * Math.cos(y)) * Math.sin(x), p.z = e * Math.sin(y), h.push(p.x, p.y, p.z), d.x = t * Math.cos(x), d.y = t * Math.sin(x), f.subVectors(p, d).normalize(), c.push(f.x, f.y, f.z), u.push(g / s), u.push(m / i);
      }
    }
    for (let m = 1; m <= i; m++) for (let y = 1; y <= s; y++) {
      const g = (s + 1) * m + y - 1, x = (s + 1) * (m - 1) + y - 1, b = (s + 1) * (m - 1) + y, M = (s + 1) * m + y;
      o.push(g, x, M), o.push(x, b, M);
    }
    this.setIndex(o), this.setAttribute("position", new P(h, 3)), this.setAttribute("normal", new P(c, 3)), this.setAttribute("uv", new P(u, 2));
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _Jn(t.radius, t.tube, t.radialSegments, t.tubularSegments, t.arc, t.thetaStart, t.thetaLength);
  }
};
var Xn = class _Xn extends H {
  constructor(t = 1, e = 0.4, i = 64, s = 8, n = 2, r = 3) {
    super(), this.type = "TorusKnotGeometry", this.parameters = { radius: t, tube: e, tubularSegments: i, radialSegments: s, p: n, q: r }, i = Math.floor(i), s = Math.floor(s);
    const a = [], o = [], h = [], c = [], u = new w(), d = new w(), p = new w(), f = new w(), m = new w(), y = new w(), g = new w();
    for (let b = 0; b <= i; ++b) {
      const M = b / i * n * Math.PI * 2;
      x(M, n, r, t, p), x(M + 0.01, n, r, t, f), y.subVectors(f, p), g.addVectors(f, p), m.crossVectors(y, g), g.crossVectors(m, y), m.normalize(), g.normalize();
      for (let _ = 0; _ <= s; ++_) {
        const v = _ / s * Math.PI * 2, A = -e * Math.cos(v), S = e * Math.sin(v);
        u.x = p.x + (A * g.x + S * m.x), u.y = p.y + (A * g.y + S * m.y), u.z = p.z + (A * g.z + S * m.z), o.push(u.x, u.y, u.z), d.subVectors(u, p).normalize(), h.push(d.x, d.y, d.z), c.push(b / i), c.push(_ / s);
      }
    }
    for (let b = 1; b <= i; b++) for (let M = 1; M <= s; M++) {
      const _ = (s + 1) * (b - 1) + (M - 1), v = (s + 1) * b + (M - 1), A = (s + 1) * b + M, S = (s + 1) * (b - 1) + M;
      a.push(_, v, S), a.push(v, A, S);
    }
    this.setIndex(a), this.setAttribute("position", new P(o, 3)), this.setAttribute("normal", new P(h, 3)), this.setAttribute("uv", new P(c, 2));
    function x(b, M, _, v, A) {
      const S = Math.cos(b), T = Math.sin(b), C = _ / M * b, B = Math.cos(C);
      A.x = v * (2 + B) * 0.5 * S, A.y = v * (2 + B) * T * 0.5, A.z = v * Math.sin(C) * 0.5;
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  static fromJSON(t) {
    return new _Xn(t.radius, t.tube, t.tubularSegments, t.radialSegments, t.p, t.q);
  }
};
var Yn = class _Yn extends H {
  constructor(t = new sa(new w(-1, -1, 0), new w(-1, 1, 0), new w(1, 1, 0)), e = 64, i = 1, s = 8, n = false) {
    super(), this.type = "TubeGeometry", this.parameters = { path: t, tubularSegments: e, radius: i, radialSegments: s, closed: n };
    const r = t.computeFrenetFrames(e, n);
    this.tangents = r.tangents, this.normals = r.normals, this.binormals = r.binormals;
    const a = new w(), o = new w(), h = new I();
    let c = new w();
    const u = [], d = [], p = [], f = [];
    m(), this.setIndex(f), this.setAttribute("position", new P(u, 3)), this.setAttribute("normal", new P(d, 3)), this.setAttribute("uv", new P(p, 2));
    function m() {
      for (let b = 0; b < e; b++) y(b);
      y(n === false ? e : 0), x(), g();
    }
    function y(b) {
      c = t.getPointAt(b / e, c);
      const M = r.normals[b], _ = r.binormals[b];
      for (let v = 0; v <= s; v++) {
        const A = v / s * Math.PI * 2, S = Math.sin(A), T = -Math.cos(A);
        o.x = T * M.x + S * _.x, o.y = T * M.y + S * _.y, o.z = T * M.z + S * _.z, o.normalize(), d.push(o.x, o.y, o.z), a.x = c.x + i * o.x, a.y = c.y + i * o.y, a.z = c.z + i * o.z, u.push(a.x, a.y, a.z);
      }
    }
    function g() {
      for (let b = 1; b <= e; b++) for (let M = 1; M <= s; M++) {
        const _ = (s + 1) * (b - 1) + (M - 1), v = (s + 1) * b + (M - 1), A = (s + 1) * b + M, S = (s + 1) * (b - 1) + M;
        f.push(_, v, S), f.push(v, A, S);
      }
    }
    function x() {
      for (let b = 0; b <= e; b++) for (let M = 0; M <= s; M++) h.x = b / e, h.y = M / s, p.push(h.x, h.y);
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
  toJSON() {
    const t = super.toJSON();
    return t.path = this.parameters.path.toJSON(), t;
  }
  static fromJSON(t) {
    return new _Yn(new fn[t.path.type]().fromJSON(t.path), t.tubularSegments, t.radius, t.radialSegments, t.closed);
  }
};
var cl = class extends H {
  constructor(t = null) {
    if (super(), this.type = "WireframeGeometry", this.parameters = { geometry: t }, t !== null) {
      const e = [], i = /* @__PURE__ */ new Set(), s = new w(), n = new w();
      if (t.index !== null) {
        const r = t.attributes.position, a = t.index;
        let o = t.groups;
        o.length === 0 && (o = [{ start: 0, count: a.count, materialIndex: 0 }]);
        for (let h = 0, c = o.length; h < c; ++h) {
          const u = o[h], d = u.start, p = u.count;
          for (let f = d, m = d + p; f < m; f += 3) for (let y = 0; y < 3; y++) {
            const g = a.getX(f + y), x = a.getX(f + (y + 1) % 3);
            s.fromBufferAttribute(r, g), n.fromBufferAttribute(r, x), ul(s, n, i) === true && (e.push(s.x, s.y, s.z), e.push(n.x, n.y, n.z));
          }
        }
      } else {
        const r = t.attributes.position;
        for (let a = 0, o = r.count / 3; a < o; a++) for (let h = 0; h < 3; h++) {
          const c = 3 * a + h, u = 3 * a + (h + 1) % 3;
          s.fromBufferAttribute(r, c), n.fromBufferAttribute(r, u), ul(s, n, i) === true && (e.push(s.x, s.y, s.z), e.push(n.x, n.y, n.z));
        }
      }
      this.setAttribute("position", new P(e, 3));
    }
  }
  copy(t) {
    return super.copy(t), this.parameters = Object.assign({}, t.parameters), this;
  }
};
function ul(l, t, e) {
  const i = `${l.x},${l.y},${l.z}-${t.x},${t.y},${t.z}`, s = `${t.x},${t.y},${t.z}-${l.x},${l.y},${l.z}`;
  return e.has(i) === true || e.has(s) === true ? false : (e.add(i), e.add(s), true);
}
var dl = Object.freeze({ __proto__: null, BoxGeometry: On, CapsuleGeometry: En, CircleGeometry: Nn, ConeGeometry: us, CylinderGeometry: cs, DodecahedronGeometry: Ln, EdgesGeometry: Yh, ExtrudeGeometry: Vn, IcosahedronGeometry: Dn, LatheGeometry: Un, OctahedronGeometry: ds, PlaneGeometry: Wn, PolyhedronGeometry: ke, RingGeometry: Gn, ShapeGeometry: Hn, SphereGeometry: ps, TetrahedronGeometry: qn, TorusGeometry: Jn, TorusKnotGeometry: Xn, TubeGeometry: Yn, WireframeGeometry: cl });
function gn(l) {
  const t = {};
  for (const e in l) {
    t[e] = {};
    for (const i in l[e]) {
      const s = l[e][i];
      if (ml(s)) s.isRenderTargetTexture ? (V("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."), t[e][i] = null) : t[e][i] = s.clone();
      else if (Array.isArray(s)) if (ml(s[0])) {
        const n = [];
        for (let r = 0, a = s.length; r < a; r++) n[r] = s[r].clone();
        t[e][i] = n;
      } else t[e][i] = s.slice();
      else t[e][i] = s;
    }
  }
  return t;
}
function fl(l) {
  const t = {};
  for (let e = 0; e < l.length; e++) {
    const i = gn(l[e]);
    for (const s in i) t[s] = i[s];
  }
  return t;
}
function ml(l) {
  return l && (l.isColor || l.isMatrix3 || l.isMatrix4 || l.isVector2 || l.isVector3 || l.isVector4 || l.isTexture || l.isQuaternion);
}
function rf(l) {
  const t = [];
  for (let e = 0; e < l.length; e++) t.push(l[e].clone());
  return t;
}
function af(l) {
  const t = l.getRenderTarget();
  return t === null ? l.outputColorSpace : t.isXRRenderTarget === true ? t.texture.colorSpace : It.workingColorSpace;
}
var of = { clone: gn, merge: fl };
var hf = `void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
var lf = `void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;
var oa = class extends ft {
  constructor(t) {
    super(), this.isShaderMaterial = true, this.type = "ShaderMaterial", this.defines = {}, this.uniforms = {}, this.uniformsGroups = [], this.vertexShader = hf, this.fragmentShader = lf, this.linewidth = 1, this.wireframe = false, this.wireframeLinewidth = 1, this.fog = false, this.lights = false, this.clipping = false, this.forceSinglePass = true, this.extensions = { clipCullDistance: false, multiDraw: false }, this.defaultAttributeValues = { color: [1, 1, 1], uv: [0, 0], uv1: [0, 0] }, this.index0AttributeName = void 0, this.uniformsNeedUpdate = false, this.glslVersion = null, t !== void 0 && this.setValues(t);
  }
  copy(t) {
    return super.copy(t), this.fragmentShader = t.fragmentShader, this.vertexShader = t.vertexShader, this.uniforms = gn(t.uniforms), this.uniformsGroups = rf(t.uniformsGroups), this.defines = Object.assign({}, t.defines), this.wireframe = t.wireframe, this.wireframeLinewidth = t.wireframeLinewidth, this.fog = t.fog, this.lights = t.lights, this.clipping = t.clipping, this.extensions = Object.assign({}, t.extensions), this.glslVersion = t.glslVersion, this.defaultAttributeValues = Object.assign({}, t.defaultAttributeValues), this.index0AttributeName = t.index0AttributeName, this.uniformsNeedUpdate = t.uniformsNeedUpdate, this;
  }
  toJSON(t) {
    const e = super.toJSON(t);
    e.glslVersion = this.glslVersion, e.uniforms = {};
    for (const s in this.uniforms) {
      const r = this.uniforms[s].value;
      r && r.isTexture ? e.uniforms[s] = { type: "t", value: r.toJSON(t).uuid } : r && r.isColor ? e.uniforms[s] = { type: "c", value: r.getHex() } : r && r.isVector2 ? e.uniforms[s] = { type: "v2", value: r.toArray() } : r && r.isVector3 ? e.uniforms[s] = { type: "v3", value: r.toArray() } : r && r.isVector4 ? e.uniforms[s] = { type: "v4", value: r.toArray() } : r && r.isMatrix3 ? e.uniforms[s] = { type: "m3", value: r.toArray() } : r && r.isMatrix4 ? e.uniforms[s] = { type: "m4", value: r.toArray() } : e.uniforms[s] = { value: r };
    }
    Object.keys(this.defines).length > 0 && (e.defines = this.defines), e.vertexShader = this.vertexShader, e.fragmentShader = this.fragmentShader, e.lights = this.lights, e.clipping = this.clipping;
    const i = {};
    for (const s in this.extensions) this.extensions[s] === true && (i[s] = true);
    return Object.keys(i).length > 0 && (e.extensions = i), e;
  }
  fromJSON(t, e) {
    if (super.fromJSON(t, e), t.uniforms !== void 0) for (const i in t.uniforms) {
      const s = t.uniforms[i];
      switch (this.uniforms[i] = {}, s.type) {
        case "t":
          this.uniforms[i].value = e[s.value] || null;
          break;
        case "c":
          this.uniforms[i].value = new U().setHex(s.value);
          break;
        case "v2":
          this.uniforms[i].value = new I().fromArray(s.value);
          break;
        case "v3":
          this.uniforms[i].value = new w().fromArray(s.value);
          break;
        case "v4":
          this.uniforms[i].value = new At().fromArray(s.value);
          break;
        case "m3":
          this.uniforms[i].value = new Kt().fromArray(s.value);
          break;
        case "m4":
          this.uniforms[i].value = new G().fromArray(s.value);
          break;
        default:
          this.uniforms[i].value = s.value;
      }
    }
    if (t.defines !== void 0 && (this.defines = t.defines), t.vertexShader !== void 0 && (this.vertexShader = t.vertexShader), t.fragmentShader !== void 0 && (this.fragmentShader = t.fragmentShader), t.glslVersion !== void 0 && (this.glslVersion = t.glslVersion), t.extensions !== void 0) for (const i in t.extensions) this.extensions[i] = t.extensions[i];
    return t.lights !== void 0 && (this.lights = t.lights), t.clipping !== void 0 && (this.clipping = t.clipping), this;
  }
};
var yl = class extends oa {
  constructor(t) {
    super(t), this.isRawShaderMaterial = true, this.type = "RawShaderMaterial";
  }
};
var _l = class extends ft {
  constructor(t) {
    super(), this.isMeshDepthMaterial = true, this.type = "MeshDepthMaterial", this.depthPacking = Zo, this.map = null, this.alphaMap = null, this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.wireframe = false, this.wireframeLinewidth = 1, this.setValues(t);
  }
  copy(t) {
    return super.copy(t), this.depthPacking = t.depthPacking, this.map = t.map, this.alphaMap = t.alphaMap, this.displacementMap = t.displacementMap, this.displacementScale = t.displacementScale, this.displacementBias = t.displacementBias, this.wireframe = t.wireframe, this.wireframeLinewidth = t.wireframeLinewidth, this;
  }
};
var vl = class extends ft {
  constructor(t) {
    super(), this.isMeshDistanceMaterial = true, this.type = "MeshDistanceMaterial", this.map = null, this.alphaMap = null, this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.setValues(t);
  }
  copy(t) {
    return super.copy(t), this.map = t.map, this.alphaMap = t.alphaMap, this.displacementMap = t.displacementMap, this.displacementScale = t.displacementScale, this.displacementBias = t.displacementBias, this;
  }
};
function jt(l, t) {
  return !l || l.constructor === t ? l : typeof t.BYTES_PER_ELEMENT == "number" ? new t(l) : Array.prototype.slice.call(l);
}
function os(l) {
  return l !== void 0 && l.inTangents !== void 0 && l.outTangents !== void 0;
}
var Ti = class {
  constructor(t, e, i, s) {
    this.parameterPositions = t, this._cachedIndex = 0, this.resultBuffer = s !== void 0 ? s : new e.constructor(i), this.sampleValues = e, this.valueSize = i, this.settings = null, this.DefaultSettings_ = {};
  }
  evaluate(t) {
    const e = this.parameterPositions;
    let i = this._cachedIndex, s = e[i], n = e[i - 1];
    t: {
      e: {
        let r;
        i: {
          s: if (!(t < s)) {
            for (let a = i + 2; ; ) {
              if (s === void 0) {
                if (t < n) break s;
                return i = e.length, this._cachedIndex = i, this.copySampleValue_(i - 1);
              }
              if (i === a) break;
              if (n = s, s = e[++i], t < s) break e;
            }
            r = e.length;
            break i;
          }
          if (!(t >= n)) {
            const a = e[1];
            t < a && (i = 2, n = a);
            for (let o = i - 2; ; ) {
              if (n === void 0) return this._cachedIndex = 0, this.copySampleValue_(0);
              if (i === o) break;
              if (s = n, n = e[--i - 1], t >= n) break e;
            }
            r = i, i = 0;
            break i;
          }
          break t;
        }
        for (; i < r; ) {
          const a = i + r >>> 1;
          t < e[a] ? r = a : i = a + 1;
        }
        if (s = e[i], n = e[i - 1], n === void 0) return this._cachedIndex = 0, this.copySampleValue_(0);
        if (s === void 0) return i = e.length, this._cachedIndex = i, this.copySampleValue_(i - 1);
      }
      this._cachedIndex = i, this.intervalChanged_(i, n, s);
    }
    return this.interpolate_(i, n, t, s);
  }
  getSettings_() {
    return this.settings || this.DefaultSettings_;
  }
  copySampleValue_(t) {
    const e = this.resultBuffer, i = this.sampleValues, s = this.valueSize, n = t * s;
    for (let r = 0; r !== s; ++r) e[r] = i[n + r];
    return e;
  }
  interpolate_() {
    throw new Error("THREE.Interpolant: Call to abstract method.");
  }
  intervalChanged_() {
  }
};
var Il = class extends Ti {
  constructor(t, e, i, s) {
    super(t, e, i, s), this._weightPrev = -0, this._offsetPrev = -0, this._weightNext = -0, this._offsetNext = -0, this.DefaultSettings_ = { endingStart: Oe, endingEnd: Oe };
  }
  intervalChanged_(t, e, i) {
    const s = this.parameterPositions;
    let n = t - 2, r = t + 1, a = s[n], o = s[r];
    if (a === void 0) switch (this.getSettings_().endingStart) {
      case Ee:
        n = t, a = 2 * e - i;
        break;
      case Ei:
        n = s.length - 2, a = e + s[n] - s[n + 1];
        break;
      default:
        n = t, a = i;
    }
    if (o === void 0) switch (this.getSettings_().endingEnd) {
      case Ee:
        r = t, o = 2 * i - e;
        break;
      case Ei:
        r = 1, o = i + s[1] - s[0];
        break;
      default:
        r = t - 1, o = e;
    }
    const h = (i - e) * 0.5, c = this.valueSize;
    this._weightPrev = h / (e - a), this._weightNext = h / (o - i), this._offsetPrev = n * c, this._offsetNext = r * c;
  }
  interpolate_(t, e, i, s) {
    const n = this.resultBuffer, r = this.sampleValues, a = this.valueSize, o = t * a, h = o - a, c = this._offsetPrev, u = this._offsetNext, d = this._weightPrev, p = this._weightNext, f = (i - e) / (s - e), m = f * f, y = m * f, g = -d * y + 2 * d * m - d * f, x = (1 + d) * y + (-1.5 - 2 * d) * m + (-0.5 + d) * f + 1, b = (-1 - p) * y + (1.5 + p) * m + 0.5 * f, M = p * y - p * m;
    for (let _ = 0; _ !== a; ++_) n[_] = g * r[c + _] + x * r[h + _] + b * r[o + _] + M * r[u + _];
    return n;
  }
};
var ca = class extends Ti {
  constructor(t, e, i, s) {
    super(t, e, i, s);
  }
  interpolate_(t, e, i, s) {
    const n = this.resultBuffer, r = this.sampleValues, a = this.valueSize, o = t * a, h = o - a, c = (i - e) / (s - e), u = 1 - c;
    for (let d = 0; d !== a; ++d) n[d] = r[h + d] * u + r[o + d] * c;
    return n;
  }
};
var zl = class extends Ti {
  constructor(t, e, i, s) {
    super(t, e, i, s);
  }
  interpolate_(t) {
    return this.copySampleValue_(t - 1);
  }
};
var Bl = class extends Ti {
  interpolate_(t, e, i, s) {
    const n = this.resultBuffer, r = this.sampleValues, a = this.valueSize, o = t * a, h = o - a, c = this.inTangents, u = this.outTangents;
    if (!c || !u) {
      const f = (i - e) / (s - e), m = 1 - f;
      for (let y = 0; y !== a; ++y) n[y] = r[h + y] * m + r[o + y] * f;
      return n;
    }
    const d = a * 2, p = t - 1;
    for (let f = 0; f !== a; ++f) {
      const m = r[h + f], y = r[o + f], g = p * d + f * 2, x = u[g], b = u[g + 1], M = t * d + f * 2, _ = c[M], v = c[M + 1], A = ff(i, e, x, _, s);
      n[f] = Fl(A, m, b, v, y);
    }
    return n;
  }
};
function Fl(l, t, e, i, s) {
  const n = 1 - l;
  return n * n * n * t + 3 * n * n * l * e + 3 * n * l * l * i + l * l * l * s;
}
function pf(l, t, e, i, s) {
  const n = 1 - l;
  return 3 * n * n * (e - t) + 6 * n * l * (i - e) + 3 * l * l * (s - i);
}
function ff(l, t, e, i, s) {
  let n = (l - t) / (s - t);
  for (let r = 0; r < 8; r++) {
    const a = Fl(n, t, e, i, s) - l;
    if (Math.abs(a) < 1e-10) break;
    const o = pf(n, t, e, i, s);
    if (Math.abs(o) < 1e-10) break;
    n = Math.max(0, Math.min(1, n - a / o));
  }
  return n;
}
var Gt = class {
  constructor(t, e, i, s) {
    if (t === void 0) throw new Error("THREE.KeyframeTrack: track name is undefined");
    if (e === void 0 || e.length === 0) throw new Error("THREE.KeyframeTrack: no keyframes in track named " + t);
    this.name = t, this.times = jt(e, this.TimeBufferType), this.values = jt(i, this.ValueBufferType), this.setInterpolation(s || this.DefaultInterpolation);
  }
  static toJSON(t) {
    const e = t.constructor;
    let i;
    if (e.toJSON !== this.toJSON) i = e.toJSON(t);
    else {
      i = { name: t.name, times: jt(t.times, Array), values: jt(t.values, Array) };
      const s = t.getInterpolation();
      s !== t.DefaultInterpolation && (i.interpolation = s), os(t.settings) && (i.settings = { inTangents: jt(t.settings.inTangents, Array), outTangents: jt(t.settings.outTangents, Array) });
    }
    return i.type = t.ValueTypeName, i;
  }
  InterpolantFactoryMethodDiscrete(t) {
    return new zl(this.times, this.values, this.getValueSize(), t);
  }
  InterpolantFactoryMethodLinear(t) {
    return new ca(this.times, this.values, this.getValueSize(), t);
  }
  InterpolantFactoryMethodSmooth(t) {
    return new Il(this.times, this.values, this.getValueSize(), t);
  }
  InterpolantFactoryMethodBezier(t) {
    const e = new Bl(this.times, this.values, this.getValueSize(), t);
    return this.settings && (e.inTangents = this.settings.inTangents, e.outTangents = this.settings.outTangents), e;
  }
  setInterpolation(t) {
    let e;
    switch (t) {
      case Oi:
        e = this.InterpolantFactoryMethodDiscrete;
        break;
      case Ss:
        e = this.InterpolantFactoryMethodLinear;
        break;
      case As:
        e = this.InterpolantFactoryMethodSmooth;
        break;
      case or:
        e = this.InterpolantFactoryMethodBezier;
        break;
    }
    if (e === void 0) {
      const i = "unsupported interpolation for " + this.ValueTypeName + " keyframe track named " + this.name;
      if (this.createInterpolant === void 0) if (t !== this.DefaultInterpolation) this.setInterpolation(this.DefaultInterpolation);
      else throw new Error(i);
      return V("KeyframeTrack:", i), this;
    }
    return this.createInterpolant = e, this;
  }
  getInterpolation() {
    switch (this.createInterpolant) {
      case this.InterpolantFactoryMethodDiscrete:
        return Oi;
      case this.InterpolantFactoryMethodLinear:
        return Ss;
      case this.InterpolantFactoryMethodSmooth:
        return As;
      case this.InterpolantFactoryMethodBezier:
        return or;
    }
  }
  getValueSize() {
    return this.values.length / this.times.length;
  }
  shift(t) {
    if (t !== 0) {
      const e = this.times;
      for (let i = 0, s = e.length; i !== s; ++i) e[i] += t;
    }
    return this;
  }
  scale(t) {
    if (t !== 1) {
      const e = this.times;
      for (let i = 0, s = e.length; i !== s; ++i) e[i] *= t;
      os(this.settings) && (kl(this.settings.inTangents, t), kl(this.settings.outTangents, t));
    }
    return this;
  }
  trim(t, e) {
    const i = this.times, s = i.length;
    let n = 0, r = s - 1;
    for (; n !== s && i[n] < t; ) ++n;
    for (; r !== -1 && i[r] > e; ) --r;
    if (++r, n !== 0 || r !== s) {
      n >= r && (r = Math.max(r, 1), n = r - 1);
      const a = this.getValueSize();
      this.times = i.slice(n, r), this.values = this.values.slice(n * a, r * a);
    }
    return this;
  }
  validate() {
    let t = true;
    const e = this.getValueSize();
    e - Math.floor(e) !== 0 && (X("KeyframeTrack: Invalid value size in track.", this), t = false);
    const i = this.times, s = this.values, n = i.length;
    n === 0 && (X("KeyframeTrack: Track is empty.", this), t = false);
    let r = null;
    for (let a = 0; a !== n; a++) {
      const o = i[a];
      if (typeof o == "number" && isNaN(o)) {
        X("KeyframeTrack: Time is not a valid number.", this, a, o), t = false;
        break;
      }
      if (r !== null && r > o) {
        X("KeyframeTrack: Out of order keys.", this, a, o, r), t = false;
        break;
      }
      r = o;
    }
    if (s !== void 0 && dr(s)) for (let a = 0, o = s.length; a !== o; ++a) {
      const h = s[a];
      if (isNaN(h)) {
        X("KeyframeTrack: Value is not a valid number.", this, a, h), t = false;
        break;
      }
    }
    return t;
  }
  optimize() {
    const t = this.times.slice(), e = this.values.slice(), i = this.getValueSize(), s = this.getInterpolation() === As, n = t.length - 1;
    let r = 1;
    for (let a = 1; a < n; ++a) {
      let o = false;
      const h = t[a], c = t[a + 1];
      if (h !== c && (a !== 1 || h !== t[0])) if (s) o = true;
      else {
        const u = a * i, d = u - i, p = u + i;
        for (let f = 0; f !== i; ++f) {
          const m = e[u + f];
          if (m !== e[d + f] || m !== e[p + f]) {
            o = true;
            break;
          }
        }
      }
      if (o) {
        if (a !== r) {
          t[r] = t[a];
          const u = a * i, d = r * i;
          for (let p = 0; p !== i; ++p) e[d + p] = e[u + p];
        }
        ++r;
      }
    }
    if (n > 0) {
      t[r] = t[n];
      for (let a = n * i, o = r * i, h = 0; h !== i; ++h) e[o + h] = e[a + h];
      ++r;
    }
    return r !== t.length ? (this.times = t.slice(0, r), this.values = e.slice(0, r * i)) : (this.times = t, this.values = e), this;
  }
  clone() {
    const t = this.times.slice(), e = this.values.slice(), i = this.constructor, s = new i(this.name, t, e);
    return s.createInterpolant = this.createInterpolant, os(this.settings) && (s.settings = { inTangents: this.settings.inTangents.slice(), outTangents: this.settings.outTangents.slice() }), s;
  }
};
function kl(l, t) {
  for (let e = 0, i = l.length; e !== i; e += 2) l[e] *= t;
}
Gt.prototype.ValueTypeName = "", Gt.prototype.TimeBufferType = Float32Array, Gt.prototype.ValueBufferType = Float32Array, Gt.prototype.DefaultInterpolation = Ss;
var Ye = class extends Gt {
  constructor(t, e, i) {
    super(t, e, i);
  }
};
Ye.prototype.ValueTypeName = "bool", Ye.prototype.ValueBufferType = Array, Ye.prototype.DefaultInterpolation = Oi, Ye.prototype.InterpolantFactoryMethodLinear = void 0, Ye.prototype.InterpolantFactoryMethodSmooth = void 0;
var ua = class extends Gt {
  constructor(t, e, i, s) {
    super(t, e, i, s);
  }
};
ua.prototype.ValueTypeName = "color";
var xn = class extends Gt {
  constructor(t, e, i, s) {
    super(t, e, i, s);
  }
};
xn.prototype.ValueTypeName = "number";
var Pl = class extends Ti {
  constructor(t, e, i, s) {
    super(t, e, i, s);
  }
  interpolate_(t, e, i, s) {
    const n = this.resultBuffer, r = this.sampleValues, a = this.valueSize, o = (i - e) / (s - e);
    let h = t * a;
    for (let c = h + a; h !== c; h += 4) _t.slerpFlat(n, 0, r, h - a, r, h, o);
    return n;
  }
};
var bn = class extends Gt {
  constructor(t, e, i, s) {
    super(t, e, i, s);
  }
  InterpolantFactoryMethodLinear(t) {
    return new Pl(this.times, this.values, this.getValueSize(), t);
  }
};
bn.prototype.ValueTypeName = "quaternion", bn.prototype.InterpolantFactoryMethodSmooth = void 0;
var Ze = class extends Gt {
  constructor(t, e, i) {
    super(t, e, i);
  }
};
Ze.prototype.ValueTypeName = "string", Ze.prototype.ValueBufferType = Array, Ze.prototype.DefaultInterpolation = Oi, Ze.prototype.InterpolantFactoryMethodLinear = void 0, Ze.prototype.InterpolantFactoryMethodSmooth = void 0;
var da = class extends Gt {
  constructor(t, e, i, s) {
    super(t, e, i, s);
  }
};
da.prototype.ValueTypeName = "vector";
var pa = class {
  constructor(t, e, i) {
    const s = this;
    let n = false, r = 0, a = 0, o;
    const h = [];
    this.onStart = void 0, this.onLoad = t, this.onProgress = e, this.onError = i, this._abortController = null, this.itemStart = function(c) {
      a++, n === false && s.onStart !== void 0 && s.onStart(c, r, a), n = true;
    }, this.itemEnd = function(c) {
      r++, s.onProgress !== void 0 && s.onProgress(c, r, a), r === a && (n = false, s.onLoad !== void 0 && s.onLoad());
    }, this.itemError = function(c) {
      s.onError !== void 0 && s.onError(c);
    }, this.resolveURL = function(c) {
      return c = c.normalize("NFC"), o ? o(c) : c;
    }, this.setURLModifier = function(c) {
      return o = c, this;
    }, this.addHandler = function(c, u) {
      return h.push(c, u), this;
    }, this.removeHandler = function(c) {
      const u = h.indexOf(c);
      return u !== -1 && h.splice(u, 2), this;
    }, this.getHandler = function(c) {
      for (let u = 0, d = h.length; u < d; u += 2) {
        const p = h[u], f = h[u + 1];
        if (p.global && (p.lastIndex = 0), p.test(c)) return f;
      }
      return null;
    }, this.abort = function() {
      return this.abortController.abort(), this._abortController = null, this;
    };
  }
  get abortController() {
    return this._abortController || (this._abortController = new AbortController()), this._abortController;
  }
};
var Ol = new pa();
var Ft = class {
  constructor(t) {
    this.manager = t !== void 0 ? t : Ol, this.crossOrigin = "anonymous", this.withCredentials = false, this.path = "", this.resourcePath = "", this.requestHeader = {}, typeof __THREE_DEVTOOLS__ < "u" && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", { detail: this }));
  }
  load() {
  }
  loadAsync(t, e) {
    const i = this;
    return new Promise(function(s, n) {
      i.load(t, s, e, n);
    });
  }
  parse() {
  }
  setCrossOrigin(t) {
    return this.crossOrigin = t, this;
  }
  setWithCredentials(t) {
    return this.withCredentials = t, this;
  }
  setPath(t) {
    return this.path = t, this;
  }
  setResourcePath(t) {
    return this.resourcePath = t, this;
  }
  setRequestHeader(t) {
    return this.requestHeader = t, this;
  }
  abort() {
    return this;
  }
};
Ft.DEFAULT_MATERIAL_NAME = "__DEFAULT";
var fa = new G();
var Nl = new w();
var Ll = new w();
var wn = new w();
var _n = new _t();
var ae = new w();
var vn = class extends Y {
  constructor() {
    super(), this.isCamera = true, this.type = "Camera", this.matrixWorldInverse = new G(), this.projectionMatrix = new G(), this.projectionMatrixInverse = new G(), this.coordinateSystem = qt, this._reversedDepth = false;
  }
  get reversedDepth() {
    return this._reversedDepth;
  }
  copy(t, e) {
    return super.copy(t, e), this.matrixWorldInverse.copy(t.matrixWorldInverse), this.projectionMatrix.copy(t.projectionMatrix), this.projectionMatrixInverse.copy(t.projectionMatrixInverse), this.coordinateSystem = t.coordinateSystem, this;
  }
  getWorldDirection(t) {
    return super.getWorldDirection(t).negate();
  }
  updateMatrixWorld(t) {
    super.updateMatrixWorld(t), this.matrixWorld.decompose(wn, _n, ae), ae.x === 1 && ae.y === 1 && ae.z === 1 ? this.matrixWorldInverse.copy(this.matrixWorld).invert() : this.matrixWorldInverse.compose(wn, _n, ae.set(1, 1, 1)).invert();
  }
  updateWorldMatrix(t, e, i = false) {
    super.updateWorldMatrix(t, e, i), this.matrixWorld.decompose(wn, _n, ae), ae.x === 1 && ae.y === 1 && ae.z === 1 ? this.matrixWorldInverse.copy(this.matrixWorld).invert() : this.matrixWorldInverse.compose(wn, _n, ae.set(1, 1, 1)).invert();
  }
  clone() {
    return new this.constructor().copy(this);
  }
};
var Be = new w();
var Vl = new I();
var Dl = new I();
var Dt = class extends vn {
  constructor(t = 50, e = 1, i = 0.1, s = 2e3) {
    super(), this.isPerspectiveCamera = true, this.type = "PerspectiveCamera", this.fov = t, this.zoom = 1, this.near = i, this.far = s, this.focus = 10, this.aspect = e, this.view = null, this.filmGauge = 35, this.filmOffset = 0, this.updateProjectionMatrix();
  }
  copy(t, e) {
    return super.copy(t, e), this.fov = t.fov, this.zoom = t.zoom, this.near = t.near, this.far = t.far, this.focus = t.focus, this.aspect = t.aspect, this.view = t.view === null ? null : Object.assign({}, t.view), this.filmGauge = t.filmGauge, this.filmOffset = t.filmOffset, this;
  }
  setFocalLength(t) {
    const e = 0.5 * this.getFilmHeight() / t;
    this.fov = ri * 2 * Math.atan(e), this.updateProjectionMatrix();
  }
  getFocalLength() {
    const t = Math.tan(Ve * 0.5 * this.fov);
    return 0.5 * this.getFilmHeight() / t;
  }
  getEffectiveFOV() {
    return ri * 2 * Math.atan(Math.tan(Ve * 0.5 * this.fov) / this.zoom);
  }
  getFilmWidth() {
    return this.filmGauge * Math.min(this.aspect, 1);
  }
  getFilmHeight() {
    return this.filmGauge / Math.max(this.aspect, 1);
  }
  getViewBounds(t, e, i) {
    Be.set(-1, -1, 0.5).applyMatrix4(this.projectionMatrixInverse), e.set(Be.x, Be.y).multiplyScalar(-t / Be.z), Be.set(1, 1, 0.5).applyMatrix4(this.projectionMatrixInverse), i.set(Be.x, Be.y).multiplyScalar(-t / Be.z);
  }
  getViewSize(t, e) {
    return this.getViewBounds(t, Vl, Dl), e.subVectors(Dl, Vl);
  }
  setViewOffset(t, e, i, s, n, r) {
    this.aspect = t / e, this.view === null && (this.view = { enabled: true, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 }), this.view.enabled = true, this.view.fullWidth = t, this.view.fullHeight = e, this.view.offsetX = i, this.view.offsetY = s, this.view.width = n, this.view.height = r, this.updateProjectionMatrix();
  }
  clearViewOffset() {
    this.view !== null && (this.view.enabled = false), this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    const t = this.near;
    let e = t * Math.tan(Ve * 0.5 * this.fov) / this.zoom, i = 2 * e, s = this.aspect * i, n = -0.5 * s;
    const r = this.view;
    if (this.view !== null && this.view.enabled) {
      const o = r.fullWidth, h = r.fullHeight;
      n += r.offsetX * s / o, e -= r.offsetY * i / h, s *= r.width / o, i *= r.height / h;
    }
    const a = this.filmOffset;
    a !== 0 && (n += t * a / this.getFilmWidth()), this.projectionMatrix.makePerspective(n, n + s, e, e - i, t, this.far, this.coordinateSystem, this.reversedDepth), this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  toJSON(t) {
    const e = super.toJSON(t);
    return e.object.fov = this.fov, e.object.zoom = this.zoom, e.object.near = this.near, e.object.far = this.far, e.object.focus = this.focus, e.object.aspect = this.aspect, this.view !== null && (e.object.view = Object.assign({}, this.view)), e.object.filmGauge = this.filmGauge, e.object.filmOffset = this.filmOffset, e;
  }
};
var ma = class extends vn {
  constructor(t = -1, e = 1, i = 1, s = -1, n = 0.1, r = 2e3) {
    super(), this.isOrthographicCamera = true, this.type = "OrthographicCamera", this.zoom = 1, this.view = null, this.left = t, this.right = e, this.top = i, this.bottom = s, this.near = n, this.far = r, this.updateProjectionMatrix();
  }
  copy(t, e) {
    return super.copy(t, e), this.left = t.left, this.right = t.right, this.top = t.top, this.bottom = t.bottom, this.near = t.near, this.far = t.far, this.zoom = t.zoom, this.view = t.view === null ? null : Object.assign({}, t.view), this;
  }
  setViewOffset(t, e, i, s, n, r) {
    this.view === null && (this.view = { enabled: true, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 }), this.view.enabled = true, this.view.fullWidth = t, this.view.fullHeight = e, this.view.offsetX = i, this.view.offsetY = s, this.view.width = n, this.view.height = r, this.updateProjectionMatrix();
  }
  clearViewOffset() {
    this.view !== null && (this.view.enabled = false), this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    const t = (this.right - this.left) / (2 * this.zoom), e = (this.top - this.bottom) / (2 * this.zoom), i = (this.right + this.left) / 2, s = (this.top + this.bottom) / 2;
    let n = i - t, r = i + t, a = s + e, o = s - e;
    if (this.view !== null && this.view.enabled) {
      const h = (this.right - this.left) / this.view.fullWidth / this.zoom, c = (this.top - this.bottom) / this.view.fullHeight / this.zoom;
      n += h * this.view.offsetX, r = n + h * this.view.width, a -= c * this.view.offsetY, o = a - c * this.view.height;
    }
    this.projectionMatrix.makeOrthographic(n, r, a, o, this.near, this.far, this.coordinateSystem, this.reversedDepth), this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  toJSON(t) {
    const e = super.toJSON(t);
    return e.object.zoom = this.zoom, e.object.left = this.left, e.object.right = this.right, e.object.top = this.top, e.object.bottom = this.bottom, e.object.near = this.near, e.object.far = this.far, this.view !== null && (e.object.view = Object.assign({}, this.view)), e;
  }
};
var jl = new G();
var Kl = new G();
var $e = new G();
var Ii = -90;
var zi = 1;
var Ff = class extends Y {
  constructor(t, e, i) {
    super(), this.type = "CubeCamera", this.renderTarget = i, this.coordinateSystem = null, this.activeMipmapLevel = 0;
    const s = new Dt(Ii, zi, t, e);
    s.layers = this.layers, this.add(s);
    const n = new Dt(Ii, zi, t, e);
    n.layers = this.layers, this.add(n);
    const r = new Dt(Ii, zi, t, e);
    r.layers = this.layers, this.add(r);
    const a = new Dt(Ii, zi, t, e);
    a.layers = this.layers, this.add(a);
    const o = new Dt(Ii, zi, t, e);
    o.layers = this.layers, this.add(o);
    const h = new Dt(Ii, zi, t, e);
    h.layers = this.layers, this.add(h);
  }
  updateCoordinateSystem() {
    const t = this.coordinateSystem, e = this.children.concat(), [i, s, n, r, a, o] = e;
    for (const h of e) this.remove(h);
    if (t === qt) i.up.set(0, 1, 0), i.lookAt(1, 0, 0), s.up.set(0, 1, 0), s.lookAt(-1, 0, 0), n.up.set(0, 0, -1), n.lookAt(0, 1, 0), r.up.set(0, 0, 1), r.lookAt(0, -1, 0), a.up.set(0, 1, 0), a.lookAt(0, 0, 1), o.up.set(0, 1, 0), o.lookAt(0, 0, -1);
    else if (t === Le) i.up.set(0, -1, 0), i.lookAt(-1, 0, 0), s.up.set(0, -1, 0), s.lookAt(1, 0, 0), n.up.set(0, 0, 1), n.lookAt(0, 1, 0), r.up.set(0, 0, -1), r.lookAt(0, -1, 0), a.up.set(0, -1, 0), a.lookAt(0, 0, 1), o.up.set(0, -1, 0), o.lookAt(0, 0, -1);
    else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: " + t);
    for (const h of e) this.add(h), h.updateMatrixWorld();
  }
  update(t, e) {
    this.parent === null && this.updateMatrixWorld();
    const { renderTarget: i, activeMipmapLevel: s } = this;
    this.coordinateSystem !== t.coordinateSystem && (this.coordinateSystem = t.coordinateSystem, this.updateCoordinateSystem());
    const [n, r, a, o, h, c] = this.children, u = t.getRenderTarget(), d = t.getActiveCubeFace(), p = t.getActiveMipmapLevel(), f = t.xr.enabled;
    t.xr.enabled = false;
    const m = i.texture.generateMipmaps;
    i.texture.generateMipmaps = false;
    let y = false;
    t.isWebGLRenderer === true ? y = t.state.buffers.depth.getReversed() : y = t.reversedDepthBuffer, t.setRenderTarget(i, 0, s), y && t.autoClear === false && t.clearDepth(), t.render(e, n), t.setRenderTarget(i, 1, s), y && t.autoClear === false && t.clearDepth(), t.render(e, r), t.setRenderTarget(i, 2, s), y && t.autoClear === false && t.clearDepth(), t.render(e, a), t.setRenderTarget(i, 3, s), y && t.autoClear === false && t.clearDepth(), t.render(e, o), t.setRenderTarget(i, 4, s), y && t.autoClear === false && t.clearDepth(), t.render(e, h), i.texture.generateMipmaps = m, t.setRenderTarget(i, 5, s), y && t.autoClear === false && t.clearDepth(), t.render(e, c), t.setRenderTarget(u, d, p), t.xr.enabled = f, i.texture.needsPMREMUpdate = true;
  }
};
var kf = class extends Dt {
  constructor(t = []) {
    super(), this.isArrayCamera = true, this.isMultiViewCamera = false, this.cameras = t;
  }
};
var Qe = new w();
var wa = new _t();
var Rf = new w();
var je = new w();
var Ke = new w();
var ti = new w();
var ic = new _t();
var Ef = new w();
var ei = new w();
var _a = "\\[\\]\\.:\\/";
var Vf = new RegExp("[" + _a + "]", "g");
var va = "[^" + _a + "]";
var Df = "[^" + _a.replace("\\.", "") + "]";
var Uf = /((?:WC+[\/:])*)/.source.replace("WC", va);
var Wf = /(WCOD+)?/.source.replace("WCOD", Df);
var Gf = /(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC", va);
var Hf = /\.(WC+)(?:\[(.+)\])?/.source.replace("WC", va);
var qf = new RegExp("^" + Uf + Wf + Gf + Hf + "$");
var Jf = ["material", "materials", "bones", "map"];
var Xf = class {
  constructor(t, e, i) {
    const s = i || Z.parseTrackName(e);
    this._targetGroup = t, this._bindings = t.subscribe_(e, s);
  }
  getValue(t, e) {
    this.bind();
    const i = this._targetGroup.nCachedObjects_, s = this._bindings[i];
    s !== void 0 && s.getValue(t, e);
  }
  setValue(t, e) {
    const i = this._bindings;
    for (let s = this._targetGroup.nCachedObjects_, n = i.length; s !== n; ++s) i[s].setValue(t, e);
  }
  bind() {
    const t = this._bindings;
    for (let e = this._targetGroup.nCachedObjects_, i = t.length; e !== i; ++e) t[e].bind();
  }
  unbind() {
    const t = this._bindings;
    for (let e = this._targetGroup.nCachedObjects_, i = t.length; e !== i; ++e) t[e].unbind();
  }
};
var Z = class _Z {
  constructor(t, e, i) {
    this.path = e, this.parsedPath = i || _Z.parseTrackName(e), this.node = _Z.findNode(t, this.parsedPath.nodeName), this.rootNode = t, this.getValue = this._getValue_unbound, this.setValue = this._setValue_unbound;
  }
  static create(t, e, i) {
    return t && t.isAnimationObjectGroup ? new _Z.Composite(t, e, i) : new _Z(t, e, i);
  }
  static sanitizeNodeName(t) {
    return t.replace(/\s/g, "_").replace(Vf, "");
  }
  static parseTrackName(t) {
    const e = qf.exec(t);
    if (e === null) throw new Error("THREE.PropertyBinding: Cannot parse trackName: " + t);
    const i = { nodeName: e[2], objectName: e[3], objectIndex: e[4], propertyName: e[5], propertyIndex: e[6] }, s = i.nodeName && i.nodeName.lastIndexOf(".");
    if (s !== void 0 && s !== -1) {
      const n = i.nodeName.substring(s + 1);
      Jf.indexOf(n) !== -1 && (i.nodeName = i.nodeName.substring(0, s), i.objectName = n);
    }
    if (i.propertyName === null || i.propertyName.length === 0) throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: " + t);
    return i;
  }
  static findNode(t, e) {
    if (e === void 0 || e === "" || e === "." || e === -1 || e === t.name || e === t.uuid) return t;
    if (t.skeleton) {
      const i = t.skeleton.getBoneByName(e);
      if (i !== void 0) return i;
    }
    if (t.children) {
      const i = function(n) {
        for (let r = 0; r < n.length; r++) {
          const a = n[r];
          if (a.name === e || a.uuid === e) return a;
          const o = i(a.children);
          if (o) return o;
        }
        return null;
      }, s = i(t.children);
      if (s) return s;
    }
    return null;
  }
  _getValue_unavailable() {
  }
  _setValue_unavailable() {
  }
  _getValue_direct(t, e) {
    t[e] = this.targetObject[this.propertyName];
  }
  _getValue_array(t, e) {
    const i = this.resolvedProperty;
    for (let s = 0, n = i.length; s !== n; ++s) t[e++] = i[s];
  }
  _getValue_arrayElement(t, e) {
    t[e] = this.resolvedProperty[this.propertyIndex];
  }
  _getValue_toArray(t, e) {
    this.resolvedProperty.toArray(t, e);
  }
  _setValue_direct(t, e) {
    this.targetObject[this.propertyName] = t[e];
  }
  _setValue_direct_setNeedsUpdate(t, e) {
    this.targetObject[this.propertyName] = t[e], this.targetObject.needsUpdate = true;
  }
  _setValue_direct_setMatrixWorldNeedsUpdate(t, e) {
    this.targetObject[this.propertyName] = t[e], this.targetObject.matrixWorldNeedsUpdate = true;
  }
  _setValue_array(t, e) {
    const i = this.resolvedProperty;
    for (let s = 0, n = i.length; s !== n; ++s) i[s] = t[e++];
  }
  _setValue_array_setNeedsUpdate(t, e) {
    const i = this.resolvedProperty;
    for (let s = 0, n = i.length; s !== n; ++s) i[s] = t[e++];
    this.targetObject.needsUpdate = true;
  }
  _setValue_array_setMatrixWorldNeedsUpdate(t, e) {
    const i = this.resolvedProperty;
    for (let s = 0, n = i.length; s !== n; ++s) i[s] = t[e++];
    this.targetObject.matrixWorldNeedsUpdate = true;
  }
  _setValue_arrayElement(t, e) {
    this.resolvedProperty[this.propertyIndex] = t[e];
  }
  _setValue_arrayElement_setNeedsUpdate(t, e) {
    this.resolvedProperty[this.propertyIndex] = t[e], this.targetObject.needsUpdate = true;
  }
  _setValue_arrayElement_setMatrixWorldNeedsUpdate(t, e) {
    this.resolvedProperty[this.propertyIndex] = t[e], this.targetObject.matrixWorldNeedsUpdate = true;
  }
  _setValue_fromArray(t, e) {
    this.resolvedProperty.fromArray(t, e);
  }
  _setValue_fromArray_setNeedsUpdate(t, e) {
    this.resolvedProperty.fromArray(t, e), this.targetObject.needsUpdate = true;
  }
  _setValue_fromArray_setMatrixWorldNeedsUpdate(t, e) {
    this.resolvedProperty.fromArray(t, e), this.targetObject.matrixWorldNeedsUpdate = true;
  }
  _getValue_unbound(t, e) {
    this.bind(), this.getValue(t, e);
  }
  _setValue_unbound(t, e) {
    this.bind(), this.setValue(t, e);
  }
  bind() {
    let t = this.node;
    const e = this.parsedPath, i = e.objectName, s = e.propertyName;
    let n = e.propertyIndex;
    if (t || (t = _Z.findNode(this.rootNode, e.nodeName), this.node = t), this.getValue = this._getValue_unavailable, this.setValue = this._setValue_unavailable, !t) {
      V("PropertyBinding: No target node found for track: " + this.path + ".");
      return;
    }
    if (i) {
      let h = e.objectIndex;
      switch (i) {
        case "materials":
          if (!t.material) {
            X("PropertyBinding: Can not bind to material as node does not have a material.", this);
            return;
          }
          if (!t.material.materials) {
            X("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.", this);
            return;
          }
          t = t.material.materials;
          break;
        case "bones":
          if (!t.skeleton) {
            X("PropertyBinding: Can not bind to bones as node does not have a skeleton.", this);
            return;
          }
          t = t.skeleton.bones;
          for (let c = 0; c < t.length; c++) if (t[c].name === h) {
            h = c;
            break;
          }
          break;
        case "map":
          if ("map" in t) {
            t = t.map;
            break;
          }
          if (!t.material) {
            X("PropertyBinding: Can not bind to material as node does not have a material.", this);
            return;
          }
          if (!t.material.map) {
            X("PropertyBinding: Can not bind to material.map as node.material does not have a map.", this);
            return;
          }
          t = t.material.map;
          break;
        default:
          if (t[i] === void 0) {
            X("PropertyBinding: Can not bind to objectName of node undefined.", this);
            return;
          }
          t = t[i];
      }
      if (h !== void 0) {
        if (t[h] === void 0) {
          X("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.", this, t);
          return;
        }
        t = t[h];
      }
    }
    const r = t[s];
    if (r === void 0) {
      const h = e.nodeName;
      X("PropertyBinding: Trying to update property for track: " + h + "." + s + " but it wasn't found.", t);
      return;
    }
    let a = this.Versioning.None;
    this.targetObject = t, t.isMaterial === true ? a = this.Versioning.NeedsUpdate : t.isObject3D === true && (a = this.Versioning.MatrixWorldNeedsUpdate);
    let o = this.BindingType.Direct;
    if (n !== void 0) {
      if (s === "morphTargetInfluences") {
        if (!t.geometry) {
          X("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.", this);
          return;
        }
        if (!t.geometry.morphAttributes) {
          X("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.", this);
          return;
        }
        t.morphTargetDictionary[n] !== void 0 && (n = t.morphTargetDictionary[n]);
      }
      o = this.BindingType.ArrayElement, this.resolvedProperty = r, this.propertyIndex = n;
    } else r.fromArray !== void 0 && r.toArray !== void 0 ? (o = this.BindingType.HasFromToArray, this.resolvedProperty = r) : Array.isArray(r) ? (o = this.BindingType.EntireArray, this.resolvedProperty = r) : this.propertyName = s;
    this.getValue = this.GetterByBindingType[o], this.setValue = this.SetterByBindingTypeAndVersioning[o][a];
  }
  unbind() {
    this.node = null, this.getValue = this._getValue_unbound, this.setValue = this._setValue_unbound;
  }
};
Z.Composite = Xf, Z.prototype.BindingType = { Direct: 0, EntireArray: 1, ArrayElement: 2, HasFromToArray: 3 }, Z.prototype.Versioning = { None: 0, NeedsUpdate: 1, MatrixWorldNeedsUpdate: 2 }, Z.prototype.GetterByBindingType = [Z.prototype._getValue_direct, Z.prototype._getValue_array, Z.prototype._getValue_arrayElement, Z.prototype._getValue_toArray], Z.prototype.SetterByBindingTypeAndVersioning = [[Z.prototype._setValue_direct, Z.prototype._setValue_direct_setNeedsUpdate, Z.prototype._setValue_direct_setMatrixWorldNeedsUpdate], [Z.prototype._setValue_array, Z.prototype._setValue_array_setNeedsUpdate, Z.prototype._setValue_array_setMatrixWorldNeedsUpdate], [Z.prototype._setValue_arrayElement, Z.prototype._setValue_arrayElement_setNeedsUpdate, Z.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate], [Z.prototype._setValue_fromArray, Z.prototype._setValue_fromArray_setNeedsUpdate, Z.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];
var Zf = new Float32Array(1);
var rc = new G();
var za = class _za {
  static {
    _za.prototype.isMatrix2 = true;
  }
  constructor(t, e, i, s) {
    this.elements = [1, 0, 0, 1], t !== void 0 && this.set(t, e, i, s);
  }
  identity() {
    return this.set(1, 0, 0, 1), this;
  }
  fromArray(t, e = 0) {
    for (let i = 0; i < 4; i++) this.elements[i] = t[i + e];
    return this;
  }
  set(t, e, i, s) {
    const n = this.elements;
    return n[0] = t, n[2] = e, n[1] = i, n[3] = s, this;
  }
};
var oc = new I();
var lc = new w();
var An = new w();
var Bi = new w();
var Fi = new w();
var Aa = new w();
var am = new w();
var om = new w();
var cc = new w();
var Fe = new w();
var Tn = new G();
var Ta = new G();
var dm = new w();
var dc = new U();
var pc = new U();
var fc = new w();
var Cn = new w();
var mc = new w();
var In = new w();
var at = new vn();
var zn = new gt();
var yc = new w();
function gc(l, t, e, i) {
  const s = Im(i);
  switch (e) {
    case so:
      return l * t;
    case rr:
      return l * t / s.components * s.byteLength;
    case ar:
      return l * t / s.components * s.byteLength;
    case ao:
      return l * t * 2 / s.components * s.byteLength;
    case oo:
      return l * t * 2 / s.components * s.byteLength;
    case no:
      return l * t * 3 / s.components * s.byteLength;
    case si:
      return l * t * 4 / s.components * s.byteLength;
    case ho:
      return l * t * 4 / s.components * s.byteLength;
    case lo:
    case co:
      return Math.floor((l + 3) / 4) * Math.floor((t + 3) / 4) * 8;
    case uo:
    case po:
      return Math.floor((l + 3) / 4) * Math.floor((t + 3) / 4) * 16;
    case mo:
    case go:
      return Math.max(l, 16) * Math.max(t, 8) / 4;
    case fo:
    case yo:
      return Math.max(l, 8) * Math.max(t, 8) / 2;
    case xo:
    case bo:
    case wo:
    case _o:
      return Math.floor((l + 3) / 4) * Math.floor((t + 3) / 4) * 8;
    case Mo:
    case vo:
    case So:
      return Math.floor((l + 3) / 4) * Math.floor((t + 3) / 4) * 16;
    case Ao:
      return Math.floor((l + 3) / 4) * Math.floor((t + 3) / 4) * 16;
    case To:
      return Math.floor((l + 4) / 5) * Math.floor((t + 3) / 4) * 16;
    case Co:
      return Math.floor((l + 4) / 5) * Math.floor((t + 4) / 5) * 16;
    case Io:
      return Math.floor((l + 5) / 6) * Math.floor((t + 4) / 5) * 16;
    case zo:
      return Math.floor((l + 5) / 6) * Math.floor((t + 5) / 6) * 16;
    case Bo:
      return Math.floor((l + 7) / 8) * Math.floor((t + 4) / 5) * 16;
    case Fo:
      return Math.floor((l + 7) / 8) * Math.floor((t + 5) / 6) * 16;
    case ko:
      return Math.floor((l + 7) / 8) * Math.floor((t + 7) / 8) * 16;
    case Po:
      return Math.floor((l + 9) / 10) * Math.floor((t + 4) / 5) * 16;
    case Ro:
      return Math.floor((l + 9) / 10) * Math.floor((t + 5) / 6) * 16;
    case Oo:
      return Math.floor((l + 9) / 10) * Math.floor((t + 7) / 8) * 16;
    case Eo:
      return Math.floor((l + 9) / 10) * Math.floor((t + 9) / 10) * 16;
    case No:
      return Math.floor((l + 11) / 12) * Math.floor((t + 9) / 10) * 16;
    case Lo:
      return Math.floor((l + 11) / 12) * Math.floor((t + 11) / 12) * 16;
    case Vo:
    case Do:
    case Uo:
      return Math.ceil(l / 4) * Math.ceil(t / 4) * 16;
    case Wo:
    case Go:
      return Math.ceil(l / 4) * Math.ceil(t / 4) * 8;
    case Ho:
    case qo:
      return Math.ceil(l / 4) * Math.ceil(t / 4) * 16;
  }
  throw new Error(`Unable to determine texture byte length for ${e} format.`);
}
function Im(l) {
  switch (l) {
    case _s:
    case Ya:
      return { byteLength: 1, components: 1 };
    case $a:
    case Za:
    case ja:
      return { byteLength: 2, components: 1 };
    case Ka:
    case to:
      return { byteLength: 2, components: 4 };
    case Ri:
    case Qa:
    case Re:
      return { byteLength: 4, components: 1 };
    case eo:
    case io:
      return { byteLength: 4, components: 3 };
  }
  throw new Error(`THREE.TextureUtils: Unknown texture type ${l}.`);
}
typeof __THREE_DEVTOOLS__ < "u" && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register", { detail: { revision: "186" } })), typeof window < "u" && (window.__THREE__ ? V("WARNING: Multiple instances of Three.js being imported.") : window.__THREE__ = "186");

// quartz/components/scripts/vendor/three/three.module.js
function Na2() {
  let e = null, n = false, t = null, i = null;
  function l(o, d) {
    i = e.requestAnimationFrame(l), t(o, d);
  }
  return { start: function() {
    n !== true && t !== null && e !== null && (i = e.requestAnimationFrame(l), n = true);
  }, stop: function() {
    e !== null && e.cancelAnimationFrame(i), n = false;
  }, setAnimationLoop: function(o) {
    t = o;
  }, setContext: function(o) {
    e = o;
  } };
}
function Mo2(e) {
  const n = /* @__PURE__ */ new WeakMap();
  function t(g, R) {
    const T = g.array, H2 = g.usage, I2 = T.byteLength, p = e.createBuffer();
    e.bindBuffer(R, p), e.bufferData(R, T, H2), g.onUploadCallback();
    let x;
    if (T instanceof Float32Array) x = e.FLOAT;
    else if (typeof Float16Array < "u" && T instanceof Float16Array) x = e.HALF_FLOAT;
    else if (T instanceof Uint16Array) g.isFloat16BufferAttribute ? x = e.HALF_FLOAT : x = e.UNSIGNED_SHORT;
    else if (T instanceof Int16Array) x = e.SHORT;
    else if (T instanceof Uint32Array) x = e.UNSIGNED_INT;
    else if (T instanceof Int32Array) x = e.INT;
    else if (T instanceof Int8Array) x = e.BYTE;
    else if (T instanceof Uint8Array) x = e.UNSIGNED_BYTE;
    else if (T instanceof Uint8ClampedArray) x = e.UNSIGNED_BYTE;
    else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: " + T);
    return { buffer: p, type: x, bytesPerElement: T.BYTES_PER_ELEMENT, version: g.version, size: I2 };
  }
  function i(g, R, T) {
    const H2 = R.array, I2 = R.updateRanges;
    if (e.bindBuffer(T, g), I2.length === 0) e.bufferSubData(T, 0, H2);
    else {
      I2.sort((x, N) => x.start - N.start);
      let p = 0;
      for (let x = 1; x < I2.length; x++) {
        const N = I2[p], W2 = I2[x];
        W2.start <= N.start + N.count + 1 ? N.count = Math.max(N.count, W2.start + W2.count - N.start) : (++p, I2[p] = W2);
      }
      I2.length = p + 1;
      for (let x = 0, N = I2.length; x < N; x++) {
        const W2 = I2[x];
        e.bufferSubData(T, W2.start * H2.BYTES_PER_ELEMENT, H2, W2.start, W2.count);
      }
      R.clearUpdateRanges();
    }
    R.onUploadCallback();
  }
  function l(g) {
    return g.isInterleavedBufferAttribute && (g = g.data), n.get(g);
  }
  function o(g) {
    g.isInterleavedBufferAttribute && (g = g.data);
    const R = n.get(g);
    R && (e.deleteBuffer(R.buffer), n.delete(g));
  }
  function d(g, R) {
    if (g.isInterleavedBufferAttribute && (g = g.data), g.isGLBufferAttribute) {
      const H2 = n.get(g);
      (!H2 || H2.version < g.version) && n.set(g, { buffer: g.buffer, type: g.type, bytesPerElement: g.elementSize, version: g.version });
      return;
    }
    const T = n.get(g);
    if (T === void 0) n.set(g, t(g, R));
    else if (T.version < g.version) {
      if (T.size !== g.array.byteLength) throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");
      i(T.buffer, g, R), T.version = g.version;
    }
  }
  return { get: l, remove: o, update: d };
}
var xo2 = `#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`;
var To2 = `#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`;
var Ao2 = `#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`;
var Ro2 = `#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`;
var bo2 = `#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`;
var Co2 = `#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`;
var Po2 = `#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`;
var Lo2 = `#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`;
var Uo2 = `#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`;
var Do2 = `#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`;
var wo2 = `vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`;
var Io2 = `vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`;
var No2 = `float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`;
var yo2 = `#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`;
var Fo2 = `#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`;
var Oo2 = `#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`;
var Bo2 = `#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`;
var Go2 = `#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`;
var Ho2 = `#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`;
var Vo2 = `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`;
var Wo2 = `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`;
var ko2 = `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`;
var zo2 = `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`;
var Xo2 = `#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`;
var Ko = `#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`;
var Yo2 = `vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`;
var qo2 = `#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`;
var Zo2 = `#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`;
var $o2 = `#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`;
var Qo2 = `#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`;
var Jo2 = "gl_FragColor = linearToOutputTexel( gl_FragColor );";
var jo2 = `vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`;
var es2 = `#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`;
var ts2 = `#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`;
var ns2 = `#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`;
var is2 = `#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`;
var rs2 = `#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`;
var as2 = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`;
var os2 = `#ifdef USE_FOG
	varying float vFogDepth;
#endif`;
var ss2 = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
var ls2 = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
var cs2 = `#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`;
var fs = `#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`;
var ds2 = `LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`;
var us2 = `varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`;
var ps2 = `uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`;
var hs2 = `#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureCubeUV( envMap, envMapRotation * retroVec, roughness );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`;
var ms = `ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`;
var _s2 = `varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`;
var gs2 = `BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`;
var vs2 = `varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`;
var Ss2 = `PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`;
var Es2 = `uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`;
var Ms2 = `
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`;
var xs2 = `#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`;
var Ts2 = `#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`;
var As2 = `#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`;
var Rs2 = `#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`;
var bs2 = `#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`;
var Cs2 = `#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`;
var Ps2 = `#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`;
var Ls2 = `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`;
var Us2 = `#ifdef USE_MAP
	uniform sampler2D map;
#endif`;
var Ds = `#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`;
var ws2 = `#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`;
var Is2 = `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`;
var Ns2 = `#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`;
var ys2 = `#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`;
var Fs2 = `#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`;
var Os2 = `#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`;
var Bs2 = `#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`;
var Gs2 = `#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`;
var Hs2 = `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`;
var Vs2 = `#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`;
var Ws2 = `#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`;
var ks2 = `#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`;
var zs2 = `#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`;
var Xs2 = `#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`;
var Ks2 = `#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`;
var Ys2 = `#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`;
var qs2 = `#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`;
var Zs2 = `#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`;
var $s2 = `#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`;
var Qs2 = `vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`;
var Js2 = `#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`;
var js = `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;
var el2 = `#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`;
var tl2 = `#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`;
var nl2 = `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`;
var il2 = `#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`;
var rl2 = `#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`;
var al2 = `#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`;
var ol2 = `#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`;
var sl2 = `float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`;
var ll2 = `#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`;
var cl2 = `#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`;
var fl2 = `#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`;
var dl2 = `#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`;
var ul2 = `float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`;
var pl2 = `#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`;
var hl2 = `#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`;
var ml2 = `#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`;
var _l2 = `#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`;
var gl2 = `#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`;
var vl2 = `#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`;
var Sl2 = `#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`;
var El2 = `#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`;
var Ml2 = `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;
var xl2 = `varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`;
var Tl = `uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
var Al2 = `varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`;
var Rl = `#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
var bl2 = `varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`;
var Cl = `uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
var Pl2 = `#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`;
var Ll2 = `#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`;
var Ul2 = `#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`;
var Dl2 = `#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`;
var wl2 = `varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`;
var Il2 = `uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
var Nl2 = `uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`;
var yl2 = `uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`;
var Fl2 = `#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`;
var Ol2 = `uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`;
var Bl2 = `#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`;
var Gl2 = `#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`;
var Hl2 = `#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`;
var Vl2 = `#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`;
var Wl2 = `#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`;
var kl2 = `#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`;
var zl2 = `#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`;
var Xl = `#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`;
var Kl2 = `#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`;
var Yl2 = `#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`;
var ql2 = `#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`;
var Zl2 = `#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`;
var $l = `uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`;
var Ql = `uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`;
var Jl2 = `#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`;
var jl2 = `uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`;
var ec2 = `uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`;
var tc2 = `uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`;
var Pe = { alphahash_fragment: xo2, alphahash_pars_fragment: To2, alphamap_fragment: Ao2, alphamap_pars_fragment: Ro2, alphatest_fragment: bo2, alphatest_pars_fragment: Co2, aomap_fragment: Po2, aomap_pars_fragment: Lo2, batching_pars_vertex: Uo2, batching_vertex: Do2, begin_vertex: wo2, beginnormal_vertex: Io2, bsdfs: No2, iridescence_fragment: yo2, bumpmap_pars_fragment: Fo2, clipping_planes_fragment: Oo2, clipping_planes_pars_fragment: Bo2, clipping_planes_pars_vertex: Go2, clipping_planes_vertex: Ho2, color_fragment: Vo2, color_pars_fragment: Wo2, color_pars_vertex: ko2, color_vertex: zo2, common: Xo2, cube_uv_reflection_fragment: Ko, defaultnormal_vertex: Yo2, displacementmap_pars_vertex: qo2, displacementmap_vertex: Zo2, emissivemap_fragment: $o2, emissivemap_pars_fragment: Qo2, colorspace_fragment: Jo2, colorspace_pars_fragment: jo2, envmap_fragment: es2, envmap_common_pars_fragment: ts2, envmap_pars_fragment: ns2, envmap_pars_vertex: is2, envmap_physical_pars_fragment: hs2, envmap_vertex: rs2, fog_vertex: as2, fog_pars_vertex: os2, fog_fragment: ss2, fog_pars_fragment: ls2, gradientmap_pars_fragment: cs2, lightmap_pars_fragment: fs, lights_lambert_fragment: ds2, lights_lambert_pars_fragment: us2, lights_pars_begin: ps2, lights_toon_fragment: ms, lights_toon_pars_fragment: _s2, lights_phong_fragment: gs2, lights_phong_pars_fragment: vs2, lights_physical_fragment: Ss2, lights_physical_pars_fragment: Es2, lights_fragment_begin: Ms2, lights_fragment_maps: xs2, lights_fragment_end: Ts2, lightprobes_pars_fragment: As2, logdepthbuf_fragment: Rs2, logdepthbuf_pars_fragment: bs2, logdepthbuf_pars_vertex: Cs2, logdepthbuf_vertex: Ps2, map_fragment: Ls2, map_pars_fragment: Us2, map_particle_fragment: Ds, map_particle_pars_fragment: ws2, metalnessmap_fragment: Is2, metalnessmap_pars_fragment: Ns2, morphinstance_vertex: ys2, morphcolor_vertex: Fs2, morphnormal_vertex: Os2, morphtarget_pars_vertex: Bs2, morphtarget_vertex: Gs2, normal_fragment_begin: Hs2, normal_fragment_maps: Vs2, normal_pars_fragment: Ws2, normal_pars_vertex: ks2, normal_vertex: zs2, normalmap_pars_fragment: Xs2, clearcoat_normal_fragment_begin: Ks2, clearcoat_normal_fragment_maps: Ys2, clearcoat_pars_fragment: qs2, iridescence_pars_fragment: Zs2, opaque_fragment: $s2, packing: Qs2, premultiplied_alpha_fragment: Js2, project_vertex: js, dithering_fragment: el2, dithering_pars_fragment: tl2, roughnessmap_fragment: nl2, roughnessmap_pars_fragment: il2, shadowmap_pars_fragment: rl2, shadowmap_pars_vertex: al2, shadowmap_vertex: ol2, shadowmask_pars_fragment: sl2, skinbase_vertex: ll2, skinning_pars_vertex: cl2, skinning_vertex: fl2, skinnormal_vertex: dl2, specularmap_fragment: ul2, specularmap_pars_fragment: pl2, tonemapping_fragment: hl2, tonemapping_pars_fragment: ml2, transmission_fragment: _l2, transmission_pars_fragment: gl2, uv_pars_fragment: vl2, uv_pars_vertex: Sl2, uv_vertex: El2, worldpos_vertex: Ml2, background_vert: xl2, background_frag: Tl, backgroundCube_vert: Al2, backgroundCube_frag: Rl, cube_vert: bl2, cube_frag: Cl, depth_vert: Pl2, depth_frag: Ll2, distance_vert: Ul2, distance_frag: Dl2, equirect_vert: wl2, equirect_frag: Il2, linedashed_vert: Nl2, linedashed_frag: yl2, meshbasic_vert: Fl2, meshbasic_frag: Ol2, meshlambert_vert: Bl2, meshlambert_frag: Gl2, meshmatcap_vert: Hl2, meshmatcap_frag: Vl2, meshnormal_vert: Wl2, meshnormal_frag: kl2, meshphong_vert: zl2, meshphong_frag: Xl, meshphysical_vert: Kl2, meshphysical_frag: Yl2, meshtoon_vert: ql2, meshtoon_frag: Zl2, points_vert: $l, points_frag: Ql, shadow_vert: Jl2, shadow_frag: jl2, sprite_vert: ec2, sprite_frag: tc2 };
var le2 = { common: { diffuse: { value: new U(16777215) }, opacity: { value: 1 }, map: { value: null }, mapTransform: { value: new Kt() }, alphaMap: { value: null }, alphaMapTransform: { value: new Kt() }, alphaTest: { value: 0 } }, specularmap: { specularMap: { value: null }, specularMapTransform: { value: new Kt() } }, envmap: { envMap: { value: null }, envMapRotation: { value: new Kt() }, reflectivity: { value: 1 }, ior: { value: 1.5 }, refractionRatio: { value: 0.98 }, dfgLUT: { value: null } }, aomap: { aoMap: { value: null }, aoMapIntensity: { value: 1 }, aoMapTransform: { value: new Kt() } }, lightmap: { lightMap: { value: null }, lightMapIntensity: { value: 1 }, lightMapTransform: { value: new Kt() } }, bumpmap: { bumpMap: { value: null }, bumpMapTransform: { value: new Kt() }, bumpScale: { value: 1 } }, normalmap: { normalMap: { value: null }, normalMapTransform: { value: new Kt() }, normalScale: { value: new I(1, 1) } }, displacementmap: { displacementMap: { value: null }, displacementMapTransform: { value: new Kt() }, displacementScale: { value: 1 }, displacementBias: { value: 0 } }, emissivemap: { emissiveMap: { value: null }, emissiveMapTransform: { value: new Kt() } }, metalnessmap: { metalnessMap: { value: null }, metalnessMapTransform: { value: new Kt() } }, roughnessmap: { roughnessMap: { value: null }, roughnessMapTransform: { value: new Kt() } }, gradientmap: { gradientMap: { value: null } }, fog: { fogDensity: { value: 25e-5 }, fogNear: { value: 1 }, fogFar: { value: 2e3 }, fogColor: { value: new U(16777215) } }, lights: { ambientLightColor: { value: [] }, lightProbe: { value: [] }, sunLights: { value: [], properties: { direction: {}, color: {} } }, sunLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} } }, sunShadowMatrix: { value: [] }, sunShadowCascade: { value: [] }, directionalLights: { value: [], properties: { direction: {}, color: {} } }, directionalLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} } }, directionalShadowMatrix: { value: [] }, spotLights: { value: [], properties: { color: {}, position: {}, direction: {}, distance: {}, coneCos: {}, penumbraCos: {}, decay: {} } }, spotLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} } }, spotLightMap: { value: [] }, spotLightMatrix: { value: [] }, pointLights: { value: [], properties: { color: {}, position: {}, decay: {}, distance: {} } }, pointLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {}, shadowCameraNear: {}, shadowCameraFar: {} } }, pointShadowMatrix: { value: [] }, hemisphereLights: { value: [], properties: { direction: {}, skyColor: {}, groundColor: {} } }, rectAreaLights: { value: [], properties: { color: {}, position: {}, width: {}, height: {} } }, ltc_1: { value: null }, ltc_2: { value: null }, probesSH: { value: null }, probesMin: { value: new w() }, probesMax: { value: new w() }, probesResolution: { value: new w() } }, points: { diffuse: { value: new U(16777215) }, opacity: { value: 1 }, size: { value: 1 }, scale: { value: 1 }, map: { value: null }, alphaMap: { value: null }, alphaMapTransform: { value: new Kt() }, alphaTest: { value: 0 }, uvTransform: { value: new Kt() } }, sprite: { diffuse: { value: new U(16777215) }, opacity: { value: 1 }, center: { value: new I(0.5, 0.5) }, rotation: { value: 0 }, map: { value: null }, mapTransform: { value: new Kt() }, alphaMap: { value: null }, alphaMapTransform: { value: new Kt() }, alphaTest: { value: 0 } } };
var Rt = { basic: { uniforms: fl([le2.common, le2.specularmap, le2.envmap, le2.aomap, le2.lightmap, le2.fog]), vertexShader: Pe.meshbasic_vert, fragmentShader: Pe.meshbasic_frag }, lambert: { uniforms: fl([le2.common, le2.specularmap, le2.envmap, le2.aomap, le2.lightmap, le2.emissivemap, le2.bumpmap, le2.normalmap, le2.displacementmap, le2.fog, le2.lights, { emissive: { value: new U(0) }, envMapIntensity: { value: 1 } }]), vertexShader: Pe.meshlambert_vert, fragmentShader: Pe.meshlambert_frag }, phong: { uniforms: fl([le2.common, le2.specularmap, le2.envmap, le2.aomap, le2.lightmap, le2.emissivemap, le2.bumpmap, le2.normalmap, le2.displacementmap, le2.fog, le2.lights, { emissive: { value: new U(0) }, specular: { value: new U(1118481) }, shininess: { value: 30 }, envMapIntensity: { value: 1 } }]), vertexShader: Pe.meshphong_vert, fragmentShader: Pe.meshphong_frag }, standard: { uniforms: fl([le2.common, le2.envmap, le2.aomap, le2.lightmap, le2.emissivemap, le2.bumpmap, le2.normalmap, le2.displacementmap, le2.roughnessmap, le2.metalnessmap, le2.fog, le2.lights, { emissive: { value: new U(0) }, roughness: { value: 1 }, metalness: { value: 0 }, envMapIntensity: { value: 1 } }]), vertexShader: Pe.meshphysical_vert, fragmentShader: Pe.meshphysical_frag }, toon: { uniforms: fl([le2.common, le2.aomap, le2.lightmap, le2.emissivemap, le2.bumpmap, le2.normalmap, le2.displacementmap, le2.gradientmap, le2.fog, le2.lights, { emissive: { value: new U(0) } }]), vertexShader: Pe.meshtoon_vert, fragmentShader: Pe.meshtoon_frag }, matcap: { uniforms: fl([le2.common, le2.bumpmap, le2.normalmap, le2.displacementmap, le2.fog, { matcap: { value: null } }]), vertexShader: Pe.meshmatcap_vert, fragmentShader: Pe.meshmatcap_frag }, points: { uniforms: fl([le2.points, le2.fog]), vertexShader: Pe.points_vert, fragmentShader: Pe.points_frag }, dashed: { uniforms: fl([le2.common, le2.fog, { scale: { value: 1 }, dashSize: { value: 1 }, totalSize: { value: 2 } }]), vertexShader: Pe.linedashed_vert, fragmentShader: Pe.linedashed_frag }, depth: { uniforms: fl([le2.common, le2.displacementmap]), vertexShader: Pe.depth_vert, fragmentShader: Pe.depth_frag }, normal: { uniforms: fl([le2.common, le2.bumpmap, le2.normalmap, le2.displacementmap, { opacity: { value: 1 } }]), vertexShader: Pe.meshnormal_vert, fragmentShader: Pe.meshnormal_frag }, sprite: { uniforms: fl([le2.sprite, le2.fog]), vertexShader: Pe.sprite_vert, fragmentShader: Pe.sprite_frag }, background: { uniforms: { uvTransform: { value: new Kt() }, t2D: { value: null }, backgroundIntensity: { value: 1 } }, vertexShader: Pe.background_vert, fragmentShader: Pe.background_frag }, backgroundCube: { uniforms: { envMap: { value: null }, backgroundBlurriness: { value: 0 }, backgroundIntensity: { value: 1 }, backgroundRotation: { value: new Kt() } }, vertexShader: Pe.backgroundCube_vert, fragmentShader: Pe.backgroundCube_frag }, cube: { uniforms: { tCube: { value: null }, tFlip: { value: -1 }, opacity: { value: 1 } }, vertexShader: Pe.cube_vert, fragmentShader: Pe.cube_frag }, equirect: { uniforms: { tEquirect: { value: null } }, vertexShader: Pe.equirect_vert, fragmentShader: Pe.equirect_frag }, distance: { uniforms: fl([le2.common, le2.displacementmap, { referencePosition: { value: new w() }, nearDistance: { value: 1 }, farDistance: { value: 1e3 } }]), vertexShader: Pe.distance_vert, fragmentShader: Pe.distance_frag }, shadow: { uniforms: fl([le2.lights, le2.fog, { color: { value: new U(0) }, opacity: { value: 1 } }]), vertexShader: Pe.shadow_vert, fragmentShader: Pe.shadow_frag } };
Rt.physical = { uniforms: fl([Rt.standard.uniforms, { clearcoat: { value: 0 }, clearcoatMap: { value: null }, clearcoatMapTransform: { value: new Kt() }, clearcoatNormalMap: { value: null }, clearcoatNormalMapTransform: { value: new Kt() }, clearcoatNormalScale: { value: new I(1, 1) }, clearcoatRoughness: { value: 0 }, clearcoatRoughnessMap: { value: null }, clearcoatRoughnessMapTransform: { value: new Kt() }, dispersion: { value: 0 }, retroreflectivity: { value: 0 }, iridescence: { value: 0 }, iridescenceMap: { value: null }, iridescenceMapTransform: { value: new Kt() }, iridescenceIOR: { value: 1.3 }, iridescenceThicknessMinimum: { value: 100 }, iridescenceThicknessMaximum: { value: 400 }, iridescenceThicknessMap: { value: null }, iridescenceThicknessMapTransform: { value: new Kt() }, sheen: { value: 0 }, sheenColor: { value: new U(0) }, sheenColorMap: { value: null }, sheenColorMapTransform: { value: new Kt() }, sheenRoughness: { value: 1 }, sheenRoughnessMap: { value: null }, sheenRoughnessMapTransform: { value: new Kt() }, transmission: { value: 0 }, transmissionMap: { value: null }, transmissionMapTransform: { value: new Kt() }, transmissionSamplerSize: { value: new I() }, transmissionSamplerMap: { value: null }, thickness: { value: 0 }, thicknessMap: { value: null }, thicknessMapTransform: { value: new Kt() }, attenuationDistance: { value: 0 }, attenuationColor: { value: new U(0) }, specularColor: { value: new U(1, 1, 1) }, specularColorMap: { value: null }, specularColorMapTransform: { value: new Kt() }, specularIntensity: { value: 1 }, specularIntensityMap: { value: null }, specularIntensityMapTransform: { value: new Kt() }, anisotropyVector: { value: new I() }, anisotropyMap: { value: null }, anisotropyMapTransform: { value: new Kt() } }]), vertexShader: Pe.meshphysical_vert, fragmentShader: Pe.meshphysical_frag };
var yn2 = { r: 0, b: 0, g: 0 };
var nc2 = new G();
var ya2 = new Kt();
ya2.set(-1, 0, 0, 0, 1, 0, 0, 0, 1);
function ic2(e, n, t, i, l, o) {
  const d = new U(0);
  let g = l === true ? 0 : 1, R, T, H2 = null, I2 = 0, p = null;
  function x(L) {
    let z = L.isScene === true ? L.background : null;
    if (z && z.isTexture) {
      const h = L.backgroundBlurriness > 0;
      z = n.get(z, h);
    }
    return z;
  }
  function N(L) {
    let z = false;
    const h = x(L);
    h === null ? f(d, g) : h && h.isColor && (f(h, 1), z = true);
    const S = e.xr.getEnvironmentBlendMode();
    S === "additive" ? t.buffers.color.setClear(0, 0, 0, 1, o) : S === "alpha-blend" && t.buffers.color.setClear(0, 0, 0, 0, o), (e.autoClear || z) && (t.buffers.depth.setTest(true), t.buffers.depth.setMask(true), t.buffers.color.setMask(true), e.clear(e.autoClearColor, e.autoClearDepth, e.autoClearStencil));
  }
  function W2(L, z) {
    const h = x(z);
    h && (h.isCubeTexture || h.mapping === Ha) ? (T === void 0 && (T = new Zt(new On(1, 1, 1), new oa({ name: "BackgroundCubeMaterial", uniforms: gn(Rt.backgroundCube.uniforms), vertexShader: Rt.backgroundCube.vertexShader, fragmentShader: Rt.backgroundCube.fragmentShader, side: Oa, depthTest: false, depthWrite: false, fog: false, allowOverride: false })), T.geometry.deleteAttribute("normal"), T.geometry.deleteAttribute("uv"), T.onBeforeRender = function(S, m, D2) {
      this.matrixWorld.copyPosition(D2.matrixWorld);
    }, Object.defineProperty(T.material, "envMap", { get: function() {
      return this.uniforms.envMap.value;
    } }), i.update(T)), T.material.uniforms.envMap.value = h, T.material.uniforms.backgroundBlurriness.value = z.backgroundBlurriness, T.material.uniforms.backgroundIntensity.value = z.backgroundIntensity, T.material.uniforms.backgroundRotation.value.setFromMatrix4(nc2.makeRotationFromEuler(z.backgroundRotation)).transpose(), h.isCubeTexture && h.isRenderTargetTexture === false && T.material.uniforms.backgroundRotation.value.premultiply(ya2), T.material.toneMapped = It.getTransfer(h.colorSpace) !== Cs, (H2 !== h || I2 !== h.version || p !== e.toneMapping) && (T.material.needsUpdate = true, H2 = h, I2 = h.version, p = e.toneMapping), T.layers.enableAll(), L.unshift(T, T.geometry, T.material, 0, 0, null)) : h && h.isTexture && (R === void 0 && (R = new Zt(new Wn(2, 2), new oa({ name: "BackgroundMaterial", uniforms: gn(Rt.background.uniforms), vertexShader: Rt.background.vertexShader, fragmentShader: Rt.background.fragmentShader, side: $n, depthTest: false, depthWrite: false, fog: false, allowOverride: false })), R.geometry.deleteAttribute("normal"), Object.defineProperty(R.material, "map", { get: function() {
      return this.uniforms.t2D.value;
    } }), i.update(R)), R.material.uniforms.t2D.value = h, R.material.uniforms.backgroundIntensity.value = z.backgroundIntensity, R.material.toneMapped = It.getTransfer(h.colorSpace) !== Cs, h.matrixAutoUpdate === true && h.updateMatrix(), R.material.uniforms.uvTransform.value.copy(h.matrix), (H2 !== h || I2 !== h.version || p !== e.toneMapping) && (R.material.needsUpdate = true, H2 = h, I2 = h.version, p = e.toneMapping), R.layers.enableAll(), L.unshift(R, R.geometry, R.material, 0, 0, null));
  }
  function f(L, z) {
    L.getRGB(yn2, af(e)), t.buffers.color.setClear(yn2.r, yn2.g, yn2.b, z, o);
  }
  function s() {
    T !== void 0 && (T.geometry.dispose(), T.material.dispose(), T = void 0), R !== void 0 && (R.geometry.dispose(), R.material.dispose(), R = void 0);
  }
  return { getClearColor: function() {
    return d;
  }, setClearColor: function(L, z = 1) {
    d.set(L), g = z, f(d, g);
  }, getClearAlpha: function() {
    return g;
  }, setClearAlpha: function(L) {
    g = L, f(d, g);
  }, render: N, addToRenderList: W2, dispose: s };
}
function rc2(e, n) {
  const t = e.getParameter(e.MAX_VERTEX_ATTRIBS), i = {}, l = p(null);
  let o = l, d = false;
  function g(F, G2, q, P2, K) {
    let Q = false;
    const Y2 = I2(F, P2, q, G2);
    o !== Y2 && (o = Y2, T(o.object)), Q = x(F, P2, q, K), Q && N(F, P2, q, K), K !== null && n.update(K, e.ELEMENT_ARRAY_BUFFER), (Q || d) && (d = false, h(F, G2, q, P2), K !== null && e.bindBuffer(e.ELEMENT_ARRAY_BUFFER, n.get(K).buffer));
  }
  function R() {
    return e.createVertexArray();
  }
  function T(F) {
    return e.bindVertexArray(F);
  }
  function H2(F) {
    return e.deleteVertexArray(F);
  }
  function I2(F, G2, q, P2) {
    const K = P2.wireframe === true;
    let Q = i[G2.id];
    Q === void 0 && (Q = {}, i[G2.id] = Q);
    const Y2 = F.isInstancedMesh === true ? F.id : 0;
    let ne2 = Q[Y2];
    ne2 === void 0 && (ne2 = {}, Q[Y2] = ne2);
    let Z2 = ne2[q.id];
    Z2 === void 0 && (Z2 = {}, ne2[q.id] = Z2);
    let j = Z2[K];
    return j === void 0 && (j = p(R()), Z2[K] = j), j;
  }
  function p(F) {
    const G2 = [], q = [], P2 = [];
    for (let K = 0; K < t; K++) G2[K] = 0, q[K] = 0, P2[K] = 0;
    return { geometry: null, program: null, wireframe: false, newAttributes: G2, enabledAttributes: q, attributeDivisors: P2, object: F, attributes: {}, index: null };
  }
  function x(F, G2, q, P2) {
    const K = o.attributes, Q = G2.attributes;
    let Y2 = 0;
    const ne2 = q.getAttributes();
    for (const Z2 in ne2) if (ne2[Z2].location >= 0) {
      const ee2 = K[Z2];
      let be = Q[Z2];
      if (be === void 0 && (Z2 === "instanceMatrix" && F.instanceMatrix && (be = F.instanceMatrix), Z2 === "instanceColor" && F.instanceColor && (be = F.instanceColor)), ee2 === void 0 || ee2.attribute !== be || be && ee2.data !== be.data) return true;
      Y2++;
    }
    return o.attributesNum !== Y2 || o.index !== P2;
  }
  function N(F, G2, q, P2) {
    const K = {}, Q = G2.attributes;
    let Y2 = 0;
    const ne2 = q.getAttributes();
    for (const Z2 in ne2) if (ne2[Z2].location >= 0) {
      let ee2 = Q[Z2];
      ee2 === void 0 && (Z2 === "instanceMatrix" && F.instanceMatrix && (ee2 = F.instanceMatrix), Z2 === "instanceColor" && F.instanceColor && (ee2 = F.instanceColor));
      const be = {};
      be.attribute = ee2, ee2 && ee2.data && (be.data = ee2.data), K[Z2] = be, Y2++;
    }
    o.attributes = K, o.attributesNum = Y2, o.index = P2;
  }
  function W2() {
    const F = o.newAttributes;
    for (let G2 = 0, q = F.length; G2 < q; G2++) F[G2] = 0;
  }
  function f(F) {
    s(F, 0);
  }
  function s(F, G2) {
    const q = o.newAttributes, P2 = o.enabledAttributes, K = o.attributeDivisors;
    q[F] = 1, P2[F] === 0 && (e.enableVertexAttribArray(F), P2[F] = 1), K[F] !== G2 && (e.vertexAttribDivisor(F, G2), K[F] = G2);
  }
  function L() {
    const F = o.newAttributes, G2 = o.enabledAttributes;
    for (let q = 0, P2 = G2.length; q < P2; q++) G2[q] !== F[q] && (e.disableVertexAttribArray(q), G2[q] = 0);
  }
  function z(F, G2, q, P2, K, Q, Y2) {
    Y2 === true ? e.vertexAttribIPointer(F, G2, q, K, Q) : e.vertexAttribPointer(F, G2, q, P2, K, Q);
  }
  function h(F, G2, q, P2) {
    W2();
    const K = P2.attributes, Q = q.getAttributes(), Y2 = G2.defaultAttributeValues;
    for (const ne2 in Q) {
      const Z2 = Q[ne2];
      if (Z2.location >= 0) {
        let j = K[ne2];
        if (j === void 0 && (ne2 === "instanceMatrix" && F.instanceMatrix && (j = F.instanceMatrix), ne2 === "instanceColor" && F.instanceColor && (j = F.instanceColor)), j !== void 0) {
          const ee2 = j.normalized, be = j.itemSize, Re2 = n.get(j);
          if (Re2 === void 0) continue;
          const it = Re2.buffer, ke2 = Re2.type, ze2 = Re2.bytesPerElement, V2 = ke2 === e.INT || ke2 === e.UNSIGNED_INT || j.gpuType === Qa;
          if (j.isInterleavedBufferAttribute) {
            const $ = j.data, Ee2 = $.stride, Ue2 = j.offset;
            if ($.isInstancedInterleavedBuffer) {
              for (let me2 = 0; me2 < Z2.locationSize; me2++) s(Z2.location + me2, $.meshPerAttribute);
              F.isInstancedMesh !== true && P2._maxInstanceCount === void 0 && (P2._maxInstanceCount = $.meshPerAttribute * $.count);
            } else for (let me2 = 0; me2 < Z2.locationSize; me2++) f(Z2.location + me2);
            e.bindBuffer(e.ARRAY_BUFFER, it);
            for (let me2 = 0; me2 < Z2.locationSize; me2++) z(Z2.location + me2, be / Z2.locationSize, ke2, ee2, Ee2 * ze2, (Ue2 + be / Z2.locationSize * me2) * ze2, V2);
          } else {
            if (j.isInstancedBufferAttribute) {
              for (let $ = 0; $ < Z2.locationSize; $++) s(Z2.location + $, j.meshPerAttribute);
              F.isInstancedMesh !== true && P2._maxInstanceCount === void 0 && (P2._maxInstanceCount = j.meshPerAttribute * j.count);
            } else for (let $ = 0; $ < Z2.locationSize; $++) f(Z2.location + $);
            e.bindBuffer(e.ARRAY_BUFFER, it);
            for (let $ = 0; $ < Z2.locationSize; $++) z(Z2.location + $, be / Z2.locationSize, ke2, ee2, be * ze2, be / Z2.locationSize * $ * ze2, V2);
          }
        } else if (Y2 !== void 0) {
          const ee2 = Y2[ne2];
          if (ee2 !== void 0) switch (ee2.length) {
            case 2:
              e.vertexAttrib2fv(Z2.location, ee2);
              break;
            case 3:
              e.vertexAttrib3fv(Z2.location, ee2);
              break;
            case 4:
              e.vertexAttrib4fv(Z2.location, ee2);
              break;
            default:
              e.vertexAttrib1fv(Z2.location, ee2);
          }
        }
      }
    }
    L();
  }
  function S() {
    _();
    for (const F in i) {
      const G2 = i[F];
      for (const q in G2) {
        const P2 = G2[q];
        for (const K in P2) {
          const Q = P2[K];
          for (const Y2 in Q) H2(Q[Y2].object), delete Q[Y2];
          delete P2[K];
        }
      }
      delete i[F];
    }
  }
  function m(F) {
    if (i[F.id] === void 0) return;
    const G2 = i[F.id];
    for (const q in G2) {
      const P2 = G2[q];
      for (const K in P2) {
        const Q = P2[K];
        for (const Y2 in Q) H2(Q[Y2].object), delete Q[Y2];
        delete P2[K];
      }
    }
    delete i[F.id];
  }
  function D2(F) {
    for (const G2 in i) {
      const q = i[G2];
      for (const P2 in q) {
        const K = q[P2];
        if (K[F.id] === void 0) continue;
        const Q = K[F.id];
        for (const Y2 in Q) H2(Q[Y2].object), delete Q[Y2];
        delete K[F.id];
      }
    }
  }
  function c(F) {
    for (const G2 in i) {
      const q = i[G2], P2 = F.isInstancedMesh === true ? F.id : 0, K = q[P2];
      if (K !== void 0) {
        for (const Q in K) {
          const Y2 = K[Q];
          for (const ne2 in Y2) H2(Y2[ne2].object), delete Y2[ne2];
          delete K[Q];
        }
        delete q[P2], Object.keys(q).length === 0 && delete i[G2];
      }
    }
  }
  function _() {
    w2(), d = true, o !== l && (o = l, T(o.object));
  }
  function w2() {
    l.geometry = null, l.program = null, l.wireframe = false;
  }
  return { setup: g, reset: _, resetDefaultState: w2, dispose: S, releaseStatesOfGeometry: m, releaseStatesOfObject: c, releaseStatesOfProgram: D2, initAttributes: W2, enableAttribute: f, disableUnusedAttributes: L };
}
function ac(e, n, t) {
  let i;
  function l(R) {
    i = R;
  }
  function o(R, T) {
    e.drawArrays(i, R, T), t.update(T, i, 1);
  }
  function d(R, T, H2) {
    H2 !== 0 && (e.drawArraysInstanced(i, R, T, H2), t.update(T, i, H2));
  }
  function g(R, T, H2) {
    if (H2 === 0) return;
    n.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i, R, 0, T, 0, H2);
    let p = 0;
    for (let x = 0; x < H2; x++) p += T[x];
    t.update(p, i, 1);
  }
  this.setMode = l, this.render = o, this.renderInstances = d, this.renderMultiDraw = g;
}
function oc2(e, n, t, i) {
  let l;
  function o() {
    if (l !== void 0) return l;
    if (n.has("EXT_texture_filter_anisotropic") === true) {
      const D2 = n.get("EXT_texture_filter_anisotropic");
      l = e.getParameter(D2.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    } else l = 0;
    return l;
  }
  function d(D2) {
    return !(D2 !== si && i.convert(D2) !== e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT));
  }
  function g(D2) {
    const c = D2 === ja && (n.has("EXT_color_buffer_half_float") || n.has("EXT_color_buffer_float"));
    return !(D2 !== _s && D2 !== Re && !c && i.convert(D2) !== e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE));
  }
  function R(D2) {
    if (D2 === "highp") {
      if (e.getShaderPrecisionFormat(e.VERTEX_SHADER, e.HIGH_FLOAT).precision > 0 && e.getShaderPrecisionFormat(e.FRAGMENT_SHADER, e.HIGH_FLOAT).precision > 0) return "highp";
      D2 = "mediump";
    }
    return D2 === "mediump" && e.getShaderPrecisionFormat(e.VERTEX_SHADER, e.MEDIUM_FLOAT).precision > 0 && e.getShaderPrecisionFormat(e.FRAGMENT_SHADER, e.MEDIUM_FLOAT).precision > 0 ? "mediump" : "lowp";
  }
  let T = t.precision !== void 0 ? t.precision : "highp";
  const H2 = R(T);
  H2 !== T && (V("WebGLRenderer:", T, "not supported, using", H2, "instead."), T = H2);
  const I2 = t.logarithmicDepthBuffer === true, p = t.reversedDepthBuffer === true && n.has("EXT_clip_control");
  t.reversedDepthBuffer === true && p === false && V("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");
  const x = e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS), N = e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS), W2 = e.getParameter(e.MAX_TEXTURE_SIZE), f = e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE), s = e.getParameter(e.MAX_VERTEX_ATTRIBS), L = e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS), z = e.getParameter(e.MAX_VARYING_VECTORS), h = e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS), S = e.getParameter(e.MAX_SAMPLES), m = e.getParameter(e.SAMPLES);
  return { isWebGL2: true, getMaxAnisotropy: o, getMaxPrecision: R, textureFormatReadable: d, textureTypeReadable: g, precision: T, logarithmicDepthBuffer: I2, reversedDepthBuffer: p, maxTextures: x, maxVertexTextures: N, maxTextureSize: W2, maxCubemapSize: f, maxAttributes: s, maxVertexUniforms: L, maxVaryings: z, maxFragmentUniforms: h, maxSamples: S, samples: m };
}
function sc2(e) {
  const n = this;
  let t = null, i = 0, l = false, o = false;
  const d = new Ce(), g = new Kt(), R = { value: null, needsUpdate: false };
  this.uniform = R, this.numPlanes = 0, this.numIntersection = 0, this.init = function(I2, p) {
    const x = I2.length !== 0 || p || i !== 0 || l;
    return l = p, i = I2.length, x;
  }, this.beginShadows = function() {
    o = true, H2(null);
  }, this.endShadows = function() {
    o = false;
  }, this.setGlobalState = function(I2, p) {
    t = H2(I2, p, 0);
  }, this.setState = function(I2, p, x) {
    const N = I2.clippingPlanes, W2 = I2.clipIntersection, f = I2.clipShadows, s = e.get(I2);
    if (!l || N === null || N.length === 0 || o && !f) o ? H2(null) : T();
    else {
      const L = o ? 0 : i, z = L * 4;
      let h = s.clippingState || null;
      R.value = h, h = H2(N, p, z, x);
      for (let S = 0; S !== z; ++S) h[S] = t[S];
      s.clippingState = h, this.numIntersection = W2 ? this.numPlanes : 0, this.numPlanes += L;
    }
  };
  function T() {
    R.value !== t && (R.value = t, R.needsUpdate = i > 0), n.numPlanes = i, n.numIntersection = 0;
  }
  function H2(I2, p, x, N) {
    const W2 = I2 !== null ? I2.length : 0;
    let f = null;
    if (W2 !== 0) {
      if (f = R.value, N !== true || f === null) {
        const s = x + W2 * 4, L = p.matrixWorldInverse;
        g.getNormalMatrix(L), (f === null || f.length < s) && (f = new Float32Array(s));
        for (let z = 0, h = x; z !== W2; ++z, h += 4) d.copy(I2[z]).applyMatrix4(L, g), d.normal.toArray(f, h), f[h + 3] = d.constant;
      }
      R.value = f, R.needsUpdate = true;
    }
    return n.numPlanes = W2, n.numIntersection = 0, f;
  }
}
var rn2 = 4;
var lc2 = 6;
var cc2 = 20;
var fc2 = 256;
var mn2 = new ma();
var Fa = new U();
var $i2 = null;
var Qi2 = 0;
var Ji2 = 0;
var ji2 = false;
var dc2 = new w();
var Zt2 = new w();
var er2 = class {
  constructor(n) {
    this._renderer = n, this._pingPongRenderTarget = null, this._lodMax = 0, this._cubeSize = 0, this._sizeLods = [], this._lodMeshes = [], this._backgroundBox = null, this._cubemapMaterial = null, this._equirectMaterial = null, this._blurMaterial = null, this._ggxMaterial = null;
  }
  fromScene(n, t = 0, i = 0.1, l = 100, o = {}) {
    const { size: d = 256, position: g = dc2 } = o;
    $i2 = this._renderer.getRenderTarget(), Qi2 = this._renderer.getActiveCubeFace(), Ji2 = this._renderer.getActiveMipmapLevel(), ji2 = this._renderer.xr.enabled, this._renderer.xr.enabled = false, this._setSize(d);
    const R = this._allocateTargets();
    return R.depthBuffer = true, this._sceneToCubeUV(n, i, l, R, g), t > 0 && this._blur(R, 0, 0, t), this._applyPMREM(R), this._cleanup(R), R;
  }
  fromEquirectangular(n, t = null) {
    return this._fromTexture(n, t);
  }
  fromCubemap(n, t = null) {
    return this._fromTexture(n, t);
  }
  compileCubemapShader() {
    this._cubemapMaterial === null && (this._cubemapMaterial = Ga2(), this._compileMaterial(this._cubemapMaterial));
  }
  compileEquirectangularShader() {
    this._equirectMaterial === null && (this._equirectMaterial = Ba(), this._compileMaterial(this._equirectMaterial));
  }
  dispose() {
    this._dispose(), this._cubemapMaterial !== null && this._cubemapMaterial.dispose(), this._equirectMaterial !== null && this._equirectMaterial.dispose(), this._backgroundBox !== null && (this._backgroundBox.geometry.dispose(), this._backgroundBox.material.dispose());
  }
  _setSize(n) {
    this._lodMax = Math.floor(Math.log2(n)), this._cubeSize = Math.pow(2, this._lodMax);
  }
  _dispose() {
    this._blurMaterial !== null && this._blurMaterial.dispose(), this._ggxMaterial !== null && this._ggxMaterial.dispose(), this._pingPongRenderTarget !== null && this._pingPongRenderTarget.dispose();
    for (let n = 0; n < this._lodMeshes.length; n++) this._lodMeshes[n].geometry.dispose();
  }
  _cleanup(n) {
    this._renderer.setRenderTarget($i2, Qi2, Ji2), this._renderer.xr.enabled = ji2, n.scissorTest = false, an2(n, 0, 0, n.width, n.height);
  }
  _fromTexture(n, t) {
    n.mapping === Pi || n.mapping === Ua ? this._setSize(n.image.length === 0 ? 16 : n.image[0].width || n.image[0].image.width) : this._setSize(n.image.width / 4), $i2 = this._renderer.getRenderTarget(), Qi2 = this._renderer.getActiveCubeFace(), Ji2 = this._renderer.getActiveMipmapLevel(), ji2 = this._renderer.xr.enabled, this._renderer.xr.enabled = false;
    const i = t || this._allocateTargets();
    return this._textureToCubeUV(n, i), this._applyPMREM(i), this._cleanup(i), i;
  }
  _allocateTargets() {
    const n = 3 * Math.max(this._cubeSize, 112), t = 4 * this._cubeSize, i = { magFilter: Ut, minFilter: Ut, generateMipmaps: false, type: ja, format: si, colorSpace: cr, depthBuffer: false }, l = Oa2(n, t, i);
    if (this._pingPongRenderTarget === null || this._pingPongRenderTarget.width !== n || this._pingPongRenderTarget.height !== t) {
      this._pingPongRenderTarget !== null && this._dispose(), this._pingPongRenderTarget = Oa2(n, t, i);
      const { _lodMax: o } = this;
      ({ lodMeshes: this._lodMeshes, sizeLods: this._sizeLods } = uc(o)), this._blurMaterial = hc2(o, n, t), this._ggxMaterial = pc2(o, n, t);
    }
    return l;
  }
  _compileMaterial(n) {
    const t = new Zt(new H(), n);
    this._renderer.compile(t, mn2);
  }
  _sceneToCubeUV(n, t, i, l, o) {
    const R = new Dt(90, 1, t, i), T = [1, -1, 1, 1, 1, 1], H2 = [1, 1, 1, -1, -1, -1], I2 = this._renderer, p = I2.autoClear, x = I2.toneMapping;
    I2.getClearColor(Fa), I2.toneMapping = su, I2.autoClear = false, I2.state.buffers.depth.getReversed() && (I2.setRenderTarget(l), I2.clearDepth(), I2.setRenderTarget(null)), this._backgroundBox === null && (this._backgroundBox = new Zt(new On(), new We({ name: "PMREM.Background", side: Oa, depthWrite: false, depthTest: false })));
    const W2 = this._backgroundBox, f = W2.material;
    let s = false;
    const L = n.background;
    L ? L.isColor && (f.color.copy(L), n.background = null, s = true) : (f.color.copy(Fa), s = true);
    for (let z = 0; z < 6; z++) {
      const h = z % 3;
      h === 0 ? (R.up.set(0, T[z], 0), R.position.set(o.x, o.y, o.z), R.lookAt(o.x + H2[z], o.y, o.z)) : h === 1 ? (R.up.set(0, 0, T[z]), R.position.set(o.x, o.y, o.z), R.lookAt(o.x, o.y + H2[z], o.z)) : (R.up.set(0, T[z], 0), R.position.set(o.x, o.y, o.z), R.lookAt(o.x, o.y, o.z + H2[z]));
      const S = this._cubeSize;
      an2(l, h * S, z > 2 ? S : 0, S, S), I2.setRenderTarget(l), s && I2.render(W2, R), I2.render(n, R);
    }
    I2.toneMapping = x, I2.autoClear = p, n.background = L;
  }
  _textureToCubeUV(n, t) {
    const i = this._renderer, l = n.mapping === Pi || n.mapping === Ua;
    l ? (this._cubemapMaterial === null && (this._cubemapMaterial = Ga2()), this._cubemapMaterial.uniforms.flipEnvMap.value = n.isRenderTargetTexture === false ? -1 : 1) : this._equirectMaterial === null && (this._equirectMaterial = Ba());
    const o = l ? this._cubemapMaterial : this._equirectMaterial, d = this._lodMeshes[0];
    d.material = o;
    const g = o.uniforms;
    g.envMap.value = n;
    const R = this._cubeSize;
    an2(t, 0, 0, 3 * R, 2 * R), i.setRenderTarget(t), i.render(d, mn2);
  }
  _applyPMREM(n) {
    const t = this._renderer, i = t.autoClear;
    t.autoClear = false;
    const l = this._lodMeshes.length;
    for (let o = 1; o < l; o++) this._applyGGXFilter(n, o - 1, o);
    t.autoClear = i;
  }
  _applyGGXFilter(n, t, i) {
    const l = this._renderer, o = this._pingPongRenderTarget, d = this._ggxMaterial, g = this._lodMeshes[i];
    g.material = d;
    const R = d.uniforms, T = i / (this._lodMeshes.length - 1), H2 = t / (this._lodMeshes.length - 1), I2 = Math.sqrt(T * T - H2 * H2), p = T * 1.25, x = I2 * p, { _lodMax: N } = this, W2 = this._sizeLods[i], f = 3 * W2 * (i > N - rn2 ? i - N + rn2 : 0), s = 4 * (this._cubeSize - W2);
    R.envMap.value = n.texture, R.roughness.value = x, R.mipInt.value = N - t, an2(o, f, s, 3 * W2, 2 * W2), l.setRenderTarget(o), l.render(g, mn2), R.envMap.value = o.texture, R.roughness.value = 0, R.mipInt.value = N - i, an2(n, f, s, 3 * W2, 2 * W2), l.setRenderTarget(n), l.render(g, mn2);
  }
  _blur(n, t, i, l) {
    const o = this._pingPongRenderTarget, d = Math.min(l, Math.PI) / Math.SQRT2;
    this._blurPass(n, o, t, i, d), this._blurPass(o, n, i, i, d);
  }
  _blurPass(n, t, i, l, o) {
    const d = this._renderer, g = this._blurMaterial, R = this._lodMeshes[l];
    R.material = g;
    const T = g.uniforms;
    T.envMap.value = n.texture, T.sigma.value = o, T.mipInt.value = this._lodMax - i;
    const H2 = this._sizeLods[l], I2 = 3 * H2 * (l > this._lodMax - rn2 ? l - this._lodMax + rn2 : 0), p = 4 * (this._cubeSize - H2);
    an2(t, I2, p, 3 * H2, 2 * H2), d.setRenderTarget(t), d.render(R, mn2);
  }
};
function uc(e) {
  const n = [], t = [];
  let i = e;
  const l = e - rn2 + 1 + lc2;
  for (let o = 0; o < l; o++) {
    const d = Math.pow(2, i);
    n.push(d);
    const g = 1 / (d - 2), R = -g, T = 1 + g, H2 = [R, R, T, R, T, T, R, R, T, T, R, T], I2 = 6, p = 6, x = 3, N = new Float32Array(x * p * I2), W2 = new Float32Array(x * p * I2);
    for (let s = 0; s < I2; s++) {
      const L = s % 3 * 2 / 3 - 1, z = s > 2 ? 0 : -1, h = [L, z, 0, L + 2 / 3, z, 0, L + 2 / 3, z + 1, 0, L, z, 0, L + 2 / 3, z + 1, 0, L, z + 1, 0];
      N.set(h, x * p * s);
      for (let S = 0; S < p; S++) {
        const m = H2[S * 2] * 2 - 1, D2 = H2[S * 2 + 1] * 2 - 1;
        s === 0 ? Zt2.set(1, D2, m) : s === 1 ? Zt2.set(-m, 1, -D2) : s === 2 ? Zt2.set(-m, D2, 1) : s === 3 ? Zt2.set(-1, D2, -m) : s === 4 ? Zt2.set(-m, -1, D2) : Zt2.set(m, D2, -1), Zt2.toArray(W2, (s * p + S) * x);
      }
    }
    const f = new H();
    f.setAttribute("position", new st(N, x)), f.setAttribute("outputDirection", new st(W2, x)), t.push(new Zt(f, null)), i > rn2 && i--;
  }
  return { lodMeshes: t, sizeLods: n };
}
function Oa2(e, n, t) {
  const i = new Mr(e, n, t);
  return i.texture.mapping = Ha, i.texture.name = "PMREM.cubeUv", i.scissorTest = true, i;
}
function an2(e, n, t, i, l) {
  e.viewport.set(n, t, i, l), e.scissor.set(n, t, i, l);
}
function pc2(e, n, t) {
  return new oa({ name: "PMREMGGXConvolution", defines: { GGX_SAMPLES: fc2, CUBEUV_TEXEL_WIDTH: 1 / n, CUBEUV_TEXEL_HEIGHT: 1 / t, CUBEUV_MAX_MIP: `${e}.0` }, uniforms: { envMap: { value: null }, roughness: { value: 0 }, mipInt: { value: 0 } }, vertexShader: Fn2(), fragmentShader: `

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`, blending: kc, depthTest: false, depthWrite: false });
}
function hc2(e, n, t) {
  return new oa({ name: "SphericalGaussianBlur", defines: { SAMPLES: cc2, CUBEUV_TEXEL_WIDTH: 1 / n, CUBEUV_TEXEL_HEIGHT: 1 / t, CUBEUV_MAX_MIP: `${e}.0` }, uniforms: { envMap: { value: null }, sigma: { value: 0 }, mipInt: { value: 0 } }, vertexShader: Fn2(), fragmentShader: `

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float sigma;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359
			#define GOLDEN_ANGLE 2.39996322973

			void main() {

				if ( sigma == 0.0 ) {

					gl_FragColor = vec4( bilinearCubeUV( envMap, vOutputDirection, mipInt ), 1.0 );
					return;

				}

				vec3 outputDirection = normalize( vOutputDirection );

				vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
				vec3 tangent = normalize( cross( up, outputDirection ) );
				vec3 bitangent = cross( outputDirection, tangent );

				// Truncate the kernel at three standard deviations or at the antipode.
				float thetaMax = min( 3.0 * sigma, PI );
				float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

				vec3 accumColor = vec3( 0.0 );
				float accumWeight = 0.0;

				for ( int i = 0; i < SAMPLES; i ++ ) {

					// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
					float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
					float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
					float phi = float( i ) * GOLDEN_ANGLE;

					vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
					vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

					// Correct the planar sample density to solid angle.
					float weight = sin( theta ) / theta;

					accumColor += weight * bilinearCubeUV( envMap, sampleDirection, mipInt );
					accumWeight += weight;

				}

				gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

			}
		`, blending: kc, depthTest: false, depthWrite: false });
}
function Ba() {
  return new oa({ name: "EquirectangularToCubeUV", uniforms: { envMap: { value: null } }, vertexShader: Fn2(), fragmentShader: `

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`, blending: kc, depthTest: false, depthWrite: false });
}
function Ga2() {
  return new oa({ name: "CubemapToCubeUV", uniforms: { envMap: { value: null }, flipEnvMap: { value: -1 } }, vertexShader: Fn2(), fragmentShader: `

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`, blending: kc, depthTest: false, depthWrite: false });
}
function Fn2() {
  return `

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`;
}
var tr2 = class extends Mr {
  constructor(n = 1, t = {}) {
    super(n, n, t), this.isWebGLCubeRenderTarget = true;
    const i = { width: n, height: n, depth: 1 }, l = [i, i, i, i, i, i];
    this.texture = new Yr(l), this._setTextureOptions(t), this.texture.isRenderTargetTexture = true;
  }
  fromEquirectangularTexture(n, t) {
    this.texture.type = t.type, this.texture.colorSpace = t.colorSpace, this.texture.generateMipmaps = t.generateMipmaps, this.texture.minFilter = t.minFilter, this.texture.magFilter = t.magFilter;
    const i = { uniforms: { tEquirect: { value: null } }, vertexShader: `

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`, fragmentShader: `

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			` }, l = new On(5, 5, 5), o = new oa({ name: "CubemapFromEquirect", uniforms: gn(i.uniforms), vertexShader: i.vertexShader, fragmentShader: i.fragmentShader, side: Oa, blending: kc });
    o.uniforms.tEquirect.value = t;
    const d = new Zt(l, o), g = t.minFilter;
    return t.minFilter === ws && (t.minFilter = Ut), new Ff(1, 10, this).update(n, d), t.minFilter = g, d.geometry.dispose(), d.material.dispose(), this;
  }
  clear(n, t = true, i = true, l = true) {
    const o = n.getRenderTarget();
    for (let d = 0; d < 6; d++) n.setRenderTarget(this, d), n.clear(t, i, l);
    n.setRenderTarget(o);
  }
};
function mc2(e) {
  let n = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap(), i = null;
  function l(p, x = false) {
    return p == null ? null : x ? d(p) : o(p);
  }
  function o(p) {
    if (p && p.isTexture) {
      const x = p.mapping;
      if (x === Wa || x === Ga) if (n.has(p)) {
        const N = n.get(p).texture;
        return g(N, p.mapping);
      } else {
        const N = p.image;
        if (N && N.height > 0) {
          const W2 = new tr2(N.height);
          return W2.fromEquirectangularTexture(e, p), n.set(p, W2), p.addEventListener("dispose", T), g(W2.texture, p.mapping);
        } else return null;
      }
    }
    return p;
  }
  function d(p) {
    if (p && p.isTexture) {
      const x = p.mapping, N = x === Wa || x === Ga, W2 = x === Pi || x === Ua;
      if (N || W2) {
        let f = t.get(p);
        const s = f !== void 0 ? f.texture.pmremVersion : 0;
        if (p.isRenderTargetTexture && p.pmremVersion !== s) return i === null && (i = new er2(e)), f = N ? i.fromEquirectangular(p, f) : i.fromCubemap(p, f), f.texture.pmremVersion = p.pmremVersion, t.set(p, f), f.texture;
        if (f !== void 0) return f.texture;
        {
          const L = p.image;
          return N && L && L.height > 0 || W2 && L && R(L) ? (i === null && (i = new er2(e)), f = N ? i.fromEquirectangular(p) : i.fromCubemap(p), f.texture.pmremVersion = p.pmremVersion, t.set(p, f), p.addEventListener("dispose", H2), f.texture) : null;
        }
      }
    }
    return p;
  }
  function g(p, x) {
    return x === Wa ? p.mapping = Pi : x === Ga && (p.mapping = Ua), p;
  }
  function R(p) {
    let x = 0;
    const N = 6;
    for (let W2 = 0; W2 < N; W2++) p[W2] !== void 0 && x++;
    return x === N;
  }
  function T(p) {
    const x = p.target;
    x.removeEventListener("dispose", T);
    const N = n.get(x);
    N !== void 0 && (n.delete(x), N.dispose());
  }
  function H2(p) {
    const x = p.target;
    x.removeEventListener("dispose", H2);
    const N = t.get(x);
    N !== void 0 && (t.delete(x), N.dispose());
  }
  function I2() {
    n = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap(), i !== null && (i.dispose(), i = null);
  }
  return { get: l, dispose: I2 };
}
function _c2(e) {
  const n = {};
  function t(i) {
    if (n[i] !== void 0) return n[i];
    const l = e.getExtension(i);
    return n[i] = l, l;
  }
  return { has: function(i) {
    return t(i) !== null;
  }, init: function() {
    t("EXT_color_buffer_float"), t("WEBGL_clip_cull_distance"), t("OES_texture_float_linear"), t("EXT_color_buffer_half_float"), t("WEBGL_multisampled_render_to_texture"), t("WEBGL_render_shared_exponent");
  }, get: function(i) {
    const l = t(i);
    return l === null && _e("WebGLRenderer: " + i + " extension not supported."), l;
  } };
}
function gc2(e, n, t, i) {
  const l = {}, o = /* @__PURE__ */ new WeakMap();
  function d(I2) {
    const p = I2.target;
    p.index !== null && n.remove(p.index);
    for (const N in p.attributes) n.remove(p.attributes[N]);
    p.removeEventListener("dispose", d), delete l[p.id];
    const x = o.get(p);
    x && (n.remove(x), o.delete(p)), i.releaseStatesOfGeometry(p), p.isInstancedBufferGeometry === true && delete p._maxInstanceCount, t.memory.geometries--;
  }
  function g(I2, p) {
    return l[p.id] === true || (p.addEventListener("dispose", d), l[p.id] = true, t.memory.geometries++), p;
  }
  function R(I2) {
    const p = I2.attributes;
    for (const x in p) n.update(p[x], e.ARRAY_BUFFER);
  }
  function T(I2) {
    const p = [], x = I2.index, N = I2.attributes.position;
    let W2 = 0;
    if (N === void 0) return;
    if (x !== null) {
      const L = x.array;
      W2 = x.version;
      for (let z = 0, h = L.length; z < h; z += 3) {
        const S = L[z + 0], m = L[z + 1], D2 = L[z + 2];
        p.push(S, m, m, D2, D2, S);
      }
    } else {
      const L = N.array;
      W2 = N.version;
      for (let z = 0, h = L.length / 3 - 1; z < h; z += 3) {
        const S = z + 0, m = z + 1, D2 = z + 2;
        p.push(S, m, m, D2, D2, S);
      }
    }
    const f = new (N.count >= 65535 ? yh : mh)(p, 1);
    f.version = W2;
    const s = o.get(I2);
    s && n.remove(s), o.set(I2, f);
  }
  function H2(I2) {
    const p = o.get(I2);
    if (p) {
      const x = I2.index;
      x !== null && p.version < x.version && T(I2);
    } else T(I2);
    return o.get(I2);
  }
  return { get: g, update: R, getWireframeAttribute: H2 };
}
function vc2(e, n, t) {
  let i;
  function l(I2) {
    i = I2;
  }
  let o, d;
  function g(I2) {
    o = I2.type, d = I2.bytesPerElement;
  }
  function R(I2, p) {
    e.drawElements(i, p, o, I2 * d), t.update(p, i, 1);
  }
  function T(I2, p, x) {
    x !== 0 && (e.drawElementsInstanced(i, p, o, I2 * d, x), t.update(p, i, x));
  }
  function H2(I2, p, x) {
    if (x === 0) return;
    n.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i, p, 0, o, I2, 0, x);
    let W2 = 0;
    for (let f = 0; f < x; f++) W2 += p[f];
    t.update(W2, i, 1);
  }
  this.setMode = l, this.setIndex = g, this.render = R, this.renderInstances = T, this.renderMultiDraw = H2;
}
function Sc2(e) {
  const n = { geometries: 0, textures: 0 }, t = { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 };
  function i(o, d, g) {
    switch (t.calls++, d) {
      case e.TRIANGLES:
        t.triangles += g * (o / 3);
        break;
      case e.LINES:
        t.lines += g * (o / 2);
        break;
      case e.LINE_STRIP:
        t.lines += g * (o - 1);
        break;
      case e.LINE_LOOP:
        t.lines += g * o;
        break;
      case e.POINTS:
        t.points += g * o;
        break;
      default:
        X("WebGLInfo: Unknown draw mode:", d);
        break;
    }
  }
  function l() {
    t.calls = 0, t.triangles = 0, t.points = 0, t.lines = 0;
  }
  return { memory: n, render: t, programs: null, autoReset: true, reset: l, update: i };
}
function Ec2(e, n, t) {
  const i = /* @__PURE__ */ new WeakMap(), l = new At();
  function o(d, g, R) {
    const T = d.morphTargetInfluences, H2 = g.morphAttributes.position || g.morphAttributes.normal || g.morphAttributes.color, I2 = H2 !== void 0 ? H2.length : 0;
    let p = i.get(g);
    if (p === void 0 || p.count !== I2) {
      let _ = function() {
        D2.dispose(), i.delete(g), g.removeEventListener("dispose", _);
      };
      p !== void 0 && p.texture.dispose();
      const x = g.morphAttributes.position !== void 0, N = g.morphAttributes.normal !== void 0, W2 = g.morphAttributes.color !== void 0, f = g.morphAttributes.position || [], s = g.morphAttributes.normal || [], L = g.morphAttributes.color || [];
      let z = 0;
      x === true && (z = 1), N === true && (z = 2), W2 === true && (z = 3);
      let h = g.attributes.position.count * z, S = 1;
      h > n.maxTextureSize && (S = Math.ceil(h / n.maxTextureSize), h = n.maxTextureSize);
      const m = new Float32Array(h * S * 4 * I2), D2 = new nh(m, h, S, I2);
      D2.type = Re, D2.needsUpdate = true;
      const c = z * 4;
      for (let w2 = 0; w2 < I2; w2++) {
        const F = f[w2], G2 = s[w2], q = L[w2], P2 = h * S * 4 * w2;
        for (let K = 0; K < F.count; K++) {
          const Q = K * c;
          x === true && (l.fromBufferAttribute(F, K), m[P2 + Q + 0] = l.x, m[P2 + Q + 1] = l.y, m[P2 + Q + 2] = l.z, m[P2 + Q + 3] = 0), N === true && (l.fromBufferAttribute(G2, K), m[P2 + Q + 4] = l.x, m[P2 + Q + 5] = l.y, m[P2 + Q + 6] = l.z, m[P2 + Q + 7] = 0), W2 === true && (l.fromBufferAttribute(q, K), m[P2 + Q + 8] = l.x, m[P2 + Q + 9] = l.y, m[P2 + Q + 10] = l.z, m[P2 + Q + 11] = q.itemSize === 4 ? l.w : 1);
        }
      }
      p = { count: I2, texture: D2, size: new I(h, S) }, i.set(g, p), g.addEventListener("dispose", _);
    }
    if (d.isInstancedMesh === true && d.morphTexture !== null) R.getUniforms().setValue(e, "morphTexture", d.morphTexture, t);
    else {
      let x = 0;
      for (let W2 = 0; W2 < T.length; W2++) x += T[W2];
      const N = g.morphTargetsRelative ? 1 : 1 - x;
      R.getUniforms().setValue(e, "morphTargetBaseInfluence", N), R.getUniforms().setValue(e, "morphTargetInfluences", T);
    }
    R.getUniforms().setValue(e, "morphTargetsTexture", p.texture, t), R.getUniforms().setValue(e, "morphTargetsTextureSize", p.size);
  }
  return { update: o };
}
function Mc2(e, n, t, i, l) {
  let o = /* @__PURE__ */ new WeakMap();
  function d(T) {
    const H2 = l.render.frame, I2 = T.geometry, p = n.get(T, I2);
    if (o.get(p) !== H2 && (n.update(p), o.set(p, H2)), T.isInstancedMesh && (T.hasEventListener("dispose", R) === false && T.addEventListener("dispose", R), o.get(T) !== H2 && (t.update(T.instanceMatrix, e.ARRAY_BUFFER), T.instanceColor !== null && t.update(T.instanceColor, e.ARRAY_BUFFER), o.set(T, H2))), T.isSkinnedMesh) {
      const x = T.skeleton;
      o.get(x) !== H2 && (x.update(), o.set(x, H2));
    }
    return p;
  }
  function g() {
    o = /* @__PURE__ */ new WeakMap();
  }
  function R(T) {
    const H2 = T.target;
    H2.removeEventListener("dispose", R), i.releaseStatesOfObject(H2), t.remove(H2.instanceMatrix), H2.instanceColor !== null && t.remove(H2.instanceColor);
  }
  return { update: d, dispose: g };
}
var xc = { [nu]: "LINEAR_TONE_MAPPING", [ru]: "REINHARD_TONE_MAPPING", [au]: "CINEON_TONE_MAPPING", [ou]: "ACES_FILMIC_TONE_MAPPING", [lu]: "AGX_TONE_MAPPING", [cu]: "NEUTRAL_TONE_MAPPING", [hu]: "CUSTOM_TONE_MAPPING" };
function Tc2(e, n, t, i, l, o) {
  const d = new Mr(n, t, { type: e, depthBuffer: l, stencilBuffer: o, samples: i ? 4 : 0, storeMultisampledDepthBuffer: false, storeMultisampledStencilBuffer: false, resolveDepthBuffer: false, resolveStencilBuffer: false });
  let g = null, R = null;
  const T = new H();
  T.setAttribute("position", new P([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3)), T.setAttribute("uv", new P([0, 2, 0, 0, 2, 0], 2));
  const H2 = new yl({ uniforms: { tDiffuse: { value: null } }, vertexShader: `
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`, fragmentShader: `
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`, depthTest: false, depthWrite: false }), I2 = new Zt(T, H2), p = new ma(-1, 1, 1, -1, 0, 1);
  let x = null, N = null, W2 = false, f, s = null, L = [], z = false;
  this.setSize = function(h, S) {
    d.setSize(h, S), g !== null && g.setSize(h, S), R !== null && R.setSize(h, S);
    for (let m = 0; m < L.length; m++) {
      const D2 = L[m];
      D2.setSize && D2.setSize(h, S);
    }
  }, this.setEffects = function(h) {
    L = h, z = L.length > 0 && L[0].isRenderPass === true;
    const S = d.width, m = d.height;
    L.length > 0 && g === null && (g = new Mr(S, m, { type: ja, depthBuffer: false, stencilBuffer: false }), R = new Mr(S, m, { type: ja, depthBuffer: false, stencilBuffer: false }));
    for (let D2 = 0; D2 < L.length; D2++) {
      const c = L[D2];
      c.setSize && c.setSize(S, m);
    }
  }, this.begin = function(h, S) {
    if (W2 || h.toneMapping === su && L.length === 0) return false;
    if (s = S, S !== null) {
      const m = S.width, D2 = S.height;
      (d.width !== m || d.height !== D2) && this.setSize(m, D2);
    }
    return z === false && h.setRenderTarget(d), f = h.toneMapping, h.toneMapping = su, true;
  }, this.hasRenderPass = function() {
    return z;
  }, this.end = function(h, S) {
    h.toneMapping = f, W2 = true;
    let m = d, D2 = g;
    for (let c = 0; c < L.length; c++) {
      const _ = L[c];
      _.enabled !== false && (_.render(h, D2, m, S), _.needsSwap !== false && (m = D2, D2 = D2 === g ? R : g));
    }
    if (x !== h.outputColorSpace || N !== h.toneMapping) {
      x = h.outputColorSpace, N = h.toneMapping, H2.defines = {}, It.getTransfer(x) === Cs && (H2.defines.SRGB_TRANSFER = "");
      const c = xc[N];
      c && (H2.defines[c] = ""), H2.needsUpdate = true;
    }
    H2.uniforms.tDiffuse.value = m.texture, h.setRenderTarget(s), h.render(I2, p), s = null, W2 = false;
  }, this.isCompositing = function() {
    return W2;
  }, this.dispose = function() {
    d.dispose(), g !== null && g.dispose(), R !== null && R.dispose(), T.dispose(), H2.dispose();
  };
}
var Ha2 = new ot();
var nr2 = new Xh(1, 1);
var Va2 = new nh();
var Wa2 = new wr();
var ka = new Yr();
var za2 = [];
var Xa2 = [];
var Ka2 = new Float32Array(16);
var Ya2 = new Float32Array(9);
var qa2 = new Float32Array(4);
function on2(e, n, t) {
  const i = e[0];
  if (i <= 0 || i > 0) return e;
  const l = n * t;
  let o = za2[l];
  if (o === void 0 && (o = new Float32Array(l), za2[l] = o), n !== 0) {
    i.toArray(o, 0);
    for (let d = 1, g = 0; d !== n; ++d) g += t, e[d].toArray(o, g);
  }
  return o;
}
function lt2(e, n) {
  if (e.length !== n.length) return false;
  for (let t = 0, i = e.length; t < i; t++) if (e[t] !== n[t]) return false;
  return true;
}
function ct(e, n) {
  for (let t = 0, i = n.length; t < i; t++) e[t] = n[t];
}
function On2(e, n) {
  let t = Xa2[n];
  t === void 0 && (t = new Int32Array(n), Xa2[n] = t);
  for (let i = 0; i !== n; ++i) t[i] = e.allocateTextureUnit();
  return t;
}
function Ac2(e, n) {
  const t = this.cache;
  t[0] !== n && (e.uniform1f(this.addr, n), t[0] = n);
}
function Rc2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y) && (e.uniform2f(this.addr, n.x, n.y), t[0] = n.x, t[1] = n.y);
  else {
    if (lt2(t, n)) return;
    e.uniform2fv(this.addr, n), ct(t, n);
  }
}
function bc(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y || t[2] !== n.z) && (e.uniform3f(this.addr, n.x, n.y, n.z), t[0] = n.x, t[1] = n.y, t[2] = n.z);
  else if (n.r !== void 0) (t[0] !== n.r || t[1] !== n.g || t[2] !== n.b) && (e.uniform3f(this.addr, n.r, n.g, n.b), t[0] = n.r, t[1] = n.g, t[2] = n.b);
  else {
    if (lt2(t, n)) return;
    e.uniform3fv(this.addr, n), ct(t, n);
  }
}
function Cc2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y || t[2] !== n.z || t[3] !== n.w) && (e.uniform4f(this.addr, n.x, n.y, n.z, n.w), t[0] = n.x, t[1] = n.y, t[2] = n.z, t[3] = n.w);
  else {
    if (lt2(t, n)) return;
    e.uniform4fv(this.addr, n), ct(t, n);
  }
}
function Pc2(e, n) {
  const t = this.cache, i = n.elements;
  if (i === void 0) {
    if (lt2(t, n)) return;
    e.uniformMatrix2fv(this.addr, false, n), ct(t, n);
  } else {
    if (lt2(t, i)) return;
    qa2.set(i), e.uniformMatrix2fv(this.addr, false, qa2), ct(t, i);
  }
}
function Lc2(e, n) {
  const t = this.cache, i = n.elements;
  if (i === void 0) {
    if (lt2(t, n)) return;
    e.uniformMatrix3fv(this.addr, false, n), ct(t, n);
  } else {
    if (lt2(t, i)) return;
    Ya2.set(i), e.uniformMatrix3fv(this.addr, false, Ya2), ct(t, i);
  }
}
function Uc2(e, n) {
  const t = this.cache, i = n.elements;
  if (i === void 0) {
    if (lt2(t, n)) return;
    e.uniformMatrix4fv(this.addr, false, n), ct(t, n);
  } else {
    if (lt2(t, i)) return;
    Ka2.set(i), e.uniformMatrix4fv(this.addr, false, Ka2), ct(t, i);
  }
}
function Dc2(e, n) {
  const t = this.cache;
  t[0] !== n && (e.uniform1i(this.addr, n), t[0] = n);
}
function wc2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y) && (e.uniform2i(this.addr, n.x, n.y), t[0] = n.x, t[1] = n.y);
  else {
    if (lt2(t, n)) return;
    e.uniform2iv(this.addr, n), ct(t, n);
  }
}
function Ic2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y || t[2] !== n.z) && (e.uniform3i(this.addr, n.x, n.y, n.z), t[0] = n.x, t[1] = n.y, t[2] = n.z);
  else {
    if (lt2(t, n)) return;
    e.uniform3iv(this.addr, n), ct(t, n);
  }
}
function Nc2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y || t[2] !== n.z || t[3] !== n.w) && (e.uniform4i(this.addr, n.x, n.y, n.z, n.w), t[0] = n.x, t[1] = n.y, t[2] = n.z, t[3] = n.w);
  else {
    if (lt2(t, n)) return;
    e.uniform4iv(this.addr, n), ct(t, n);
  }
}
function yc2(e, n) {
  const t = this.cache;
  t[0] !== n && (e.uniform1ui(this.addr, n), t[0] = n);
}
function Fc2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y) && (e.uniform2ui(this.addr, n.x, n.y), t[0] = n.x, t[1] = n.y);
  else {
    if (lt2(t, n)) return;
    e.uniform2uiv(this.addr, n), ct(t, n);
  }
}
function Oc2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y || t[2] !== n.z) && (e.uniform3ui(this.addr, n.x, n.y, n.z), t[0] = n.x, t[1] = n.y, t[2] = n.z);
  else {
    if (lt2(t, n)) return;
    e.uniform3uiv(this.addr, n), ct(t, n);
  }
}
function Bc2(e, n) {
  const t = this.cache;
  if (n.x !== void 0) (t[0] !== n.x || t[1] !== n.y || t[2] !== n.z || t[3] !== n.w) && (e.uniform4ui(this.addr, n.x, n.y, n.z, n.w), t[0] = n.x, t[1] = n.y, t[2] = n.z, t[3] = n.w);
  else {
    if (lt2(t, n)) return;
    e.uniform4uiv(this.addr, n), ct(t, n);
  }
}
function Gc2(e, n, t) {
  const i = this.cache, l = t.allocateTextureUnit();
  i[0] !== l && (e.uniform1i(this.addr, l), i[0] = l);
  let o;
  this.type === e.SAMPLER_2D_SHADOW ? (nr2.compareFunction = t.isReversedDepthBuffer() ? Xu : Hu, o = nr2) : o = Ha2, t.setTexture2D(n || o, l);
}
function Hc2(e, n, t) {
  const i = this.cache, l = t.allocateTextureUnit();
  i[0] !== l && (e.uniform1i(this.addr, l), i[0] = l), t.setTexture3D(n || Wa2, l);
}
function Vc2(e, n, t) {
  const i = this.cache, l = t.allocateTextureUnit();
  i[0] !== l && (e.uniform1i(this.addr, l), i[0] = l), t.setTextureCube(n || ka, l);
}
function Wc2(e, n, t) {
  const i = this.cache, l = t.allocateTextureUnit();
  i[0] !== l && (e.uniform1i(this.addr, l), i[0] = l), t.setTexture2DArray(n || Va2, l);
}
function kc2(e) {
  switch (e) {
    case 5126:
      return Ac2;
    case 35664:
      return Rc2;
    case 35665:
      return bc;
    case 35666:
      return Cc2;
    case 35674:
      return Pc2;
    case 35675:
      return Lc2;
    case 35676:
      return Uc2;
    case 5124:
    case 35670:
      return Dc2;
    case 35667:
    case 35671:
      return wc2;
    case 35668:
    case 35672:
      return Ic2;
    case 35669:
    case 35673:
      return Nc2;
    case 5125:
      return yc2;
    case 36294:
      return Fc2;
    case 36295:
      return Oc2;
    case 36296:
      return Bc2;
    case 35678:
    case 36198:
    case 36298:
    case 36306:
    case 35682:
      return Gc2;
    case 35679:
    case 36299:
    case 36307:
      return Hc2;
    case 35680:
    case 36300:
    case 36308:
    case 36293:
      return Vc2;
    case 36289:
    case 36303:
    case 36311:
    case 36292:
      return Wc2;
  }
}
function zc2(e, n) {
  e.uniform1fv(this.addr, n);
}
function Xc2(e, n) {
  const t = on2(n, this.size, 2);
  e.uniform2fv(this.addr, t);
}
function Kc2(e, n) {
  const t = on2(n, this.size, 3);
  e.uniform3fv(this.addr, t);
}
function Yc2(e, n) {
  const t = on2(n, this.size, 4);
  e.uniform4fv(this.addr, t);
}
function qc2(e, n) {
  const t = on2(n, this.size, 4);
  e.uniformMatrix2fv(this.addr, false, t);
}
function Zc2(e, n) {
  const t = on2(n, this.size, 9);
  e.uniformMatrix3fv(this.addr, false, t);
}
function $c2(e, n) {
  const t = on2(n, this.size, 16);
  e.uniformMatrix4fv(this.addr, false, t);
}
function Qc2(e, n) {
  e.uniform1iv(this.addr, n);
}
function Jc2(e, n) {
  e.uniform2iv(this.addr, n);
}
function jc2(e, n) {
  e.uniform3iv(this.addr, n);
}
function ef2(e, n) {
  e.uniform4iv(this.addr, n);
}
function tf2(e, n) {
  e.uniform1uiv(this.addr, n);
}
function nf2(e, n) {
  e.uniform2uiv(this.addr, n);
}
function rf2(e, n) {
  e.uniform3uiv(this.addr, n);
}
function af2(e, n) {
  e.uniform4uiv(this.addr, n);
}
function of2(e, n, t) {
  const i = this.cache, l = n.length, o = On2(t, l);
  lt2(i, o) || (e.uniform1iv(this.addr, o), ct(i, o));
  let d;
  this.type === e.SAMPLER_2D_SHADOW ? d = nr2 : d = Ha2;
  for (let g = 0; g !== l; ++g) t.setTexture2D(n[g] || d, o[g]);
}
function sf2(e, n, t) {
  const i = this.cache, l = n.length, o = On2(t, l);
  lt2(i, o) || (e.uniform1iv(this.addr, o), ct(i, o));
  for (let d = 0; d !== l; ++d) t.setTexture3D(n[d] || Wa2, o[d]);
}
function lf2(e, n, t) {
  const i = this.cache, l = n.length, o = On2(t, l);
  lt2(i, o) || (e.uniform1iv(this.addr, o), ct(i, o));
  for (let d = 0; d !== l; ++d) t.setTextureCube(n[d] || ka, o[d]);
}
function cf(e, n, t) {
  const i = this.cache, l = n.length, o = On2(t, l);
  lt2(i, o) || (e.uniform1iv(this.addr, o), ct(i, o));
  for (let d = 0; d !== l; ++d) t.setTexture2DArray(n[d] || Va2, o[d]);
}
function ff2(e) {
  switch (e) {
    case 5126:
      return zc2;
    case 35664:
      return Xc2;
    case 35665:
      return Kc2;
    case 35666:
      return Yc2;
    case 35674:
      return qc2;
    case 35675:
      return Zc2;
    case 35676:
      return $c2;
    case 5124:
    case 35670:
      return Qc2;
    case 35667:
    case 35671:
      return Jc2;
    case 35668:
    case 35672:
      return jc2;
    case 35669:
    case 35673:
      return ef2;
    case 5125:
      return tf2;
    case 36294:
      return nf2;
    case 36295:
      return rf2;
    case 36296:
      return af2;
    case 35678:
    case 36198:
    case 36298:
    case 36306:
    case 35682:
      return of2;
    case 35679:
    case 36299:
    case 36307:
      return sf2;
    case 35680:
    case 36300:
    case 36308:
    case 36293:
      return lf2;
    case 36289:
    case 36303:
    case 36311:
    case 36292:
      return cf;
  }
}
var df2 = class {
  constructor(n, t, i) {
    this.id = n, this.addr = i, this.cache = [], this.type = t.type, this.setValue = kc2(t.type);
  }
};
var uf = class {
  constructor(n, t, i) {
    this.id = n, this.addr = i, this.cache = [], this.type = t.type, this.size = t.size, this.setValue = ff2(t.type);
  }
};
var pf2 = class {
  constructor(n) {
    this.id = n, this.seq = [], this.map = {};
  }
  setValue(n, t, i) {
    const l = this.seq;
    for (let o = 0, d = l.length; o !== d; ++o) {
      const g = l[o];
      g.setValue(n, t[g.id], i);
    }
  }
};
var ir2 = /(\w+)(\])?(\[|\.)?/g;
function Za2(e, n) {
  e.seq.push(n), e.map[n.id] = n;
}
function hf2(e, n, t) {
  const i = e.name, l = i.length;
  for (ir2.lastIndex = 0; ; ) {
    const o = ir2.exec(i), d = ir2.lastIndex;
    let g = o[1];
    const R = o[2] === "]", T = o[3];
    if (R && (g = g | 0), T === void 0 || T === "[" && d + 2 === l) {
      Za2(t, T === void 0 ? new df2(g, e, n) : new uf(g, e, n));
      break;
    } else {
      let I2 = t.map[g];
      I2 === void 0 && (I2 = new pf2(g), Za2(t, I2)), t = I2;
    }
  }
}
var Bn = class {
  constructor(n, t) {
    this.seq = [], this.map = {};
    const i = n.getProgramParameter(t, n.ACTIVE_UNIFORMS);
    for (let d = 0; d < i; ++d) {
      const g = n.getActiveUniform(t, d), R = n.getUniformLocation(t, g.name);
      hf2(g, R, this);
    }
    const l = [], o = [];
    for (const d of this.seq) d.type === n.SAMPLER_2D_SHADOW || d.type === n.SAMPLER_CUBE_SHADOW || d.type === n.SAMPLER_2D_ARRAY_SHADOW ? l.push(d) : o.push(d);
    l.length > 0 && (this.seq = l.concat(o));
  }
  setValue(n, t, i, l) {
    const o = this.map[t];
    o !== void 0 && o.setValue(n, i, l);
  }
  setOptional(n, t, i) {
    const l = t[i];
    l !== void 0 && this.setValue(n, i, l);
  }
  static upload(n, t, i, l) {
    for (let o = 0, d = t.length; o !== d; ++o) {
      const g = t[o], R = i[g.id];
      R.needsUpdate !== false && g.setValue(n, R.value, l);
    }
  }
  static seqWithValue(n, t) {
    const i = [];
    for (let l = 0, o = n.length; l !== o; ++l) {
      const d = n[l];
      d.id in t && i.push(d);
    }
    return i;
  }
};
function $a2(e, n, t) {
  const i = e.createShader(n);
  return e.shaderSource(i, t), e.compileShader(i), i;
}
var mf = 37297;
var _f2 = 0;
function gf(e, n) {
  const t = e.split(`
`), i = [], l = Math.max(n - 6, 0), o = Math.min(n + 6, t.length);
  for (let d = l; d < o; d++) {
    const g = d + 1;
    i.push(`${g === n ? ">" : " "} ${g}: ${t[d]}`);
  }
  return i.join(`
`);
}
var Qa2 = new Kt();
function vf(e) {
  It._getMatrix(Qa2, It.workingColorSpace, e);
  const n = `mat3( ${Qa2.elements.map((t) => t.toFixed(4))} )`;
  switch (It.getTransfer(e)) {
    case ur:
      return [n, "LinearTransferOETF"];
    case Cs:
      return [n, "sRGBTransferOETF"];
    default:
      return V("WebGLProgram: Unsupported color space: ", e), [n, "LinearTransferOETF"];
  }
}
function Ja2(e, n, t) {
  const i = e.getShaderParameter(n, e.COMPILE_STATUS), o = (e.getShaderInfoLog(n) || "").trim();
  if (i && o === "") return "";
  const d = /ERROR: 0:(\d+)/.exec(o);
  if (d) {
    const g = parseInt(d[1]);
    return t.toUpperCase() + `

` + o + `

` + gf(e.getShaderSource(n), g);
  } else return o;
}
function Sf(e, n) {
  const t = vf(n);
  return [`vec4 ${e}( vec4 value ) {`, `	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`, "}"].join(`
`);
}
var Ef2 = { [nu]: "Linear", [ru]: "Reinhard", [au]: "Cineon", [ou]: "ACESFilmic", [lu]: "AgX", [cu]: "Neutral", [hu]: "Custom" };
function Mf2(e, n) {
  const t = Ef2[n];
  return t === void 0 ? (V("WebGLProgram: Unsupported toneMapping:", n), "vec3 " + e + "( vec3 color ) { return LinearToneMapping( color ); }") : "vec3 " + e + "( vec3 color ) { return " + t + "ToneMapping( color ); }";
}
var Gn2 = new w();
function xf2() {
  It.getLuminanceCoefficients(Gn2);
  const e = Gn2.x.toFixed(4), n = Gn2.y.toFixed(4), t = Gn2.z.toFixed(4);
  return ["float luminance( const in vec3 rgb ) {", `	const vec3 weights = vec3( ${e}, ${n}, ${t} );`, "	return dot( weights, rgb );", "}"].join(`
`);
}
function Tf2(e) {
  return [e.extensionClipCullDistance ? "#extension GL_ANGLE_clip_cull_distance : require" : "", e.extensionMultiDraw ? "#extension GL_ANGLE_multi_draw : require" : ""].filter(_n2).join(`
`);
}
function Af(e) {
  const n = [];
  for (const t in e) {
    const i = e[t];
    i !== false && n.push("#define " + t + " " + i);
  }
  return n.join(`
`);
}
function Rf2(e, n) {
  const t = {}, i = e.getProgramParameter(n, e.ACTIVE_ATTRIBUTES);
  for (let l = 0; l < i; l++) {
    const o = e.getActiveAttrib(n, l), d = o.name;
    let g = 1;
    o.type === e.FLOAT_MAT2 && (g = 2), o.type === e.FLOAT_MAT3 && (g = 3), o.type === e.FLOAT_MAT4 && (g = 4), t[d] = { type: o.type, location: e.getAttribLocation(n, d), locationSize: g };
  }
  return t;
}
function _n2(e) {
  return e !== "";
}
function ja2(e, n) {
  const t = n.numSpotLightShadows + n.numSpotLightMaps - n.numSpotLightShadowsWithMaps;
  return e.replace(/NUM_SUN_LIGHTS/g, n.numSunLights).replace(/NUM_DIR_LIGHTS/g, n.numDirLights).replace(/NUM_SPOT_LIGHTS/g, n.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g, n.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g, t).replace(/NUM_RECT_AREA_LIGHTS/g, n.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g, n.numPointLights).replace(/NUM_HEMI_LIGHTS/g, n.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g, n.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g, n.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g, n.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g, n.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g, n.numPointLightShadows);
}
function eo2(e, n) {
  return e.replace(/NUM_CLIPPING_PLANES/g, n.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g, n.numClippingPlanes - n.numClipIntersection);
}
var bf2 = /^[ \t]*#include +<([\w\d./]+)>/gm;
function rr2(e) {
  return e.replace(bf2, Pf);
}
var Cf = /* @__PURE__ */ new Map();
function Pf(e, n) {
  let t = Pe[n];
  if (t === void 0) {
    const i = Cf.get(n);
    if (i !== void 0) t = Pe[i], V('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.', n, i);
    else throw new Error("THREE.WebGLProgram: Can not resolve #include <" + n + ">");
  }
  return rr2(t);
}
var Lf2 = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
function to2(e) {
  return e.replace(Lf2, Uf2);
}
function Uf2(e, n, t, i) {
  let l = "";
  for (let o = parseInt(n); o < parseInt(t); o++) l += i.replace(/\[\s*i\s*\]/g, "[ " + o + " ]").replace(/UNROLLED_LOOP_INDEX/g, o);
  return l;
}
function no2(e) {
  let n = `precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;
  return e.precision === "highp" ? n += `
#define HIGH_PRECISION` : e.precision === "mediump" ? n += `
#define MEDIUM_PRECISION` : e.precision === "lowp" && (n += `
#define LOW_PRECISION`), n;
}
var Df2 = { [Ic]: "SHADOWMAP_TYPE_PCF", [Bc]: "SHADOWMAP_TYPE_VSM" };
function wf2(e) {
  return Df2[e.shadowMapType] || "SHADOWMAP_TYPE_BASIC";
}
var If2 = { [Pi]: "ENVMAP_TYPE_CUBE", [Ua]: "ENVMAP_TYPE_CUBE", [Ha]: "ENVMAP_TYPE_CUBE_UV" };
function Nf2(e) {
  return e.envMap === false ? "ENVMAP_TYPE_CUBE" : If2[e.envMapMode] || "ENVMAP_TYPE_CUBE";
}
var yf = { [Ua]: "ENVMAP_MODE_REFRACTION" };
function Ff2(e) {
  return e.envMap === false ? "ENVMAP_MODE_REFLECTION" : yf[e.envMapMode] || "ENVMAP_MODE_REFLECTION";
}
var Of2 = { [gs]: "ENVMAP_BLENDING_MULTIPLY", [eu]: "ENVMAP_BLENDING_MIX", [iu]: "ENVMAP_BLENDING_ADD" };
function Bf2(e) {
  return e.envMap === false ? "ENVMAP_BLENDING_NONE" : Of2[e.combine] || "ENVMAP_BLENDING_NONE";
}
function Gf2(e) {
  const n = e.envMapCubeUVHeight;
  if (n === null) return null;
  const t = Math.log2(n) - 2, i = 1 / n;
  return { texelWidth: 1 / (3 * Math.max(Math.pow(2, t), 112)), texelHeight: i, maxMip: t };
}
function Hf2(e, n, t, i) {
  const l = e.getContext(), o = t.defines;
  let d = t.vertexShader, g = t.fragmentShader;
  const R = wf2(t), T = Nf2(t), H2 = Ff2(t), I2 = Bf2(t), p = Gf2(t), x = Tf2(t), N = Af(o), W2 = l.createProgram();
  let f, s, L = t.glslVersion ? "#version " + t.glslVersion + `
` : "";
  t.isRawShaderMaterial ? (f = ["#define SHADER_TYPE " + t.shaderType, "#define SHADER_NAME " + t.shaderName, N].filter(_n2).join(`
`), f.length > 0 && (f += `
`), s = ["#define SHADER_TYPE " + t.shaderType, "#define SHADER_NAME " + t.shaderName, N].filter(_n2).join(`
`), s.length > 0 && (s += `
`)) : (f = [no2(t), "#define SHADER_TYPE " + t.shaderType, "#define SHADER_NAME " + t.shaderName, N, t.extensionClipCullDistance ? "#define USE_CLIP_DISTANCE" : "", t.batching ? "#define USE_BATCHING" : "", t.batchingColor ? "#define USE_BATCHING_COLOR" : "", t.instancing ? "#define USE_INSTANCING" : "", t.instancingColor ? "#define USE_INSTANCING_COLOR" : "", t.instancingMorph ? "#define USE_INSTANCING_MORPH" : "", t.useFog && t.fog ? "#define USE_FOG" : "", t.useFog && t.fogExp2 ? "#define FOG_EXP2" : "", t.map ? "#define USE_MAP" : "", t.envMap ? "#define USE_ENVMAP" : "", t.envMap ? "#define " + H2 : "", t.lightMap ? "#define USE_LIGHTMAP" : "", t.aoMap ? "#define USE_AOMAP" : "", t.bumpMap ? "#define USE_BUMPMAP" : "", t.normalMap ? "#define USE_NORMALMAP" : "", t.normalMapObjectSpace ? "#define USE_NORMALMAP_OBJECTSPACE" : "", t.normalMapTangentSpace ? "#define USE_NORMALMAP_TANGENTSPACE" : "", t.displacementMap ? "#define USE_DISPLACEMENTMAP" : "", t.emissiveMap ? "#define USE_EMISSIVEMAP" : "", t.anisotropy ? "#define USE_ANISOTROPY" : "", t.anisotropyMap ? "#define USE_ANISOTROPYMAP" : "", t.clearcoatMap ? "#define USE_CLEARCOATMAP" : "", t.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "", t.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "", t.iridescenceMap ? "#define USE_IRIDESCENCEMAP" : "", t.iridescenceThicknessMap ? "#define USE_IRIDESCENCE_THICKNESSMAP" : "", t.specularMap ? "#define USE_SPECULARMAP" : "", t.specularColorMap ? "#define USE_SPECULAR_COLORMAP" : "", t.specularIntensityMap ? "#define USE_SPECULAR_INTENSITYMAP" : "", t.roughnessMap ? "#define USE_ROUGHNESSMAP" : "", t.metalnessMap ? "#define USE_METALNESSMAP" : "", t.alphaMap ? "#define USE_ALPHAMAP" : "", t.alphaHash ? "#define USE_ALPHAHASH" : "", t.transmission ? "#define USE_TRANSMISSION" : "", t.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "", t.thicknessMap ? "#define USE_THICKNESSMAP" : "", t.sheenColorMap ? "#define USE_SHEEN_COLORMAP" : "", t.sheenRoughnessMap ? "#define USE_SHEEN_ROUGHNESSMAP" : "", t.mapUv ? "#define MAP_UV " + t.mapUv : "", t.alphaMapUv ? "#define ALPHAMAP_UV " + t.alphaMapUv : "", t.lightMapUv ? "#define LIGHTMAP_UV " + t.lightMapUv : "", t.aoMapUv ? "#define AOMAP_UV " + t.aoMapUv : "", t.emissiveMapUv ? "#define EMISSIVEMAP_UV " + t.emissiveMapUv : "", t.bumpMapUv ? "#define BUMPMAP_UV " + t.bumpMapUv : "", t.normalMapUv ? "#define NORMALMAP_UV " + t.normalMapUv : "", t.displacementMapUv ? "#define DISPLACEMENTMAP_UV " + t.displacementMapUv : "", t.metalnessMapUv ? "#define METALNESSMAP_UV " + t.metalnessMapUv : "", t.roughnessMapUv ? "#define ROUGHNESSMAP_UV " + t.roughnessMapUv : "", t.anisotropyMapUv ? "#define ANISOTROPYMAP_UV " + t.anisotropyMapUv : "", t.clearcoatMapUv ? "#define CLEARCOATMAP_UV " + t.clearcoatMapUv : "", t.clearcoatNormalMapUv ? "#define CLEARCOAT_NORMALMAP_UV " + t.clearcoatNormalMapUv : "", t.clearcoatRoughnessMapUv ? "#define CLEARCOAT_ROUGHNESSMAP_UV " + t.clearcoatRoughnessMapUv : "", t.iridescenceMapUv ? "#define IRIDESCENCEMAP_UV " + t.iridescenceMapUv : "", t.iridescenceThicknessMapUv ? "#define IRIDESCENCE_THICKNESSMAP_UV " + t.iridescenceThicknessMapUv : "", t.sheenColorMapUv ? "#define SHEEN_COLORMAP_UV " + t.sheenColorMapUv : "", t.sheenRoughnessMapUv ? "#define SHEEN_ROUGHNESSMAP_UV " + t.sheenRoughnessMapUv : "", t.specularMapUv ? "#define SPECULARMAP_UV " + t.specularMapUv : "", t.specularColorMapUv ? "#define SPECULAR_COLORMAP_UV " + t.specularColorMapUv : "", t.specularIntensityMapUv ? "#define SPECULAR_INTENSITYMAP_UV " + t.specularIntensityMapUv : "", t.transmissionMapUv ? "#define TRANSMISSIONMAP_UV " + t.transmissionMapUv : "", t.thicknessMapUv ? "#define THICKNESSMAP_UV " + t.thicknessMapUv : "", t.vertexTangents && t.flatShading === false ? "#define USE_TANGENT" : "", t.vertexNormals ? "#define HAS_NORMAL" : "", t.vertexColors ? "#define USE_COLOR" : "", t.vertexAlphas ? "#define USE_COLOR_ALPHA" : "", t.vertexUv1s ? "#define USE_UV1" : "", t.vertexUv2s ? "#define USE_UV2" : "", t.vertexUv3s ? "#define USE_UV3" : "", t.pointsUvs ? "#define USE_POINTS_UV" : "", t.flatShading ? "#define FLAT_SHADED" : "", t.skinning ? "#define USE_SKINNING" : "", t.morphTargets ? "#define USE_MORPHTARGETS" : "", t.morphNormals && t.flatShading === false ? "#define USE_MORPHNORMALS" : "", t.morphColors ? "#define USE_MORPHCOLORS" : "", t.morphTargetsCount > 0 ? "#define MORPHTARGETS_TEXTURE_STRIDE " + t.morphTextureStride : "", t.morphTargetsCount > 0 ? "#define MORPHTARGETS_COUNT " + t.morphTargetsCount : "", t.doubleSided ? "#define DOUBLE_SIDED" : "", t.flipSided ? "#define FLIP_SIDED" : "", t.shadowMapEnabled ? "#define USE_SHADOWMAP" : "", t.shadowMapEnabled ? "#define " + R : "", t.sizeAttenuation ? "#define USE_SIZEATTENUATION" : "", t.numLightProbes > 0 ? "#define USE_LIGHT_PROBES" : "", t.logarithmicDepthBuffer ? "#define USE_LOGARITHMIC_DEPTH_BUFFER" : "", t.reversedDepthBuffer ? "#define USE_REVERSED_DEPTH_BUFFER" : "", "uniform mat4 modelMatrix;", "uniform mat4 modelViewMatrix;", "uniform mat4 projectionMatrix;", "uniform mat4 viewMatrix;", "uniform mat3 normalMatrix;", "uniform vec3 cameraPosition;", "uniform bool isOrthographic;", "#ifdef USE_INSTANCING", "	attribute mat4 instanceMatrix;", "#endif", "#ifdef USE_INSTANCING_COLOR", "	attribute vec3 instanceColor;", "#endif", "#ifdef USE_INSTANCING_MORPH", "	uniform sampler2D morphTexture;", "#endif", "attribute vec3 position;", "attribute vec3 normal;", "attribute vec2 uv;", "#ifdef USE_UV1", "	attribute vec2 uv1;", "#endif", "#ifdef USE_UV2", "	attribute vec2 uv2;", "#endif", "#ifdef USE_UV3", "	attribute vec2 uv3;", "#endif", "#ifdef USE_TANGENT", "	attribute vec4 tangent;", "#endif", "#if defined( USE_COLOR_ALPHA )", "	attribute vec4 color;", "#elif defined( USE_COLOR )", "	attribute vec3 color;", "#endif", "#ifdef USE_SKINNING", "	attribute vec4 skinIndex;", "	attribute vec4 skinWeight;", "#endif", `
`].filter(_n2).join(`
`), s = [no2(t), "#define SHADER_TYPE " + t.shaderType, "#define SHADER_NAME " + t.shaderName, N, t.useFog && t.fog ? "#define USE_FOG" : "", t.useFog && t.fogExp2 ? "#define FOG_EXP2" : "", t.alphaToCoverage ? "#define ALPHA_TO_COVERAGE" : "", t.map ? "#define USE_MAP" : "", t.matcap ? "#define USE_MATCAP" : "", t.envMap ? "#define USE_ENVMAP" : "", t.envMap ? "#define " + T : "", t.envMap ? "#define " + H2 : "", t.envMap ? "#define " + I2 : "", p ? "#define CUBEUV_TEXEL_WIDTH " + p.texelWidth : "", p ? "#define CUBEUV_TEXEL_HEIGHT " + p.texelHeight : "", p ? "#define CUBEUV_MAX_MIP " + p.maxMip + ".0" : "", t.lightMap ? "#define USE_LIGHTMAP" : "", t.aoMap ? "#define USE_AOMAP" : "", t.bumpMap ? "#define USE_BUMPMAP" : "", t.normalMap ? "#define USE_NORMALMAP" : "", t.normalMapObjectSpace ? "#define USE_NORMALMAP_OBJECTSPACE" : "", t.normalMapTangentSpace ? "#define USE_NORMALMAP_TANGENTSPACE" : "", t.packedNormalMap ? "#define USE_PACKED_NORMALMAP" : "", t.emissiveMap ? "#define USE_EMISSIVEMAP" : "", t.anisotropy ? "#define USE_ANISOTROPY" : "", t.anisotropyMap ? "#define USE_ANISOTROPYMAP" : "", t.clearcoat ? "#define USE_CLEARCOAT" : "", t.clearcoatMap ? "#define USE_CLEARCOATMAP" : "", t.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "", t.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "", t.dispersion ? "#define USE_DISPERSION" : "", t.retroreflection ? "#define USE_RETROREFLECTION" : "", t.iridescence ? "#define USE_IRIDESCENCE" : "", t.iridescenceMap ? "#define USE_IRIDESCENCEMAP" : "", t.iridescenceThicknessMap ? "#define USE_IRIDESCENCE_THICKNESSMAP" : "", t.specularMap ? "#define USE_SPECULARMAP" : "", t.specularColorMap ? "#define USE_SPECULAR_COLORMAP" : "", t.specularIntensityMap ? "#define USE_SPECULAR_INTENSITYMAP" : "", t.roughnessMap ? "#define USE_ROUGHNESSMAP" : "", t.metalnessMap ? "#define USE_METALNESSMAP" : "", t.alphaMap ? "#define USE_ALPHAMAP" : "", t.alphaTest ? "#define USE_ALPHATEST" : "", t.alphaHash ? "#define USE_ALPHAHASH" : "", t.sheen ? "#define USE_SHEEN" : "", t.sheenColorMap ? "#define USE_SHEEN_COLORMAP" : "", t.sheenRoughnessMap ? "#define USE_SHEEN_ROUGHNESSMAP" : "", t.transmission ? "#define USE_TRANSMISSION" : "", t.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "", t.thicknessMap ? "#define USE_THICKNESSMAP" : "", t.vertexTangents && t.flatShading === false ? "#define USE_TANGENT" : "", t.vertexColors || t.instancingColor ? "#define USE_COLOR" : "", t.vertexAlphas || t.batchingColor ? "#define USE_COLOR_ALPHA" : "", t.vertexUv1s ? "#define USE_UV1" : "", t.vertexUv2s ? "#define USE_UV2" : "", t.vertexUv3s ? "#define USE_UV3" : "", t.pointsUvs ? "#define USE_POINTS_UV" : "", t.gradientMap ? "#define USE_GRADIENTMAP" : "", t.flatShading ? "#define FLAT_SHADED" : "", t.doubleSided ? "#define DOUBLE_SIDED" : "", t.flipSided ? "#define FLIP_SIDED" : "", t.shadowMapEnabled ? "#define USE_SHADOWMAP" : "", t.shadowMapEnabled ? "#define " + R : "", t.premultipliedAlpha ? "#define PREMULTIPLIED_ALPHA" : "", t.numLightProbes > 0 ? "#define USE_LIGHT_PROBES" : "", t.numLightProbeGrids > 0 ? "#define USE_LIGHT_PROBES_GRID" : "", t.decodeVideoTexture ? "#define DECODE_VIDEO_TEXTURE" : "", t.decodeVideoTextureEmissive ? "#define DECODE_VIDEO_TEXTURE_EMISSIVE" : "", t.logarithmicDepthBuffer ? "#define USE_LOGARITHMIC_DEPTH_BUFFER" : "", t.reversedDepthBuffer ? "#define USE_REVERSED_DEPTH_BUFFER" : "", "uniform mat4 viewMatrix;", "uniform vec3 cameraPosition;", "uniform bool isOrthographic;", t.toneMapping !== su ? "#define TONE_MAPPING" : "", t.toneMapping !== su ? Pe.tonemapping_pars_fragment : "", t.toneMapping !== su ? Mf2("toneMapping", t.toneMapping) : "", t.dithering ? "#define DITHERING" : "", t.opaque ? "#define OPAQUE" : "", Pe.colorspace_pars_fragment, Sf("linearToOutputTexel", t.outputColorSpace), xf2(), t.useDepthPacking ? "#define DEPTH_PACKING " + t.depthPacking : "", `
`].filter(_n2).join(`
`)), d = rr2(d), d = ja2(d, t), d = eo2(d, t), g = rr2(g), g = ja2(g, t), g = eo2(g, t), d = to2(d), g = to2(g), t.isRawShaderMaterial !== true && (L = `#version 300 es
`, f = [x, "#define attribute in", "#define varying out", "#define texture2D texture"].join(`
`) + `
` + f, s = ["#define varying in", t.glslVersion === nd ? "" : "layout(location = 0) out highp vec4 pc_fragColor;", t.glslVersion === nd ? "" : "#define gl_FragColor pc_fragColor", "#define gl_FragDepthEXT gl_FragDepth", "#define texture2D texture", "#define textureCube texture", "#define texture2DProj textureProj", "#define texture2DLodEXT textureLod", "#define texture2DProjLodEXT textureProjLod", "#define textureCubeLodEXT textureLod", "#define texture2DGradEXT textureGrad", "#define texture2DProjGradEXT textureProjGrad", "#define textureCubeGradEXT textureGrad"].join(`
`) + `
` + s);
  const z = L + f + d, h = L + s + g, S = $a2(l, l.VERTEX_SHADER, z), m = $a2(l, l.FRAGMENT_SHADER, h);
  l.attachShader(W2, S), l.attachShader(W2, m), t.index0AttributeName !== void 0 ? l.bindAttribLocation(W2, 0, t.index0AttributeName) : t.hasPositionAttribute === true && l.bindAttribLocation(W2, 0, "position"), l.linkProgram(W2);
  function D2(F) {
    if (e.debug.checkShaderErrors) {
      const G2 = l.getProgramInfoLog(W2) || "", q = l.getShaderInfoLog(S) || "", P2 = l.getShaderInfoLog(m) || "", K = G2.trim(), Q = q.trim(), Y2 = P2.trim();
      let ne2 = true, Z2 = true;
      if (l.getProgramParameter(W2, l.LINK_STATUS) === false) if (ne2 = false, typeof e.debug.onShaderError == "function") e.debug.onShaderError(l, W2, S, m);
      else {
        const j = Ja2(l, S, "vertex"), ee2 = Ja2(l, m, "fragment");
        X("WebGLProgram: Shader Error " + l.getError() + " - VALIDATE_STATUS " + l.getProgramParameter(W2, l.VALIDATE_STATUS) + `

Material Name: ` + F.name + `
Material Type: ` + F.type + `

Program Info Log: ` + K + `
` + j + `
` + ee2);
      }
      else K !== "" ? V("WebGLProgram: Program Info Log:", K) : (Q === "" || Y2 === "") && (Z2 = false);
      Z2 && (F.diagnostics = { runnable: ne2, programLog: K, vertexShader: { log: Q, prefix: f }, fragmentShader: { log: Y2, prefix: s } });
    }
    l.deleteShader(S), l.deleteShader(m), c = new Bn(l, W2), _ = Rf2(l, W2);
  }
  let c;
  this.getUniforms = function() {
    return c === void 0 && D2(this), c;
  };
  let _;
  this.getAttributes = function() {
    return _ === void 0 && D2(this), _;
  };
  let w2 = t.rendererExtensionParallelShaderCompile === false;
  return this.isReady = function() {
    return w2 === false && (w2 = l.getProgramParameter(W2, mf)), w2;
  }, this.destroy = function() {
    i.releaseStatesOfProgram(this), l.deleteProgram(W2), this.program = void 0;
  }, this.type = t.shaderType, this.name = t.shaderName, this.id = _f2++, this.cacheKey = n, this.usedTimes = 1, this.program = W2, this.vertexShader = S, this.fragmentShader = m, this;
}
var Vf2 = 0;
var Wf2 = class {
  constructor() {
    this.shaderCache = /* @__PURE__ */ new Map(), this.materialCache = /* @__PURE__ */ new Map();
  }
  update(n, t, i) {
    const l = this._getShaderCacheForMaterial(n);
    return l.has(t) === false && (l.add(t), t.usedTimes++), l.has(i) === false && (l.add(i), i.usedTimes++), this;
  }
  remove(n) {
    const t = this.materialCache.get(n);
    for (const i of t) i.usedTimes--, i.usedTimes === 0 && this.shaderCache.delete(i.code);
    return this.materialCache.delete(n), this;
  }
  getVertexShaderStage(n) {
    return this._getShaderStage(n.vertexShader);
  }
  getFragmentShaderStage(n) {
    return this._getShaderStage(n.fragmentShader);
  }
  dispose() {
    this.shaderCache.clear(), this.materialCache.clear();
  }
  _getShaderCacheForMaterial(n) {
    const t = this.materialCache;
    let i = t.get(n);
    return i === void 0 && (i = /* @__PURE__ */ new Set(), t.set(n, i)), i;
  }
  _getShaderStage(n) {
    const t = this.shaderCache;
    let i = t.get(n);
    return i === void 0 && (i = new kf2(n), t.set(n, i)), i;
  }
};
var kf2 = class {
  constructor(n) {
    this.id = Vf2++, this.code = n, this.usedTimes = 0;
  }
};
function zf2(e) {
  return e === ao || e === vo || e === Ho;
}
function Xf2(e, n, t, i, l, o) {
  const d = new _r(), g = new Wf2(), R = /* @__PURE__ */ new Set(), T = [], H2 = /* @__PURE__ */ new Map(), I2 = i.logarithmicDepthBuffer;
  let p = i.precision;
  const x = { MeshDepthMaterial: "depth", MeshDistanceMaterial: "distance", MeshNormalMaterial: "normal", MeshBasicMaterial: "basic", MeshLambertMaterial: "lambert", MeshPhongMaterial: "phong", MeshToonMaterial: "toon", MeshStandardMaterial: "physical", MeshPhysicalMaterial: "physical", MeshMatcapMaterial: "matcap", LineBasicMaterial: "basic", LineDashedMaterial: "dashed", PointsMaterial: "points", ShadowMaterial: "shadow", SpriteMaterial: "sprite" };
  function N(c) {
    return R.add(c), c === 0 ? "uv" : `uv${c}`;
  }
  function W2(c, _, w2, F, G2, q) {
    const P2 = F.fog, K = G2.geometry, Q = c.isMeshStandardMaterial || c.isMeshLambertMaterial || c.isMeshPhongMaterial ? F.environment : null, Y2 = c.isMeshStandardMaterial || c.isMeshLambertMaterial && !c.envMap || c.isMeshPhongMaterial && !c.envMap, ne2 = n.get(c.envMap || Q, Y2), Z2 = ne2 && ne2.mapping === Ha ? ne2.image.height : null, j = x[c.type];
    c.precision !== null && (p = i.getMaxPrecision(c.precision), p !== c.precision && V("WebGLProgram.getParameters:", c.precision, "not supported, using", p, "instead."));
    const ee2 = K.morphAttributes.position || K.morphAttributes.normal || K.morphAttributes.color, be = ee2 !== void 0 ? ee2.length : 0;
    let Re2 = 0;
    K.morphAttributes.position !== void 0 && (Re2 = 1), K.morphAttributes.normal !== void 0 && (Re2 = 2), K.morphAttributes.color !== void 0 && (Re2 = 3);
    let it, ke2, ze2, V2;
    if (j) {
      const Ze2 = Rt[j];
      it = Ze2.vertexShader, ke2 = Ze2.fragmentShader;
    } else {
      it = c.vertexShader, ke2 = c.fragmentShader;
      const Ze2 = g.getVertexShaderStage(c), Ge2 = g.getFragmentShaderStage(c);
      g.update(c, Ze2, Ge2), ze2 = Ze2.id, V2 = Ge2.id;
    }
    const $ = e.getRenderTarget(), Ee2 = e.state.buffers.depth.getReversed(), Ue2 = G2.isInstancedMesh === true, me2 = G2.isBatchedMesh === true, Fe2 = !!c.map, st2 = !!c.matcap, De2 = !!ne2, Be2 = !!c.aoMap, qe2 = !!c.lightMap, Ie2 = !!c.bumpMap && c.wireframe === false, et = !!c.normalMap, ft2 = !!c.displacementMap, _t2 = !!c.emissiveMap, nt = !!c.metalnessMap, at2 = !!c.roughnessMap, M = c.anisotropy > 0, dt2 = c.clearcoat > 0, We2 = c.dispersion > 0, u = c.retroreflectivity > 0, r = c.iridescence > 0, A = c.sheen > 0, U2 = c.transmission > 0, O = M && !!c.anisotropyMap, te2 = dt2 && !!c.clearcoatMap, ie = dt2 && !!c.clearcoatNormalMap, B = dt2 && !!c.clearcoatRoughnessMap, X2 = r && !!c.iridescenceMap, re2 = r && !!c.iridescenceThicknessMap, Me = A && !!c.sheenColorMap, ce2 = A && !!c.sheenRoughnessMap, ae2 = !!c.specularMap, xe2 = !!c.specularColorMap, Ae2 = !!c.specularIntensityMap, Ce2 = U2 && !!c.transmissionMap, E = U2 && !!c.thicknessMap, oe = !!c.gradientMap, k = !!c.alphaMap, se2 = c.alphaTest > 0, ue2 = !!c.alphaHash, J = !!c.extensions;
    let Te2 = su;
    c.toneMapped && ($ === null || $.isXRRenderTarget === true) && (Te2 = e.toneMapping);
    const ve2 = { shaderID: j, shaderType: c.type, shaderName: c.name, vertexShader: it, fragmentShader: ke2, defines: c.defines, customVertexShaderID: ze2, customFragmentShaderID: V2, isRawShaderMaterial: c.isRawShaderMaterial === true, glslVersion: c.glslVersion, precision: p, batching: me2, batchingColor: me2 && G2._colorsTexture !== null, instancing: Ue2, instancingColor: Ue2 && G2.instanceColor !== null, instancingMorph: Ue2 && G2.morphTexture !== null, outputColorSpace: $ === null ? e.outputColorSpace : $.isXRRenderTarget === true ? $.texture.colorSpace : It.workingColorSpace, alphaToCoverage: !!c.alphaToCoverage, map: Fe2, matcap: st2, envMap: De2, envMapMode: De2 && ne2.mapping, envMapCubeUVHeight: Z2, aoMap: Be2, lightMap: qe2, bumpMap: Ie2, normalMap: et, displacementMap: ft2, emissiveMap: _t2, normalMapObjectSpace: et && c.normalMapType === vu, normalMapTangentSpace: et && c.normalMapType === Ne, packedNormalMap: et && c.normalMapType === Ne && zf2(c.normalMap.format), metalnessMap: nt, roughnessMap: at2, anisotropy: M, anisotropyMap: O, clearcoat: dt2, clearcoatMap: te2, clearcoatNormalMap: ie, clearcoatRoughnessMap: B, dispersion: We2, retroreflection: u, iridescence: r, iridescenceMap: X2, iridescenceThicknessMap: re2, sheen: A, sheenColorMap: Me, sheenRoughnessMap: ce2, specularMap: ae2, specularColorMap: xe2, specularIntensityMap: Ae2, transmission: U2, transmissionMap: Ce2, thicknessMap: E, gradientMap: oe, opaque: c.transparent === false && c.blending === Ea && c.alphaToCoverage === false, alphaMap: k, alphaTest: se2, alphaHash: ue2, combine: c.combine, mapUv: Fe2 && N(c.map.channel), aoMapUv: Be2 && N(c.aoMap.channel), lightMapUv: qe2 && N(c.lightMap.channel), bumpMapUv: Ie2 && N(c.bumpMap.channel), normalMapUv: et && N(c.normalMap.channel), displacementMapUv: ft2 && N(c.displacementMap.channel), emissiveMapUv: _t2 && N(c.emissiveMap.channel), metalnessMapUv: nt && N(c.metalnessMap.channel), roughnessMapUv: at2 && N(c.roughnessMap.channel), anisotropyMapUv: O && N(c.anisotropyMap.channel), clearcoatMapUv: te2 && N(c.clearcoatMap.channel), clearcoatNormalMapUv: ie && N(c.clearcoatNormalMap.channel), clearcoatRoughnessMapUv: B && N(c.clearcoatRoughnessMap.channel), iridescenceMapUv: X2 && N(c.iridescenceMap.channel), iridescenceThicknessMapUv: re2 && N(c.iridescenceThicknessMap.channel), sheenColorMapUv: Me && N(c.sheenColorMap.channel), sheenRoughnessMapUv: ce2 && N(c.sheenRoughnessMap.channel), specularMapUv: ae2 && N(c.specularMap.channel), specularColorMapUv: xe2 && N(c.specularColorMap.channel), specularIntensityMapUv: Ae2 && N(c.specularIntensityMap.channel), transmissionMapUv: Ce2 && N(c.transmissionMap.channel), thicknessMapUv: E && N(c.thicknessMap.channel), alphaMapUv: k && N(c.alphaMap.channel), vertexTangents: !!K.attributes.tangent && (et || M), vertexNormals: !!K.attributes.normal, vertexColors: c.vertexColors, vertexAlphas: c.vertexColors === true && !!K.attributes.color && K.attributes.color.itemSize === 4, pointsUvs: G2.isPoints === true && !!K.attributes.uv && (Fe2 || k), fog: !!P2, useFog: c.fog === true, fogExp2: !!P2 && P2.isFogExp2, flatShading: c.wireframe === false && (c.flatShading === true || K.attributes.normal === void 0 && et === false && (c.isMeshLambertMaterial || c.isMeshPhongMaterial || c.isMeshStandardMaterial || c.isMeshPhysicalMaterial)), sizeAttenuation: c.sizeAttenuation === true, logarithmicDepthBuffer: I2, reversedDepthBuffer: Ee2, skinning: G2.isSkinnedMesh === true, hasPositionAttribute: K.attributes.position !== void 0, morphTargets: K.morphAttributes.position !== void 0, morphNormals: K.morphAttributes.normal !== void 0, morphColors: K.morphAttributes.color !== void 0, morphTargetsCount: be, morphTextureStride: Re2, numSunLights: _.sun.length, numDirLights: _.directional.length, numPointLights: _.point.length, numSpotLights: _.spot.length, numSpotLightMaps: _.spotLightMap.length, numRectAreaLights: _.rectArea.length, numHemiLights: _.hemi.length, numSunLightShadows: _.sunShadowMap.length, numDirLightShadows: _.directionalShadowMap.length, numPointLightShadows: _.pointShadowMap.length, numSpotLightShadows: _.spotShadowMap.length, numSpotLightShadowsWithMaps: _.numSpotLightShadowsWithMaps, numLightProbes: _.numLightProbes, numLightProbeGrids: q.length, numClippingPlanes: o.numPlanes, numClipIntersection: o.numIntersection, dithering: c.dithering, shadowMapEnabled: e.shadowMap.enabled && w2.length > 0, shadowMapType: e.shadowMap.type, toneMapping: Te2, decodeVideoTexture: Fe2 && c.map.isVideoTexture === true && It.getTransfer(c.map.colorSpace) === Cs, decodeVideoTextureEmissive: _t2 && c.emissiveMap.isVideoTexture === true && It.getTransfer(c.emissiveMap.colorSpace) === Cs, premultipliedAlpha: c.premultipliedAlpha, doubleSided: c.side === Fc, flipSided: c.side === Oa, useDepthPacking: c.depthPacking >= 0, depthPacking: c.depthPacking || 0, index0AttributeName: c.index0AttributeName, extensionClipCullDistance: J && c.extensions.clipCullDistance === true && t.has("WEBGL_clip_cull_distance"), extensionMultiDraw: (J && c.extensions.multiDraw === true || me2) && t.has("WEBGL_multi_draw"), rendererExtensionParallelShaderCompile: t.has("KHR_parallel_shader_compile"), customProgramCacheKey: c.customProgramCacheKey() };
    return ve2.vertexUv1s = R.has(1), ve2.vertexUv2s = R.has(2), ve2.vertexUv3s = R.has(3), R.clear(), ve2;
  }
  function f(c) {
    const _ = [];
    if (c.shaderID ? _.push(c.shaderID) : (_.push(c.customVertexShaderID), _.push(c.customFragmentShaderID)), c.defines !== void 0) for (const w2 in c.defines) _.push(w2), _.push(c.defines[w2]);
    return c.isRawShaderMaterial === false && (s(_, c), L(_, c), _.push(e.outputColorSpace)), _.push(c.customProgramCacheKey), _.join();
  }
  function s(c, _) {
    c.push(_.precision), c.push(_.outputColorSpace), c.push(_.envMapMode), c.push(_.envMapCubeUVHeight), c.push(_.mapUv), c.push(_.alphaMapUv), c.push(_.lightMapUv), c.push(_.aoMapUv), c.push(_.bumpMapUv), c.push(_.normalMapUv), c.push(_.displacementMapUv), c.push(_.emissiveMapUv), c.push(_.metalnessMapUv), c.push(_.roughnessMapUv), c.push(_.anisotropyMapUv), c.push(_.clearcoatMapUv), c.push(_.clearcoatNormalMapUv), c.push(_.clearcoatRoughnessMapUv), c.push(_.iridescenceMapUv), c.push(_.iridescenceThicknessMapUv), c.push(_.sheenColorMapUv), c.push(_.sheenRoughnessMapUv), c.push(_.specularMapUv), c.push(_.specularColorMapUv), c.push(_.specularIntensityMapUv), c.push(_.transmissionMapUv), c.push(_.thicknessMapUv), c.push(_.combine), c.push(_.fogExp2), c.push(_.sizeAttenuation), c.push(_.morphTargetsCount), c.push(_.morphAttributeCount), c.push(_.numSunLights), c.push(_.numDirLights), c.push(_.numPointLights), c.push(_.numSpotLights), c.push(_.numSpotLightMaps), c.push(_.numHemiLights), c.push(_.numRectAreaLights), c.push(_.numSunLightShadows), c.push(_.numDirLightShadows), c.push(_.numPointLightShadows), c.push(_.numSpotLightShadows), c.push(_.numSpotLightShadowsWithMaps), c.push(_.numLightProbes), c.push(_.shadowMapType), c.push(_.toneMapping), c.push(_.numClippingPlanes), c.push(_.numClipIntersection), c.push(_.depthPacking);
  }
  function L(c, _) {
    d.disableAll(), _.instancing && d.enable(0), _.instancingColor && d.enable(1), _.instancingMorph && d.enable(2), _.matcap && d.enable(3), _.envMap && d.enable(4), _.normalMapObjectSpace && d.enable(5), _.normalMapTangentSpace && d.enable(6), _.clearcoat && d.enable(7), _.iridescence && d.enable(8), _.alphaTest && d.enable(9), _.vertexColors && d.enable(10), _.vertexAlphas && d.enable(11), _.vertexUv1s && d.enable(12), _.vertexUv2s && d.enable(13), _.vertexUv3s && d.enable(14), _.vertexTangents && d.enable(15), _.anisotropy && d.enable(16), _.alphaHash && d.enable(17), _.batching && d.enable(18), _.dispersion && d.enable(19), _.retroreflection && d.enable(24), _.batchingColor && d.enable(20), _.gradientMap && d.enable(21), _.packedNormalMap && d.enable(22), _.vertexNormals && d.enable(23), c.push(d.mask), d.disableAll(), _.fog && d.enable(0), _.useFog && d.enable(1), _.flatShading && d.enable(2), _.logarithmicDepthBuffer && d.enable(3), _.reversedDepthBuffer && d.enable(4), _.skinning && d.enable(5), _.morphTargets && d.enable(6), _.morphNormals && d.enable(7), _.morphColors && d.enable(8), _.premultipliedAlpha && d.enable(9), _.shadowMapEnabled && d.enable(10), _.doubleSided && d.enable(11), _.flipSided && d.enable(12), _.useDepthPacking && d.enable(13), _.dithering && d.enable(14), _.transmission && d.enable(15), _.sheen && d.enable(16), _.opaque && d.enable(17), _.pointsUvs && d.enable(18), _.decodeVideoTexture && d.enable(19), _.decodeVideoTextureEmissive && d.enable(20), _.alphaToCoverage && d.enable(21), _.numLightProbeGrids > 0 && d.enable(22), _.hasPositionAttribute && d.enable(23), c.push(d.mask);
  }
  function z(c) {
    const _ = x[c.type];
    let w2;
    if (_) {
      const F = Rt[_];
      w2 = of.clone(F.uniforms);
    } else w2 = c.uniforms;
    return w2;
  }
  function h(c, _) {
    let w2 = H2.get(_);
    return w2 !== void 0 ? ++w2.usedTimes : (w2 = new Hf2(e, _, c, l), T.push(w2), H2.set(_, w2)), w2;
  }
  function S(c) {
    if (--c.usedTimes === 0) {
      const _ = T.indexOf(c);
      T[_] = T[T.length - 1], T.pop(), H2.delete(c.cacheKey), c.destroy();
    }
  }
  function m(c) {
    g.remove(c);
  }
  function D2() {
    g.dispose();
  }
  return { getParameters: W2, getProgramCacheKey: f, getUniforms: z, acquireProgram: h, releaseProgram: S, releaseShaderCache: m, programs: T, dispose: D2 };
}
function Kf2() {
  let e = /* @__PURE__ */ new WeakMap();
  function n(d) {
    return e.has(d);
  }
  function t(d) {
    let g = e.get(d);
    return g === void 0 && (g = {}, e.set(d, g)), g;
  }
  function i(d) {
    e.delete(d);
  }
  function l(d, g, R) {
    e.get(d)[g] = R;
  }
  function o() {
    e = /* @__PURE__ */ new WeakMap();
  }
  return { has: n, get: t, remove: i, update: l, dispose: o };
}
function Yf2(e, n) {
  return e.groupOrder !== n.groupOrder ? e.groupOrder - n.groupOrder : e.renderOrder !== n.renderOrder ? e.renderOrder - n.renderOrder : e.material.id !== n.material.id ? e.material.id - n.material.id : e.materialVariant !== n.materialVariant ? e.materialVariant - n.materialVariant : e.z !== n.z ? e.z - n.z : e.id - n.id;
}
function io2(e, n) {
  return e.groupOrder !== n.groupOrder ? e.groupOrder - n.groupOrder : e.renderOrder !== n.renderOrder ? e.renderOrder - n.renderOrder : e.z !== n.z ? n.z - e.z : e.id - n.id;
}
function ro2() {
  const e = [];
  let n = 0;
  const t = [], i = [], l = [];
  function o() {
    n = 0, t.length = 0, i.length = 0, l.length = 0;
  }
  function d(p) {
    let x = 0;
    return p.isInstancedMesh && (x += 2), p.isSkinnedMesh && (x += 1), x;
  }
  function g(p, x, N, W2, f, s) {
    let L = e[n];
    return L === void 0 ? (L = { id: p.id, object: p, geometry: x, material: N, materialVariant: d(p), groupOrder: W2, renderOrder: p.renderOrder, z: f, group: s }, e[n] = L) : (L.id = p.id, L.object = p, L.geometry = x, L.material = N, L.materialVariant = d(p), L.groupOrder = W2, L.renderOrder = p.renderOrder, L.z = f, L.group = s), n++, L;
  }
  function R(p, x, N, W2, f, s, L) {
    L.reversedDepth === true && (f = -f);
    const z = g(p, x, N, W2, f, s);
    N.transmission > 0 ? i.push(z) : N.transparent === true ? l.push(z) : t.push(z);
  }
  function T(p, x, N, W2, f, s) {
    const L = g(p, x, N, W2, f, s);
    N.transmission > 0 ? i.unshift(L) : N.transparent === true ? l.unshift(L) : t.unshift(L);
  }
  function H2(p, x) {
    t.length > 1 && t.sort(p || Yf2), i.length > 1 && i.sort(x || io2), l.length > 1 && l.sort(x || io2);
  }
  function I2() {
    for (let p = n, x = e.length; p < x; p++) {
      const N = e[p];
      if (N.id === null) break;
      N.id = null, N.object = null, N.geometry = null, N.material = null, N.group = null;
    }
  }
  return { opaque: t, transmissive: i, transparent: l, init: o, push: R, unshift: T, finish: I2, sort: H2 };
}
function qf2() {
  let e = /* @__PURE__ */ new WeakMap();
  function n(i, l) {
    const o = e.get(i);
    let d;
    return o === void 0 ? (d = new ro2(), e.set(i, [d])) : l >= o.length ? (d = new ro2(), o.push(d)) : d = o[l], d;
  }
  function t() {
    e = /* @__PURE__ */ new WeakMap();
  }
  return { get: n, dispose: t };
}
function Zf2() {
  const e = {};
  return { get: function(n) {
    if (e[n.id] !== void 0) return e[n.id];
    let t;
    switch (n.type) {
      case "SunLight":
      case "DirectionalLight":
        t = { direction: new w(), color: new U() };
        break;
      case "SpotLight":
        t = { position: new w(), direction: new w(), color: new U(), distance: 0, coneCos: 0, penumbraCos: 0, decay: 0 };
        break;
      case "PointLight":
        t = { position: new w(), color: new U(), distance: 0, decay: 0 };
        break;
      case "HemisphereLight":
        t = { direction: new w(), skyColor: new U(), groundColor: new U() };
        break;
      case "RectAreaLight":
        t = { color: new U(), position: new w(), halfWidth: new w(), halfHeight: new w() };
        break;
    }
    return e[n.id] = t, t;
  } };
}
function $f2() {
  const e = {};
  return { get: function(n) {
    if (e[n.id] !== void 0) return e[n.id];
    let t;
    switch (n.type) {
      case "SunLight":
      case "DirectionalLight":
        t = { shadowIntensity: 1, shadowBias: 0, shadowNormalBias: 0, shadowRadius: 1, shadowMapSize: new I() };
        break;
      case "SpotLight":
        t = { shadowIntensity: 1, shadowBias: 0, shadowNormalBias: 0, shadowRadius: 1, shadowMapSize: new I() };
        break;
      case "PointLight":
        t = { shadowIntensity: 1, shadowBias: 0, shadowNormalBias: 0, shadowRadius: 1, shadowMapSize: new I(), shadowCameraNear: 1, shadowCameraFar: 1e3 };
        break;
    }
    return e[n.id] = t, t;
  } };
}
var Qf2 = 0;
function Jf2(e, n) {
  return (n.castShadow ? 2 : 0) - (e.castShadow ? 2 : 0) + (n.map ? 1 : 0) - (e.map ? 1 : 0);
}
function jf(e) {
  const n = new Zf2(), t = $f2(), i = { version: 0, hash: { sunLength: -1, directionalLength: -1, pointLength: -1, spotLength: -1, rectAreaLength: -1, hemiLength: -1, numSunShadows: -1, numDirectionalShadows: -1, numPointShadows: -1, numSpotShadows: -1, numSpotMaps: -1, numLightProbes: -1 }, ambient: [0, 0, 0], probe: [], sun: [], sunShadow: [], sunShadowMap: [], sunShadowMatrix: [], sunShadowCascade: [], directional: [], directionalShadow: [], directionalShadowMap: [], directionalShadowMatrix: [], spot: [], spotLightMap: [], spotShadow: [], spotShadowMap: [], spotLightMatrix: [], rectArea: [], rectAreaLTC1: null, rectAreaLTC2: null, point: [], pointShadow: [], pointShadowMap: [], pointShadowMatrix: [], hemi: [], numSpotLightShadowsWithMaps: 0, numLightProbes: 0 };
  for (let T = 0; T < 9; T++) i.probe.push(new w());
  const l = new w(), o = new G(), d = new G();
  function g(T) {
    let H2 = 0, I2 = 0, p = 0;
    for (let G2 = 0; G2 < 9; G2++) i.probe[G2].set(0, 0, 0);
    let x = 0, N = 0, W2 = 0, f = 0, s = 0, L = 0, z = 0, h = 0, S = 0, m = 0, D2 = 0, c = 0, _ = 0, w2 = 0;
    T.sort(Jf2);
    for (let G2 = 0, q = T.length; G2 < q; G2++) {
      const P2 = T[G2], K = P2.color, Q = P2.intensity, Y2 = P2.distance;
      let ne2 = null;
      if (P2.shadow && P2.shadow.map && (P2.shadow.map.texture.format === ao ? ne2 = P2.shadow.map.texture : ne2 = P2.shadow.map.depthTexture || P2.shadow.map.texture), P2.isAmbientLight) H2 += K.r * Q, I2 += K.g * Q, p += K.b * Q;
      else if (P2.isLightProbe) {
        for (let Z2 = 0; Z2 < 9; Z2++) i.probe[Z2].addScaledVector(P2.sh.coefficients[Z2], Q);
        w2++;
      } else if (P2.isSunLight) {
        const Z2 = n.get(P2);
        if (Z2.color.copy(P2.color).multiplyScalar(P2.intensity), P2.castShadow) {
          const j = P2.shadow, ee2 = t.get(P2);
          ee2.shadowIntensity = j.intensity, ee2.shadowBias = j.bias, ee2.shadowNormalBias = j.normalBias, ee2.shadowRadius = j.radius, ee2.shadowMapSize.copy(j.mapSize).multiply(j.getFrameExtents()), i.sunShadow[N] = ee2, i.sunShadowMap[N] = ne2;
          const be = j.getViewportCount();
          for (let Re2 = 0; Re2 < be; Re2++) i.sunShadowMatrix[W2 + Re2] = j.getMatrix(Re2), i.sunShadowCascade[W2 + Re2] = j._cascadeData[Re2];
          W2 += be, N++;
        }
        i.sun[x] = Z2, x++;
      } else if (P2.isDirectionalLight) {
        const Z2 = n.get(P2);
        if (Z2.color.copy(P2.color).multiplyScalar(P2.intensity), P2.castShadow) {
          const j = P2.shadow, ee2 = t.get(P2);
          ee2.shadowIntensity = j.intensity, ee2.shadowBias = j.bias, ee2.shadowNormalBias = j.normalBias, ee2.shadowRadius = j.radius, ee2.shadowMapSize = j.mapSize, i.directionalShadow[f] = ee2, i.directionalShadowMap[f] = ne2, i.directionalShadowMatrix[f] = P2.shadow.matrix, S++;
        }
        i.directional[f] = Z2, f++;
      } else if (P2.isSpotLight) {
        const Z2 = n.get(P2);
        Z2.position.setFromMatrixPosition(P2.matrixWorld), Z2.color.copy(K).multiplyScalar(Q), Z2.distance = Y2, Z2.coneCos = Math.cos(P2.angle), Z2.penumbraCos = Math.cos(P2.angle * (1 - P2.penumbra)), Z2.decay = P2.decay, i.spot[L] = Z2;
        const j = P2.shadow;
        if (P2.map && (i.spotLightMap[c] = P2.map, c++, j.updateMatrices(P2), P2.castShadow && _++), i.spotLightMatrix[L] = j.matrix, P2.castShadow) {
          const ee2 = t.get(P2);
          ee2.shadowIntensity = j.intensity, ee2.shadowBias = j.bias, ee2.shadowNormalBias = j.normalBias, ee2.shadowRadius = j.radius, ee2.shadowMapSize = j.mapSize, i.spotShadow[L] = ee2, i.spotShadowMap[L] = ne2, D2++;
        }
        L++;
      } else if (P2.isRectAreaLight) {
        const Z2 = n.get(P2);
        Z2.color.copy(K).multiplyScalar(Q), Z2.halfWidth.set(P2.width * 0.5, 0, 0), Z2.halfHeight.set(0, P2.height * 0.5, 0), i.rectArea[z] = Z2, z++;
      } else if (P2.isPointLight) {
        const Z2 = n.get(P2);
        if (Z2.color.copy(P2.color).multiplyScalar(P2.intensity), Z2.distance = P2.distance, Z2.decay = P2.decay, P2.castShadow) {
          const j = P2.shadow, ee2 = t.get(P2);
          ee2.shadowIntensity = j.intensity, ee2.shadowBias = j.bias, ee2.shadowNormalBias = j.normalBias, ee2.shadowRadius = j.radius, ee2.shadowMapSize = j.mapSize, ee2.shadowCameraNear = j.camera.near, ee2.shadowCameraFar = j.camera.far, i.pointShadow[s] = ee2, i.pointShadowMap[s] = ne2, i.pointShadowMatrix[s] = P2.shadow.matrix, m++;
        }
        i.point[s] = Z2, s++;
      } else if (P2.isHemisphereLight) {
        const Z2 = n.get(P2);
        Z2.skyColor.copy(P2.color).multiplyScalar(Q), Z2.groundColor.copy(P2.groundColor).multiplyScalar(Q), i.hemi[h] = Z2, h++;
      }
    }
    z > 0 && (e.has("OES_texture_float_linear") === true ? (i.rectAreaLTC1 = le2.LTC_FLOAT_1, i.rectAreaLTC2 = le2.LTC_FLOAT_2) : (i.rectAreaLTC1 = le2.LTC_HALF_1, i.rectAreaLTC2 = le2.LTC_HALF_2)), i.ambient[0] = H2, i.ambient[1] = I2, i.ambient[2] = p;
    const F = i.hash;
    (F.sunLength !== x || F.directionalLength !== f || F.pointLength !== s || F.spotLength !== L || F.rectAreaLength !== z || F.hemiLength !== h || F.numSunShadows !== N || F.numDirectionalShadows !== S || F.numPointShadows !== m || F.numSpotShadows !== D2 || F.numSpotMaps !== c || F.numLightProbes !== w2) && (i.sun.length = x, i.directional.length = f, i.spot.length = L, i.rectArea.length = z, i.point.length = s, i.hemi.length = h, i.sunShadow.length = N, i.sunShadowMap.length = N, i.sunShadowMatrix.length = W2, i.sunShadowCascade.length = W2, i.directionalShadow.length = S, i.directionalShadowMap.length = S, i.directionalShadowMatrix.length = S, i.pointShadow.length = m, i.pointShadowMap.length = m, i.pointShadowMatrix.length = m, i.spotShadow.length = D2, i.spotShadowMap.length = D2, i.spotLightMatrix.length = D2 + c - _, i.spotLightMap.length = c, i.numSpotLightShadowsWithMaps = _, i.numLightProbes = w2, F.sunLength = x, F.directionalLength = f, F.pointLength = s, F.spotLength = L, F.rectAreaLength = z, F.hemiLength = h, F.numSunShadows = N, F.numDirectionalShadows = S, F.numPointShadows = m, F.numSpotShadows = D2, F.numSpotMaps = c, F.numLightProbes = w2, i.version = Qf2++);
  }
  function R(T, H2) {
    let I2 = 0, p = 0, x = 0, N = 0, W2 = 0, f = 0;
    const s = H2.matrixWorldInverse;
    for (let L = 0, z = T.length; L < z; L++) {
      const h = T[L];
      if (h.isSunLight) {
        const S = i.sun[I2];
        S.direction.setFromMatrixPosition(h.matrixWorld), S.direction.transformDirection(s), I2++;
      } else if (h.isDirectionalLight) {
        const S = i.directional[p];
        S.direction.setFromMatrixPosition(h.matrixWorld), l.setFromMatrixPosition(h.target.matrixWorld), S.direction.sub(l), S.direction.transformDirection(s), p++;
      } else if (h.isSpotLight) {
        const S = i.spot[N];
        S.position.setFromMatrixPosition(h.matrixWorld), S.position.applyMatrix4(s), S.direction.setFromMatrixPosition(h.matrixWorld), l.setFromMatrixPosition(h.target.matrixWorld), S.direction.sub(l), S.direction.transformDirection(s), N++;
      } else if (h.isRectAreaLight) {
        const S = i.rectArea[W2];
        S.position.setFromMatrixPosition(h.matrixWorld), S.position.applyMatrix4(s), d.identity(), o.copy(h.matrixWorld), o.premultiply(s), d.extractRotation(o), S.halfWidth.set(h.width * 0.5, 0, 0), S.halfHeight.set(0, h.height * 0.5, 0), S.halfWidth.applyMatrix4(d), S.halfHeight.applyMatrix4(d), W2++;
      } else if (h.isPointLight) {
        const S = i.point[x];
        S.position.setFromMatrixPosition(h.matrixWorld), S.position.applyMatrix4(s), x++;
      } else if (h.isHemisphereLight) {
        const S = i.hemi[f];
        S.direction.setFromMatrixPosition(h.matrixWorld), S.direction.transformDirection(s), f++;
      }
    }
  }
  return { setup: g, setupView: R, state: i };
}
function ao2(e) {
  const n = new jf(e), t = [], i = [], l = [];
  function o(p) {
    I2.camera = p, t.length = 0, i.length = 0, l.length = 0;
  }
  function d(p) {
    t.push(p);
  }
  function g(p) {
    i.push(p);
  }
  function R(p) {
    l.push(p);
  }
  function T() {
    n.setup(t);
  }
  function H2(p) {
    n.setupView(t, p);
  }
  const I2 = { lightsArray: t, shadowsArray: i, lightProbeGridArray: l, camera: null, lights: n, transmissionRenderTarget: {}, textureUnits: 0 };
  return { init: o, state: I2, setupLights: T, setupLightsView: H2, pushLight: d, pushShadow: g, pushLightProbeGrid: R };
}
function ed2(e) {
  let n = /* @__PURE__ */ new WeakMap();
  function t(l, o = 0) {
    const d = n.get(l);
    let g;
    return d === void 0 ? (g = new ao2(e), n.set(l, [g])) : o >= d.length ? (g = new ao2(e), d.push(g)) : g = d[o], g;
  }
  function i() {
    n = /* @__PURE__ */ new WeakMap();
  }
  return { get: t, dispose: i };
}
var td2 = `void main() {
	gl_Position = vec4( position, 1.0 );
}`;
var nd2 = `uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`;
var id2 = [new w(1, 0, 0), new w(-1, 0, 0), new w(0, 1, 0), new w(0, -1, 0), new w(0, 0, 1), new w(0, 0, -1)];
var rd2 = [new w(0, -1, 0), new w(0, -1, 0), new w(0, 0, 1), new w(0, 0, -1), new w(0, -1, 0), new w(0, -1, 0)];
var oo2 = new G();
var gn2 = new w();
var ar2 = new w();
function ad2(e, n, t) {
  let i = new $i();
  const l = new I(), o = new I(), d = new At(), g = new _l(), R = new vl(), T = {}, H2 = t.maxTextureSize, I2 = { [$n]: Oa, [Oa]: $n, [Fc]: Fc }, p = new oa({ defines: { VSM_SAMPLES: 8 }, uniforms: { shadow_pass: { value: null }, resolution: { value: new I() }, radius: { value: 4 } }, vertexShader: td2, fragmentShader: nd2 }), x = p.clone();
  x.defines.HORIZONTAL_PASS = 1;
  const N = new H();
  N.setAttribute("position", new st(new Float32Array([-1, -1, 0.5, 3, -1, 0.5, -1, 3, 0.5]), 3));
  const W2 = new Zt(N, p), f = this;
  this.enabled = false, this.autoUpdate = true, this.needsUpdate = false, this.type = Ic;
  let s = this.type;
  this.render = function(m, D2, c) {
    if (f.enabled === false || f.autoUpdate === false && f.needsUpdate === false || m.length === 0) return;
    this.type === zc && (V("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."), this.type = Ic);
    const _ = e.getRenderTarget(), w2 = e.getActiveCubeFace(), F = e.getActiveMipmapLevel(), G2 = e.state;
    G2.setBlending(kc), G2.buffers.depth.getReversed() === true ? G2.buffers.color.setClear(0, 0, 0, 0) : G2.buffers.color.setClear(1, 1, 1, 1), G2.buffers.depth.setTest(true), G2.setScissorTest(false);
    const q = s !== this.type;
    q && D2.traverse(function(P2) {
      P2.material && (Array.isArray(P2.material) ? P2.material.forEach((K) => K.needsUpdate = true) : P2.material.needsUpdate = true);
    });
    for (let P2 = 0, K = m.length; P2 < K; P2++) {
      const Q = m[P2], Y2 = Q.shadow;
      if (Y2 === void 0) {
        V("WebGLShadowMap:", Q, "has no shadow.");
        continue;
      }
      if (Y2.autoUpdate === false && Y2.needsUpdate === false) continue;
      l.copy(Y2.mapSize);
      const ne2 = Y2.getFrameExtents();
      l.multiply(ne2), o.copy(Y2.mapSize), (l.x > H2 || l.y > H2) && (l.x > H2 && (o.x = Math.floor(H2 / ne2.x), l.x = o.x * ne2.x, Y2.mapSize.x = o.x), l.y > H2 && (o.y = Math.floor(H2 / ne2.y), l.y = o.y * ne2.y, Y2.mapSize.y = o.y));
      const Z2 = e.state.buffers.depth.getReversed();
      if (Y2.camera._reversedDepth = Z2, Y2.map === null || q === true) {
        if (Y2.map !== null && (Y2.map.depthTexture !== null && (Y2.map.depthTexture.dispose(), Y2.map.depthTexture = null), Y2.map.dispose()), this.type === Bc) {
          if (Q.isPointLight) {
            V("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");
            continue;
          }
          Y2.map = new Mr(l.x, l.y, { format: ao, type: ja, minFilter: Ut, magFilter: Ut, generateMipmaps: false }), Y2.map.texture.name = Q.name + ".shadowMap", Y2.map.depthTexture = new Xh(l.x, l.y, Re), Y2.map.depthTexture.name = Q.name + ".shadowMapDepth", Y2.map.depthTexture.format = vs, Y2.map.depthTexture.compareFunction = null, Y2.map.depthTexture.minFilter = Ct, Y2.map.depthTexture.magFilter = Ct;
        } else Q.isPointLight ? (Y2.map = new tr2(l.x), Y2.map.depthTexture = new Ip(l.x, Ri)) : (Y2.map = new Mr(l.x, l.y), Y2.map.depthTexture = new Xh(l.x, l.y, Ri)), Y2.map.depthTexture.name = Q.name + ".shadowMap", Y2.map.depthTexture.format = vs, this.type === Ic ? (Y2.map.depthTexture.compareFunction = Z2 ? Xu : Hu, Y2.map.depthTexture.minFilter = Ut, Y2.map.depthTexture.magFilter = Ut) : (Y2.map.depthTexture.compareFunction = null, Y2.map.depthTexture.minFilter = Ct, Y2.map.depthTexture.magFilter = Ct);
        Y2.camera.updateProjectionMatrix();
      }
      Y2.map.isWebGLCubeRenderTarget !== true && (Y2.map.width !== l.x || Y2.map.height !== l.y) && Y2.map.setSize(l.x, l.y);
      const j = Y2.map.isWebGLCubeRenderTarget ? 6 : Y2.getViewportCount();
      Q.isPointLight !== true && Y2.updateMatrices(Q, c);
      for (let ee2 = 0; ee2 < j; ee2++) {
        const be = Y2.getCamera(ee2);
        if (Q.isPointLight) {
          const Re2 = Y2.camera, it = Y2.matrix, ke2 = Q.distance || Re2.far;
          ke2 !== Re2.far && (Re2.far = ke2, Re2.updateProjectionMatrix()), gn2.setFromMatrixPosition(Q.matrixWorld), Re2.position.copy(gn2), ar2.copy(Re2.position), ar2.add(id2[ee2]), Re2.up.copy(rd2[ee2]), Re2.lookAt(ar2), Re2.updateMatrixWorld(), it.makeTranslation(-gn2.x, -gn2.y, -gn2.z), oo2.multiplyMatrices(Re2.projectionMatrix, Re2.matrixWorldInverse), Y2._frustum.setFromProjectionMatrix(oo2, Re2.coordinateSystem, Re2.reversedDepth);
        }
        if (Y2.map.isWebGLCubeRenderTarget) e.setRenderTarget(Y2.map, ee2), e.clear();
        else {
          ee2 === 0 && (e.setRenderTarget(Y2.map), e.clear());
          const Re2 = Y2.getViewport(ee2);
          d.set(o.x * Re2.x, o.y * Re2.y, o.x * Re2.z, o.y * Re2.w), G2.viewport(d);
        }
        i = Y2.getFrustum(ee2), h(D2, c, be, Q, this.type);
      }
      Y2.isPointLightShadow !== true && this.type === Bc && L(Y2, c), Y2.needsUpdate = false;
    }
    s = this.type, f.needsUpdate = false, e.setRenderTarget(_, w2, F);
  };
  function L(m, D2) {
    const c = n.update(W2);
    p.defines.VSM_SAMPLES !== m.blurSamples && (p.defines.VSM_SAMPLES = m.blurSamples, x.defines.VSM_SAMPLES = m.blurSamples, p.needsUpdate = true, x.needsUpdate = true), m.mapPass === null ? m.mapPass = new Mr(l.x, l.y, { format: ao, type: ja }) : (m.mapPass.width !== m.map.width || m.mapPass.height !== m.map.height) && m.mapPass.setSize(m.map.width, m.map.height), p.uniforms.shadow_pass.value = m.map.depthTexture, p.uniforms.resolution.value.set(m.map.width, m.map.height), p.uniforms.radius.value = m.radius, e.setRenderTarget(m.mapPass), e.clear(), e.renderBufferDirect(D2, null, c, p, W2, null), x.uniforms.shadow_pass.value = m.mapPass.texture, x.uniforms.resolution.value.set(m.map.width, m.map.height), x.uniforms.radius.value = m.radius, e.setRenderTarget(m.map), e.clear(), e.renderBufferDirect(D2, null, c, x, W2, null);
  }
  function z(m, D2, c, _) {
    let w2 = null;
    const F = c.isPointLight === true ? m.customDistanceMaterial : m.customDepthMaterial;
    if (F !== void 0) w2 = F;
    else if (w2 = c.isPointLight === true ? R : g, e.localClippingEnabled && D2.clipShadows === true && Array.isArray(D2.clippingPlanes) && D2.clippingPlanes.length !== 0 || D2.displacementMap && D2.displacementScale !== 0 || D2.alphaMap && D2.alphaTest > 0 || D2.map && D2.alphaTest > 0 || D2.alphaToCoverage === true) {
      const G2 = w2.uuid, q = D2.uuid;
      let P2 = T[G2];
      P2 === void 0 && (P2 = {}, T[G2] = P2);
      let K = P2[q];
      K === void 0 && (K = w2.clone(), P2[q] = K, D2.addEventListener("dispose", S)), w2 = K;
    }
    if (w2.visible = D2.visible, w2.wireframe = D2.wireframe, _ === Bc ? w2.side = D2.shadowSide !== null ? D2.shadowSide : D2.side : w2.side = D2.shadowSide !== null ? D2.shadowSide : I2[D2.side], w2.alphaMap = D2.alphaMap, w2.alphaTest = D2.alphaToCoverage === true ? 0.5 : D2.alphaTest, w2.map = D2.map, w2.clipShadows = D2.clipShadows, w2.clippingPlanes = D2.clippingPlanes, w2.clipIntersection = D2.clipIntersection, w2.displacementMap = D2.displacementMap, w2.displacementScale = D2.displacementScale, w2.displacementBias = D2.displacementBias, w2.wireframeLinewidth = D2.wireframeLinewidth, w2.linewidth = D2.linewidth, c.isPointLight === true && w2.isMeshDistanceMaterial === true) {
      const G2 = e.properties.get(w2);
      G2.light = c;
    }
    return w2;
  }
  function h(m, D2, c, _, w2) {
    if (m.visible === false) return;
    if (m.layers.test(D2.layers) && (m.isMesh || m.isLine || m.isPoints) && (m.castShadow || m.receiveShadow && w2 === Bc) && (!m.frustumCulled || m.intersectsFrustum(i))) {
      m.modelViewMatrix.multiplyMatrices(c.matrixWorldInverse, m.matrixWorld);
      const q = n.update(m), P2 = m.material;
      if (Array.isArray(P2)) {
        const K = q.groups;
        for (let Q = 0, Y2 = K.length; Q < Y2; Q++) {
          const ne2 = K[Q], Z2 = P2[ne2.materialIndex];
          if (Z2 && Z2.visible) {
            const j = z(m, Z2, _, w2);
            m.onBeforeShadow(e, m, D2, c, q, j, ne2), e.renderBufferDirect(c, null, q, j, m, ne2), m.onAfterShadow(e, m, D2, c, q, j, ne2);
          }
        }
      } else if (P2.visible) {
        const K = z(m, P2, _, w2);
        m.onBeforeShadow(e, m, D2, c, q, K, null), e.renderBufferDirect(c, null, q, K, m, null), m.onAfterShadow(e, m, D2, c, q, K, null);
      }
    }
    const G2 = m.children;
    for (let q = 0, P2 = G2.length; q < P2; q++) h(G2[q], D2, c, _, w2);
  }
  function S(m) {
    m.target.removeEventListener("dispose", S);
    for (const c in T) {
      const _ = T[c], w2 = m.target.uuid;
      w2 in _ && (_[w2].dispose(), delete _[w2]);
    }
  }
}
function od2(e, n) {
  function t() {
    let E = false;
    const oe = new At();
    let k = null;
    const se2 = new At(0, 0, 0, 0);
    return { setMask: function(ue2) {
      k !== ue2 && !E && (e.colorMask(ue2, ue2, ue2, ue2), k = ue2);
    }, setLocked: function(ue2) {
      E = ue2;
    }, setClear: function(ue2, J, Te2, ve2, Ze2) {
      Ze2 === true && (ue2 *= ve2, J *= ve2, Te2 *= ve2), oe.set(ue2, J, Te2, ve2), se2.equals(oe) === false && (e.clearColor(ue2, J, Te2, ve2), se2.copy(oe));
    }, reset: function() {
      E = false, k = null, se2.set(-1, 0, 0, 0);
    } };
  }
  function i() {
    let E = false, oe = false, k = null, se2 = null, ue2 = null;
    return { setReversed: function(J) {
      if (oe !== J) {
        const Te2 = n.get("EXT_clip_control");
        J ? Te2.clipControlEXT(Te2.LOWER_LEFT_EXT, Te2.ZERO_TO_ONE_EXT) : Te2.clipControlEXT(Te2.LOWER_LEFT_EXT, Te2.NEGATIVE_ONE_TO_ONE_EXT), oe = J;
        const ve2 = ue2;
        ue2 = null, this.setClear(ve2);
      }
    }, getReversed: function() {
      return oe;
    }, setTest: function(J) {
      J ? $(e.DEPTH_TEST) : Ee2(e.DEPTH_TEST);
    }, setMask: function(J) {
      k !== J && !E && (e.depthMask(J), k = J);
    }, setFunc: function(J) {
      if (oe && (J = gd[J]), se2 !== J) {
        switch (J) {
          case Qn:
            e.depthFunc(e.NEVER);
            break;
          case jn:
            e.depthFunc(e.ALWAYS);
            break;
          case Kn:
            e.depthFunc(e.LESS);
            break;
          case ys:
            e.depthFunc(e.LEQUAL);
            break;
          case tr:
            e.depthFunc(e.EQUAL);
            break;
          case er:
            e.depthFunc(e.GEQUAL);
            break;
          case ir:
            e.depthFunc(e.GREATER);
            break;
          case sr:
            e.depthFunc(e.NOTEQUAL);
            break;
          default:
            e.depthFunc(e.LEQUAL);
        }
        se2 = J;
      }
    }, setLocked: function(J) {
      E = J;
    }, setClear: function(J) {
      ue2 !== J && (ue2 = J, oe && (J = 1 - J), e.clearDepth(J));
    }, reset: function() {
      E = false, k = null, se2 = null, ue2 = null, oe = false;
    } };
  }
  function l() {
    let E = false, oe = null, k = null, se2 = null, ue2 = null, J = null, Te2 = null, ve2 = null, Ze2 = null;
    return { setTest: function(Ge2) {
      E || (Ge2 ? $(e.STENCIL_TEST) : Ee2(e.STENCIL_TEST));
    }, setMask: function(Ge2) {
      oe !== Ge2 && !E && (e.stencilMask(Ge2), oe = Ge2);
    }, setFunc: function(Ge2, xt2, bt) {
      (k !== Ge2 || se2 !== xt2 || ue2 !== bt) && (e.stencilFunc(Ge2, xt2, bt), k = Ge2, se2 = xt2, ue2 = bt);
    }, setOp: function(Ge2, xt2, bt) {
      (J !== Ge2 || Te2 !== xt2 || ve2 !== bt) && (e.stencilOp(Ge2, xt2, bt), J = Ge2, Te2 = xt2, ve2 = bt);
    }, setLocked: function(Ge2) {
      E = Ge2;
    }, setClear: function(Ge2) {
      Ze2 !== Ge2 && (e.clearStencil(Ge2), Ze2 = Ge2);
    }, reset: function() {
      E = false, oe = null, k = null, se2 = null, ue2 = null, J = null, Te2 = null, ve2 = null, Ze2 = null;
    } };
  }
  const o = new t(), d = new i(), g = new l(), R = /* @__PURE__ */ new WeakMap(), T = /* @__PURE__ */ new WeakMap();
  let H2 = {}, I2 = {}, p = {}, x = /* @__PURE__ */ new WeakMap(), N = [], W2 = null, f = false, s = null, L = null, z = null, h = null, S = null, m = null, D2 = null, c = new U(0, 0, 0), _ = 0, w2 = false, F = null, G2 = null, q = null, P2 = null, K = null;
  const Q = e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  let Y2 = false, ne2 = 0;
  const Z2 = e.getParameter(e.VERSION);
  Z2.indexOf("WebGL") !== -1 ? (ne2 = parseFloat(/^WebGL (\d)/.exec(Z2)[1]), Y2 = ne2 >= 1) : Z2.indexOf("OpenGL ES") !== -1 && (ne2 = parseFloat(/^OpenGL ES (\d)/.exec(Z2)[1]), Y2 = ne2 >= 2);
  let j = null, ee2 = {};
  const be = e.getParameter(e.SCISSOR_BOX), Re2 = e.getParameter(e.VIEWPORT), it = new At().fromArray(be), ke2 = new At().fromArray(Re2);
  function ze2(E, oe, k, se2) {
    const ue2 = new Uint8Array(4), J = e.createTexture();
    e.bindTexture(E, J), e.texParameteri(E, e.TEXTURE_MIN_FILTER, e.NEAREST), e.texParameteri(E, e.TEXTURE_MAG_FILTER, e.NEAREST);
    for (let Te2 = 0; Te2 < k; Te2++) E === e.TEXTURE_3D || E === e.TEXTURE_2D_ARRAY ? e.texImage3D(oe, 0, e.RGBA, 1, 1, se2, 0, e.RGBA, e.UNSIGNED_BYTE, ue2) : e.texImage2D(oe + Te2, 0, e.RGBA, 1, 1, 0, e.RGBA, e.UNSIGNED_BYTE, ue2);
    return J;
  }
  const V2 = {};
  V2[e.TEXTURE_2D] = ze2(e.TEXTURE_2D, e.TEXTURE_2D, 1), V2[e.TEXTURE_CUBE_MAP] = ze2(e.TEXTURE_CUBE_MAP, e.TEXTURE_CUBE_MAP_POSITIVE_X, 6), V2[e.TEXTURE_2D_ARRAY] = ze2(e.TEXTURE_2D_ARRAY, e.TEXTURE_2D_ARRAY, 1, 1), V2[e.TEXTURE_3D] = ze2(e.TEXTURE_3D, e.TEXTURE_3D, 1, 1), o.setClear(0, 0, 0, 1), d.setClear(1), g.setClear(0), $(e.DEPTH_TEST), d.setFunc(ys), Ie2(false), et(Sc), $(e.CULL_FACE), Be2(kc);
  function $(E) {
    H2[E] !== true && (e.enable(E), H2[E] = true);
  }
  function Ee2(E) {
    H2[E] !== false && (e.disable(E), H2[E] = false);
  }
  function Ue2(E, oe) {
    return p[E] !== oe ? (e.bindFramebuffer(E, oe), p[E] = oe, E === e.DRAW_FRAMEBUFFER && (p[e.FRAMEBUFFER] = oe), E === e.FRAMEBUFFER && (p[e.DRAW_FRAMEBUFFER] = oe), true) : false;
  }
  function me2(E, oe) {
    let k = N, se2 = false;
    if (E) {
      k = x.get(oe), k === void 0 && (k = [], x.set(oe, k));
      const ue2 = E.textures;
      if (k.length !== ue2.length || k[0] !== e.COLOR_ATTACHMENT0) {
        for (let J = 0, Te2 = ue2.length; J < Te2; J++) k[J] = e.COLOR_ATTACHMENT0 + J;
        k.length = ue2.length, se2 = true;
      }
    } else k[0] !== e.BACK && (k[0] = e.BACK, se2 = true);
    se2 && e.drawBuffers(k);
  }
  function Fe2(E) {
    return W2 !== E ? (e.useProgram(E), W2 = E, true) : false;
  }
  const st2 = { [Na]: e.FUNC_ADD, [Lc]: e.FUNC_SUBTRACT, [Vc]: e.FUNC_REVERSE_SUBTRACT };
  st2[Dc] = e.MIN, st2[Uc] = e.MAX;
  const De2 = { [Wc]: e.ZERO, [Gc]: e.ONE, [Hc]: e.SRC_COLOR, [La]: e.SRC_ALPHA, [$c]: e.SRC_ALPHA_SATURATE, [Yc]: e.DST_COLOR, [Jc]: e.DST_ALPHA, [qc]: e.ONE_MINUS_SRC_COLOR, [Va]: e.ONE_MINUS_SRC_ALPHA, [Zc]: e.ONE_MINUS_DST_COLOR, [Xc]: e.ONE_MINUS_DST_ALPHA, [Qc]: e.CONSTANT_COLOR, [jc]: e.ONE_MINUS_CONSTANT_COLOR, [Kc]: e.CONSTANT_ALPHA, [tu]: e.ONE_MINUS_CONSTANT_ALPHA };
  function Be2(E, oe, k, se2, ue2, J, Te2, ve2, Ze2, Ge2) {
    if (E === kc) {
      f === true && (Ee2(e.BLEND), f = false);
      return;
    }
    if (f === false && ($(e.BLEND), f = true), E !== Ec) {
      if (E !== s || Ge2 !== w2) {
        if ((L !== Na || S !== Na) && (e.blendEquation(e.FUNC_ADD), L = Na, S = Na), Ge2) switch (E) {
          case Ea:
            e.blendFuncSeparate(e.ONE, e.ONE_MINUS_SRC_ALPHA, e.ONE, e.ONE_MINUS_SRC_ALPHA);
            break;
          case Pc:
            e.blendFunc(e.ONE, e.ONE);
            break;
          case Rc:
            e.blendFuncSeparate(e.ZERO, e.ONE_MINUS_SRC_COLOR, e.ZERO, e.ONE);
            break;
          case Oc:
            e.blendFuncSeparate(e.DST_COLOR, e.ONE_MINUS_SRC_ALPHA, e.ZERO, e.ONE);
            break;
          default:
            X("WebGLState: Invalid blending: ", E);
            break;
        }
        else switch (E) {
          case Ea:
            e.blendFuncSeparate(e.SRC_ALPHA, e.ONE_MINUS_SRC_ALPHA, e.ONE, e.ONE_MINUS_SRC_ALPHA);
            break;
          case Pc:
            e.blendFuncSeparate(e.SRC_ALPHA, e.ONE, e.ONE, e.ONE);
            break;
          case Rc:
            X("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");
            break;
          case Oc:
            X("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");
            break;
          default:
            X("WebGLState: Invalid blending: ", E);
            break;
        }
        z = null, h = null, m = null, D2 = null, c.set(0, 0, 0), _ = 0, s = E, w2 = Ge2;
      }
      return;
    }
    ue2 = ue2 || oe, J = J || k, Te2 = Te2 || se2, (oe !== L || ue2 !== S) && (e.blendEquationSeparate(st2[oe], st2[ue2]), L = oe, S = ue2), (k !== z || se2 !== h || J !== m || Te2 !== D2) && (e.blendFuncSeparate(De2[k], De2[se2], De2[J], De2[Te2]), z = k, h = se2, m = J, D2 = Te2), (ve2.equals(c) === false || Ze2 !== _) && (e.blendColor(ve2.r, ve2.g, ve2.b, Ze2), c.copy(ve2), _ = Ze2), s = E, w2 = false;
  }
  function qe2(E, oe) {
    E.side === Fc ? Ee2(e.CULL_FACE) : $(e.CULL_FACE);
    let k = E.side === Oa;
    oe && (k = !k), Ie2(k), E.blending === Ea && E.transparent === false ? Be2(kc) : Be2(E.blending, E.blendEquation, E.blendSrc, E.blendDst, E.blendEquationAlpha, E.blendSrcAlpha, E.blendDstAlpha, E.blendColor, E.blendAlpha, E.premultipliedAlpha), d.setFunc(E.depthFunc), d.setTest(E.depthTest), d.setMask(E.depthWrite), o.setMask(E.colorWrite);
    const se2 = E.stencilWrite;
    g.setTest(se2), se2 && (g.setMask(E.stencilWriteMask), g.setFunc(E.stencilFunc, E.stencilRef, E.stencilFuncMask), g.setOp(E.stencilFail, E.stencilZFail, E.stencilZPass)), _t2(E.polygonOffset, E.polygonOffsetFactor, E.polygonOffsetUnits), E.alphaToCoverage === true ? $(e.SAMPLE_ALPHA_TO_COVERAGE) : Ee2(e.SAMPLE_ALPHA_TO_COVERAGE);
  }
  function Ie2(E) {
    F !== E && (E ? e.frontFace(e.CW) : e.frontFace(e.CCW), F = E);
  }
  function et(E) {
    E !== vc ? ($(e.CULL_FACE), E !== G2 && (E === Sc ? e.cullFace(e.BACK) : E === Ac ? e.cullFace(e.FRONT) : e.cullFace(e.FRONT_AND_BACK))) : Ee2(e.CULL_FACE), G2 = E;
  }
  function ft2(E) {
    E !== q && (Y2 && e.lineWidth(E), q = E);
  }
  function _t2(E, oe, k) {
    E ? ($(e.POLYGON_OFFSET_FILL), (P2 !== oe || K !== k) && (P2 = oe, K = k, d.getReversed() && (oe = -oe), e.polygonOffset(oe, k))) : Ee2(e.POLYGON_OFFSET_FILL);
  }
  function nt(E) {
    E ? $(e.SCISSOR_TEST) : Ee2(e.SCISSOR_TEST);
  }
  function at2(E) {
    E === void 0 && (E = e.TEXTURE0 + Q - 1), j !== E && (e.activeTexture(E), j = E);
  }
  function M(E, oe, k) {
    k === void 0 && (j === null ? k = e.TEXTURE0 + Q - 1 : k = j);
    let se2 = ee2[k];
    se2 === void 0 && (se2 = { type: void 0, texture: void 0 }, ee2[k] = se2), (se2.type !== E || se2.texture !== oe) && (j !== k && (e.activeTexture(k), j = k), e.bindTexture(E, oe || V2[E]), se2.type = E, se2.texture = oe);
  }
  function dt2() {
    const E = ee2[j];
    E !== void 0 && E.type !== void 0 && (e.bindTexture(E.type, null), E.type = void 0, E.texture = void 0);
  }
  function We2() {
    try {
      e.compressedTexImage2D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function u() {
    try {
      e.compressedTexImage3D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function r() {
    try {
      e.texSubImage2D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function A() {
    try {
      e.texSubImage3D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function U2() {
    try {
      e.compressedTexSubImage2D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function O() {
    try {
      e.compressedTexSubImage3D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function te2() {
    try {
      e.texStorage2D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function ie() {
    try {
      e.texStorage3D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function B() {
    try {
      e.texImage2D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function X2() {
    try {
      e.texImage3D(...arguments);
    } catch (E) {
      X("WebGLState:", E);
    }
  }
  function re2(E) {
    return I2[E] !== void 0 ? I2[E] : e.getParameter(E);
  }
  function Me(E, oe) {
    I2[E] !== oe && (e.pixelStorei(E, oe), I2[E] = oe);
  }
  function ce2(E) {
    it.equals(E) === false && (e.scissor(E.x, E.y, E.z, E.w), it.copy(E));
  }
  function ae2(E) {
    ke2.equals(E) === false && (e.viewport(E.x, E.y, E.z, E.w), ke2.copy(E));
  }
  function xe2(E, oe) {
    let k = T.get(oe);
    k === void 0 && (k = /* @__PURE__ */ new WeakMap(), T.set(oe, k));
    let se2 = k.get(E);
    se2 === void 0 && (se2 = e.getUniformBlockIndex(oe, E.name), k.set(E, se2));
  }
  function Ae2(E, oe) {
    const se2 = T.get(oe).get(E);
    R.get(oe) !== se2 && (e.uniformBlockBinding(oe, se2, E.__bindingPointIndex), R.set(oe, se2));
  }
  function Ce2() {
    e.disable(e.BLEND), e.disable(e.CULL_FACE), e.disable(e.DEPTH_TEST), e.disable(e.POLYGON_OFFSET_FILL), e.disable(e.SCISSOR_TEST), e.disable(e.STENCIL_TEST), e.disable(e.SAMPLE_ALPHA_TO_COVERAGE), e.blendEquation(e.FUNC_ADD), e.blendFunc(e.ONE, e.ZERO), e.blendFuncSeparate(e.ONE, e.ZERO, e.ONE, e.ZERO), e.blendColor(0, 0, 0, 0), e.colorMask(true, true, true, true), e.clearColor(0, 0, 0, 0), e.depthMask(true), e.depthFunc(e.LESS), d.setReversed(false), e.clearDepth(1), e.stencilMask(4294967295), e.stencilFunc(e.ALWAYS, 0, 4294967295), e.stencilOp(e.KEEP, e.KEEP, e.KEEP), e.clearStencil(0), e.cullFace(e.BACK), e.frontFace(e.CCW), e.polygonOffset(0, 0), e.activeTexture(e.TEXTURE0), e.bindFramebuffer(e.FRAMEBUFFER, null), e.bindFramebuffer(e.DRAW_FRAMEBUFFER, null), e.bindFramebuffer(e.READ_FRAMEBUFFER, null), e.useProgram(null), e.lineWidth(1), e.scissor(0, 0, e.canvas.width, e.canvas.height), e.viewport(0, 0, e.canvas.width, e.canvas.height), e.pixelStorei(e.PACK_ALIGNMENT, 4), e.pixelStorei(e.UNPACK_ALIGNMENT, 4), e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL, false), e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false), e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL, e.BROWSER_DEFAULT_WEBGL), e.pixelStorei(e.PACK_ROW_LENGTH, 0), e.pixelStorei(e.PACK_SKIP_PIXELS, 0), e.pixelStorei(e.PACK_SKIP_ROWS, 0), e.pixelStorei(e.UNPACK_ROW_LENGTH, 0), e.pixelStorei(e.UNPACK_IMAGE_HEIGHT, 0), e.pixelStorei(e.UNPACK_SKIP_PIXELS, 0), e.pixelStorei(e.UNPACK_SKIP_ROWS, 0), e.pixelStorei(e.UNPACK_SKIP_IMAGES, 0), H2 = {}, I2 = {}, j = null, ee2 = {}, p = {}, x = /* @__PURE__ */ new WeakMap(), N = [], W2 = null, f = false, s = null, L = null, z = null, h = null, S = null, m = null, D2 = null, c = new U(0, 0, 0), _ = 0, w2 = false, F = null, G2 = null, q = null, P2 = null, K = null, it.set(0, 0, e.canvas.width, e.canvas.height), ke2.set(0, 0, e.canvas.width, e.canvas.height), o.reset(), d.reset(), g.reset();
  }
  return { buffers: { color: o, depth: d, stencil: g }, enable: $, disable: Ee2, bindFramebuffer: Ue2, drawBuffers: me2, useProgram: Fe2, setBlending: Be2, setMaterial: qe2, setFlipSided: Ie2, setCullFace: et, setLineWidth: ft2, setPolygonOffset: _t2, setScissorTest: nt, activeTexture: at2, bindTexture: M, unbindTexture: dt2, compressedTexImage2D: We2, compressedTexImage3D: u, texImage2D: B, texImage3D: X2, pixelStorei: Me, getParameter: re2, updateUBOMapping: xe2, uniformBlockBinding: Ae2, texStorage2D: te2, texStorage3D: ie, texSubImage2D: r, texSubImage3D: A, compressedTexSubImage2D: U2, compressedTexSubImage3D: O, scissor: ce2, viewport: ae2, reset: Ce2 };
}
function sd2(e, n, t, i, l, o, d) {
  const g = n.has("WEBGL_multisampled_render_to_texture") ? n.get("WEBGL_multisampled_render_to_texture") : null, R = typeof navigator > "u" ? false : /OculusBrowser/g.test(navigator.userAgent), T = new I(), H2 = /* @__PURE__ */ new WeakMap(), I2 = /* @__PURE__ */ new Set();
  let p;
  const x = /* @__PURE__ */ new WeakMap();
  let N = false;
  try {
    N = typeof OffscreenCanvas < "u" && new OffscreenCanvas(1, 1).getContext("2d") !== null;
  } catch {
  }
  function W2(u, r) {
    return N ? new OffscreenCanvas(u, r) : Ni("canvas");
  }
  function f(u, r, A) {
    let U2 = 1;
    const O = We2(u);
    if ((O.width > A || O.height > A) && (U2 = A / Math.max(O.width, O.height)), U2 < 1) if (typeof HTMLImageElement < "u" && u instanceof HTMLImageElement || typeof HTMLCanvasElement < "u" && u instanceof HTMLCanvasElement || typeof ImageBitmap < "u" && u instanceof ImageBitmap || typeof VideoFrame < "u" && u instanceof VideoFrame) {
      const te2 = Math.floor(U2 * O.width), ie = Math.floor(U2 * O.height);
      p === void 0 && (p = W2(te2, ie));
      const B = r ? W2(te2, ie) : p;
      return B.width = te2, B.height = ie, B.getContext("2d").drawImage(u, 0, 0, te2, ie), V("WebGLRenderer: Texture has been resized from (" + O.width + "x" + O.height + ") to (" + te2 + "x" + ie + ")."), B;
    } else return "data" in u && V("WebGLRenderer: Image in DataTexture is too big (" + O.width + "x" + O.height + ")."), u;
    return u;
  }
  function s(u) {
    return u.generateMipmaps;
  }
  function L(u) {
    e.generateMipmap(u);
  }
  function z(u) {
    return u.isWebGLCubeRenderTarget ? e.TEXTURE_CUBE_MAP : u.isWebGL3DRenderTarget ? e.TEXTURE_3D : u.isWebGLArrayRenderTarget || u.isCompressedArrayTexture ? e.TEXTURE_2D_ARRAY : e.TEXTURE_2D;
  }
  function h(u, r, A, U2, O, te2 = false) {
    if (u !== null) {
      if (e[u] !== void 0) return e[u];
      V("WebGLRenderer: Attempt to use non-existing WebGL internal format '" + u + "'");
    }
    let ie;
    U2 && (ie = n.get("EXT_texture_norm16"), ie || V("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));
    let B = r;
    if (r === e.RED && (A === e.FLOAT && (B = e.R32F), A === e.HALF_FLOAT && (B = e.R16F), A === e.UNSIGNED_BYTE && (B = e.R8), A === e.UNSIGNED_SHORT && ie && (B = ie.R16_EXT), A === e.SHORT && ie && (B = ie.R16_SNORM_EXT)), r === e.RED_INTEGER && (A === e.UNSIGNED_BYTE && (B = e.R8UI), A === e.UNSIGNED_SHORT && (B = e.R16UI), A === e.UNSIGNED_INT && (B = e.R32UI), A === e.BYTE && (B = e.R8I), A === e.SHORT && (B = e.R16I), A === e.INT && (B = e.R32I)), r === e.RG && (A === e.FLOAT && (B = e.RG32F), A === e.HALF_FLOAT && (B = e.RG16F), A === e.UNSIGNED_BYTE && (B = e.RG8), A === e.UNSIGNED_SHORT && ie && (B = ie.RG16_EXT), A === e.SHORT && ie && (B = ie.RG16_SNORM_EXT)), r === e.RG_INTEGER && (A === e.UNSIGNED_BYTE && (B = e.RG8UI), A === e.UNSIGNED_SHORT && (B = e.RG16UI), A === e.UNSIGNED_INT && (B = e.RG32UI), A === e.BYTE && (B = e.RG8I), A === e.SHORT && (B = e.RG16I), A === e.INT && (B = e.RG32I)), r === e.RGB_INTEGER && (A === e.UNSIGNED_BYTE && (B = e.RGB8UI), A === e.UNSIGNED_SHORT && (B = e.RGB16UI), A === e.UNSIGNED_INT && (B = e.RGB32UI), A === e.BYTE && (B = e.RGB8I), A === e.SHORT && (B = e.RGB16I), A === e.INT && (B = e.RGB32I)), r === e.RGBA_INTEGER && (A === e.UNSIGNED_BYTE && (B = e.RGBA8UI), A === e.UNSIGNED_SHORT && (B = e.RGBA16UI), A === e.UNSIGNED_INT && (B = e.RGBA32UI), A === e.BYTE && (B = e.RGBA8I), A === e.SHORT && (B = e.RGBA16I), A === e.INT && (B = e.RGBA32I)), r === e.RGB && (A === e.UNSIGNED_SHORT && ie && (B = ie.RGB16_EXT), A === e.SHORT && ie && (B = ie.RGB16_SNORM_EXT), A === e.UNSIGNED_INT_5_9_9_9_REV && (B = e.RGB9_E5), A === e.UNSIGNED_INT_10F_11F_11F_REV && (B = e.R11F_G11F_B10F)), r === e.RGBA) {
      const X2 = te2 ? ur : It.getTransfer(O);
      A === e.FLOAT && (B = e.RGBA32F), A === e.HALF_FLOAT && (B = e.RGBA16F), A === e.UNSIGNED_BYTE && (B = X2 === Cs ? e.SRGB8_ALPHA8 : e.RGBA8), A === e.UNSIGNED_SHORT && ie && (B = ie.RGBA16_EXT), A === e.SHORT && ie && (B = ie.RGBA16_SNORM_EXT), A === e.UNSIGNED_SHORT_4_4_4_4 && (B = e.RGBA4), A === e.UNSIGNED_SHORT_5_5_5_1 && (B = e.RGB5_A1);
    }
    return (B === e.R16F || B === e.R32F || B === e.RG16F || B === e.RG32F || B === e.RGBA16F || B === e.RGBA32F) && n.get("EXT_color_buffer_float"), B;
  }
  function S(u, r) {
    let A;
    return u ? r === null || r === Ri || r === mu ? A = e.DEPTH24_STENCIL8 : r === Re ? A = e.DEPTH32F_STENCIL8 : r === $a && (A = e.DEPTH24_STENCIL8, V("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")) : r === null || r === Ri || r === mu ? A = e.DEPTH_COMPONENT24 : r === Re ? A = e.DEPTH_COMPONENT32F : r === $a && (A = e.DEPTH_COMPONENT16), A;
  }
  function m(u, r) {
    return s(u) === true || u.isFramebufferTexture && u.minFilter !== Ct && u.minFilter !== Ut ? Math.log2(Math.max(r.width, r.height)) + 1 : u.mipmaps !== void 0 && u.mipmaps.length > 0 ? u.mipmaps.length : u.isCompressedTexture && Array.isArray(u.image) ? r.mipmaps.length : 1;
  }
  function D2(u) {
    const r = u.target;
    r.removeEventListener("dispose", D2), _(r), r.isVideoTexture && H2.delete(r), r.isHTMLTexture && I2.delete(r);
  }
  function c(u) {
    const r = u.target;
    r.removeEventListener("dispose", c), F(r);
  }
  function _(u) {
    const r = i.get(u);
    if (r.__webglInit === void 0) return;
    const A = u.source, U2 = x.get(A);
    if (U2) {
      const O = U2[r.__cacheKey];
      O.usedTimes--, O.usedTimes === 0 && w2(u), Object.keys(U2).length === 0 && x.delete(A);
    }
    i.remove(u);
  }
  function w2(u) {
    const r = i.get(u);
    e.deleteTexture(r.__webglTexture);
    const A = u.source, U2 = x.get(A);
    delete U2[r.__cacheKey], d.memory.textures--;
  }
  function F(u) {
    const r = i.get(u);
    if (u.depthTexture && (u.depthTexture.dispose(), i.remove(u.depthTexture)), u.isWebGLCubeRenderTarget) for (let U2 = 0; U2 < 6; U2++) {
      if (Array.isArray(r.__webglFramebuffer[U2])) for (let O = 0; O < r.__webglFramebuffer[U2].length; O++) e.deleteFramebuffer(r.__webglFramebuffer[U2][O]);
      else e.deleteFramebuffer(r.__webglFramebuffer[U2]);
      r.__webglDepthbuffer && e.deleteRenderbuffer(r.__webglDepthbuffer[U2]);
    }
    else {
      if (Array.isArray(r.__webglFramebuffer)) for (let U2 = 0; U2 < r.__webglFramebuffer.length; U2++) e.deleteFramebuffer(r.__webglFramebuffer[U2]);
      else e.deleteFramebuffer(r.__webglFramebuffer);
      if (r.__webglDepthbuffer && e.deleteRenderbuffer(r.__webglDepthbuffer), r.__webglMultisampledFramebuffer && e.deleteFramebuffer(r.__webglMultisampledFramebuffer), r.__webglColorRenderbuffer) for (let U2 = 0; U2 < r.__webglColorRenderbuffer.length; U2++) r.__webglColorRenderbuffer[U2] && e.deleteRenderbuffer(r.__webglColorRenderbuffer[U2]);
      r.__webglDepthRenderbuffer && e.deleteRenderbuffer(r.__webglDepthRenderbuffer);
    }
    const A = u.textures;
    for (let U2 = 0, O = A.length; U2 < O; U2++) {
      const te2 = i.get(A[U2]);
      te2.__webglTexture && (e.deleteTexture(te2.__webglTexture), d.memory.textures--), i.remove(A[U2]);
    }
    i.remove(u);
  }
  let G2 = 0;
  function q() {
    G2 = 0;
  }
  function P2() {
    return G2;
  }
  function K(u) {
    G2 = u;
  }
  function Q() {
    const u = G2;
    return u >= l.maxTextures && V("WebGLTextures: Trying to use " + (u + 1) + " texture units while this GPU supports only " + l.maxTextures), G2 += 1, u;
  }
  function Y2(u) {
    const r = [];
    return r.push(u.wrapS), r.push(u.wrapT), r.push(u.wrapR || 0), r.push(u.magFilter), r.push(u.minFilter), r.push(u.anisotropy), r.push(u.internalFormat), r.push(u.format), r.push(u.type), r.push(u.generateMipmaps), r.push(u.premultiplyAlpha), r.push(u.flipY), r.push(u.unpackAlignment), r.push(u.colorSpace), r.join();
  }
  function ne2(u, r) {
    const A = i.get(u);
    if (u.isVideoTexture && M(u), u.isRenderTargetTexture === false && u.isExternalTexture !== true && u.version > 0 && A.__version !== u.version) {
      const U2 = u.image;
      if (U2 === null) V("WebGLRenderer: Texture marked for update but no image data found.");
      else if (U2.complete === false) V("WebGLRenderer: Texture marked for update but image is incomplete");
      else {
        Ee2(A, u, r);
        return;
      }
    } else u.isExternalTexture && (A.__webglTexture = u.sourceTexture ? u.sourceTexture : null);
    t.bindTexture(e.TEXTURE_2D, A.__webglTexture, e.TEXTURE0 + r);
  }
  function Z2(u, r) {
    const A = i.get(u);
    if (u.isRenderTargetTexture === false && u.version > 0 && A.__version !== u.version) {
      Ee2(A, u, r);
      return;
    } else u.isExternalTexture && (A.__webglTexture = u.sourceTexture ? u.sourceTexture : null);
    t.bindTexture(e.TEXTURE_2D_ARRAY, A.__webglTexture, e.TEXTURE0 + r);
  }
  function j(u, r) {
    const A = i.get(u);
    if (u.isRenderTargetTexture === false && u.version > 0 && A.__version !== u.version) {
      Ee2(A, u, r);
      return;
    }
    t.bindTexture(e.TEXTURE_3D, A.__webglTexture, e.TEXTURE0 + r);
  }
  function ee2(u, r) {
    const A = i.get(u);
    if (u.isCubeDepthTexture !== true && u.version > 0 && A.__version !== u.version) {
      Ue2(A, u, r);
      return;
    }
    t.bindTexture(e.TEXTURE_CUBE_MAP, A.__webglTexture, e.TEXTURE0 + r);
  }
  const be = { [bs]: e.REPEAT, [Ht]: e.CLAMP_TO_EDGE, [Ms]: e.MIRRORED_REPEAT }, Re2 = { [Ct]: e.NEAREST, [qa]: e.NEAREST_MIPMAP_NEAREST, [Ja]: e.NEAREST_MIPMAP_LINEAR, [Ut]: e.LINEAR, [Xa]: e.LINEAR_MIPMAP_NEAREST, [ws]: e.LINEAR_MIPMAP_LINEAR }, it = { [Uu]: e.NEVER, [Yu]: e.ALWAYS, [Wu]: e.LESS, [Hu]: e.LEQUAL, [Gu]: e.EQUAL, [Xu]: e.GEQUAL, [qu]: e.GREATER, [Ju]: e.NOTEQUAL };
  function ke2(u, r) {
    if (r.type === Re && n.has("OES_texture_float_linear") === false && (r.magFilter === Ut || r.magFilter === Xa || r.magFilter === Ja || r.magFilter === ws || r.minFilter === Ut || r.minFilter === Xa || r.minFilter === Ja || r.minFilter === ws) && V("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."), e.texParameteri(u, e.TEXTURE_WRAP_S, be[r.wrapS]), e.texParameteri(u, e.TEXTURE_WRAP_T, be[r.wrapT]), (u === e.TEXTURE_3D || u === e.TEXTURE_2D_ARRAY) && e.texParameteri(u, e.TEXTURE_WRAP_R, be[r.wrapR]), e.texParameteri(u, e.TEXTURE_MAG_FILTER, Re2[r.magFilter]), e.texParameteri(u, e.TEXTURE_MIN_FILTER, Re2[r.minFilter]), r.compareFunction && (e.texParameteri(u, e.TEXTURE_COMPARE_MODE, e.COMPARE_REF_TO_TEXTURE), e.texParameteri(u, e.TEXTURE_COMPARE_FUNC, it[r.compareFunction])), n.has("EXT_texture_filter_anisotropic") === true) {
      if (r.magFilter === Ct || r.minFilter !== Ja && r.minFilter !== ws || r.type === Re && n.has("OES_texture_float_linear") === false) return;
      if (r.anisotropy > 1 || i.get(r).__currentAnisotropy) {
        const A = n.get("EXT_texture_filter_anisotropic");
        e.texParameterf(u, A.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(r.anisotropy, l.getMaxAnisotropy())), i.get(r).__currentAnisotropy = r.anisotropy;
      }
    }
  }
  function ze2(u, r) {
    let A = false;
    u.__webglInit === void 0 && (u.__webglInit = true, r.addEventListener("dispose", D2));
    const U2 = r.source;
    let O = x.get(U2);
    O === void 0 && (O = {}, x.set(U2, O));
    const te2 = Y2(r);
    if (te2 !== u.__cacheKey) {
      O[te2] === void 0 && (O[te2] = { texture: e.createTexture(), usedTimes: 0 }, d.memory.textures++, A = true), O[te2].usedTimes++;
      const ie = O[u.__cacheKey];
      ie !== void 0 && (O[u.__cacheKey].usedTimes--, ie.usedTimes === 0 && w2(r)), u.__cacheKey = te2, u.__webglTexture = O[te2].texture;
    }
    return A;
  }
  function V2(u, r, A) {
    return Math.floor(Math.floor(u / A) / r);
  }
  function $(u, r, A, U2) {
    const te2 = u.updateRanges;
    if (te2.length === 0) t.texSubImage2D(e.TEXTURE_2D, 0, 0, 0, r.width, r.height, A, U2, r.data);
    else {
      te2.sort((Me, ce2) => Me.start - ce2.start);
      let ie = 0;
      for (let Me = 1; Me < te2.length; Me++) {
        const ce2 = te2[ie], ae2 = te2[Me], xe2 = ce2.start + ce2.count, Ae2 = V2(ae2.start, r.width, 4), Ce2 = V2(ce2.start, r.width, 4);
        ae2.start <= xe2 + 1 && Ae2 === Ce2 && V2(ae2.start + ae2.count - 1, r.width, 4) === Ae2 ? ce2.count = Math.max(ce2.count, ae2.start + ae2.count - ce2.start) : (++ie, te2[ie] = ae2);
      }
      te2.length = ie + 1;
      const B = t.getParameter(e.UNPACK_ROW_LENGTH), X2 = t.getParameter(e.UNPACK_SKIP_PIXELS), re2 = t.getParameter(e.UNPACK_SKIP_ROWS);
      t.pixelStorei(e.UNPACK_ROW_LENGTH, r.width);
      for (let Me = 0, ce2 = te2.length; Me < ce2; Me++) {
        const ae2 = te2[Me], xe2 = Math.floor(ae2.start / 4), Ae2 = Math.ceil(ae2.count / 4), Ce2 = xe2 % r.width, E = Math.floor(xe2 / r.width), oe = Ae2, k = 1;
        t.pixelStorei(e.UNPACK_SKIP_PIXELS, Ce2), t.pixelStorei(e.UNPACK_SKIP_ROWS, E), t.texSubImage2D(e.TEXTURE_2D, 0, Ce2, E, oe, k, A, U2, r.data);
      }
      u.clearUpdateRanges(), t.pixelStorei(e.UNPACK_ROW_LENGTH, B), t.pixelStorei(e.UNPACK_SKIP_PIXELS, X2), t.pixelStorei(e.UNPACK_SKIP_ROWS, re2);
    }
  }
  function Ee2(u, r, A) {
    let U2 = e.TEXTURE_2D;
    (r.isDataArrayTexture || r.isCompressedArrayTexture) && (U2 = e.TEXTURE_2D_ARRAY), r.isData3DTexture && (U2 = e.TEXTURE_3D);
    const O = ze2(u, r), te2 = r.source;
    t.bindTexture(U2, u.__webglTexture, e.TEXTURE0 + A);
    const ie = i.get(te2);
    if (te2.version !== ie.__version || O === true) {
      if (t.activeTexture(e.TEXTURE0 + A), (typeof ImageBitmap < "u" && r.image instanceof ImageBitmap) === false) {
        const k = It.getPrimaries(It.workingColorSpace), se2 = r.colorSpace === lr ? null : It.getPrimaries(r.colorSpace), ue2 = r.colorSpace === lr || k === se2 ? e.NONE : e.BROWSER_DEFAULT_WEBGL;
        t.pixelStorei(e.UNPACK_FLIP_Y_WEBGL, r.flipY), t.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL, r.premultiplyAlpha), t.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL, ue2);
      }
      t.pixelStorei(e.UNPACK_ALIGNMENT, r.unpackAlignment);
      let X2 = f(r.image, false, l.maxTextureSize);
      X2 = dt2(r, X2);
      const re2 = o.convert(r.format, r.colorSpace), Me = o.convert(r.type);
      let ce2 = h(r.internalFormat, re2, Me, r.normalized, r.colorSpace, r.isVideoTexture);
      ke2(U2, r);
      let ae2;
      const xe2 = r.mipmaps, Ae2 = r.isVideoTexture !== true, Ce2 = ie.__version === void 0 || O === true, E = te2.dataReady, oe = m(r, X2);
      if (r.isDepthTexture) ce2 = S(r.format === ro, r.type), Ce2 && (Ae2 ? t.texStorage2D(e.TEXTURE_2D, 1, ce2, X2.width, X2.height) : t.texImage2D(e.TEXTURE_2D, 0, ce2, X2.width, X2.height, 0, re2, Me, null));
      else if (r.isDataTexture) if (xe2.length > 0) {
        Ae2 && Ce2 && t.texStorage2D(e.TEXTURE_2D, oe, ce2, xe2[0].width, xe2[0].height);
        for (let k = 0, se2 = xe2.length; k < se2; k++) ae2 = xe2[k], Ae2 ? E && t.texSubImage2D(e.TEXTURE_2D, k, 0, 0, ae2.width, ae2.height, re2, Me, ae2.data) : t.texImage2D(e.TEXTURE_2D, k, ce2, ae2.width, ae2.height, 0, re2, Me, ae2.data);
        r.generateMipmaps = false;
      } else Ae2 ? (Ce2 && t.texStorage2D(e.TEXTURE_2D, oe, ce2, X2.width, X2.height), E && $(r, X2, re2, Me)) : t.texImage2D(e.TEXTURE_2D, 0, ce2, X2.width, X2.height, 0, re2, Me, X2.data);
      else if (r.isCompressedTexture) if (r.isCompressedArrayTexture) {
        Ae2 && Ce2 && t.texStorage3D(e.TEXTURE_2D_ARRAY, oe, ce2, xe2[0].width, xe2[0].height, X2.depth);
        for (let k = 0, se2 = xe2.length; k < se2; k++) if (ae2 = xe2[k], r.format !== si) if (re2 !== null) if (Ae2) {
          if (E) if (r.layerUpdates.size > 0) {
            const ue2 = gc(ae2.width, ae2.height, r.format, r.type);
            for (const J of r.layerUpdates) {
              const Te2 = ae2.data.subarray(J * ue2 / ae2.data.BYTES_PER_ELEMENT, (J + 1) * ue2 / ae2.data.BYTES_PER_ELEMENT);
              t.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY, k, 0, 0, J, ae2.width, ae2.height, 1, re2, Te2);
            }
          } else t.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY, k, 0, 0, 0, ae2.width, ae2.height, X2.depth, re2, ae2.data);
        } else t.compressedTexImage3D(e.TEXTURE_2D_ARRAY, k, ce2, ae2.width, ae2.height, X2.depth, 0, ae2.data, 0, 0);
        else V("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");
        else Ae2 ? E && t.texSubImage3D(e.TEXTURE_2D_ARRAY, k, 0, 0, 0, ae2.width, ae2.height, X2.depth, re2, Me, ae2.data) : t.texImage3D(e.TEXTURE_2D_ARRAY, k, ce2, ae2.width, ae2.height, X2.depth, 0, re2, Me, ae2.data);
        r.layerUpdates.size > 0 && r.clearLayerUpdates();
      } else {
        Ae2 && Ce2 && t.texStorage2D(e.TEXTURE_2D, oe, ce2, xe2[0].width, xe2[0].height);
        for (let k = 0, se2 = xe2.length; k < se2; k++) ae2 = xe2[k], r.format !== si ? re2 !== null ? Ae2 ? E && t.compressedTexSubImage2D(e.TEXTURE_2D, k, 0, 0, ae2.width, ae2.height, re2, ae2.data) : t.compressedTexImage2D(e.TEXTURE_2D, k, ce2, ae2.width, ae2.height, 0, ae2.data) : V("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()") : Ae2 ? E && t.texSubImage2D(e.TEXTURE_2D, k, 0, 0, ae2.width, ae2.height, re2, Me, ae2.data) : t.texImage2D(e.TEXTURE_2D, k, ce2, ae2.width, ae2.height, 0, re2, Me, ae2.data);
      }
      else if (r.isDataArrayTexture) if (Ae2) {
        if (Ce2 && t.texStorage3D(e.TEXTURE_2D_ARRAY, oe, ce2, X2.width, X2.height, X2.depth), E) if (r.layerUpdates.size > 0) {
          const k = gc(X2.width, X2.height, r.format, r.type);
          for (const se2 of r.layerUpdates) {
            const ue2 = X2.data.subarray(se2 * k / X2.data.BYTES_PER_ELEMENT, (se2 + 1) * k / X2.data.BYTES_PER_ELEMENT);
            t.texSubImage3D(e.TEXTURE_2D_ARRAY, 0, 0, 0, se2, X2.width, X2.height, 1, re2, Me, ue2);
          }
          r.clearLayerUpdates();
        } else t.texSubImage3D(e.TEXTURE_2D_ARRAY, 0, 0, 0, 0, X2.width, X2.height, X2.depth, re2, Me, X2.data);
      } else t.texImage3D(e.TEXTURE_2D_ARRAY, 0, ce2, X2.width, X2.height, X2.depth, 0, re2, Me, X2.data);
      else if (r.isData3DTexture) Ae2 ? (Ce2 && t.texStorage3D(e.TEXTURE_3D, oe, ce2, X2.width, X2.height, X2.depth), E && t.texSubImage3D(e.TEXTURE_3D, 0, 0, 0, 0, X2.width, X2.height, X2.depth, re2, Me, X2.data)) : t.texImage3D(e.TEXTURE_3D, 0, ce2, X2.width, X2.height, X2.depth, 0, re2, Me, X2.data);
      else if (r.isFramebufferTexture) {
        if (Ce2) if (Ae2) t.texStorage2D(e.TEXTURE_2D, oe, ce2, X2.width, X2.height);
        else {
          let k = X2.width, se2 = X2.height;
          for (let ue2 = 0; ue2 < oe; ue2++) t.texImage2D(e.TEXTURE_2D, ue2, ce2, k, se2, 0, re2, Me, null), k >>= 1, se2 >>= 1;
        }
      } else if (r.isHTMLTexture) {
        if ("texElementImage2D" in e) {
          const k = e.canvas;
          if (k.hasAttribute("layoutsubtree") || k.setAttribute("layoutsubtree", "true"), X2.parentNode !== k) {
            k.appendChild(X2), I2.add(r), k.onpaint = (se2) => {
              const ue2 = se2.changedElements;
              for (const J of I2) ue2.includes(J.image) && (J.needsUpdate = true);
            }, k.requestPaint();
            return;
          }
          if (e.texElementImage2D.length === 3) e.texElementImage2D(e.TEXTURE_2D, e.RGBA8, X2);
          else {
            const ue2 = e.RGBA, J = e.RGBA, Te2 = e.UNSIGNED_BYTE;
            e.texElementImage2D(e.TEXTURE_2D, 0, ue2, J, Te2, X2);
          }
          e.texParameteri(e.TEXTURE_2D, e.TEXTURE_MIN_FILTER, e.LINEAR), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_S, e.CLAMP_TO_EDGE), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_T, e.CLAMP_TO_EDGE);
        }
      } else if (xe2.length > 0) {
        if (Ae2 && Ce2) {
          const k = We2(xe2[0]);
          t.texStorage2D(e.TEXTURE_2D, oe, ce2, k.width, k.height);
        }
        for (let k = 0, se2 = xe2.length; k < se2; k++) ae2 = xe2[k], Ae2 ? E && t.texSubImage2D(e.TEXTURE_2D, k, 0, 0, re2, Me, ae2) : t.texImage2D(e.TEXTURE_2D, k, ce2, re2, Me, ae2);
        r.generateMipmaps = false;
      } else if (Ae2) {
        if (Ce2) {
          const k = We2(X2);
          t.texStorage2D(e.TEXTURE_2D, oe, ce2, k.width, k.height);
        }
        E && t.texSubImage2D(e.TEXTURE_2D, 0, 0, 0, re2, Me, X2);
      } else t.texImage2D(e.TEXTURE_2D, 0, ce2, re2, Me, X2);
      s(r) && L(U2), ie.__version = te2.version, r.onUpdate && r.onUpdate(r);
    }
    u.__version = r.version;
  }
  function Ue2(u, r, A) {
    if (r.image.length !== 6) return;
    const U2 = ze2(u, r), O = r.source;
    t.bindTexture(e.TEXTURE_CUBE_MAP, u.__webglTexture, e.TEXTURE0 + A);
    const te2 = i.get(O);
    if (O.version !== te2.__version || U2 === true) {
      t.activeTexture(e.TEXTURE0 + A);
      const ie = It.getPrimaries(It.workingColorSpace), B = r.colorSpace === lr ? null : It.getPrimaries(r.colorSpace), X2 = r.colorSpace === lr || ie === B ? e.NONE : e.BROWSER_DEFAULT_WEBGL;
      t.pixelStorei(e.UNPACK_FLIP_Y_WEBGL, r.flipY), t.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL, r.premultiplyAlpha), t.pixelStorei(e.UNPACK_ALIGNMENT, r.unpackAlignment), t.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL, X2);
      const re2 = r.isCompressedTexture || r.image[0].isCompressedTexture, Me = r.image[0] && r.image[0].isDataTexture, ce2 = [];
      for (let J = 0; J < 6; J++) !re2 && !Me ? ce2[J] = f(r.image[J], true, l.maxCubemapSize) : ce2[J] = Me ? r.image[J].image : r.image[J], ce2[J] = dt2(r, ce2[J]);
      const ae2 = ce2[0], xe2 = o.convert(r.format, r.colorSpace), Ae2 = o.convert(r.type), Ce2 = h(r.internalFormat, xe2, Ae2, r.normalized, r.colorSpace), E = r.isVideoTexture !== true, oe = te2.__version === void 0 || U2 === true, k = O.dataReady;
      let se2 = m(r, ae2);
      ke2(e.TEXTURE_CUBE_MAP, r);
      let ue2;
      if (re2) {
        E && oe && t.texStorage2D(e.TEXTURE_CUBE_MAP, se2, Ce2, ae2.width, ae2.height);
        for (let J = 0; J < 6; J++) {
          ue2 = ce2[J].mipmaps;
          for (let Te2 = 0; Te2 < ue2.length; Te2++) {
            const ve2 = ue2[Te2];
            r.format !== si ? xe2 !== null ? E ? k && t.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2, 0, 0, ve2.width, ve2.height, xe2, ve2.data) : t.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2, Ce2, ve2.width, ve2.height, 0, ve2.data) : V("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()") : E ? k && t.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2, 0, 0, ve2.width, ve2.height, xe2, Ae2, ve2.data) : t.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2, Ce2, ve2.width, ve2.height, 0, xe2, Ae2, ve2.data);
          }
        }
      } else {
        if (ue2 = r.mipmaps, E && oe) {
          ue2.length > 0 && se2++;
          const J = We2(ce2[0]);
          t.texStorage2D(e.TEXTURE_CUBE_MAP, se2, Ce2, J.width, J.height);
        }
        for (let J = 0; J < 6; J++) if (Me) {
          E ? k && t.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, 0, 0, 0, ce2[J].width, ce2[J].height, xe2, Ae2, ce2[J].data) : t.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, 0, Ce2, ce2[J].width, ce2[J].height, 0, xe2, Ae2, ce2[J].data);
          for (let Te2 = 0; Te2 < ue2.length; Te2++) {
            const Ze2 = ue2[Te2].image[J].image;
            E ? k && t.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2 + 1, 0, 0, Ze2.width, Ze2.height, xe2, Ae2, Ze2.data) : t.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2 + 1, Ce2, Ze2.width, Ze2.height, 0, xe2, Ae2, Ze2.data);
          }
        } else {
          E ? k && t.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, 0, 0, 0, xe2, Ae2, ce2[J]) : t.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, 0, Ce2, xe2, Ae2, ce2[J]);
          for (let Te2 = 0; Te2 < ue2.length; Te2++) {
            const ve2 = ue2[Te2];
            E ? k && t.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2 + 1, 0, 0, xe2, Ae2, ve2.image[J]) : t.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + J, Te2 + 1, Ce2, xe2, Ae2, ve2.image[J]);
          }
        }
      }
      s(r) && L(e.TEXTURE_CUBE_MAP), te2.__version = O.version, r.onUpdate && r.onUpdate(r);
    }
    u.__version = r.version;
  }
  function me2(u, r, A, U2, O, te2) {
    const ie = o.convert(A.format, A.colorSpace), B = o.convert(A.type), X2 = h(A.internalFormat, ie, B, A.normalized, A.colorSpace), re2 = i.get(r), Me = i.get(A);
    if (Me.__renderTarget = r, !re2.__hasExternalTextures) {
      const ce2 = Math.max(1, r.width >> te2), ae2 = Math.max(1, r.height >> te2);
      O === e.TEXTURE_3D || O === e.TEXTURE_2D_ARRAY ? t.texImage3D(O, te2, X2, ce2, ae2, r.depth, 0, ie, B, null) : t.texImage2D(O, te2, X2, ce2, ae2, 0, ie, B, null);
    }
    t.bindFramebuffer(e.FRAMEBUFFER, u), at2(r) ? g.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER, U2, O, Me.__webglTexture, 0, nt(r)) : (O === e.TEXTURE_2D || O >= e.TEXTURE_CUBE_MAP_POSITIVE_X && O <= e.TEXTURE_CUBE_MAP_NEGATIVE_Z) && e.framebufferTexture2D(e.FRAMEBUFFER, U2, O, Me.__webglTexture, te2), t.bindFramebuffer(e.FRAMEBUFFER, null);
  }
  function Fe2(u, r, A) {
    if (e.bindRenderbuffer(e.RENDERBUFFER, u), r.depthBuffer) {
      const U2 = r.depthTexture, O = U2 && U2.isDepthTexture ? U2.type : null, te2 = S(r.stencilBuffer, O), ie = r.stencilBuffer ? e.DEPTH_STENCIL_ATTACHMENT : e.DEPTH_ATTACHMENT;
      at2(r) ? g.renderbufferStorageMultisampleEXT(e.RENDERBUFFER, nt(r), te2, r.width, r.height) : A ? e.renderbufferStorageMultisample(e.RENDERBUFFER, nt(r), te2, r.width, r.height) : e.renderbufferStorage(e.RENDERBUFFER, te2, r.width, r.height), e.framebufferRenderbuffer(e.FRAMEBUFFER, ie, e.RENDERBUFFER, u);
    } else {
      const U2 = r.textures;
      for (let O = 0; O < U2.length; O++) {
        const te2 = U2[O], ie = o.convert(te2.format, te2.colorSpace), B = o.convert(te2.type), X2 = h(te2.internalFormat, ie, B, te2.normalized, te2.colorSpace);
        at2(r) ? g.renderbufferStorageMultisampleEXT(e.RENDERBUFFER, nt(r), X2, r.width, r.height) : A ? e.renderbufferStorageMultisample(e.RENDERBUFFER, nt(r), X2, r.width, r.height) : e.renderbufferStorage(e.RENDERBUFFER, X2, r.width, r.height);
      }
    }
    e.bindRenderbuffer(e.RENDERBUFFER, null);
  }
  function st2(u, r, A) {
    const U2 = r.isWebGLCubeRenderTarget === true;
    if (t.bindFramebuffer(e.FRAMEBUFFER, u), !(r.depthTexture && r.depthTexture.isDepthTexture)) throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");
    const O = i.get(r.depthTexture);
    if (O.__renderTarget = r, (!O.__webglTexture || r.depthTexture.image.width !== r.width || r.depthTexture.image.height !== r.height) && (r.depthTexture.image.width = r.width, r.depthTexture.image.height = r.height, r.depthTexture.needsUpdate = true), U2) {
      if (O.__webglInit === void 0 && (O.__webglInit = true, r.depthTexture.addEventListener("dispose", D2)), O.__webglTexture === void 0) {
        O.__webglTexture = e.createTexture(), t.bindTexture(e.TEXTURE_CUBE_MAP, O.__webglTexture), ke2(e.TEXTURE_CUBE_MAP, r.depthTexture);
        const re2 = o.convert(r.depthTexture.format), Me = o.convert(r.depthTexture.type);
        let ce2;
        r.depthTexture.format === vs ? ce2 = e.DEPTH_COMPONENT24 : r.depthTexture.format === ro && (ce2 = e.DEPTH24_STENCIL8);
        for (let ae2 = 0; ae2 < 6; ae2++) e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X + ae2, 0, ce2, r.width, r.height, 0, re2, Me, null);
      }
    } else ne2(r.depthTexture, 0);
    const te2 = O.__webglTexture, ie = nt(r), B = U2 ? e.TEXTURE_CUBE_MAP_POSITIVE_X + A : e.TEXTURE_2D, X2 = r.depthTexture.format === ro ? e.DEPTH_STENCIL_ATTACHMENT : e.DEPTH_ATTACHMENT;
    if (r.depthTexture.format === vs) at2(r) ? g.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER, X2, B, te2, 0, ie) : e.framebufferTexture2D(e.FRAMEBUFFER, X2, B, te2, 0);
    else if (r.depthTexture.format === ro) at2(r) ? g.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER, X2, B, te2, 0, ie) : e.framebufferTexture2D(e.FRAMEBUFFER, X2, B, te2, 0);
    else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.");
  }
  function De2(u) {
    const r = i.get(u), A = u.isWebGLCubeRenderTarget === true;
    if (r.__boundDepthTexture !== u.depthTexture) {
      const U2 = u.depthTexture;
      if (r.__depthDisposeCallback && r.__depthDisposeCallback(), U2) {
        const O = () => {
          delete r.__boundDepthTexture, delete r.__depthDisposeCallback, U2.removeEventListener("dispose", O);
        };
        U2.addEventListener("dispose", O), r.__depthDisposeCallback = O;
      }
      r.__boundDepthTexture = U2;
    }
    if (u.depthTexture && !r.__autoAllocateDepthBuffer) if (A) for (let U2 = 0; U2 < 6; U2++) st2(r.__webglFramebuffer[U2], u, U2);
    else {
      const U2 = u.texture.mipmaps;
      U2 && U2.length > 0 ? st2(r.__webglFramebuffer[0], u, 0) : st2(r.__webglFramebuffer, u, 0);
    }
    else if (A) {
      r.__webglDepthbuffer = [];
      for (let U2 = 0; U2 < 6; U2++) if (t.bindFramebuffer(e.FRAMEBUFFER, r.__webglFramebuffer[U2]), r.__webglDepthbuffer[U2] === void 0) r.__webglDepthbuffer[U2] = e.createRenderbuffer(), Fe2(r.__webglDepthbuffer[U2], u, false);
      else {
        const O = u.stencilBuffer ? e.DEPTH_STENCIL_ATTACHMENT : e.DEPTH_ATTACHMENT, te2 = r.__webglDepthbuffer[U2];
        e.bindRenderbuffer(e.RENDERBUFFER, te2), e.framebufferRenderbuffer(e.FRAMEBUFFER, O, e.RENDERBUFFER, te2);
      }
    } else {
      const U2 = u.texture.mipmaps;
      if (U2 && U2.length > 0 ? t.bindFramebuffer(e.FRAMEBUFFER, r.__webglFramebuffer[0]) : t.bindFramebuffer(e.FRAMEBUFFER, r.__webglFramebuffer), r.__webglDepthbuffer === void 0) r.__webglDepthbuffer = e.createRenderbuffer(), Fe2(r.__webglDepthbuffer, u, false);
      else {
        const O = u.stencilBuffer ? e.DEPTH_STENCIL_ATTACHMENT : e.DEPTH_ATTACHMENT, te2 = r.__webglDepthbuffer;
        e.bindRenderbuffer(e.RENDERBUFFER, te2), e.framebufferRenderbuffer(e.FRAMEBUFFER, O, e.RENDERBUFFER, te2);
      }
    }
    t.bindFramebuffer(e.FRAMEBUFFER, null);
  }
  function Be2(u, r, A) {
    const U2 = i.get(u);
    r !== void 0 && me2(U2.__webglFramebuffer, u, u.texture, e.COLOR_ATTACHMENT0, e.TEXTURE_2D, 0), A !== void 0 && De2(u);
  }
  function qe2(u) {
    const r = u.texture, A = i.get(u), U2 = i.get(r);
    u.addEventListener("dispose", c);
    const O = u.textures, te2 = u.isWebGLCubeRenderTarget === true, ie = O.length > 1;
    if (ie || (U2.__webglTexture === void 0 && (U2.__webglTexture = e.createTexture()), U2.__version = r.version, d.memory.textures++), te2) {
      A.__webglFramebuffer = [];
      for (let B = 0; B < 6; B++) if (r.mipmaps && r.mipmaps.length > 0) {
        A.__webglFramebuffer[B] = [];
        for (let X2 = 0; X2 < r.mipmaps.length; X2++) A.__webglFramebuffer[B][X2] = e.createFramebuffer();
      } else A.__webglFramebuffer[B] = e.createFramebuffer();
    } else {
      if (r.mipmaps && r.mipmaps.length > 0) {
        A.__webglFramebuffer = [];
        for (let B = 0; B < r.mipmaps.length; B++) A.__webglFramebuffer[B] = e.createFramebuffer();
      } else A.__webglFramebuffer = e.createFramebuffer();
      if (ie) for (let B = 0, X2 = O.length; B < X2; B++) {
        const re2 = i.get(O[B]);
        re2.__webglTexture === void 0 && (re2.__webglTexture = e.createTexture(), d.memory.textures++);
      }
      if (u.samples > 0 && at2(u) === false) {
        A.__webglMultisampledFramebuffer = e.createFramebuffer(), A.__webglColorRenderbuffer = [], t.bindFramebuffer(e.FRAMEBUFFER, A.__webglMultisampledFramebuffer);
        for (let B = 0; B < O.length; B++) {
          const X2 = O[B];
          A.__webglColorRenderbuffer[B] = e.createRenderbuffer(), e.bindRenderbuffer(e.RENDERBUFFER, A.__webglColorRenderbuffer[B]);
          const re2 = o.convert(X2.format, X2.colorSpace), Me = o.convert(X2.type), ce2 = h(X2.internalFormat, re2, Me, X2.normalized, X2.colorSpace, u.isXRRenderTarget === true), ae2 = nt(u);
          e.renderbufferStorageMultisample(e.RENDERBUFFER, ae2, ce2, u.width, u.height), e.framebufferRenderbuffer(e.FRAMEBUFFER, e.COLOR_ATTACHMENT0 + B, e.RENDERBUFFER, A.__webglColorRenderbuffer[B]);
        }
        e.bindRenderbuffer(e.RENDERBUFFER, null), u.depthBuffer && (A.__webglDepthRenderbuffer = e.createRenderbuffer(), Fe2(A.__webglDepthRenderbuffer, u, true)), t.bindFramebuffer(e.FRAMEBUFFER, null);
      }
    }
    if (te2) {
      t.bindTexture(e.TEXTURE_CUBE_MAP, U2.__webglTexture), ke2(e.TEXTURE_CUBE_MAP, r);
      for (let B = 0; B < 6; B++) if (r.mipmaps && r.mipmaps.length > 0) for (let X2 = 0; X2 < r.mipmaps.length; X2++) me2(A.__webglFramebuffer[B][X2], u, r, e.COLOR_ATTACHMENT0, e.TEXTURE_CUBE_MAP_POSITIVE_X + B, X2);
      else me2(A.__webglFramebuffer[B], u, r, e.COLOR_ATTACHMENT0, e.TEXTURE_CUBE_MAP_POSITIVE_X + B, 0);
      s(r) && L(e.TEXTURE_CUBE_MAP), t.unbindTexture();
    } else if (ie) {
      for (let B = 0, X2 = O.length; B < X2; B++) {
        const re2 = O[B], Me = i.get(re2);
        let ce2 = e.TEXTURE_2D;
        (u.isWebGL3DRenderTarget || u.isWebGLArrayRenderTarget) && (ce2 = u.isWebGL3DRenderTarget ? e.TEXTURE_3D : e.TEXTURE_2D_ARRAY), t.bindTexture(ce2, Me.__webglTexture), ke2(ce2, re2), me2(A.__webglFramebuffer, u, re2, e.COLOR_ATTACHMENT0 + B, ce2, 0), s(re2) && L(ce2);
      }
      t.unbindTexture();
    } else {
      let B = e.TEXTURE_2D;
      if ((u.isWebGL3DRenderTarget || u.isWebGLArrayRenderTarget) && (B = u.isWebGL3DRenderTarget ? e.TEXTURE_3D : e.TEXTURE_2D_ARRAY), t.bindTexture(B, U2.__webglTexture), ke2(B, r), r.mipmaps && r.mipmaps.length > 0) for (let X2 = 0; X2 < r.mipmaps.length; X2++) me2(A.__webglFramebuffer[X2], u, r, e.COLOR_ATTACHMENT0, B, X2);
      else me2(A.__webglFramebuffer, u, r, e.COLOR_ATTACHMENT0, B, 0);
      s(r) && L(B), t.unbindTexture();
    }
    u.depthBuffer && De2(u);
  }
  function Ie2(u) {
    const r = u.textures;
    for (let A = 0, U2 = r.length; A < U2; A++) {
      const O = r[A];
      if (s(O)) {
        const te2 = z(u), ie = i.get(O).__webglTexture;
        t.bindTexture(te2, ie), L(te2), t.unbindTexture();
      }
    }
  }
  const et = [], ft2 = [];
  function _t2(u) {
    if (u.samples > 0) {
      if (at2(u) === false) {
        const r = u.textures, A = u.width, U2 = u.height;
        let O = e.COLOR_BUFFER_BIT;
        const te2 = u.stencilBuffer ? e.DEPTH_STENCIL_ATTACHMENT : e.DEPTH_ATTACHMENT, ie = i.get(u), B = r.length > 1;
        if (B) for (let re2 = 0; re2 < r.length; re2++) t.bindFramebuffer(e.FRAMEBUFFER, ie.__webglMultisampledFramebuffer), e.framebufferRenderbuffer(e.FRAMEBUFFER, e.COLOR_ATTACHMENT0 + re2, e.RENDERBUFFER, null), t.bindFramebuffer(e.FRAMEBUFFER, ie.__webglFramebuffer), e.framebufferTexture2D(e.DRAW_FRAMEBUFFER, e.COLOR_ATTACHMENT0 + re2, e.TEXTURE_2D, null, 0);
        t.bindFramebuffer(e.READ_FRAMEBUFFER, ie.__webglMultisampledFramebuffer);
        const X2 = u.texture.mipmaps;
        X2 && X2.length > 0 ? t.bindFramebuffer(e.DRAW_FRAMEBUFFER, ie.__webglFramebuffer[0]) : t.bindFramebuffer(e.DRAW_FRAMEBUFFER, ie.__webglFramebuffer);
        for (let re2 = 0; re2 < r.length; re2++) {
          if (u.resolveDepthBuffer && (u.depthBuffer && (O |= e.DEPTH_BUFFER_BIT), u.stencilBuffer && u.resolveStencilBuffer && (O |= e.STENCIL_BUFFER_BIT)), B) {
            e.framebufferRenderbuffer(e.READ_FRAMEBUFFER, e.COLOR_ATTACHMENT0, e.RENDERBUFFER, ie.__webglColorRenderbuffer[re2]);
            const Me = i.get(r[re2]).__webglTexture;
            e.framebufferTexture2D(e.DRAW_FRAMEBUFFER, e.COLOR_ATTACHMENT0, e.TEXTURE_2D, Me, 0);
          }
          e.blitFramebuffer(0, 0, A, U2, 0, 0, A, U2, O, e.NEAREST), R === true && (et.length = 0, ft2.length = 0, et.push(e.COLOR_ATTACHMENT0 + re2), u.depthBuffer && u.storeMultisampledDepthBuffer === false && (et.push(te2), ft2.push(te2), e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER, ft2)), e.invalidateFramebuffer(e.READ_FRAMEBUFFER, et));
        }
        if (t.bindFramebuffer(e.READ_FRAMEBUFFER, null), t.bindFramebuffer(e.DRAW_FRAMEBUFFER, null), B) for (let re2 = 0; re2 < r.length; re2++) {
          t.bindFramebuffer(e.FRAMEBUFFER, ie.__webglMultisampledFramebuffer), e.framebufferRenderbuffer(e.FRAMEBUFFER, e.COLOR_ATTACHMENT0 + re2, e.RENDERBUFFER, ie.__webglColorRenderbuffer[re2]);
          const Me = i.get(r[re2]).__webglTexture;
          t.bindFramebuffer(e.FRAMEBUFFER, ie.__webglFramebuffer), e.framebufferTexture2D(e.DRAW_FRAMEBUFFER, e.COLOR_ATTACHMENT0 + re2, e.TEXTURE_2D, Me, 0);
        }
        t.bindFramebuffer(e.DRAW_FRAMEBUFFER, ie.__webglMultisampledFramebuffer);
      } else if (u.depthBuffer && u.storeMultisampledDepthBuffer === false && R) {
        const r = u.stencilBuffer ? e.DEPTH_STENCIL_ATTACHMENT : e.DEPTH_ATTACHMENT;
        e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER, [r]);
      }
    }
  }
  function nt(u) {
    return Math.min(l.maxSamples, u.samples);
  }
  function at2(u) {
    const r = i.get(u);
    return u.samples > 0 && n.has("WEBGL_multisampled_render_to_texture") === true && r.__useRenderToTexture !== false;
  }
  function M(u) {
    const r = d.render.frame;
    H2.get(u) !== r && (H2.set(u, r), u.update());
  }
  function dt2(u, r) {
    const A = u.colorSpace, U2 = u.format, O = u.type;
    return u.isCompressedTexture === true || u.isVideoTexture === true || A !== cr && A !== lr && (It.getTransfer(A) === Cs ? (U2 !== si || O !== _s) && V("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.") : X("WebGLTextures: Unsupported texture color space:", A)), r;
  }
  function We2(u) {
    return typeof HTMLImageElement < "u" && u instanceof HTMLImageElement ? (T.width = u.naturalWidth || u.width, T.height = u.naturalHeight || u.height) : typeof VideoFrame < "u" && u instanceof VideoFrame ? (T.width = u.displayWidth, T.height = u.displayHeight) : (T.width = u.width, T.height = u.height), T;
  }
  this.allocateTextureUnit = Q, this.resetTextureUnits = q, this.getTextureUnits = P2, this.setTextureUnits = K, this.setTexture2D = ne2, this.setTexture2DArray = Z2, this.setTexture3D = j, this.setTextureCube = ee2, this.rebindTextures = Be2, this.setupRenderTarget = qe2, this.updateRenderTargetMipmap = Ie2, this.updateMultisampleRenderTarget = _t2, this.setupDepthRenderbuffer = De2, this.setupFrameBufferTexture = me2, this.useMultisampledRTT = at2, this.isReversedDepthBuffer = function() {
    return t.buffers.depth.getReversed();
  };
}
function so2(e, n) {
  function t(i, l = lr) {
    let o;
    const d = It.getTransfer(l);
    if (i === _s) return e.UNSIGNED_BYTE;
    if (i === Ka) return e.UNSIGNED_SHORT_4_4_4_4;
    if (i === to) return e.UNSIGNED_SHORT_5_5_5_1;
    if (i === eo) return e.UNSIGNED_INT_5_9_9_9_REV;
    if (i === io) return e.UNSIGNED_INT_10F_11F_11F_REV;
    if (i === Ya) return e.BYTE;
    if (i === Za) return e.SHORT;
    if (i === $a) return e.UNSIGNED_SHORT;
    if (i === Qa) return e.INT;
    if (i === Ri) return e.UNSIGNED_INT;
    if (i === Re) return e.FLOAT;
    if (i === ja) return e.HALF_FLOAT;
    if (i === so) return e.ALPHA;
    if (i === no) return e.RGB;
    if (i === si) return e.RGBA;
    if (i === vs) return e.DEPTH_COMPONENT;
    if (i === ro) return e.DEPTH_STENCIL;
    if (i === rr) return e.RED;
    if (i === ar) return e.RED_INTEGER;
    if (i === ao) return e.RG;
    if (i === oo) return e.RG_INTEGER;
    if (i === ho) return e.RGBA_INTEGER;
    if (i === lo || i === co || i === uo || i === po) if (d === Cs) if (o = n.get("WEBGL_compressed_texture_s3tc_srgb"), o !== null) {
      if (i === lo) return o.COMPRESSED_SRGB_S3TC_DXT1_EXT;
      if (i === co) return o.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;
      if (i === uo) return o.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;
      if (i === po) return o.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT;
    } else return null;
    else if (o = n.get("WEBGL_compressed_texture_s3tc"), o !== null) {
      if (i === lo) return o.COMPRESSED_RGB_S3TC_DXT1_EXT;
      if (i === co) return o.COMPRESSED_RGBA_S3TC_DXT1_EXT;
      if (i === uo) return o.COMPRESSED_RGBA_S3TC_DXT3_EXT;
      if (i === po) return o.COMPRESSED_RGBA_S3TC_DXT5_EXT;
    } else return null;
    if (i === fo || i === mo || i === yo || i === go) if (o = n.get("WEBGL_compressed_texture_pvrtc"), o !== null) {
      if (i === fo) return o.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;
      if (i === mo) return o.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;
      if (i === yo) return o.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;
      if (i === go) return o.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG;
    } else return null;
    if (i === xo || i === bo || i === Mo || i === wo || i === _o || i === vo || i === So) if (o = n.get("WEBGL_compressed_texture_etc"), o !== null) {
      if (i === xo || i === bo) return d === Cs ? o.COMPRESSED_SRGB8_ETC2 : o.COMPRESSED_RGB8_ETC2;
      if (i === Mo) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC : o.COMPRESSED_RGBA8_ETC2_EAC;
      if (i === wo) return o.COMPRESSED_R11_EAC;
      if (i === _o) return o.COMPRESSED_SIGNED_R11_EAC;
      if (i === vo) return o.COMPRESSED_RG11_EAC;
      if (i === So) return o.COMPRESSED_SIGNED_RG11_EAC;
    } else return null;
    if (i === Ao || i === To || i === Co || i === Io || i === zo || i === Bo || i === Fo || i === ko || i === Po || i === Ro || i === Oo || i === Eo || i === No || i === Lo) if (o = n.get("WEBGL_compressed_texture_astc"), o !== null) {
      if (i === Ao) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR : o.COMPRESSED_RGBA_ASTC_4x4_KHR;
      if (i === To) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR : o.COMPRESSED_RGBA_ASTC_5x4_KHR;
      if (i === Co) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR : o.COMPRESSED_RGBA_ASTC_5x5_KHR;
      if (i === Io) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR : o.COMPRESSED_RGBA_ASTC_6x5_KHR;
      if (i === zo) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR : o.COMPRESSED_RGBA_ASTC_6x6_KHR;
      if (i === Bo) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR : o.COMPRESSED_RGBA_ASTC_8x5_KHR;
      if (i === Fo) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR : o.COMPRESSED_RGBA_ASTC_8x6_KHR;
      if (i === ko) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR : o.COMPRESSED_RGBA_ASTC_8x8_KHR;
      if (i === Po) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR : o.COMPRESSED_RGBA_ASTC_10x5_KHR;
      if (i === Ro) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR : o.COMPRESSED_RGBA_ASTC_10x6_KHR;
      if (i === Oo) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR : o.COMPRESSED_RGBA_ASTC_10x8_KHR;
      if (i === Eo) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR : o.COMPRESSED_RGBA_ASTC_10x10_KHR;
      if (i === No) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR : o.COMPRESSED_RGBA_ASTC_12x10_KHR;
      if (i === Lo) return d === Cs ? o.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR : o.COMPRESSED_RGBA_ASTC_12x12_KHR;
    } else return null;
    if (i === Vo || i === Do || i === Uo) if (o = n.get("EXT_texture_compression_bptc"), o !== null) {
      if (i === Vo) return d === Cs ? o.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT : o.COMPRESSED_RGBA_BPTC_UNORM_EXT;
      if (i === Do) return o.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;
      if (i === Uo) return o.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT;
    } else return null;
    if (i === Wo || i === Go || i === Ho || i === qo) if (o = n.get("EXT_texture_compression_rgtc"), o !== null) {
      if (i === Wo) return o.COMPRESSED_RED_RGTC1_EXT;
      if (i === Go) return o.COMPRESSED_SIGNED_RED_RGTC1_EXT;
      if (i === Ho) return o.COMPRESSED_RED_GREEN_RGTC2_EXT;
      if (i === qo) return o.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT;
    } else return null;
    return i === mu ? e.UNSIGNED_INT_24_8 : e[i] !== void 0 ? e[i] : null;
  }
  return { convert: t };
}
var ld2 = `
void main() {

	gl_Position = vec4( position, 1.0 );

}`;
var cd2 = `
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;
var fd2 = class {
  constructor() {
    this.texture = null, this.mesh = null, this.depthNear = 0, this.depthFar = 0;
  }
  init(n, t) {
    if (this.texture === null) {
      const i = new zp(n.texture);
      (n.depthNear !== t.depthNear || n.depthFar !== t.depthFar) && (this.depthNear = n.depthNear, this.depthFar = n.depthFar), this.texture = i;
    }
  }
  getMesh(n) {
    if (this.texture !== null && this.mesh === null) {
      const t = n.cameras[0].viewport, i = new oa({ vertexShader: ld2, fragmentShader: cd2, uniforms: { depthColor: { value: this.texture }, depthWidth: { value: t.z }, depthHeight: { value: t.w } } });
      this.mesh = new Zt(new Wn(20, 20), i);
    }
    return this.mesh;
  }
  reset() {
    this.texture = null, this.mesh = null;
  }
  getDepthTexture() {
    return this.texture;
  }
};
var dd2 = class extends se {
  constructor(n, t) {
    super();
    const i = this;
    let l = null, o = 1, d = null, g = "local-floor", R = 1, T = null, H2 = null, I2 = null, p = null, x = null, N = null;
    const W2 = typeof XRWebGLBinding < "u", f = new fd2(), s = {}, L = t.getContextAttributes();
    let z = null, h = null;
    const S = [], m = [], D2 = new I();
    let c = null, _ = null;
    const w2 = new Dt();
    w2.viewport = new At();
    const F = new Dt();
    F.viewport = new At();
    const G2 = [w2, F], q = new kf();
    let P2 = null, K = null;
    this.cameraAutoUpdate = true, this.enabled = false, this.isPresenting = false, this.getController = function(V2) {
      let $ = S[V2];
      return $ === void 0 && ($ = new Yd(), S[V2] = $), $.getTargetRaySpace();
    }, this.getControllerGrip = function(V2) {
      let $ = S[V2];
      return $ === void 0 && ($ = new Yd(), S[V2] = $), $.getGripSpace();
    }, this.getHand = function(V2) {
      let $ = S[V2];
      return $ === void 0 && ($ = new Yd(), S[V2] = $), $.getHandSpace();
    };
    function Q(V2) {
      const $ = m.indexOf(V2.inputSource);
      if ($ === -1) return;
      const Ee2 = S[$];
      Ee2 !== void 0 && (Ee2.update(V2.inputSource, V2.frame, T || d), Ee2.dispatchEvent({ type: V2.type, data: V2.inputSource }));
    }
    function Y2() {
      l.removeEventListener("select", Q), l.removeEventListener("selectstart", Q), l.removeEventListener("selectend", Q), l.removeEventListener("squeeze", Q), l.removeEventListener("squeezestart", Q), l.removeEventListener("squeezeend", Q), l.removeEventListener("end", Y2), l.removeEventListener("inputsourceschange", ne2);
      for (let V2 = 0; V2 < S.length; V2++) {
        const $ = m[V2];
        $ !== null && (m[V2] = null, S[V2].disconnect($));
      }
      P2 = null, K = null, f.reset();
      for (const V2 in s) delete s[V2];
      if (n.setRenderTarget(z), x = null, p = null, I2 = null, l = null, h = null, ze2.stop(), i.isPresenting = false, n.setPixelRatio(c), n.setSize(D2.width, D2.height, false), _ !== null) {
        const V2 = _.camera;
        V2.fov = _.fov, V2.zoom = _.zoom, V2.updateProjectionMatrix(), _ = null;
      }
      i.dispatchEvent({ type: "sessionend" });
    }
    this.setFramebufferScaleFactor = function(V2) {
      o = V2, i.isPresenting === true && V("WebXRManager: Cannot change framebuffer scale while presenting.");
    }, this.setReferenceSpaceType = function(V2) {
      g = V2, i.isPresenting === true && V("WebXRManager: Cannot change reference space type while presenting.");
    }, this.getReferenceSpace = function() {
      return T || d;
    }, this.setReferenceSpace = function(V2) {
      T = V2;
    }, this.getBaseLayer = function() {
      return p !== null ? p : x;
    }, this.getBinding = function() {
      return I2 === null && W2 && (I2 = new XRWebGLBinding(l, t)), I2;
    }, this.getFrame = function() {
      return N;
    }, this.getSession = function() {
      return l;
    }, this.setSession = async function(V2) {
      if (l = V2, l !== null) {
        if (z = n.getRenderTarget(), l.addEventListener("select", Q), l.addEventListener("selectstart", Q), l.addEventListener("selectend", Q), l.addEventListener("squeeze", Q), l.addEventListener("squeezestart", Q), l.addEventListener("squeezeend", Q), l.addEventListener("end", Y2), l.addEventListener("inputsourceschange", ne2), L.xrCompatible !== true && await t.makeXRCompatible(), c = n.getPixelRatio(), n.getSize(D2), W2 && "createProjectionLayer" in XRWebGLBinding.prototype) {
          let Ee2 = null, Ue2 = null, me2 = null;
          L.depth && (me2 = L.stencil ? t.DEPTH24_STENCIL8 : t.DEPTH_COMPONENT24, Ee2 = L.stencil ? ro : vs, Ue2 = L.stencil ? mu : Ri);
          const Fe2 = { colorFormat: t.RGBA8, depthFormat: me2, scaleFactor: o };
          I2 = this.getBinding(), p = I2.createProjectionLayer(Fe2), l.updateRenderState({ layers: [p] }), n.setPixelRatio(1), n.setSize(p.textureWidth, p.textureHeight, false), h = new Mr(p.textureWidth, p.textureHeight, { format: si, type: _s, depthTexture: new Xh(p.textureWidth, p.textureHeight, Ue2, void 0, void 0, void 0, void 0, void 0, void 0, Ee2), stencilBuffer: L.stencil, colorSpace: n.outputColorSpace, samples: L.antialias ? 4 : 0, resolveDepthBuffer: p.ignoreDepthValues === false, resolveStencilBuffer: p.ignoreDepthValues === false, storeMultisampledDepthBuffer: p.ignoreDepthValues === false, storeMultisampledStencilBuffer: p.ignoreDepthValues === false });
        } else {
          const Ee2 = { antialias: L.antialias, alpha: true, depth: L.depth, stencil: L.stencil, framebufferScaleFactor: o };
          x = new XRWebGLLayer(l, t, Ee2), l.updateRenderState({ baseLayer: x }), n.setPixelRatio(1), n.setSize(x.framebufferWidth, x.framebufferHeight, false), h = new Mr(x.framebufferWidth, x.framebufferHeight, { format: si, type: _s, colorSpace: n.outputColorSpace, stencilBuffer: L.stencil, resolveDepthBuffer: x.ignoreDepthValues === false, resolveStencilBuffer: x.ignoreDepthValues === false, storeMultisampledDepthBuffer: x.ignoreDepthValues === false, storeMultisampledStencilBuffer: x.ignoreDepthValues === false });
        }
        h.isXRRenderTarget = true, this.setFoveation(R), T = null, d = await l.requestReferenceSpace(g), ze2.setContext(l), ze2.start(), i.isPresenting = true, i.dispatchEvent({ type: "sessionstart" });
      }
    }, this.getEnvironmentBlendMode = function() {
      if (l !== null) return l.environmentBlendMode;
    }, this.getDepthTexture = function() {
      return f.getDepthTexture();
    };
    function ne2(V2) {
      for (let $ = 0; $ < V2.removed.length; $++) {
        const Ee2 = V2.removed[$], Ue2 = m.indexOf(Ee2);
        Ue2 >= 0 && (m[Ue2] = null, S[Ue2].disconnect(Ee2));
      }
      for (let $ = 0; $ < V2.added.length; $++) {
        const Ee2 = V2.added[$];
        let Ue2 = m.indexOf(Ee2);
        if (Ue2 === -1) {
          for (let Fe2 = 0; Fe2 < S.length; Fe2++) if (Fe2 >= m.length) {
            m.push(Ee2), Ue2 = Fe2;
            break;
          } else if (m[Fe2] === null) {
            m[Fe2] = Ee2, Ue2 = Fe2;
            break;
          }
          if (Ue2 === -1) break;
        }
        const me2 = S[Ue2];
        me2 && me2.connect(Ee2);
      }
    }
    const Z2 = new w(), j = new w();
    function ee2(V2, $, Ee2) {
      Z2.setFromMatrixPosition($.matrixWorld), j.setFromMatrixPosition(Ee2.matrixWorld);
      const Ue2 = Z2.distanceTo(j), me2 = $.projectionMatrix.elements, Fe2 = Ee2.projectionMatrix.elements, st2 = me2[14] / (me2[10] - 1), De2 = me2[14] / (me2[10] + 1), Be2 = (me2[9] + 1) / me2[5], qe2 = (me2[9] - 1) / me2[5], Ie2 = (me2[8] - 1) / me2[0], et = (Fe2[8] + 1) / Fe2[0], ft2 = st2 * Ie2, _t2 = st2 * et, nt = Ue2 / (-Ie2 + et), at2 = nt * -Ie2;
      if ($.matrixWorld.decompose(V2.position, V2.quaternion, V2.scale), V2.translateX(at2), V2.translateZ(nt), V2.matrixWorld.compose(V2.position, V2.quaternion, V2.scale), V2.matrixWorldInverse.copy(V2.matrixWorld).invert(), me2[10] === -1) V2.projectionMatrix.copy($.projectionMatrix), V2.projectionMatrixInverse.copy($.projectionMatrixInverse);
      else {
        const M = st2 + nt, dt2 = De2 + nt, We2 = ft2 - at2, u = _t2 + (Ue2 - at2), r = Be2 * De2 / dt2 * M, A = qe2 * De2 / dt2 * M;
        V2.projectionMatrix.makePerspective(We2, u, r, A, M, dt2), V2.projectionMatrixInverse.copy(V2.projectionMatrix).invert();
      }
    }
    function be(V2, $) {
      $ === null ? V2.matrixWorld.copy(V2.matrix) : V2.matrixWorld.multiplyMatrices($.matrixWorld, V2.matrix), V2.matrixWorldInverse.copy(V2.matrixWorld).invert();
    }
    this.updateCamera = function(V2) {
      if (l === null) return;
      let $ = V2.near, Ee2 = V2.far;
      f.texture !== null && (f.depthNear > 0 && ($ = f.depthNear), f.depthFar > 0 && (Ee2 = f.depthFar)), q.near = F.near = w2.near = $, q.far = F.far = w2.far = Ee2, (P2 !== q.near || K !== q.far) && (l.updateRenderState({ depthNear: q.near, depthFar: q.far }), P2 = q.near, K = q.far), q.layers.mask = V2.layers.mask | 6, w2.layers.mask = q.layers.mask & -5, F.layers.mask = q.layers.mask & -3;
      const Ue2 = V2.parent, me2 = q.cameras;
      be(q, Ue2);
      for (let Fe2 = 0; Fe2 < me2.length; Fe2++) be(me2[Fe2], Ue2);
      me2.length === 2 ? ee2(q, w2, F) : q.projectionMatrix.copy(w2.projectionMatrix), _ === null && V2.isPerspectiveCamera && (_ = { camera: V2, fov: V2.fov, zoom: V2.zoom }), Re2(V2, q, Ue2);
    };
    function Re2(V2, $, Ee2) {
      Ee2 === null ? V2.matrix.copy($.matrixWorld) : (V2.matrix.copy(Ee2.matrixWorld), V2.matrix.invert(), V2.matrix.multiply($.matrixWorld)), V2.matrix.decompose(V2.position, V2.quaternion, V2.scale), V2.updateMatrixWorld(true), V2.projectionMatrix.copy($.projectionMatrix), V2.projectionMatrixInverse.copy($.projectionMatrixInverse), V2.isPerspectiveCamera && (V2.fov = ri * 2 * Math.atan(1 / V2.projectionMatrix.elements[5]), V2.zoom = 1);
    }
    this.getCamera = function() {
      return q;
    }, this.getFoveation = function() {
      if (!(p === null && x === null)) return R;
    }, this.setFoveation = function(V2) {
      R = V2, p !== null && (p.fixedFoveation = V2), x !== null && x.fixedFoveation !== void 0 && (x.fixedFoveation = V2);
    }, this.hasDepthSensing = function() {
      return f.texture !== null;
    }, this.getDepthSensingMesh = function() {
      return f.getMesh(q);
    }, this.getCameraTexture = function(V2) {
      return s[V2];
    };
    let it = null;
    function ke2(V2, $) {
      if (H2 = $.getViewerPose(T || d), N = $, H2 !== null) {
        const Ee2 = H2.views;
        x !== null && (n.setRenderTargetFramebuffer(h, x.framebuffer), n.setRenderTarget(h));
        let Ue2 = false;
        Ee2.length !== q.cameras.length && (q.cameras.length = 0, Ue2 = true);
        for (let De2 = 0; De2 < Ee2.length; De2++) {
          const Be2 = Ee2[De2];
          let qe2 = null;
          if (x !== null) qe2 = x.getViewport(Be2);
          else {
            const et = I2.getViewSubImage(p, Be2);
            qe2 = et.viewport, De2 === 0 && (n.setRenderTargetTextures(h, et.colorTexture, et.depthStencilTexture), n.setRenderTarget(h));
          }
          let Ie2 = G2[De2];
          Ie2 === void 0 && (Ie2 = new Dt(), Ie2.layers.enable(De2), Ie2.viewport = new At(), G2[De2] = Ie2), Ie2.matrix.fromArray(Be2.transform.matrix), Ie2.matrix.decompose(Ie2.position, Ie2.quaternion, Ie2.scale), Ie2.projectionMatrix.fromArray(Be2.projectionMatrix), Ie2.projectionMatrixInverse.copy(Ie2.projectionMatrix).invert(), Ie2.viewport.set(qe2.x, qe2.y, qe2.width, qe2.height), De2 === 0 && (q.matrix.copy(Ie2.matrix), q.matrix.decompose(q.position, q.quaternion, q.scale)), Ue2 === true && q.cameras.push(Ie2);
        }
        const me2 = l.enabledFeatures;
        if (me2 && me2.includes("depth-sensing") && l.depthUsage == "gpu-optimized" && W2) {
          I2 = i.getBinding();
          const De2 = I2.getDepthInformation(Ee2[0]);
          De2 && De2.isValid && De2.texture && f.init(De2, l.renderState);
        }
        if (me2 && me2.includes("camera-access") && W2) {
          n.state.unbindTexture(), I2 = i.getBinding();
          for (let De2 = 0; De2 < Ee2.length; De2++) {
            const Be2 = Ee2[De2].camera;
            if (Be2) {
              let qe2 = s[Be2];
              qe2 || (qe2 = new zp(), s[Be2] = qe2);
              const Ie2 = I2.getCameraImage(Be2);
              qe2.sourceTexture = Ie2;
            }
          }
        }
      }
      for (let Ee2 = 0; Ee2 < S.length; Ee2++) {
        const Ue2 = m[Ee2], me2 = S[Ee2];
        Ue2 !== null && me2 !== void 0 && me2.update(Ue2, $, T || d);
      }
      it && it(V2, $), $.detectedPlanes && i.dispatchEvent({ type: "planesdetected", data: $ }), N = null;
    }
    const ze2 = new Na2();
    ze2.setAnimationLoop(ke2), this.setAnimationLoop = function(V2) {
      it = V2;
    }, this.dispose = function() {
    };
  }
};
var ud = new G();
var lo2 = new Kt();
lo2.set(-1, 0, 0, 0, 1, 0, 0, 0, 1);
function pd2(e, n) {
  function t(f, s) {
    f.matrixAutoUpdate === true && f.updateMatrix(), s.value.copy(f.matrix);
  }
  function i(f, s) {
    s.color.getRGB(f.fogColor.value, af(e)), s.isFog ? (f.fogNear.value = s.near, f.fogFar.value = s.far) : s.isFogExp2 && (f.fogDensity.value = s.density);
  }
  function l(f, s, L, z, h) {
    s.isNodeMaterial ? s.uniformsNeedUpdate = false : s.isMeshBasicMaterial ? o(f, s) : s.isMeshLambertMaterial ? (o(f, s), s.envMap && (f.envMapIntensity.value = s.envMapIntensity)) : s.isMeshToonMaterial ? (o(f, s), I2(f, s)) : s.isMeshPhongMaterial ? (o(f, s), H2(f, s), s.envMap && (f.envMapIntensity.value = s.envMapIntensity)) : s.isMeshStandardMaterial ? (o(f, s), p(f, s), s.isMeshPhysicalMaterial && x(f, s, h)) : s.isMeshMatcapMaterial ? (o(f, s), N(f, s)) : s.isMeshDepthMaterial ? o(f, s) : s.isMeshDistanceMaterial ? (o(f, s), W2(f, s)) : s.isMeshNormalMaterial ? o(f, s) : s.isLineBasicMaterial ? (d(f, s), s.isLineDashedMaterial && g(f, s)) : s.isPointsMaterial ? R(f, s, L, z) : s.isSpriteMaterial ? T(f, s) : s.isShadowMaterial ? (f.color.value.copy(s.color), f.opacity.value = s.opacity) : s.isShaderMaterial && (s.uniformsNeedUpdate = false);
  }
  function o(f, s) {
    f.opacity.value = s.opacity, s.color && f.diffuse.value.copy(s.color), s.emissive && f.emissive.value.copy(s.emissive).multiplyScalar(s.emissiveIntensity), s.map && (f.map.value = s.map, t(s.map, f.mapTransform)), s.alphaMap && (f.alphaMap.value = s.alphaMap, t(s.alphaMap, f.alphaMapTransform)), s.bumpMap && (f.bumpMap.value = s.bumpMap, t(s.bumpMap, f.bumpMapTransform), f.bumpScale.value = s.bumpScale, s.side === Oa && (f.bumpScale.value *= -1)), s.normalMap && (f.normalMap.value = s.normalMap, t(s.normalMap, f.normalMapTransform), f.normalScale.value.copy(s.normalScale), s.side === Oa && f.normalScale.value.negate()), s.displacementMap && (f.displacementMap.value = s.displacementMap, t(s.displacementMap, f.displacementMapTransform), f.displacementScale.value = s.displacementScale, f.displacementBias.value = s.displacementBias), s.emissiveMap && (f.emissiveMap.value = s.emissiveMap, t(s.emissiveMap, f.emissiveMapTransform)), s.specularMap && (f.specularMap.value = s.specularMap, t(s.specularMap, f.specularMapTransform)), s.alphaTest > 0 && (f.alphaTest.value = s.alphaTest);
    const L = n.get(s), z = L.envMap, h = L.envMapRotation;
    z && (f.envMap.value = z, f.envMapRotation.value.setFromMatrix4(ud.makeRotationFromEuler(h)).transpose(), z.isCubeTexture && z.isRenderTargetTexture === false && f.envMapRotation.value.premultiply(lo2), f.reflectivity.value = s.reflectivity, f.ior.value = s.ior, f.refractionRatio.value = s.refractionRatio), s.lightMap && (f.lightMap.value = s.lightMap, f.lightMapIntensity.value = s.lightMapIntensity, t(s.lightMap, f.lightMapTransform)), s.aoMap && (f.aoMap.value = s.aoMap, f.aoMapIntensity.value = s.aoMapIntensity, t(s.aoMap, f.aoMapTransform));
  }
  function d(f, s) {
    f.diffuse.value.copy(s.color), f.opacity.value = s.opacity, s.map && (f.map.value = s.map, t(s.map, f.mapTransform));
  }
  function g(f, s) {
    f.dashSize.value = s.dashSize, f.totalSize.value = s.dashSize + s.gapSize, f.scale.value = s.scale;
  }
  function R(f, s, L, z) {
    f.diffuse.value.copy(s.color), f.opacity.value = s.opacity, f.size.value = s.size * L, f.scale.value = z * 0.5, s.map && (f.map.value = s.map, t(s.map, f.uvTransform)), s.alphaMap && (f.alphaMap.value = s.alphaMap, t(s.alphaMap, f.alphaMapTransform)), s.alphaTest > 0 && (f.alphaTest.value = s.alphaTest);
  }
  function T(f, s) {
    f.diffuse.value.copy(s.color), f.opacity.value = s.opacity, f.rotation.value = s.rotation, s.map && (f.map.value = s.map, t(s.map, f.mapTransform)), s.alphaMap && (f.alphaMap.value = s.alphaMap, t(s.alphaMap, f.alphaMapTransform)), s.alphaTest > 0 && (f.alphaTest.value = s.alphaTest);
  }
  function H2(f, s) {
    f.specular.value.copy(s.specular), f.shininess.value = Math.max(s.shininess, 1e-4);
  }
  function I2(f, s) {
    s.gradientMap && (f.gradientMap.value = s.gradientMap);
  }
  function p(f, s) {
    f.metalness.value = s.metalness, s.metalnessMap && (f.metalnessMap.value = s.metalnessMap, t(s.metalnessMap, f.metalnessMapTransform)), f.roughness.value = s.roughness, s.roughnessMap && (f.roughnessMap.value = s.roughnessMap, t(s.roughnessMap, f.roughnessMapTransform)), s.envMap && (f.envMapIntensity.value = s.envMapIntensity);
  }
  function x(f, s, L) {
    f.ior.value = s.ior, s.sheen > 0 && (f.sheenColor.value.copy(s.sheenColor).multiplyScalar(s.sheen), f.sheenRoughness.value = s.sheenRoughness, s.sheenColorMap && (f.sheenColorMap.value = s.sheenColorMap, t(s.sheenColorMap, f.sheenColorMapTransform)), s.sheenRoughnessMap && (f.sheenRoughnessMap.value = s.sheenRoughnessMap, t(s.sheenRoughnessMap, f.sheenRoughnessMapTransform))), s.clearcoat > 0 && (f.clearcoat.value = s.clearcoat, f.clearcoatRoughness.value = s.clearcoatRoughness, s.clearcoatMap && (f.clearcoatMap.value = s.clearcoatMap, t(s.clearcoatMap, f.clearcoatMapTransform)), s.clearcoatRoughnessMap && (f.clearcoatRoughnessMap.value = s.clearcoatRoughnessMap, t(s.clearcoatRoughnessMap, f.clearcoatRoughnessMapTransform)), s.clearcoatNormalMap && (f.clearcoatNormalMap.value = s.clearcoatNormalMap, t(s.clearcoatNormalMap, f.clearcoatNormalMapTransform), f.clearcoatNormalScale.value.copy(s.clearcoatNormalScale), s.side === Oa && f.clearcoatNormalScale.value.negate())), s.dispersion > 0 && (f.dispersion.value = s.dispersion), s.retroreflectivity > 0 && (f.retroreflectivity.value = s.retroreflectivity), s.iridescence > 0 && (f.iridescence.value = s.iridescence, f.iridescenceIOR.value = s.iridescenceIOR, f.iridescenceThicknessMinimum.value = s.iridescenceThicknessRange[0], f.iridescenceThicknessMaximum.value = s.iridescenceThicknessRange[1], s.iridescenceMap && (f.iridescenceMap.value = s.iridescenceMap, t(s.iridescenceMap, f.iridescenceMapTransform)), s.iridescenceThicknessMap && (f.iridescenceThicknessMap.value = s.iridescenceThicknessMap, t(s.iridescenceThicknessMap, f.iridescenceThicknessMapTransform))), s.transmission > 0 && (f.transmission.value = s.transmission, f.transmissionSamplerMap.value = L.texture, f.transmissionSamplerSize.value.set(L.width, L.height), s.transmissionMap && (f.transmissionMap.value = s.transmissionMap, t(s.transmissionMap, f.transmissionMapTransform)), f.thickness.value = s.thickness, s.thicknessMap && (f.thicknessMap.value = s.thicknessMap, t(s.thicknessMap, f.thicknessMapTransform)), f.attenuationDistance.value = s.attenuationDistance, f.attenuationColor.value.copy(s.attenuationColor)), s.anisotropy > 0 && (f.anisotropyVector.value.set(s.anisotropy * Math.cos(s.anisotropyRotation), s.anisotropy * Math.sin(s.anisotropyRotation)), s.anisotropyMap && (f.anisotropyMap.value = s.anisotropyMap, t(s.anisotropyMap, f.anisotropyMapTransform))), f.specularIntensity.value = s.specularIntensity, f.specularColor.value.copy(s.specularColor), s.specularColorMap && (f.specularColorMap.value = s.specularColorMap, t(s.specularColorMap, f.specularColorMapTransform)), s.specularIntensityMap && (f.specularIntensityMap.value = s.specularIntensityMap, t(s.specularIntensityMap, f.specularIntensityMapTransform));
  }
  function N(f, s) {
    s.matcap && (f.matcap.value = s.matcap);
  }
  function W2(f, s) {
    const L = n.get(s).light;
    f.referencePosition.value.setFromMatrixPosition(L.matrixWorld), f.nearDistance.value = L.shadow.camera.near, f.farDistance.value = L.shadow.camera.far;
  }
  return { refreshFogUniforms: i, refreshMaterialUniforms: l };
}
function hd2(e, n, t, i) {
  let l = {}, o = {}, d = [];
  const g = e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);
  function R(h, S) {
    const m = S.program;
    i.uniformBlockBinding(h, m);
  }
  function T(h, S) {
    let m = l[h.id];
    m === void 0 && (f(h), m = H2(h), l[h.id] = m, h.addEventListener("dispose", L));
    const D2 = S.program;
    i.updateUBOMapping(h, D2);
    const c = n.render.frame;
    o[h.id] !== c && (p(h), o[h.id] = c);
  }
  function H2(h) {
    const S = I2();
    h.__bindingPointIndex = S;
    const m = e.createBuffer(), D2 = h.__size, c = h.usage;
    return e.bindBuffer(e.UNIFORM_BUFFER, m), e.bufferData(e.UNIFORM_BUFFER, D2, c), e.bindBuffer(e.UNIFORM_BUFFER, null), e.bindBufferBase(e.UNIFORM_BUFFER, S, m), m;
  }
  function I2() {
    for (let h = 0; h < g; h++) if (d.indexOf(h) === -1) return d.push(h), h;
    return X("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."), 0;
  }
  function p(h) {
    const S = l[h.id], m = h.uniforms, D2 = h.__cache;
    e.bindBuffer(e.UNIFORM_BUFFER, S);
    for (let c = 0, _ = m.length; c < _; c++) {
      const w2 = m[c];
      if (Array.isArray(w2)) for (let F = 0, G2 = w2.length; F < G2; F++) x(w2[F], c, F, D2);
      else x(w2, c, 0, D2);
    }
    e.bindBuffer(e.UNIFORM_BUFFER, null);
  }
  function x(h, S, m, D2) {
    if (W2(h, S, m, D2) === true) {
      const c = h.__offset, _ = h.value;
      if (Array.isArray(_)) {
        let w2 = 0;
        for (let F = 0; F < _.length; F++) {
          const G2 = _[F], q = s(G2);
          N(G2, h.__data, w2), typeof G2 != "number" && typeof G2 != "boolean" && !G2.isMatrix3 && !ArrayBuffer.isView(G2) && (w2 += q.storage / Float32Array.BYTES_PER_ELEMENT);
        }
      } else N(_, h.__data, 0);
      e.bufferSubData(e.UNIFORM_BUFFER, c, h.__data);
    }
  }
  function N(h, S, m) {
    typeof h == "number" || typeof h == "boolean" ? S[0] = h : h.isMatrix3 ? (S[0] = h.elements[0], S[1] = h.elements[1], S[2] = h.elements[2], S[3] = 0, S[4] = h.elements[3], S[5] = h.elements[4], S[6] = h.elements[5], S[7] = 0, S[8] = h.elements[6], S[9] = h.elements[7], S[10] = h.elements[8], S[11] = 0) : ArrayBuffer.isView(h) ? S.set(new h.constructor(h.buffer, h.byteOffset, S.length)) : h.toArray(S, m);
  }
  function W2(h, S, m, D2) {
    const c = h.value, _ = S + "_" + m;
    if (D2[_] === void 0) return typeof c == "number" || typeof c == "boolean" ? D2[_] = c : ArrayBuffer.isView(c) ? D2[_] = c.slice() : D2[_] = c.clone(), true;
    {
      const w2 = D2[_];
      if (typeof c == "number" || typeof c == "boolean") {
        if (w2 !== c) return D2[_] = c, true;
      } else {
        if (ArrayBuffer.isView(c)) return true;
        if (w2.equals(c) === false) return w2.copy(c), true;
      }
    }
    return false;
  }
  function f(h) {
    const S = h.uniforms;
    let m = 0;
    const D2 = 16;
    for (let _ = 0, w2 = S.length; _ < w2; _++) {
      const F = Array.isArray(S[_]) ? S[_] : [S[_]];
      for (let G2 = 0, q = F.length; G2 < q; G2++) {
        const P2 = F[G2], K = Array.isArray(P2.value) ? P2.value : [P2.value];
        for (let Q = 0, Y2 = K.length; Q < Y2; Q++) {
          const ne2 = K[Q], Z2 = s(ne2), j = m % D2, ee2 = j % Z2.boundary, be = j + ee2;
          m += ee2, be !== 0 && D2 - be < Z2.storage && (m += D2 - be), P2.__data = new Float32Array(Z2.storage / Float32Array.BYTES_PER_ELEMENT), P2.__offset = m, m += Z2.storage;
        }
      }
    }
    const c = m % D2;
    return c > 0 && (m += D2 - c), h.__size = m, h.__cache = {}, this;
  }
  function s(h) {
    const S = { boundary: 0, storage: 0 };
    return typeof h == "number" || typeof h == "boolean" ? (S.boundary = 4, S.storage = 4) : h.isVector2 ? (S.boundary = 8, S.storage = 8) : h.isVector3 || h.isColor ? (S.boundary = 16, S.storage = 12) : h.isVector4 ? (S.boundary = 16, S.storage = 16) : h.isMatrix3 ? (S.boundary = 48, S.storage = 48) : h.isMatrix4 ? (S.boundary = 64, S.storage = 64) : h.isTexture ? V("WebGLRenderer: Texture samplers can not be part of an uniforms group.") : ArrayBuffer.isView(h) ? (S.boundary = 16, S.storage = h.byteLength) : V("WebGLRenderer: Unsupported uniform value type.", h), S;
  }
  function L(h) {
    const S = h.target;
    S.removeEventListener("dispose", L);
    const m = d.indexOf(S.__bindingPointIndex);
    d.splice(m, 1), e.deleteBuffer(l[S.id]), delete l[S.id], delete o[S.id];
  }
  function z() {
    for (const h in l) e.deleteBuffer(l[h]);
    d = [], l = {}, o = {};
  }
  return { bind: R, update: T, dispose: z };
}
var md = new Uint16Array([12469, 15057, 12620, 14925, 13266, 14620, 13807, 14376, 14323, 13990, 14545, 13625, 14713, 13328, 14840, 12882, 14931, 12528, 14996, 12233, 15039, 11829, 15066, 11525, 15080, 11295, 15085, 10976, 15082, 10705, 15073, 10495, 13880, 14564, 13898, 14542, 13977, 14430, 14158, 14124, 14393, 13732, 14556, 13410, 14702, 12996, 14814, 12596, 14891, 12291, 14937, 11834, 14957, 11489, 14958, 11194, 14943, 10803, 14921, 10506, 14893, 10278, 14858, 9960, 14484, 14039, 14487, 14025, 14499, 13941, 14524, 13740, 14574, 13468, 14654, 13106, 14743, 12678, 14818, 12344, 14867, 11893, 14889, 11509, 14893, 11180, 14881, 10751, 14852, 10428, 14812, 10128, 14765, 9754, 14712, 9466, 14764, 13480, 14764, 13475, 14766, 13440, 14766, 13347, 14769, 13070, 14786, 12713, 14816, 12387, 14844, 11957, 14860, 11549, 14868, 11215, 14855, 10751, 14825, 10403, 14782, 10044, 14729, 9651, 14666, 9352, 14599, 9029, 14967, 12835, 14966, 12831, 14963, 12804, 14954, 12723, 14936, 12564, 14917, 12347, 14900, 11958, 14886, 11569, 14878, 11247, 14859, 10765, 14828, 10401, 14784, 10011, 14727, 9600, 14660, 9289, 14586, 8893, 14508, 8533, 15111, 12234, 15110, 12234, 15104, 12216, 15092, 12156, 15067, 12010, 15028, 11776, 14981, 11500, 14942, 11205, 14902, 10752, 14861, 10393, 14812, 9991, 14752, 9570, 14682, 9252, 14603, 8808, 14519, 8445, 14431, 8145, 15209, 11449, 15208, 11451, 15202, 11451, 15190, 11438, 15163, 11384, 15117, 11274, 15055, 10979, 14994, 10648, 14932, 10343, 14871, 9936, 14803, 9532, 14729, 9218, 14645, 8742, 14556, 8381, 14461, 8020, 14365, 7603, 15273, 10603, 15272, 10607, 15267, 10619, 15256, 10631, 15231, 10614, 15182, 10535, 15118, 10389, 15042, 10167, 14963, 9787, 14883, 9447, 14800, 9115, 14710, 8665, 14615, 8318, 14514, 7911, 14411, 7507, 14279, 7198, 15314, 9675, 15313, 9683, 15309, 9712, 15298, 9759, 15277, 9797, 15229, 9773, 15166, 9668, 15084, 9487, 14995, 9274, 14898, 8910, 14800, 8539, 14697, 8234, 14590, 7790, 14479, 7409, 14367, 7067, 14178, 6621, 15337, 8619, 15337, 8631, 15333, 8677, 15325, 8769, 15305, 8871, 15264, 8940, 15202, 8909, 15119, 8775, 15022, 8565, 14916, 8328, 14804, 8009, 14688, 7614, 14569, 7287, 14448, 6888, 14321, 6483, 14088, 6171, 15350, 7402, 15350, 7419, 15347, 7480, 15340, 7613, 15322, 7804, 15287, 7973, 15229, 8057, 15148, 8012, 15046, 7846, 14933, 7611, 14810, 7357, 14682, 7069, 14552, 6656, 14421, 6316, 14251, 5948, 14007, 5528, 15356, 5942, 15356, 5977, 15353, 6119, 15348, 6294, 15332, 6551, 15302, 6824, 15249, 7044, 15171, 7122, 15070, 7050, 14949, 6861, 14818, 6611, 14679, 6349, 14538, 6067, 14398, 5651, 14189, 5311, 13935, 4958, 15359, 4123, 15359, 4153, 15356, 4296, 15353, 4646, 15338, 5160, 15311, 5508, 15263, 5829, 15188, 6042, 15088, 6094, 14966, 6001, 14826, 5796, 14678, 5543, 14527, 5287, 14377, 4985, 14133, 4586, 13869, 4257, 15360, 1563, 15360, 1642, 15358, 2076, 15354, 2636, 15341, 3350, 15317, 4019, 15273, 4429, 15203, 4732, 15105, 4911, 14981, 4932, 14836, 4818, 14679, 4621, 14517, 4386, 14359, 4156, 14083, 3795, 13808, 3437, 15360, 122, 15360, 137, 15358, 285, 15355, 636, 15344, 1274, 15322, 2177, 15281, 2765, 15215, 3223, 15120, 3451, 14995, 3569, 14846, 3567, 14681, 3466, 14511, 3305, 14344, 3121, 14037, 2800, 13753, 2467, 15360, 0, 15360, 1, 15359, 21, 15355, 89, 15346, 253, 15325, 479, 15287, 796, 15225, 1148, 15133, 1492, 15008, 1749, 14856, 1882, 14685, 1886, 14506, 1783, 14324, 1608, 13996, 1398, 13702, 1183]);
var Nt2 = null;
function _d() {
  return Nt2 === null && (Nt2 = new $t(md, 16, 16, ao, ja), Nt2.name = "DFG_LUT", Nt2.minFilter = Ut, Nt2.magFilter = Ut, Nt2.wrapS = Ht, Nt2.wrapT = Ht, Nt2.generateMipmaps = false, Nt2.needsUpdate = true), Nt2;
}
var gd2 = class {
  constructor(n = {}) {
    const { canvas: t = dd(), context: i = null, depth: l = true, stencil: o = false, alpha: d = false, antialias: g = false, premultipliedAlpha: R = true, preserveDrawingBuffer: T = false, powerPreference: H2 = "default", failIfMajorPerformanceCaveat: I2 = false, reversedDepthBuffer: p = false, outputBufferType: x = _s } = n;
    this.isWebGLRenderer = true;
    let N;
    if (i !== null) {
      if (typeof WebGLRenderingContext < "u" && i instanceof WebGLRenderingContext) throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");
      N = i.getContextAttributes().alpha;
    } else N = d;
    const W2 = x, f = /* @__PURE__ */ new Set([ho, oo, ar]), s = /* @__PURE__ */ new Set([_s, Ri, $a, mu, Ka, to]), L = new Uint32Array(4), z = new Int32Array(4), h = new w();
    let S = null, m = null;
    const D2 = [], c = [];
    let _ = null;
    this.domElement = t, this.debug = { checkShaderErrors: true, diagnostics: { keywords: false }, onShaderError: null }, this.autoClear = true, this.autoClearColor = true, this.autoClearDepth = true, this.autoClearStencil = true, this.sortObjects = true, this.clippingPlanes = [], this.localClippingEnabled = false, this.toneMapping = su, this.toneMappingExposure = 1, this.transmissionResolutionScale = 1;
    const w2 = this;
    let F = false, G2 = null, q = null, P2 = null, K = null;
    this._outputColorSpace = Et;
    let Q = 0, Y2 = 0, ne2 = null, Z2 = -1, j = null;
    const ee2 = new At(), be = new At();
    let Re2 = null;
    const it = new U(0);
    let ke2 = 0, ze2 = t.width, V2 = t.height, $ = 1, Ee2 = null, Ue2 = null;
    const me2 = new At(0, 0, ze2, V2), Fe2 = new At(0, 0, ze2, V2);
    let st2 = false;
    const De2 = new $i();
    let Be2 = false, qe2 = false;
    const Ie2 = new G(), et = new w(), ft2 = new At(), _t2 = { background: null, fog: null, environment: null, overrideMaterial: null, isScene: true };
    let nt = false;
    function at2() {
      return ne2 === null ? $ : 1;
    }
    let M = i;
    function dt2(a, v) {
      return t.getContext(a, v);
    }
    let We2, u, r, A, U2, O, te2, ie, B, X2, re2, Me, ce2, ae2, xe2, Ae2, Ce2, E, oe, k, se2, ue2, J;
    try {
      const a = { alpha: true, depth: l, stencil: o, antialias: g, premultipliedAlpha: R, preserveDrawingBuffer: T, powerPreference: H2, failIfMajorPerformanceCaveat: I2 };
      if ("setAttribute" in t && t.setAttribute("data-engine", `three.js r${Mc}`), t.addEventListener("webglcontextlost", Ze2, false), t.addEventListener("webglcontextrestored", Ge2, false), t.addEventListener("webglcontextcreationerror", xt2, false), M === null) {
        const v = "webgl2";
        if (M = dt2(v, a), M === null) throw dt2(v) ? new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.") : new Error("THREE.WebGLRenderer: Error creating WebGL context.");
      }
      Te2();
    } catch (a) {
      throw t.removeEventListener("webglcontextlost", Ze2, false), t.removeEventListener("webglcontextrestored", Ge2, false), t.removeEventListener("webglcontextcreationerror", xt2, false), X("WebGLRenderer: " + a.message), a;
    }
    function Te2() {
      We2 = new _c2(M), We2.init(), se2 = new so2(M, We2), u = new oc2(M, We2, n, se2), r = new od2(M, We2), u.reversedDepthBuffer && p && r.buffers.depth.setReversed(true), q = M.createFramebuffer(), P2 = M.createFramebuffer(), K = M.createFramebuffer(), A = new Sc2(M), U2 = new Kf2(), O = new sd2(M, We2, r, U2, u, se2, A), te2 = new mc2(w2), ie = new Mo2(M), ue2 = new rc2(M, ie), B = new gc2(M, ie, A, ue2), X2 = new Mc2(M, B, ie, ue2, A), E = new Ec2(M, u, O), xe2 = new sc2(U2), re2 = new Xf2(w2, te2, We2, u, ue2, xe2), Me = new pd2(w2, U2), ce2 = new qf2(), ae2 = new ed2(We2), Ce2 = new ic2(w2, te2, r, X2, N, R), Ae2 = new ad2(w2, X2, u), J = new hd2(M, A, u, r), oe = new ac(M, We2, A), k = new vc2(M, We2, A), A.programs = re2.programs, w2.capabilities = u, w2.extensions = We2, w2.properties = U2, w2.renderLists = ce2, w2.shadowMap = Ae2, w2.state = r, w2.info = A;
    }
    W2 !== _s && (_ = new Tc2(W2, t.width, t.height, g, l, o));
    const ve2 = new dd2(w2, M);
    this.xr = ve2, this.getContext = function() {
      return M;
    }, this.getContextAttributes = function() {
      return M.getContextAttributes();
    }, this.forceContextLoss = function() {
      const a = We2.get("WEBGL_lose_context");
      a && a.loseContext();
    }, this.forceContextRestore = function() {
      const a = We2.get("WEBGL_lose_context");
      a && a.restoreContext();
    }, this.getPixelRatio = function() {
      return $;
    }, this.setPixelRatio = function(a) {
      a !== void 0 && ($ = a, this.setSize(ze2, V2, false));
    }, this.getSize = function(a) {
      return a.set(ze2, V2);
    }, this.setSize = function(a, v, y = true) {
      if (ve2.isPresenting) {
        V("WebGLRenderer: Can't change size while VR device is presenting.");
        return;
      }
      ze2 = a, V2 = v, t.width = Math.floor(a * $), t.height = Math.floor(v * $), y === true && (t.style.width = a + "px", t.style.height = v + "px"), _ !== null && _.setSize(t.width, t.height), this.setViewport(0, 0, a, v);
    }, this.getDrawingBufferSize = function(a) {
      return a.set(ze2 * $, V2 * $).floor();
    }, this.setDrawingBufferSize = function(a, v, y) {
      ze2 = a, V2 = v, $ = y, t.width = Math.floor(a * y), t.height = Math.floor(v * y), this.setViewport(0, 0, a, v);
    }, this.setEffects = function(a) {
      if (W2 === _s) {
        X("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");
        return;
      }
      if (a) {
        for (let v = 0; v < a.length; v++) if (a[v].isOutputPass === true) {
          V("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");
          break;
        }
      }
      _.setEffects(a || []);
    }, this.getCurrentViewport = function(a) {
      return a.copy(ee2);
    }, this.getViewport = function(a) {
      return a.copy(me2);
    }, this.setViewport = function(a, v, y, b) {
      a.isVector4 ? me2.set(a.x, a.y, a.z, a.w) : me2.set(a, v, y, b), r.viewport(ee2.copy(me2).multiplyScalar($).round());
    }, this.getScissor = function(a) {
      return a.copy(Fe2);
    }, this.setScissor = function(a, v, y, b) {
      a.isVector4 ? Fe2.set(a.x, a.y, a.z, a.w) : Fe2.set(a, v, y, b), r.scissor(be.copy(Fe2).multiplyScalar($).round());
    }, this.getScissorTest = function() {
      return st2;
    }, this.setScissorTest = function(a) {
      r.setScissorTest(st2 = a);
    }, this.setOpaqueSort = function(a) {
      Ee2 = a;
    }, this.setTransparentSort = function(a) {
      Ue2 = a;
    }, this.getClearColor = function(a) {
      return a.copy(Ce2.getClearColor());
    }, this.setClearColor = function() {
      Ce2.setClearColor(...arguments);
    }, this.getClearAlpha = function() {
      return Ce2.getClearAlpha();
    }, this.setClearAlpha = function() {
      Ce2.setClearAlpha(...arguments);
    }, this.clear = function(a = true, v = true, y = true) {
      let b = 0;
      if (a) {
        let C = false;
        if (ne2 !== null) {
          const de2 = ne2.texture.format;
          C = f.has(de2);
        }
        if (C) {
          const de2 = ne2.texture.type, he = s.has(de2), fe2 = Ce2.getClearColor(), _e2 = Ce2.getClearAlpha(), Se2 = fe2.r, Le2 = fe2.g, we2 = fe2.b;
          he ? (L[0] = Se2, L[1] = Le2, L[2] = we2, L[3] = _e2, M.clearBufferuiv(M.COLOR, 0, L)) : (z[0] = Se2, z[1] = Le2, z[2] = we2, z[3] = _e2, M.clearBufferiv(M.COLOR, 0, z));
        } else b |= M.COLOR_BUFFER_BIT;
      }
      v && (b |= M.DEPTH_BUFFER_BIT, this.state.buffers.depth.setMask(true)), y && (b |= M.STENCIL_BUFFER_BIT, this.state.buffers.stencil.setMask(4294967295)), b !== 0 && M.clear(b);
    }, this.clearColor = function() {
      this.clear(true, false, false);
    }, this.clearDepth = function() {
      this.clear(false, true, false);
    }, this.clearStencil = function() {
      this.clear(false, false, true);
    }, this.setNodesHandler = function(a) {
      a.setRenderer(this), G2 = a;
    }, this.dispose = function() {
      t.removeEventListener("webglcontextlost", Ze2, false), t.removeEventListener("webglcontextrestored", Ge2, false), t.removeEventListener("webglcontextcreationerror", xt2, false), Ce2.dispose(), ce2.dispose(), ae2.dispose(), U2.dispose(), te2.dispose(), X2.dispose(), ue2.dispose(), J.dispose(), re2.dispose(), ve2.dispose(), ve2.removeEventListener("sessionstart", sr2), ve2.removeEventListener("sessionend", lr2), Vt2.stop();
    };
    function Ze2(a) {
      a.preventDefault(), pr("WebGLRenderer: Context Lost."), F = true;
    }
    function Ge2() {
      pr("WebGLRenderer: Context Restored."), F = false;
      const a = A.autoReset, v = Ae2.enabled, y = Ae2.autoUpdate, b = Ae2.needsUpdate, C = Ae2.type;
      Te2(), A.autoReset = a, Ae2.enabled = v, Ae2.autoUpdate = y, Ae2.needsUpdate = b, Ae2.type = C;
    }
    function xt2(a) {
      X("WebGLRenderer: A WebGL context could not be created. Reason: ", a.statusMessage);
    }
    function bt(a) {
      const v = a.target;
      v.removeEventListener("dispose", bt), co2(v);
    }
    function co2(a) {
      fo2(a), U2.remove(a);
    }
    function fo2(a) {
      const v = U2.get(a).programs;
      v !== void 0 && (v.forEach(function(y) {
        re2.releaseProgram(y);
      }), a.isShaderMaterial && re2.releaseShaderCache(a));
    }
    this.renderBufferDirect = function(a, v, y, b, C, de2) {
      v === null && (v = _t2);
      const he = C.isMesh && C.matrixWorld.determinantAffine() < 0, fe2 = ho2(a, v, y, b, C);
      r.setMaterial(b, he);
      let _e2 = y.index, Se2 = 1;
      if (b.wireframe === true) {
        if (_e2 = B.getWireframeAttribute(y), _e2 === void 0) return;
        Se2 = 2;
      }
      const Le2 = y.drawRange, we2 = y.attributes.position;
      let ge = Le2.start * Se2, He2 = (Le2.start + Le2.count) * Se2;
      de2 !== null && (ge = Math.max(ge, de2.start * Se2), He2 = Math.min(He2, (de2.start + de2.count) * Se2)), _e2 !== null ? (ge = Math.max(ge, 0), He2 = Math.min(He2, _e2.count)) : we2 != null && (ge = Math.max(ge, 0), He2 = Math.min(He2, we2.count));
      const ot2 = He2 - ge;
      if (ot2 < 0 || ot2 === 1 / 0) return;
      ue2.setup(C, b, fe2, y, _e2);
      let Je, Ke2 = oe;
      if (_e2 !== null && (Je = ie.get(_e2), Ke2 = k, Ke2.setIndex(Je)), C.isMesh) b.wireframe === true ? (r.setLineWidth(b.wireframeLinewidth * at2()), Ke2.setMode(M.LINES)) : Ke2.setMode(M.TRIANGLES);
      else if (C.isLine) {
        let ut = b.linewidth;
        ut === void 0 && (ut = 1), r.setLineWidth(ut * at2()), C.isLineSegments ? Ke2.setMode(M.LINES) : C.isLineLoop ? Ke2.setMode(M.LINE_LOOP) : Ke2.setMode(M.LINE_STRIP);
      } else C.isPoints ? Ke2.setMode(M.POINTS) : C.isSprite && Ke2.setMode(M.TRIANGLES);
      if (C.isBatchedMesh) if (We2.get("WEBGL_multi_draw")) Ke2.renderMultiDraw(C._multiDrawStarts, C._multiDrawCounts, C._multiDrawCount);
      else {
        const ut = C._multiDrawStarts, pe2 = C._multiDrawCounts, pt2 = C._multiDrawCount, Oe2 = _e2 ? ie.get(_e2).bytesPerElement : 1, Et2 = U2.get(b).currentProgram.getUniforms();
        for (let Ct2 = 0; Ct2 < pt2; Ct2++) Et2.setValue(M, "_gl_DrawID", Ct2), Ke2.render(ut[Ct2] / Oe2, pe2[Ct2]);
      }
      else if (C.isInstancedMesh) Ke2.renderInstances(ge, ot2, C.count);
      else if (y.isInstancedBufferGeometry) {
        const ut = y._maxInstanceCount !== void 0 ? y._maxInstanceCount : 1 / 0, pe2 = Math.min(y.instanceCount, ut);
        Ke2.renderInstances(ge, ot2, pe2);
      } else Ke2.render(ge, ot2);
    };
    function or2(a, v, y, b) {
      G2 !== null && a.isNodeMaterial && G2.setObject(b, a), Be2 === true && xe2.setState(a, y, false), a.transparent === true && a.side === Fc && a.forceSinglePass === false ? (a.side = Oa, a.needsUpdate = true, Sn(a, v, b), a.side = $n, a.needsUpdate = true, Sn(a, v, b), a.side = Fc) : Sn(a, v, b);
    }
    this.compile = function(a, v, y = null) {
      y === null && (y = a), G2 !== null && G2.renderStart(a, v, y), m = ae2.get(y), m.init(v), c.push(m), y.traverseVisible(function(C) {
        C.isLight && C.layers.test(v.layers) && (m.pushLight(C), C.castShadow && m.pushShadow(C));
      }), a !== y && a.traverseVisible(function(C) {
        C.isLight && C.layers.test(v.layers) && (m.pushLight(C), C.castShadow && m.pushShadow(C));
      }), m.setupLights(), G2 !== null && G2.updateLights(m.state.lightsArray), qe2 = this.localClippingEnabled, Be2 = xe2.init(this.clippingPlanes, qe2), Be2 === true && xe2.setGlobalState(this.clippingPlanes, v), G2 !== null && Ae2.render(m.state.shadowsArray, y, v);
      const b = /* @__PURE__ */ new Set();
      return a.traverse(function(C) {
        if (!(C.isMesh || C.isPoints || C.isLine || C.isSprite)) return;
        const de2 = C.material;
        if (de2) if (Array.isArray(de2)) for (let he = 0; he < de2.length; he++) {
          const fe2 = de2[he];
          or2(fe2, y, v, C), b.add(fe2);
        }
        else or2(de2, y, v, C), b.add(de2);
      }), m = c.pop(), G2 !== null && G2.renderEnd(), b;
    }, this.compileAsync = function(a, v, y = null) {
      const b = this.compile(a, v, y);
      return new Promise((C) => {
        function de2() {
          if (b.forEach(function(he) {
            const _e2 = U2.get(he).currentProgram;
            (_e2 === void 0 || _e2.isReady()) && b.delete(he);
          }), b.size === 0) {
            C(a);
            return;
          }
          setTimeout(de2, 10);
        }
        We2.get("KHR_parallel_shader_compile") !== null ? de2() : setTimeout(de2, 10);
      });
    };
    let Hn2 = null;
    function uo2(a) {
      Hn2 && Hn2(a);
    }
    function sr2() {
      Vt2.stop();
    }
    function lr2() {
      Vt2.start();
    }
    const Vt2 = new Na2();
    Vt2.setAnimationLoop(uo2), typeof self < "u" && Vt2.setContext(self), this.setAnimationLoop = function(a) {
      Hn2 = a, ve2.setAnimationLoop(a), a === null ? Vt2.stop() : Vt2.start();
    }, ve2.addEventListener("sessionstart", sr2), ve2.addEventListener("sessionend", lr2), this.render = function(a, v) {
      if (v !== void 0 && v.isCamera !== true) {
        X("WebGLRenderer.render: camera is not an instance of THREE.Camera.");
        return;
      }
      if (F === true) return;
      G2 !== null && G2.renderStart(a, v);
      const y = ve2.enabled === true && ve2.isPresenting === true, b = _ !== null && (ne2 === null || y) && _.begin(w2, ne2);
      if (a.matrixWorldAutoUpdate === true && a.updateMatrixWorld(), v.parent === null && v.matrixWorldAutoUpdate === true && v.updateMatrixWorld(), ve2.enabled === true && ve2.isPresenting === true && (_ === null || _.isCompositing() === false) && (ve2.cameraAutoUpdate === true && ve2.updateCamera(v), v = ve2.getCamera()), a.isScene === true && a.onBeforeRender(w2, a, v, ne2), m = ae2.get(a, c.length), m.init(v), m.state.textureUnits = O.getTextureUnits(), c.push(m), Ie2.multiplyMatrices(v.projectionMatrix, v.matrixWorldInverse), De2.setFromProjectionMatrix(Ie2, qt, v.reversedDepth), qe2 = this.localClippingEnabled, Be2 = xe2.init(this.clippingPlanes, qe2), S = ce2.get(a, D2.length), S.init(), D2.push(S), ve2.enabled === true && ve2.isPresenting === true) {
        const he = w2.xr.getDepthSensingMesh();
        he !== null && Vn2(he, v, -1 / 0, w2.sortObjects);
      }
      Vn2(a, v, 0, w2.sortObjects), S.finish(), G2 !== null && G2.updateLights(m.state.lightsArray), w2.sortObjects === true && S.sort(Ee2, Ue2), nt = ve2.enabled === false || ve2.isPresenting === false || ve2.hasDepthSensing() === false, nt && Ce2.addToRenderList(S, a), this.info.render.frame++, this.info.autoReset === true && this.info.reset(), Be2 === true && xe2.beginShadows();
      const C = m.state.shadowsArray;
      if (Ae2.render(C, a, v), Be2 === true && xe2.endShadows(), (b && _.hasRenderPass()) === false) {
        const he = S.opaque, fe2 = S.transmissive;
        if (m.setupLights(), v.isArrayCamera) {
          const _e2 = v.cameras;
          if (fe2.length > 0) for (let Se2 = 0, Le2 = _e2.length; Se2 < Le2; Se2++) {
            const we2 = _e2[Se2];
            fr2(he, fe2, a, we2);
          }
          nt && Ce2.render(a);
          for (let Se2 = 0, Le2 = _e2.length; Se2 < Le2; Se2++) {
            const we2 = _e2[Se2];
            cr2(S, a, we2, we2.viewport);
          }
        } else fe2.length > 0 && fr2(he, fe2, a, v), nt && Ce2.render(a), cr2(S, a, v);
      }
      ne2 !== null && Y2 === 0 && (O.updateMultisampleRenderTarget(ne2), O.updateRenderTargetMipmap(ne2)), b && _.end(w2), a.isScene === true && a.onAfterRender(w2, a, v), ue2.resetDefaultState(), Z2 = -1, j = null, c.pop(), c.length > 0 ? (m = c[c.length - 1], O.setTextureUnits(m.state.textureUnits), Be2 === true && xe2.setGlobalState(w2.clippingPlanes, m.state.camera)) : m = null, D2.pop(), D2.length > 0 ? S = D2[D2.length - 1] : S = null, G2 !== null && G2.renderEnd();
    };
    function Vn2(a, v, y, b) {
      if (a.visible === false) return;
      if (a.layers.test(v.layers)) {
        if (a.isGroup) y = a.renderOrder;
        else if (a.isLOD) a.autoUpdate === true && a.update(v);
        else if (a.isLightProbeGrid) m.pushLightProbeGrid(a);
        else if (a.isLight) m.pushLight(a), a.castShadow && m.pushShadow(a);
        else if (a.isSprite) {
          if (!a.frustumCulled || a.intersectsFrustum(De2)) {
            b && ft2.setFromMatrixPosition(a.matrixWorld).applyMatrix4(Ie2);
            const he = X2.update(a), fe2 = a.material;
            fe2.visible && S.push(a, he, fe2, y, ft2.z, null, v);
          }
        } else if ((a.isMesh || a.isLine || a.isPoints) && (!a.frustumCulled || a.intersectsFrustum(De2))) {
          const he = X2.update(a), fe2 = a.material;
          if (b && (a.boundingSphere !== void 0 ? (a.boundingSphere === null && a.computeBoundingSphere(), ft2.copy(a.boundingSphere.center)) : (he.boundingSphere === null && he.computeBoundingSphere(), ft2.copy(he.boundingSphere.center)), ft2.applyMatrix4(a.matrixWorld).applyMatrix4(Ie2)), Array.isArray(fe2)) {
            const _e2 = he.groups;
            for (let Se2 = 0, Le2 = _e2.length; Se2 < Le2; Se2++) {
              const we2 = _e2[Se2], ge = fe2[we2.materialIndex];
              ge && ge.visible && S.push(a, he, ge, y, ft2.z, we2, v);
            }
          } else fe2.visible && S.push(a, he, fe2, y, ft2.z, null, v);
        }
      }
      const de2 = a.children;
      for (let he = 0, fe2 = de2.length; he < fe2; he++) Vn2(de2[he], v, y, b);
    }
    function cr2(a, v, y, b) {
      const { opaque: C, transmissive: de2, transparent: he } = a;
      m.setupLightsView(y), Be2 === true && xe2.setGlobalState(w2.clippingPlanes, y), b && r.viewport(ee2.copy(b)), C.length > 0 && vn2(C, v, y), de2.length > 0 && vn2(de2, v, y), he.length > 0 && vn2(he, v, y), r.buffers.depth.setTest(true), r.buffers.depth.setMask(true), r.buffers.color.setMask(true), r.setPolygonOffset(false);
    }
    function fr2(a, v, y, b) {
      if ((y.isScene === true ? y.overrideMaterial : null) !== null) return;
      if (m.state.transmissionRenderTarget[b.id] === void 0) {
        const ge = We2.has("EXT_color_buffer_half_float") || We2.has("EXT_color_buffer_float");
        m.state.transmissionRenderTarget[b.id] = new Mr(1, 1, { generateMipmaps: true, type: ge ? ja : _s, minFilter: ws, samples: Math.max(4, u.samples), stencilBuffer: o, resolveDepthBuffer: false, resolveStencilBuffer: false, storeMultisampledDepthBuffer: false, storeMultisampledStencilBuffer: false, colorSpace: It.workingColorSpace });
      }
      const de2 = m.state.transmissionRenderTarget[b.id], he = b.viewport || ee2;
      de2.setSize(he.z * w2.transmissionResolutionScale, he.w * w2.transmissionResolutionScale);
      const fe2 = w2.getRenderTarget(), _e2 = w2.getActiveCubeFace(), Se2 = w2.getActiveMipmapLevel();
      w2.setRenderTarget(de2), w2.getClearColor(it), ke2 = w2.getClearAlpha(), ke2 < 1 && w2.setClearColor(16777215, 0.5), w2.clear(), nt && Ce2.render(y);
      const Le2 = w2.toneMapping;
      w2.toneMapping = su;
      const we2 = b.viewport;
      if (b.viewport !== void 0 && (b.viewport = void 0), m.setupLightsView(b), Be2 === true && xe2.setGlobalState(w2.clippingPlanes, b), vn2(a, y, b), O.updateMultisampleRenderTarget(de2), O.updateRenderTargetMipmap(de2), We2.has("WEBGL_multisampled_render_to_texture") === false) {
        let ge = false;
        for (let He2 = 0, ot2 = v.length; He2 < ot2; He2++) {
          const Je = v[He2], { object: Ke2, geometry: ut, material: pe2, group: pt2 } = Je;
          if (pe2.side === Fc && Ke2.layers.test(b.layers)) {
            const Oe2 = pe2.side;
            pe2.side = Oa, pe2.needsUpdate = true, dr2(Ke2, y, b, ut, pe2, pt2), pe2.side = Oe2, pe2.needsUpdate = true, ge = true;
          }
        }
        ge === true && (O.updateMultisampleRenderTarget(de2), O.updateRenderTargetMipmap(de2));
      }
      w2.setRenderTarget(fe2, _e2, Se2), w2.setClearColor(it, ke2), we2 !== void 0 && (b.viewport = we2), w2.toneMapping = Le2;
    }
    function vn2(a, v, y) {
      const b = v.isScene === true ? v.overrideMaterial : null;
      for (let C = 0, de2 = a.length; C < de2; C++) {
        const he = a[C], { object: fe2, geometry: _e2, group: Se2 } = he;
        let Le2 = he.material;
        Le2.allowOverride === true && b !== null && (Le2 = b), fe2.layers.test(y.layers) && dr2(fe2, v, y, _e2, Le2, Se2);
      }
    }
    function dr2(a, v, y, b, C, de2) {
      G2 !== null && C.isNodeMaterial && G2.setObject(a, C), a.onBeforeRender(w2, v, y, b, C, de2), a.modelViewMatrix.multiplyMatrices(y.matrixWorldInverse, a.matrixWorld), a.normalMatrix.getNormalMatrix(a.modelViewMatrix), C.onBeforeRender(w2, v, y, b, a, de2), C.transparent === true && C.side === Fc && C.forceSinglePass === false ? (C.side = Oa, C.needsUpdate = true, w2.renderBufferDirect(y, v, b, C, a, de2), C.side = $n, C.needsUpdate = true, w2.renderBufferDirect(y, v, b, C, a, de2), C.side = Fc) : w2.renderBufferDirect(y, v, b, C, a, de2), a.onAfterRender(w2, v, y, b, C, de2);
    }
    function Sn(a, v, y) {
      v.isScene !== true && (v = _t2);
      const b = U2.get(a), C = m.state.lights, de2 = m.state.shadowsArray, he = C.state.version, fe2 = re2.getParameters(a, C.state, de2, v, y, m.state.lightProbeGridArray), _e2 = re2.getProgramCacheKey(fe2);
      let Se2 = b.programs;
      b.environment = a.isMeshStandardMaterial || a.isMeshLambertMaterial || a.isMeshPhongMaterial ? v.environment : null, b.fog = v.fog;
      const Le2 = a.isMeshStandardMaterial || a.isMeshLambertMaterial && !a.envMap || a.isMeshPhongMaterial && !a.envMap;
      b.envMap = te2.get(a.envMap || b.environment, Le2), b.envMapRotation = b.environment !== null && a.envMap === null ? v.environmentRotation : a.envMapRotation, Se2 === void 0 && (a.addEventListener("dispose", bt), Se2 = /* @__PURE__ */ new Map(), b.programs = Se2);
      let we2 = Se2.get(_e2);
      if (we2 !== void 0) {
        if (b.currentProgram === we2 && b.lightsStateVersion === he) return pr2(a, fe2), we2;
      } else fe2.uniforms = re2.getUniforms(a), G2 !== null && a.isNodeMaterial && G2.build(a, y, fe2), a.onBeforeCompile(fe2, w2), we2 = re2.acquireProgram(fe2, _e2), Se2.set(_e2, we2), b.uniforms = fe2.uniforms;
      const ge = b.uniforms;
      return (!a.isShaderMaterial && !a.isRawShaderMaterial || a.clipping === true) && (ge.clippingPlanes = xe2.uniform), pr2(a, fe2), b.needsLights = _o2(a), b.lightsStateVersion = he, b.needsLights && (ge.ambientLightColor.value = C.state.ambient, ge.lightProbe.value = C.state.probe, ge.sunLights.value = C.state.sun, ge.sunLightShadows.value = C.state.sunShadow, ge.directionalLights.value = C.state.directional, ge.directionalLightShadows.value = C.state.directionalShadow, ge.spotLights.value = C.state.spot, ge.spotLightShadows.value = C.state.spotShadow, ge.rectAreaLights.value = C.state.rectArea, ge.ltc_1.value = C.state.rectAreaLTC1, ge.ltc_2.value = C.state.rectAreaLTC2, ge.pointLights.value = C.state.point, ge.pointLightShadows.value = C.state.pointShadow, ge.hemisphereLights.value = C.state.hemi, ge.sunShadowMatrix.value = C.state.sunShadowMatrix, ge.sunShadowCascade.value = C.state.sunShadowCascade, ge.directionalShadowMatrix.value = C.state.directionalShadowMatrix, ge.spotLightMatrix.value = C.state.spotLightMatrix, ge.spotLightMap.value = C.state.spotLightMap, ge.pointShadowMatrix.value = C.state.pointShadowMatrix), b.lightProbeGrid = m.state.lightProbeGridArray.length > 0, b.currentProgram = we2, b.uniformsList = null, we2;
    }
    function ur2(a) {
      if (a.uniformsList === null) {
        const v = a.currentProgram.getUniforms();
        a.uniformsList = Bn.seqWithValue(v.seq, a.uniforms);
      }
      return a.uniformsList;
    }
    function pr2(a, v) {
      const y = U2.get(a);
      y.outputColorSpace = v.outputColorSpace, y.batching = v.batching, y.batchingColor = v.batchingColor, y.instancing = v.instancing, y.instancingColor = v.instancingColor, y.instancingMorph = v.instancingMorph, y.skinning = v.skinning, y.morphTargets = v.morphTargets, y.morphNormals = v.morphNormals, y.morphColors = v.morphColors, y.morphTargetsCount = v.morphTargetsCount, y.numClippingPlanes = v.numClippingPlanes, y.numIntersection = v.numClipIntersection, y.vertexAlphas = v.vertexAlphas, y.vertexTangents = v.vertexTangents, y.toneMapping = v.toneMapping;
    }
    function po2(a, v) {
      if (a.length === 0) return null;
      if (a.length === 1) return a[0].texture !== null ? a[0] : null;
      h.setFromMatrixPosition(v.matrixWorld);
      for (let y = 0, b = a.length; y < b; y++) {
        const C = a[y];
        if (C.texture !== null && C.boundingBox.containsPoint(h)) return C;
      }
      return null;
    }
    function ho2(a, v, y, b, C) {
      v.isScene !== true && (v = _t2), O.resetTextureUnits();
      const de2 = v.fog, he = b.isMeshStandardMaterial || b.isMeshLambertMaterial || b.isMeshPhongMaterial ? v.environment : null, fe2 = ne2 === null ? w2.outputColorSpace : ne2.isXRRenderTarget === true ? ne2.texture.colorSpace : It.workingColorSpace, _e2 = b.isMeshStandardMaterial || b.isMeshLambertMaterial && !b.envMap || b.isMeshPhongMaterial && !b.envMap, Se2 = te2.get(b.envMap || he, _e2), Le2 = b.vertexColors === true && !!y.attributes.color && y.attributes.color.itemSize === 4, we2 = !!y.attributes.tangent && (!!b.normalMap || b.anisotropy > 0), ge = !!y.morphAttributes.position, He2 = !!y.morphAttributes.normal, ot2 = !!y.morphAttributes.color;
      let Je = su;
      b.toneMapped && (ne2 === null || ne2.isXRRenderTarget === true) && (Je = w2.toneMapping);
      const Ke2 = y.morphAttributes.position || y.morphAttributes.normal || y.morphAttributes.color, ut = Ke2 !== void 0 ? Ke2.length : 0, pe2 = U2.get(b), pt2 = m.state.lights;
      if (Be2 === true && (qe2 === true || a !== j)) {
        const $e2 = a === j && b.id === Z2;
        xe2.setState(b, a, $e2);
      }
      let Oe2 = false;
      b.version === pe2.__version ? (pe2.needsLights && pe2.lightsStateVersion !== pt2.state.version || pe2.outputColorSpace !== fe2 || C.isBatchedMesh && pe2.batching === false || !C.isBatchedMesh && pe2.batching === true || C.isBatchedMesh && pe2.batchingColor === true && C._colorsTexture === null || C.isBatchedMesh && pe2.batchingColor === false && C._colorsTexture !== null || C.isInstancedMesh && pe2.instancing === false || !C.isInstancedMesh && pe2.instancing === true || C.isSkinnedMesh && pe2.skinning === false || !C.isSkinnedMesh && pe2.skinning === true || C.isInstancedMesh && pe2.instancingColor === true && C.instanceColor === null || C.isInstancedMesh && pe2.instancingColor === false && C.instanceColor !== null || C.isInstancedMesh && pe2.instancingMorph === true && C.morphTexture === null || C.isInstancedMesh && pe2.instancingMorph === false && C.morphTexture !== null || pe2.envMap !== Se2 || b.fog === true && pe2.fog !== de2 || pe2.numClippingPlanes !== void 0 && (pe2.numClippingPlanes !== xe2.numPlanes || pe2.numIntersection !== xe2.numIntersection) || pe2.vertexAlphas !== Le2 || pe2.vertexTangents !== we2 || pe2.morphTargets !== ge || pe2.morphNormals !== He2 || pe2.morphColors !== ot2 || pe2.toneMapping !== Je || pe2.morphTargetsCount !== ut || !!pe2.lightProbeGrid != m.state.lightProbeGridArray.length > 0) && (Oe2 = true) : (Oe2 = true, pe2.__version = b.version);
      let Et2 = pe2.currentProgram;
      Oe2 === true && (Et2 = Sn(b, v, C), G2 && b.isNodeMaterial && G2.onUpdateProgram(b, Et2, pe2));
      let Ct2 = false, Ft2 = false, $t2 = false;
      const Xe2 = Et2.getUniforms(), rt2 = pe2.uniforms;
      if (r.useProgram(Et2.program) && (Ct2 = true, Ft2 = true, $t2 = true), b.id !== Z2 && (Z2 = b.id, Ft2 = true), pe2.needsLights) {
        const $e2 = po2(m.state.lightProbeGridArray, C);
        pe2.lightProbeGrid !== $e2 && (pe2.lightProbeGrid = $e2, Ft2 = true);
      }
      if (Ct2 || j !== a) {
        r.buffers.depth.getReversed() && a.reversedDepth !== true && (a._reversedDepth = true, a.updateProjectionMatrix()), Xe2.setValue(M, "projectionMatrix", a.projectionMatrix), Xe2.setValue(M, "viewMatrix", a.matrixWorldInverse);
        const Bt2 = Xe2.map.cameraPosition;
        Bt2 !== void 0 && Bt2.setValue(M, et.setFromMatrixPosition(a.matrixWorld)), u.logarithmicDepthBuffer && Xe2.setValue(M, "logDepthBufFC", 2 / (Math.log(a.far + 1) / Math.LN2)), (b.isMeshPhongMaterial || b.isMeshToonMaterial || b.isMeshLambertMaterial || b.isMeshBasicMaterial || b.isMeshStandardMaterial || b.isShaderMaterial) && Xe2.setValue(M, "isOrthographic", a.isOrthographicCamera === true), j !== a && (j = a, Ft2 = true, $t2 = true);
      }
      if (pe2.needsLights && (pt2.state.sunShadowMap.length > 0 && Xe2.setValue(M, "sunShadowMap", pt2.state.sunShadowMap, O), pt2.state.directionalShadowMap.length > 0 && Xe2.setValue(M, "directionalShadowMap", pt2.state.directionalShadowMap, O), pt2.state.spotShadowMap.length > 0 && Xe2.setValue(M, "spotShadowMap", pt2.state.spotShadowMap, O), pt2.state.pointShadowMap.length > 0 && Xe2.setValue(M, "pointShadowMap", pt2.state.pointShadowMap, O)), C.isSkinnedMesh) {
        Xe2.setOptional(M, C, "bindMatrix"), Xe2.setOptional(M, C, "bindMatrixInverse");
        const $e2 = C.skeleton;
        $e2 && ($e2.boneTexture === null && $e2.computeBoneTexture(), Xe2.setValue(M, "boneTexture", $e2.boneTexture, O));
      }
      C.isBatchedMesh && (Xe2.setOptional(M, C, "batchingTexture"), Xe2.setValue(M, "batchingTexture", C._matricesTexture, O), Xe2.setOptional(M, C, "batchingIdTexture"), Xe2.setValue(M, "batchingIdTexture", C._indirectTexture, O), Xe2.setOptional(M, C, "batchingColorTexture"), C._colorsTexture !== null && Xe2.setValue(M, "batchingColorTexture", C._colorsTexture, O));
      const Ot = y.morphAttributes;
      if ((Ot.position !== void 0 || Ot.normal !== void 0 || Ot.color !== void 0) && E.update(C, y, Et2), (Ft2 || pe2.receiveShadow !== C.receiveShadow) && (pe2.receiveShadow = C.receiveShadow, Xe2.setValue(M, "receiveShadow", C.receiveShadow)), (b.isMeshStandardMaterial || b.isMeshLambertMaterial || b.isMeshPhongMaterial) && b.envMap === null && v.environment !== null && (rt2.envMapIntensity.value = v.environmentIntensity), rt2.dfgLUT !== void 0 && (rt2.dfgLUT.value = _d()), Ft2) {
        if (Xe2.setValue(M, "toneMappingExposure", w2.toneMappingExposure), pe2.needsLights && mo2(rt2, $t2), de2 && b.fog === true && Me.refreshFogUniforms(rt2, de2), Me.refreshMaterialUniforms(rt2, b, $, V2, m.state.transmissionRenderTarget[a.id]), pe2.needsLights && pe2.lightProbeGrid) {
          const $e2 = pe2.lightProbeGrid;
          rt2.probesSH.value = $e2.texture, rt2.probesMin.value.copy($e2.boundingBox.min), rt2.probesMax.value.copy($e2.boundingBox.max), rt2.probesResolution.value.copy($e2.resolution);
        }
        Bn.upload(M, ur2(pe2), rt2, O);
      }
      if (b.isShaderMaterial && b.uniformsNeedUpdate === true && (Bn.upload(M, ur2(pe2), rt2, O), b.uniformsNeedUpdate = false), b.isSpriteMaterial && Xe2.setValue(M, "center", C.center), Xe2.setValue(M, "modelViewMatrix", C.modelViewMatrix), Xe2.setValue(M, "normalMatrix", C.normalMatrix), Xe2.setValue(M, "modelMatrix", C.matrixWorld), b.uniformsGroups !== void 0) {
        const $e2 = b.uniformsGroups;
        for (let Bt2 = 0, Qt2 = $e2.length; Bt2 < Qt2; Bt2++) {
          const mr2 = $e2[Bt2];
          J.update(mr2, Et2), J.bind(mr2, Et2);
        }
      }
      return Et2;
    }
    function mo2(a, v) {
      a.ambientLightColor.needsUpdate = v, a.lightProbe.needsUpdate = v, a.sunLights.needsUpdate = v, a.sunLightShadows.needsUpdate = v, a.directionalLights.needsUpdate = v, a.directionalLightShadows.needsUpdate = v, a.pointLights.needsUpdate = v, a.pointLightShadows.needsUpdate = v, a.spotLights.needsUpdate = v, a.spotLightShadows.needsUpdate = v, a.rectAreaLights.needsUpdate = v, a.hemisphereLights.needsUpdate = v;
    }
    function _o2(a) {
      return a.isMeshLambertMaterial || a.isMeshToonMaterial || a.isMeshPhongMaterial || a.isMeshStandardMaterial || a.isShadowMaterial || a.isShaderMaterial && a.lights === true;
    }
    this.getActiveCubeFace = function() {
      return Q;
    }, this.getActiveMipmapLevel = function() {
      return Y2;
    }, this.getRenderTarget = function() {
      return ne2;
    }, this.setRenderTargetTextures = function(a, v, y) {
      const b = U2.get(a);
      b.__autoAllocateDepthBuffer = a.resolveDepthBuffer === false, b.__autoAllocateDepthBuffer === false && (b.__useRenderToTexture = false), U2.get(a.texture).__webglTexture = v, U2.get(a.depthTexture).__webglTexture = b.__autoAllocateDepthBuffer ? void 0 : y, b.__hasExternalTextures = true;
    }, this.setRenderTargetFramebuffer = function(a, v) {
      const y = U2.get(a);
      y.__webglFramebuffer = v, y.__useDefaultFramebuffer = v === void 0;
    }, this.setRenderTarget = function(a, v = 0, y = 0) {
      ne2 = a, Q = v, Y2 = y;
      let b = null, C = false, de2 = false;
      if (a) {
        const fe2 = U2.get(a);
        if (fe2.__useDefaultFramebuffer !== void 0) {
          r.bindFramebuffer(M.FRAMEBUFFER, fe2.__webglFramebuffer), ee2.copy(a.viewport), be.copy(a.scissor), Re2 = a.scissorTest, r.viewport(ee2), r.scissor(be), r.setScissorTest(Re2), Z2 = -1;
          return;
        } else if (fe2.__webglFramebuffer === void 0) O.setupRenderTarget(a);
        else if (fe2.__hasExternalTextures) O.rebindTextures(a, U2.get(a.texture).__webglTexture, U2.get(a.depthTexture).__webglTexture);
        else if (a.depthBuffer) {
          const Le2 = a.depthTexture;
          if (fe2.__boundDepthTexture !== Le2) {
            if (Le2 !== null && U2.has(Le2) && (a.width !== Le2.image.width || a.height !== Le2.image.height)) throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");
            O.setupDepthRenderbuffer(a);
          }
        }
        const _e2 = a.texture;
        (_e2.isData3DTexture || _e2.isDataArrayTexture || _e2.isCompressedArrayTexture) && (de2 = true);
        const Se2 = U2.get(a).__webglFramebuffer;
        a.isWebGLCubeRenderTarget ? (Array.isArray(Se2[v]) ? b = Se2[v][y] : b = Se2[v], C = true) : a.samples > 0 && O.useMultisampledRTT(a) === false ? b = U2.get(a).__webglMultisampledFramebuffer : Array.isArray(Se2) ? b = Se2[y] : b = Se2, ee2.copy(a.viewport), be.copy(a.scissor), Re2 = a.scissorTest;
      } else ee2.copy(me2).multiplyScalar($).floor(), be.copy(Fe2).multiplyScalar($).floor(), Re2 = st2;
      if (y !== 0 && (b = q), r.bindFramebuffer(M.FRAMEBUFFER, b) && r.drawBuffers(a, b), r.viewport(ee2), r.scissor(be), r.setScissorTest(Re2), C) {
        const fe2 = U2.get(a.texture);
        M.framebufferTexture2D(M.FRAMEBUFFER, M.COLOR_ATTACHMENT0, M.TEXTURE_CUBE_MAP_POSITIVE_X + v, fe2.__webglTexture, y);
      } else if (de2) {
        const fe2 = v;
        for (let _e2 = 0; _e2 < a.textures.length; _e2++) {
          const Se2 = U2.get(a.textures[_e2]);
          M.framebufferTextureLayer(M.FRAMEBUFFER, M.COLOR_ATTACHMENT0 + _e2, Se2.__webglTexture, y, fe2);
        }
      } else if (a !== null && y !== 0) {
        const fe2 = U2.get(a.texture);
        M.framebufferTexture2D(M.FRAMEBUFFER, M.COLOR_ATTACHMENT0, M.TEXTURE_2D, fe2.__webglTexture, y);
      }
      Z2 = -1;
    };
    function hr2(a) {
      const v = U2.get(a);
      return (v.__readFormat !== a.format || v.__readType !== a.type) && (v.__readFormat = a.format, v.__readType = a.type, v.__formatReadable = u.textureFormatReadable(a.format), v.__typeReadable = u.textureTypeReadable(a.type)), v;
    }
    this.readRenderTargetPixels = function(a, v, y, b, C, de2, he, fe2 = 0) {
      if (!(a && a.isWebGLRenderTarget)) {
        X("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");
        return;
      }
      let _e2 = U2.get(a).__webglFramebuffer;
      if (a.isWebGLCubeRenderTarget && he !== void 0 && (_e2 = _e2[he]), _e2) {
        r.bindFramebuffer(M.FRAMEBUFFER, _e2);
        try {
          const Se2 = a.textures[fe2], Le2 = Se2.format, we2 = Se2.type;
          a.textures.length > 1 && M.readBuffer(M.COLOR_ATTACHMENT0 + fe2);
          const ge = hr2(Se2);
          if (ge.__formatReadable === false) {
            X("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");
            return;
          }
          if (ge.__typeReadable === false) {
            X("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");
            return;
          }
          v >= 0 && v <= a.width - b && y >= 0 && y <= a.height - C && M.readPixels(v, y, b, C, se2.convert(Le2), se2.convert(we2), de2);
        } finally {
          const Se2 = ne2 !== null ? U2.get(ne2).__webglFramebuffer : null;
          r.bindFramebuffer(M.FRAMEBUFFER, Se2);
        }
      }
    }, this.readRenderTargetPixelsAsync = async function(a, v, y, b, C, de2, he, fe2 = 0) {
      if (!(a && a.isWebGLRenderTarget)) throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");
      let _e2 = U2.get(a).__webglFramebuffer;
      if (a.isWebGLCubeRenderTarget && he !== void 0 && (_e2 = _e2[he]), _e2) if (v >= 0 && v <= a.width - b && y >= 0 && y <= a.height - C) {
        r.bindFramebuffer(M.FRAMEBUFFER, _e2);
        const Se2 = a.textures[fe2], Le2 = Se2.format, we2 = Se2.type;
        a.textures.length > 1 && M.readBuffer(M.COLOR_ATTACHMENT0 + fe2);
        const ge = hr2(Se2);
        if (ge.__formatReadable === false) throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");
        if (ge.__typeReadable === false) throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");
        const He2 = M.createBuffer();
        M.bindBuffer(M.PIXEL_PACK_BUFFER, He2), M.bufferData(M.PIXEL_PACK_BUFFER, de2.byteLength, M.STREAM_READ), M.readPixels(v, y, b, C, se2.convert(Le2), se2.convert(we2), 0), M.bindBuffer(M.PIXEL_PACK_BUFFER, null);
        const ot2 = ne2 !== null ? U2.get(ne2).__webglFramebuffer : null;
        r.bindFramebuffer(M.FRAMEBUFFER, ot2);
        const Je = M.fenceSync(M.SYNC_GPU_COMMANDS_COMPLETE, 0);
        return M.flush(), await yd(M, Je, 4), M.bindBuffer(M.PIXEL_PACK_BUFFER, He2), M.getBufferSubData(M.PIXEL_PACK_BUFFER, 0, de2), M.bindBuffer(M.PIXEL_PACK_BUFFER, null), M.deleteBuffer(He2), M.deleteSync(Je), de2;
      } else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.");
    }, this.copyFramebufferToTexture = function(a, v = null, y = 0) {
      const b = Math.pow(2, -y), C = Math.floor(a.image.width * b), de2 = Math.floor(a.image.height * b), he = v !== null ? v.x : 0, fe2 = v !== null ? v.y : 0;
      O.setTexture2D(a, 0), M.copyTexSubImage2D(M.TEXTURE_2D, y, 0, 0, he, fe2, C, de2), r.unbindTexture();
    }, this.copyTextureToTexture = function(a, v, y = null, b = null, C = 0, de2 = 0) {
      let he, fe2, _e2, Se2, Le2, we2, ge, He2, ot2;
      const Je = a.isCompressedTexture ? a.mipmaps[de2] : a.image;
      if (y !== null) he = y.max.x - y.min.x, fe2 = y.max.y - y.min.y, _e2 = y.isBox3 ? y.max.z - y.min.z : 1, Se2 = y.min.x, Le2 = y.min.y, we2 = y.isBox3 ? y.min.z : 0;
      else {
        const rt2 = Math.pow(2, -C);
        he = Math.floor(Je.width * rt2), fe2 = Math.floor(Je.height * rt2), a.isDataArrayTexture ? _e2 = Je.depth : a.isData3DTexture ? _e2 = Math.floor(Je.depth * rt2) : _e2 = 1, Se2 = 0, Le2 = 0, we2 = 0;
      }
      b !== null ? (ge = b.x, He2 = b.y, ot2 = b.z) : (ge = 0, He2 = 0, ot2 = 0);
      const Ke2 = se2.convert(v.format), ut = se2.convert(v.type);
      let pe2;
      v.isData3DTexture ? (O.setTexture3D(v, 0), pe2 = M.TEXTURE_3D) : v.isDataArrayTexture || v.isCompressedArrayTexture ? (O.setTexture2DArray(v, 0), pe2 = M.TEXTURE_2D_ARRAY) : (O.setTexture2D(v, 0), pe2 = M.TEXTURE_2D), r.activeTexture(M.TEXTURE0), r.pixelStorei(M.UNPACK_FLIP_Y_WEBGL, v.flipY), r.pixelStorei(M.UNPACK_PREMULTIPLY_ALPHA_WEBGL, v.premultiplyAlpha), r.pixelStorei(M.UNPACK_ALIGNMENT, v.unpackAlignment);
      const pt2 = r.getParameter(M.UNPACK_ROW_LENGTH), Oe2 = r.getParameter(M.UNPACK_IMAGE_HEIGHT), Et2 = r.getParameter(M.UNPACK_SKIP_PIXELS), Ct2 = r.getParameter(M.UNPACK_SKIP_ROWS), Ft2 = r.getParameter(M.UNPACK_SKIP_IMAGES);
      r.pixelStorei(M.UNPACK_ROW_LENGTH, Je.width), r.pixelStorei(M.UNPACK_IMAGE_HEIGHT, Je.height), r.pixelStorei(M.UNPACK_SKIP_PIXELS, Se2), r.pixelStorei(M.UNPACK_SKIP_ROWS, Le2), r.pixelStorei(M.UNPACK_SKIP_IMAGES, we2);
      const $t2 = a.isDataArrayTexture || a.isData3DTexture, Xe2 = v.isDataArrayTexture || v.isData3DTexture;
      if (a.isDepthTexture) {
        const rt2 = U2.get(a), Ot = U2.get(v), $e2 = U2.get(rt2.__renderTarget), Bt2 = U2.get(Ot.__renderTarget);
        r.bindFramebuffer(M.READ_FRAMEBUFFER, $e2.__webglFramebuffer), r.bindFramebuffer(M.DRAW_FRAMEBUFFER, Bt2.__webglFramebuffer);
        for (let Qt2 = 0; Qt2 < _e2; Qt2++) $t2 && (M.framebufferTextureLayer(M.READ_FRAMEBUFFER, M.COLOR_ATTACHMENT0, U2.get(a).__webglTexture, C, we2 + Qt2), M.framebufferTextureLayer(M.DRAW_FRAMEBUFFER, M.COLOR_ATTACHMENT0, U2.get(v).__webglTexture, de2, ot2 + Qt2)), M.blitFramebuffer(Se2, Le2, he, fe2, ge, He2, he, fe2, M.DEPTH_BUFFER_BIT, M.NEAREST);
        r.bindFramebuffer(M.READ_FRAMEBUFFER, null), r.bindFramebuffer(M.DRAW_FRAMEBUFFER, null);
      } else if (C !== 0 || a.isRenderTargetTexture || U2.has(a)) {
        const rt2 = U2.get(a), Ot = U2.get(v);
        r.bindFramebuffer(M.READ_FRAMEBUFFER, P2), r.bindFramebuffer(M.DRAW_FRAMEBUFFER, K);
        for (let $e2 = 0; $e2 < _e2; $e2++) $t2 ? M.framebufferTextureLayer(M.READ_FRAMEBUFFER, M.COLOR_ATTACHMENT0, rt2.__webglTexture, C, we2 + $e2) : M.framebufferTexture2D(M.READ_FRAMEBUFFER, M.COLOR_ATTACHMENT0, M.TEXTURE_2D, rt2.__webglTexture, C), Xe2 ? M.framebufferTextureLayer(M.DRAW_FRAMEBUFFER, M.COLOR_ATTACHMENT0, Ot.__webglTexture, de2, ot2 + $e2) : M.framebufferTexture2D(M.DRAW_FRAMEBUFFER, M.COLOR_ATTACHMENT0, M.TEXTURE_2D, Ot.__webglTexture, de2), C !== 0 ? M.blitFramebuffer(Se2, Le2, he, fe2, ge, He2, he, fe2, M.COLOR_BUFFER_BIT, M.NEAREST) : Xe2 ? M.copyTexSubImage3D(pe2, de2, ge, He2, ot2 + $e2, Se2, Le2, he, fe2) : M.copyTexSubImage2D(pe2, de2, ge, He2, Se2, Le2, he, fe2);
        r.bindFramebuffer(M.READ_FRAMEBUFFER, null), r.bindFramebuffer(M.DRAW_FRAMEBUFFER, null);
      } else Xe2 ? a.isDataTexture || a.isData3DTexture ? M.texSubImage3D(pe2, de2, ge, He2, ot2, he, fe2, _e2, Ke2, ut, Je.data) : v.isCompressedArrayTexture ? M.compressedTexSubImage3D(pe2, de2, ge, He2, ot2, he, fe2, _e2, Ke2, Je.data) : M.texSubImage3D(pe2, de2, ge, He2, ot2, he, fe2, _e2, Ke2, ut, Je) : a.isDataTexture ? M.texSubImage2D(M.TEXTURE_2D, de2, ge, He2, he, fe2, Ke2, ut, Je.data) : a.isCompressedTexture ? M.compressedTexSubImage2D(M.TEXTURE_2D, de2, ge, He2, Je.width, Je.height, Ke2, Je.data) : M.texSubImage2D(M.TEXTURE_2D, de2, ge, He2, he, fe2, Ke2, ut, Je);
      r.pixelStorei(M.UNPACK_ROW_LENGTH, pt2), r.pixelStorei(M.UNPACK_IMAGE_HEIGHT, Oe2), r.pixelStorei(M.UNPACK_SKIP_PIXELS, Et2), r.pixelStorei(M.UNPACK_SKIP_ROWS, Ct2), r.pixelStorei(M.UNPACK_SKIP_IMAGES, Ft2), de2 === 0 && v.generateMipmaps && M.generateMipmap(pe2), r.unbindTexture();
    }, this.initRenderTarget = function(a) {
      U2.get(a).__webglFramebuffer === void 0 && O.setupRenderTarget(a);
    }, this.initTexture = function(a) {
      a.isCubeTexture ? O.setTextureCube(a, 0) : a.isData3DTexture ? O.setTexture3D(a, 0) : a.isDataArrayTexture || a.isCompressedArrayTexture ? O.setTexture2DArray(a, 0) : O.setTexture2D(a, 0), r.unbindTexture();
    }, this.resetState = function() {
      Q = 0, Y2 = 0, ne2 = null, r.reset(), ue2.reset();
    }, typeof __THREE_DEVTOOLS__ < "u" && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", { detail: this }));
  }
  get coordinateSystem() {
    return qt;
  }
  get outputColorSpace() {
    return this._outputColorSpace;
  }
  set outputColorSpace(n) {
    this._outputColorSpace = n;
    const t = this.getContext();
    t.drawingBufferColorSpace = It._getDrawingBufferColorSpace(n), t.unpackColorSpace = It._getUnpackColorSpace();
  }
};

// quartz/components/scripts/topologyInk.ts
var FS_PTS = "\nuniform float uHalo;uniform vec3 uTint;varying vec3 vC;varying float vA;varying float vS;varying float vG;varying float vK;varying float vH;varying float vX;\nvoid main(){vec2 d=gl_PointCoord-.5;float l=length(d)*2.;float aa=1./max(vS,2.);float core=1.-smoothstep(.5-aa,.5+aa,l);\n  // A floor dot, on the pixel grid, is edged over half a pixel: its four pixels whole and none beside them (issue 1512).\n  if(vX>0.){float ah=aa*mix(1.,.5,vX);core=1.-smoothstep(.5-ah,.5+ah,l);}\n  float a=core*vA;if(a<.004)discard;\n  float solid=step(.99,vK)*smoothstep(0.,.08,vA);\n  gl_FragColor=vec4(vC*uTint*a,mix(a,core,solid));}\n";
var FS_LN = "\nuniform float uTime;uniform float uMotion;uniform vec3 uLite;\nvarying vec3 vC;varying float vA;varying float vT;varying float vS;varying float vF;varying float vD;varying float vL;\nfloat h1(float n){return fract(sin(n)*43758.5453);}\nvoid main(){float sp=.35+h1(vS*13.)*.9;float cyc=uTime*sp+vS*17.;float act=step(.8,h1(floor(cyc)*1.7+vS*31.));float x=mix(vT,1.-vT,step(.5,h1(vS*5.)));float g=act*exp(-pow((x-fract(cyc))*9.,2.))*step(.02,vA)*.3*uMotion;\n  float a=vA*(1.+vF*1.6)*vD+g*.85+vL*.55*step(.001,vA);vec3 col=mix(vC,mix(vC,uLite,.35),clamp(g*1.2+vL,0.,1.));if(a<.003)discard;gl_FragColor=vec4(col*a,a);}\n";

// quartz/components/scripts/topologyShaders.mjs
var project = `
  uniform vec4 framing;
  uniform vec2 screenSize;
  uniform vec4 rotation;
  uniform vec3 tones[8];
  attribute float tone;
  attribute float indexInView;
  attribute float weight;
  uniform float picked;
  vec4 positionOnMap() {
    float depth = -rotation.y * position.x + rotation.x * position.z;
    vec2 p = vec2(rotation.x * position.x + rotation.y * position.z, rotation.z * position.y - rotation.w * depth);
    vec2 css = (p - framing.xy) * framing.z + viewOffset;
    return vec4(css * vec2(2., -2.) / screenSize, 0., 1.);
  }`;
var common = "uniform vec2 viewOffset;\n" + project;
var points = common + `
  uniform float pixelRatio;
  attribute float emphasis;
  varying vec3 vC; varying float vA,vS,vG,vK,vH,vX;
  void main() {
    gl_Position = positionOnMap(); float lit = 1.-step(.25, abs(picked-indexInView));
    vC = tones[int(tone)] * emphasis; vA = .87 + .13*lit; vK=1.; vG=lit; vH=0.; vX=1.;
    vS = (weight + 4.*lit) * pixelRatio * framing.w; gl_PointSize = vS;
  }`;
var lines = (light) => common + (light ? "uniform float paperLineGain; attribute float bridge;\n" : "") + `
  attribute float along; attribute float sourceIndex; attribute float targetIndex;
  uniform float pickedNode;
  varying vec3 vC; varying float vA,vT,vS,vF,vD,vL;
  void main() {
    gl_Position=positionOnMap();
    float related = min(abs(sourceIndex-pickedNode),abs(targetIndex-pickedNode));
    vL=max(1.-step(.25, abs(picked-indexInView)), 1.-step(.25,related));
    vC=tones[int(tone)]; vA=${light ? "weight*max(paperLineGain,bridge*.8)" : "weight"}; vT=along; vS=indexInView*.618034; vF=0.; vD=1.;
  }`;
function createMapShaders(canvas, context, light = false) {
  const renderer = new gd2({ canvas, context, alpha: true, antialias: true });
  renderer.setClearColor(0, 0);
  const scene = new ph(), sceneCamera = new vn();
  const parameter = (value) => ({ value });
  const shared = {
    framing: parameter(new At()),
    viewOffset: parameter(new I()),
    rotation: parameter(new At()),
    screenSize: parameter(new I()),
    tones: parameter(Array.from({ length: 8 }, () => new w(1, 1, 1)))
  };
  function material(vertexShader, fragmentShader, uniforms) {
    return new oa({
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...uniforms },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true
    });
  }
  const pointMaterial = material(points, FS_PTS, {
    picked: parameter(-2),
    pixelRatio: parameter(1),
    uHalo: parameter(1),
    uTint: parameter(new w(1, 1, 1))
  });
  const lineMaterial = material(lines(light), FS_LN, {
    ...light ? { paperLineGain: parameter(1) } : {},
    picked: parameter(-2),
    pickedNode: parameter(-2),
    uTime: parameter(0),
    uMotion: parameter(0),
    uLite: parameter(new w(1, 1, 1))
  });
  const dots = new Hh(new H(), pointMaterial);
  const threads = new ne(new H(), lineMaterial);
  dots.frustumCulled = threads.frustumCulled = false;
  dots.renderOrder = 1;
  scene.add(threads, dots);
  let nodeIndex = /* @__PURE__ */ new Map(), edgeIndex = /* @__PURE__ */ new Map();
  function geometry(object, attrs) {
    object.geometry.dispose();
    const geometry2 = new H();
    for (const [name, values] of Object.entries(attrs))
      geometry2.setAttribute(name, new P(values, name === "position" ? 3 : 1));
    object.geometry = geometry2;
  }
  function setNodes(nodes, toneOf) {
    nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const pts = { position: [], tone: [], indexInView: [], weight: [], emphasis: [] };
    for (const n of nodes) {
      pts.position.push(n.x, n.y, n.z);
      pts.tone.push(toneOf(n));
      pts.indexInView.push(nodeIndex.get(n.id));
      pts.weight.push(mapPointSize(n.kind !== "page", false));
      pts.emphasis.push(1);
    }
    geometry(dots, pts);
  }
  function setLines(nodes, edges, toneOf, focus) {
    const emphasis = dots.geometry.getAttribute("emphasis");
    for (let i = 0; i < nodes.length; i++) emphasis.setX(i, !focus || focus.has(nodes[i].id) ? 1 : 0.18);
    emphasis.needsUpdate = true;
    edgeIndex = new Map(edges.map((e, i) => [e.id, i]));
    const seg = {
      ...light ? { bridge: [] } : {},
      position: [],
      tone: [],
      indexInView: [],
      weight: [],
      along: [],
      sourceIndex: [],
      targetIndex: []
    };
    for (const edge of edges) {
      const s = nodeIndex.get(edge.source), t = nodeIndex.get(edge.target);
      for (const index of [s, t]) {
        const n = nodes[index];
        seg.position.push(n.x, n.y, n.z);
        seg.tone.push(toneOf(n));
        seg.indexInView.push(edgeIndex.get(edge.id));
        seg.along.push(index === s ? 0 : 1);
        seg.weight.push(edge.opacity ?? mapThreadOpacity(edge.structural, edge.strength));
        if (light) seg.bridge.push(edge.crossFolder && !edge.structural ? 1 : 0);
        seg.sourceIndex.push(s);
        seg.targetIndex.push(t);
      }
    }
    geometry(threads, seg);
  }
  function updatePositions(nodes, edges) {
    const pts = dots.geometry.getAttribute("position"), seg = threads.geometry.getAttribute("position");
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      pts.setXYZ(i, n.x, n.y, n.z);
    }
    for (let i = 0; i < edges.length; i++) {
      const s = nodes[nodeIndex.get(edges[i].source)], t = nodes[nodeIndex.get(edges[i].target)];
      seg.setXYZ(i * 2, s.x, s.y, s.z);
      seg.setXYZ(i * 2 + 1, t.x, t.y, t.z);
    }
    pts.needsUpdate = seg.needsUpdate = true;
  }
  function resize(w2, h) {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w2, h, false);
    shared.screenSize.value.set(w2, h);
    pointMaterial.uniforms.pixelRatio.value = dpr;
  }
  function draw(camera, center, pan, scale, zoom2, item, colors, ink) {
    if (light) {
      const { x, y } = shared.screenSize.value;
      const areaPerLine = x * y / Math.max(1, edgeIndex.size);
      lineMaterial.uniforms.paperLineGain.value = Math.min(1, Math.max(0.16, areaPerLine * zoom2 * zoom2 / 160));
    }
    shared.framing.value.set(
      center.x,
      center.y,
      scale * zoom2,
      Math.min(2.2, Math.max(0.85, Math.sqrt(zoom2)))
    );
    shared.viewOffset.value.set(pan.x, pan.y);
    shared.rotation.value.set(
      Math.cos(camera.yaw),
      Math.sin(camera.yaw),
      Math.cos(camera.pitch),
      Math.sin(camera.pitch)
    );
    for (let i = 0; i < colors.length; i++) shared.tones.value[i].fromArray(colors[i]);
    lineMaterial.uniforms.uLite.value.fromArray(ink);
    const node = nodeIndex.get(item?.id) ?? -2;
    pointMaterial.uniforms.picked.value = lineMaterial.uniforms.pickedNode.value = node;
    lineMaterial.uniforms.picked.value = edgeIndex.get(item?.id) ?? -2;
    lineMaterial.uniforms.uTime.value = performance.now() / 1e3;
    renderer.resetState();
    renderer.render(scene, sceneCamera);
  }
  return {
    setNodes,
    setLines,
    updatePositions,
    resize,
    draw,
    available: () => !renderer.getContext().isContextLost(),
    dispose() {
      dots.geometry.dispose();
      threads.geometry.dispose();
      pointMaterial.dispose();
      lineMaterial.dispose();
      renderer.dispose();
    }
  };
}

// quartz/components/scripts/topologyCommunities.ts
var MAX_TOPICS = 8;
var MIN_TOPIC_SIZE = 3;
var MAX_LEVELS = 10;
function leidenCommunities(idsInput, edges) {
  const ids = [...new Set(idsInput)].sort();
  const index = new Map(ids.map((id3, i) => [id3, i]));
  let graph = ids.map(() => /* @__PURE__ */ new Map());
  for (const { source, target, weight } of edges) {
    const a = index.get(source), b = index.get(target);
    if (a === void 0 || b === void 0 || a === b || !Number.isFinite(weight) || weight <= 0) continue;
    graph[a].set(b, (graph[a].get(b) ?? 0) + weight);
    graph[b].set(a, (graph[b].get(a) ?? 0) + weight);
  }
  let original = ids.map((_, i) => i);
  let coarse = [...original];
  for (let level = 0; level < MAX_LEVELS; level++) {
    const degree = graph.map((row) => [...row.values()].reduce((a, b) => a + b, 0));
    const mass = degree.reduce((a, b) => a + b, 0);
    if (!mass) break;
    const volumes = new Float64Array(graph.length);
    coarse.forEach((c, i) => {
      volumes[c] += degree[i];
    });
    let moved = true;
    while (moved) {
      moved = false;
      for (let i = 0; i < graph.length; i++) {
        const old = coarse[i], weights = /* @__PURE__ */ new Map();
        for (const [j, w2] of graph[i]) if (i !== j) weights.set(coarse[j], (weights.get(coarse[j]) ?? 0) + w2);
        volumes[old] -= degree[i];
        let best = old, gain = (weights.get(old) ?? 0) - degree[i] * volumes[old] / mass;
        for (const [candidate, weight] of weights) {
          const next = weight - degree[i] * volumes[candidate] / mass;
          if (next > gain + 1e-12) {
            best = candidate;
            gain = next;
          }
        }
        coarse[i] = best;
        volumes[best] += degree[i];
        if (best !== old) moved = true;
      }
    }
    const refined = graph.map((_, i) => i);
    const sizes = graph.map(() => 1), volume = [...degree];
    const cut = graph.map((row, i) => [...row].reduce((w2, [j, n]) => w2 + (j !== i && coarse[i] === coarse[j] ? n : 0), 0));
    const admissible = (i) => cut[i] + 1e-12 >= volume[i] * (volumes[coarse[i]] - volume[i]) / mass;
    for (let i = 0; i < graph.length; i++) {
      if (sizes[i] !== 1 || refined[i] !== i || !admissible(i)) continue;
      const links = /* @__PURE__ */ new Map();
      for (const [j, w2] of graph[i]) {
        if (j !== i && coarse[j] === coarse[i]) links.set(refined[j], (links.get(refined[j]) ?? 0) + w2);
      }
      let target = i, gain = 0;
      for (const [c, w2] of links) {
        const next = w2 - degree[i] * volume[c] / mass;
        if (admissible(c) && next > gain + 1e-12) {
          target = c;
          gain = next;
        }
      }
      if (target === i) continue;
      refined[i] = target;
      sizes[target]++;
      volume[target] += degree[i];
      cut[target] += cut[i] - 2 * links.get(target);
    }
    const labels = [...new Set(refined)];
    if (labels.length === graph.length || level === MAX_LEVELS - 1) break;
    const renumber = new Map(labels.map((label, i) => [label, i]));
    const membership = refined.map((c) => renumber.get(c));
    const nextGraph = labels.map(() => /* @__PURE__ */ new Map());
    graph.forEach((row, i) => {
      for (const [j, w2] of row) {
        const target = membership[j], links = nextGraph[membership[i]];
        links.set(target, (links.get(target) ?? 0) + w2);
      }
    });
    original = original.map((i) => membership[i]);
    const coarseNames = /* @__PURE__ */ new Map();
    coarse = labels.map((label) => {
      const old = coarse[label];
      if (!coarseNames.has(old)) coarseNames.set(old, coarseNames.size);
      return coarseNames.get(old);
    });
    graph = nextGraph;
  }
  return new Map(ids.map((id3, i) => [id3, coarse[original[i]]]));
}
function detectTopics(nodes, edges) {
  const communities = leidenCommunities(nodes.map((node) => node.id), edges);
  const groups = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const community = communities.get(node.id);
    if (community === void 0) continue;
    const group = groups.get(community) ?? [];
    group.push(node);
    groups.set(community, group);
  }
  const degree = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + edge.weight);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + edge.weight);
  }
  return [...groups.values()].filter((group) => group.length >= MIN_TOPIC_SIZE).map((group) => ({ group, label: topicLabel(group, degree) })).sort((left, right) => right.group.length - left.group.length || left.label.localeCompare(right.label)).slice(0, MAX_TOPICS).map(({ group, label }, index, all) => {
    const earlier = all.slice(0, index).filter((entry) => entry.label === label).length;
    return {
      index,
      label: earlier > 0 ? `${label} ${earlier + 1}` : label,
      memberIds: group.map((node) => node.id)
    };
  });
}
function topicLabel(group, degree) {
  const counts = /* @__PURE__ */ new Map();
  for (const node of group) {
    for (const concept of new Set(node.concepts.map((value) => value.trim()).filter(Boolean))) {
      const key = concept.toLowerCase();
      const entry = counts.get(key) ?? { label: concept, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  const shared = [...counts.values()].filter((entry) => entry.count >= 2).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).filter((entry, index, sorted) => index === 0 || index === 1 && entry.count * 2 >= sorted[0].count).map((entry) => entry.label);
  if (shared.length > 0) return shared.join(" and ");
  const hub = [...group].sort(
    (left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.title.localeCompare(right.title)
  )[0];
  return hub.title;
}

// quartz/components/scripts/thoughtTopology3DGeometry.ts
var TopologyCamera3D = class {
  yaw = 0.42;
  pitch = -0.26;
  project(point) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp2 = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const depth = -sy * point.x + cy * point.z;
    return {
      x: cy * point.x + sy * point.z,
      y: cp2 * point.y - sp2 * depth,
      z: sp2 * point.y + cp2 * depth
    };
  }
  /** Inverse rotation: dragging follows the screen plane at any camera angle. */
  unproject(point) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp2 = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const depth = -sp2 * point.y + cp2 * point.z;
    return {
      x: cy * point.x - sy * depth,
      y: cp2 * point.y + sp2 * point.z,
      z: sy * point.x + cy * depth
    };
  }
  orbit(dx, dy) {
    this.yaw += dx * 6e-3;
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch + dy * 6e-3));
  }
};
function seededUnit(id3, channel) {
  let hash = 2166136261;
  const value = `${channel}:${id3}`;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ hash >>> 16, 2246822507);
  hash = Math.imul(hash ^ hash >>> 13, 3266489909);
  return ((hash ^ hash >>> 16) >>> 0) / 4294967296;
}
function fillSphere(positions, members, center, groupOf) {
  const groups = /* @__PURE__ */ new Map();
  for (const node of members) {
    const key = groupOf(node);
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  const count = members.length;
  const extent = Math.max(180, Math.sqrt(count) * 96);
  let start = -Math.PI / 2;
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key);
    const arc = Math.PI * 2 * group.length / count;
    for (const node of group) {
      const anchor = node.kind === "folder";
      const longitude = start + arc * (anchor ? 0.5 : seededUnit(node.id, "longitude"));
      const latitude = (seededUnit(node.id, "latitude") * 2 - 1) * (anchor ? 0.35 : 1);
      const radius = extent * (anchor ? 0.42 : Math.cbrt(0.06 + 0.94 * seededUnit(node.id, "radius")));
      const ring = radius * Math.sqrt(1 - latitude * latitude);
      positions.set(node.id, {
        x: center.x + Math.cos(longitude) * ring,
        y: center.y + latitude * radius,
        z: center.z + Math.sin(longitude) * ring
      });
    }
    start += arc;
  }
  return extent;
}
function sphericalTopologyPositions(nodes, separateSectors = false) {
  const positions = /* @__PURE__ */ new Map();
  const rest = [];
  for (const node of nodes) {
    if (node.kind === "garden") positions.set(node.id, { x: 0, y: 0, z: 0 });
    else rest.push(node);
  }
  const sectorOf = (node) => node.sectorId ?? node.folderId ?? node.id;
  const sectors = /* @__PURE__ */ new Map();
  if (separateSectors) {
    for (const node of rest) {
      const members = sectors.get(sectorOf(node)) ?? [];
      if (node.id !== sectorOf(node)) members.push(node);
      sectors.set(sectorOf(node), members);
    }
  }
  if (sectors.size < 2) {
    if (rest.length > 0) fillSphere(positions, rest, { x: 0, y: 0, z: 0 }, sectorOf);
    return positions;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const branchOf = (node) => {
    let current = node;
    for (let hops = 0; hops < 16; hops++) {
      const parent = current.folderId ? byId.get(current.folderId) : void 0;
      if (!parent || parent.id === node.sectorId) break;
      current = parent;
    }
    return current.id;
  };
  const spheres = [...sectors.entries()].map(([id3, members]) => ({ id: id3, members, radius: Math.max(180, Math.sqrt(members.length) * 96) })).sort((a, b) => b.radius - a.radius || (a.id < b.id ? -1 : 1));
  const placed = [{ x: 0, y: 0, radius: 0 }];
  for (const sphere of spheres) {
    let center = { x: 0, y: 0, z: 0 };
    for (let step = 0; step < 2e4; step++) {
      const distance = sphere.radius * 1.2 + 140 + step * 10;
      const angle = step * 0.4;
      center = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, z: 0 };
      if (placed.every(
        (other) => Math.hypot(center.x - other.x, center.y - other.y) >= (sphere.radius + other.radius) * 1.2 + 140
      ))
        break;
    }
    placed.push({ x: center.x, y: center.y, radius: sphere.radius });
    positions.set(sphere.id, center);
    if (sphere.members.length > 0) fillSphere(positions, sphere.members, center, branchOf);
  }
  return positions;
}

// quartz/components/scripts/thoughtTopology3DRenderer.ts
import {
  select,
  zoom,
  zoomIdentity,
  drag,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY
} from "d3";
import katex from "katex";
import { Application, Circle, Container, Graphics, Sprite, Text } from "pixi.js";

// node_modules/github-slugger/index.js
var own = Object.hasOwnProperty;

// quartz/util/clone.ts
var import_rfdc = __toESM(require_rfdc(), 1);
var clone = (0, import_rfdc.default)();

// quartz/util/path.ts
function simplifySlug(fp) {
  const res = stripSlashes(trimSuffix(fp, "index"), true);
  return res.length === 0 ? "/" : res;
}
function pathToRoot(slug2) {
  let rootPath = slug2.split("/").filter((x) => x !== "").slice(0, -1).map((_) => "..").join("/");
  if (rootPath.length === 0) {
    rootPath = ".";
  }
  return rootPath;
}
function resolveRelative(current, target) {
  const res = joinSegments(pathToRoot(current), simplifySlug(target));
  return res;
}
function joinSegments(...args) {
  if (args.length === 0) {
    return "";
  }
  let joined = args.filter((segment) => segment !== "" && segment !== "/").map((segment) => stripSlashes(segment)).join("/");
  if (args[0].startsWith("/")) {
    joined = "/" + joined;
  }
  if (args[args.length - 1].endsWith("/")) {
    joined = joined + "/";
  }
  return joined;
}
function endsWith(s, suffix) {
  return s === suffix || s.endsWith("/" + suffix);
}
function trimSuffix(s, suffix) {
  if (endsWith(s, suffix)) {
    s = s.slice(0, -suffix.length);
  }
  return s;
}
function stripSlashes(s, onlyStripPrefix) {
  if (s.startsWith("/")) {
    s = s.substring(1);
  }
  if (!onlyStripPrefix && s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  return s;
}

// quartz/components/scripts/generatedVisualHost.ts
function generatedVisualDashboardBaseUrl(href, referrer, ancestorOrigin = "") {
  try {
    const current = new URL(href);
    if (current.pathname.startsWith("/api/quartz-graph-preview")) return current.origin;
    for (const candidate of [ancestorOrigin, referrer]) {
      if (!candidate) continue;
      let host;
      try {
        host = new URL(candidate);
      } catch {
        continue;
      }
      if (/^https?:$/.test(host.protocol) && host.protocol === current.protocol && host.hostname === current.hostname && host.origin !== current.origin)
        return host.origin;
    }
    if (/^garden\./i.test(current.hostname)) return current.origin.replace("//garden.", "//");
    if (/^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i.test(current.hostname) || current.port === "8081")
      return `${current.protocol}//${current.hostname}:3000`;
    return current.origin;
  } catch {
    return "";
  }
}

// quartz/components/scripts/sourceNodeVisual.ts
var TOPOLOGY_SOURCE_COLORS = {
  light: {
    pdf: "#be123c",
    link: "#2563eb",
    video: "#b45309",
    audio: "#7e22ce",
    document: "#15803d",
    chat: "#0f766e"
  },
  dark: {
    pdf: "#fb7185",
    link: "#60a5fa",
    video: "#f59e0b",
    audio: "#c084fc",
    document: "#4ade80",
    chat: "#2dd4bf"
  }
};
function topologySourceKind(node, folderPath = "") {
  if (node.kind === "chat") return "chat";
  const isSource = node.kind === "source" || node.knowledgeType === "source-document" || folderPath.replace(/\\/g, "/").split("/").some((part) => part.toLocaleLowerCase() === "sources");
  if (!isSource) return null;
  const sourceType = node.sourceType?.trim().toLocaleLowerCase() ?? "";
  const fallback = `${node.title} ${node.relPath}`.toLocaleLowerCase();
  if (sourceType.includes("audio") || /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)(?:\s|$)/i.test(fallback))
    return "audio";
  if (sourceType === "youtube" || sourceType.includes("video") || /(?:youtube\.com|youtu\.be|\.(?:avi|m4v|mkv|mov|mp4|webm)(?:\s|$))/i.test(fallback))
    return "video";
  if (sourceType === "url" || sourceType === "link" || sourceType === "web" || sourceType.includes("website") || sourceType.includes("web-page") || /(?:https?:\/\/|www\.)/i.test(fallback))
    return "link";
  if (sourceType.includes("pdf") || /\.pdf(?:\s|$)/i.test(fallback)) return "pdf";
  return "document";
}
var TOPOLOGY_CHATS_FOLDER_ID = "folder:$chats";
function topologySourceLabel(kind) {
  if (kind === "chat") return "Your chat";
  return `${kind === "pdf" ? "PDF" : kind[0].toUpperCase() + kind.slice(1)} source`;
}
function openTopologyChat(nodeId, navigateSlug = "") {
  const chatId = /^chat:(\d+)$/.exec(nodeId)?.[1];
  if (!chatId) return nodeId === TOPOLOGY_CHATS_FOLDER_ID;
  const messageId = navigateSlug.split("#")[1] ?? "";
  const chatLink = messageId ? { chatId, selectionId: "", messageId, surface: "garden" } : { chatId, selectionId: "topology", surface: "garden" };
  if (window.parent !== window) {
    const dashboard = generatedVisualDashboardBaseUrl(
      window.location.href,
      document.referrer,
      window.location.ancestorOrigins?.[0]
    );
    window.parent.postMessage({ type: "second-brain:assistant-open-chat", chatLink }, dashboard);
  } else {
    window.dispatchEvent(new CustomEvent("breadboard:assistant-open-chat", { detail: { chatLink } }));
  }
  return true;
}

// quartz/components/scripts/renderSlot.ts
var RenderSlot = class {
  generation = 0;
  pending = Promise.resolve();
  active;
  release() {
    const previous = this.active;
    this.active = void 0;
    previous?.cleanup();
  }
  clear() {
    this.generation += 1;
    this.release();
  }
  replace(mount) {
    const generation = ++this.generation;
    const run = async () => {
      if (generation !== this.generation) return;
      this.release();
      const renderer = await mount();
      if (generation !== this.generation) {
        renderer.cleanup();
        return;
      }
      this.active = renderer;
      return renderer;
    };
    const result = this.pending.then(run);
    this.pending = result.then(
      () => {
      },
      () => {
      }
    );
    return result;
  }
};

// quartz/components/scripts/graphRenderLoop.ts
var GraphRenderLoop = class {
  constructor(draw, requestFrame = (callback) => requestAnimationFrame(callback), cancelFrame = (id3) => cancelAnimationFrame(id3)) {
    this.draw = draw;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
  }
  draw;
  requestFrame;
  cancelFrame;
  frame;
  active = true;
  disposed = false;
  render = (time) => {
    this.frame = void 0;
    if (this.disposed || !this.active) return;
    if (this.draw(time)) this.invalidate();
  };
  invalidate = () => {
    if (this.disposed || !this.active || this.frame !== void 0) return;
    this.frame = this.requestFrame(this.render);
  };
  setActive(active) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (active) {
      this.invalidate();
    } else if (this.frame !== void 0) {
      this.cancelFrame(this.frame);
      this.frame = void 0;
    }
  }
  dispose() {
    this.disposed = true;
    if (this.frame !== void 0) this.cancelFrame(this.frame);
    this.frame = void 0;
  }
};

// quartz/components/scripts/thoughtTopologyLayout.ts
var CONNECTION_STROKE_WIDTH = 1;
var HIERARCHY_STROKE_WIDTH = 0.7;
var CONNECTION_STRENGTH_SPAN = 0.35;
function connectionStrength(score, threshold) {
  const base = Number.isFinite(threshold) ? threshold : 0;
  const span = Math.max(1e-6, Math.min(CONNECTION_STRENGTH_SPAN, 1 - base));
  return Math.min(1, Math.max(0, (score - base) / span));
}
function topologyNavigationSlug(value) {
  const slug2 = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.md$/i, "").split("/").filter(Boolean).map(
    (segment) => segment.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/\?/g, "").replace(/#/g, "")
  ).join("/");
  return slug2.endsWith("_index") ? slug2.replace(/_index$/, "index") : slug2;
}
function normalizeTopologyScopePath(value) {
  try {
    value = decodeURIComponent(value);
  } catch {
  }
  return topologyNavigationSlug(value).replace(/\/index$/i, "").toLowerCase();
}
function shouldShowTopologyNodeLabel(node) {
  return node.kind !== "page" || node.contentKind !== "markdown";
}
var AUTHORED_CONNECTION_STRENGTH = 0.4;
function capConnectionsPerNode(edges, limit) {
  const cap = Number.isFinite(limit) ? Math.floor(limit) : 0;
  if (cap <= 0) return edges;
  const byNode = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    for (const id3 of [edge.source, edge.target]) {
      const list = byNode.get(id3) ?? [];
      list.push(edge);
      byNode.set(id3, list);
    }
  }
  const kept = /* @__PURE__ */ new Set();
  for (const list of byNode.values()) {
    list.slice().sort((left, right) => right.strength - left.strength || right.score - left.score).slice(0, cap).forEach((edge) => kept.add(edge));
  }
  return edges.filter((edge) => kept.has(edge));
}
var GOLDEN_SMALL_WORDS = /* @__PURE__ */ new Set(["of", "and", "the", "for", "to", "in", "on", "a", "an", "with"]);
var ROMAN = /^(?=[ivx]+$)(x{0,3})(ix|iv|v?i{0,3})$/i;
function displayFolderTitle(title) {
  const words = title.trim().split(/\s+/);
  return words.map((word, index) => {
    if (ROMAN.test(word) && index > 0) return word.toUpperCase();
    const lower = word.toLowerCase();
    if (index > 0 && GOLDEN_SMALL_WORDS.has(lower)) return lower;
    return word;
  }).join(" ");
}
var naturalOrder = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
function naturalCompare(left, right) {
  return naturalOrder.compare(left, right);
}
function affinityLabel(score, threshold = 0.3) {
  const base = Number.isFinite(threshold) ? threshold : 0.3;
  return score >= base + 0.28 ? "Very strong" : score >= base + 0.12 ? "Strong" : "Moderate";
}
function relationLabel(relationType) {
  const value = (relationType ?? "related").replace(/[-_]+/g, " ").trim();
  if (value === "related" || value === "related to" || value === "inter garden related") return "Inter-Garden related";
  if (value === "cross garden related") return "Cross-Garden related";
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Related";
}
function stripMarkup(text) {
  const delimiter = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\.|[^$\n])+?)(?<!\\)\$/g;
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(delimiter)) {
    const index = match.index ?? 0;
    parts.push(
      text.slice(cursor, index).replace(/[|]+/g, " ").replace(/[*`#>]+/g, "")
    );
    parts.push(match[0]);
    cursor = index + match[0].length;
  }
  parts.push(
    text.slice(cursor).replace(/[|]+/g, " ").replace(/[*`#>]+/g, "")
  );
  return parts.join("").replace(/\s+/g, " ").trim();
}
function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map((part) => part.trim()).filter((part) => part.length > 0);
}
function readableSummary(summary, fallback) {
  const raw = (summary?.text ?? "").replace(/\s+/g, " ").trim();
  const afterTitle = raw.toLowerCase().startsWith(fallback.title.toLowerCase()) ? raw.slice(fallback.title.length).trimStart() : null;
  const withoutTitle = afterTitle !== null && !/^[a-z]/.test(afterTitle) ? afterTitle.replace(/^[\s:.\-–—]+/, "") : raw;
  const parts = withoutTitle.split(/\s*\|\s*/).flatMap((fragment) => sentences(fragment)).map((sentence) => stripMarkup(sentence)).filter(
    (sentence) => /[a-zA-Z]{3,}/.test(sentence) && sentence.length >= 24 && sentence.split(" ").length >= 4
  );
  const kept = [];
  let length = 0;
  for (const sentence of parts) {
    if (kept.length >= 3 || kept.length > 0 && length + sentence.length > 320) break;
    kept.push(sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}\u2026` : sentence);
    length += sentence.length;
  }
  const joined = kept.join(" ");
  if (joined.length >= 40) return joined;
  return `\u201C${fallback.title}\u201D is a page in ${fallback.folderTitle}. Its summary will be written once the Garden\u2019s semantic analysis runs.`;
}
function joinNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
function gardenOverview(plan, gardenTitle, serverSummary) {
  const ready = serverSummary?.state === "ready" ? stripMarkup(serverSummary.text) : "";
  if (!plan.scopeFolder && ready && ready.length >= 60 && !/^Folders:/i.test(ready)) return ready;
  const folders = plan.nodes.filter(
    (node) => node.kind === "folder" && plan.meaningfulFolderIds.includes(node.id)
  );
  const sorted = [...folders].sort(
    (left, right) => right.subtreeCount - left.subtreeCount || naturalCompare(left.label, right.label)
  );
  const bridges = plan.edges.filter((edge) => edge.crossFolder).length;
  const pages = plan.totalPageCount;
  if (folders.length === 0) {
    return `${gardenTitle} holds ${pages} ${pages === 1 ? "page" : "pages"} at its root. Semantic connections between pages appear here as they are found.`;
  }
  const first = `${gardenTitle} is organized into ${folders.length} ${folders.length === 1 ? "folder" : "folders"} \u2014 ${joinNames(sorted.map((folder) => folder.label))} \u2014 holding ${pages} ${pages === 1 ? "page" : "pages"} in total.`;
  const largest = sorted[0];
  const second = folders.length > 1 ? `${largest.label} is the largest with ${largest.subtreeCount} ${largest.subtreeCount === 1 ? "page" : "pages"}.` : "";
  const third = plan.edges.length === 0 ? "No semantic connections have been confirmed between its pages yet." : bridges === 0 ? `${plan.edges.length} semantic ${plan.edges.length === 1 ? "connection links" : "connections link"} pages inside their folders; none cross between folders yet.` : `${plan.edges.length} semantic ${plan.edges.length === 1 ? "connection" : "connections"} link its pages, ${bridges} of them ${bridges === 1 ? "bridges" : "bridging"} between folders.`;
  return [first, second, third].filter(Boolean).join(" ");
}
function analysisStatus(payload) {
  if (payload.build.state === "building" && payload.nodes.length === 0) {
    return {
      mode: "building",
      notice: "Preparing Thought Topology\u2026",
      detail: "The first analysis of this Garden is still running."
    };
  }
  if (payload.build.retrievalMode === "concept-lexical" || payload.build.embeddingModel === "unavailable") {
    return {
      mode: "concept-lexical",
      notice: "",
      detail: "Showing topic and keyword connections. Related concepts will appear after analysis."
    };
  }
  return {
    mode: "semantic-vector",
    notice: "",
    detail: `Vector analysis complete${payload.build.embeddingModel ? ` \xB7 ${payload.build.embeddingModel}` : ""}.`
  };
}
var GARDEN_RADIUS = 11;
var FOLDER_RADIUS = 6.5;
var SUBFOLDER_RADIUS = 5;
var PAGE_RADIUS = 2.9;
var IMPORTANT_PAGE_RADIUS = 3.7;
var ITEM_SPACING = 46;
var FIRST_RING_RADIUS = 52;
var RING_GAP = 42;
var RING_HALF_ANGLES = [1.22, 1.36, 1.44, 1.5, 1.52];
var MIN_ANCHOR_DISTANCE = 210;
var SECTOR_MARGIN = 64;
var FOOTPRINT_GAP = 24;
var EMPTY_SUBFOLDER_FOOTPRINT = 18;
function arcLengthOf(item) {
  const footprint = item.footprint ?? 0;
  return footprint > 0 ? Math.max(ITEM_SPACING, 2 * footprint + FOOTPRINT_GAP) : ITEM_SPACING;
}
function packCluster(items, anchor, outwardAngle) {
  const positions = /* @__PURE__ */ new Map();
  if (items.length === 0) return { positions, clusterRadius: 0 };
  let index = 0;
  let ring = 0;
  let clusterRadius = 0;
  let previousRadius = 0;
  let previousReach = 0;
  while (index < items.length) {
    const halfAngle = RING_HALF_ANGLES[Math.min(ring, RING_HALF_ANGLES.length - 1)];
    const baseRadius = ring === 0 ? FIRST_RING_RADIUS : previousRadius + RING_GAP + previousReach;
    let radius = baseRadius + (items[index].footprint ?? 0);
    let count = 0;
    let used = 0;
    let reach = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      count = 0;
      used = 0;
      reach = 0;
      const available = 2 * halfAngle * radius;
      while (index + count < items.length) {
        const item = items[index + count];
        const need = arcLengthOf(item);
        if (count >= 3 && used + need > available) break;
        used += need;
        reach = Math.max(reach, item.footprint ?? 0);
        count += 1;
      }
      radius = baseRadius + reach;
    }
    let cursor = outwardAngle - halfAngle;
    for (let slot = 0; slot < count; slot += 1) {
      const item = items[index + slot];
      const share = arcLengthOf(item) / used * 2 * halfAngle;
      const angle = cursor + share / 2;
      cursor += share;
      positions.set(item.id, {
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius
      });
    }
    clusterRadius = radius + reach + 6;
    previousRadius = radius;
    previousReach = reach;
    index += count;
    ring += 1;
  }
  return { positions, clusterRadius };
}
function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  return (angle % twoPi + twoPi) % twoPi;
}
var CHAT_OFFSET = 26;
function placeChatsBesidePages(nodes, edges, positions) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const at2 = (node) => positions?.get(node.id) ?? node;
  const placed = /* @__PURE__ */ new Set();
  let order = 0;
  for (const chat of nodes) {
    if (chat.contentKind !== "chat") continue;
    const pages = edges.filter((edge) => edge.source === chat.id || edge.target === chat.id).map((edge) => byId.get(edge.source === chat.id ? edge.target : edge.source)).filter((node) => node?.kind === "page" && node.contentKind !== "chat").map(at2);
    if (pages.length === 0) continue;
    const mean = (axis) => pages.reduce((sum, page) => sum + (page[axis] ?? 0), 0) / pages.length;
    const angle = Math.atan2(mean("y"), mean("x")) + order * 2.39996;
    order += 1;
    const x = mean("x") + Math.cos(angle) * CHAT_OFFSET;
    const y = mean("y") + Math.sin(angle) * CHAT_OFFSET;
    if (positions) positions.set(chat.id, { x, y, z: mean("z") });
    else {
      chat.x = x;
      chat.y = y;
    }
    placed.add(chat.id);
  }
  return placed;
}
function planThoughtTopology(payload, options = {}) {
  const preview = Boolean(options.preview);
  const normalizeFolderPath = normalizeTopologyScopePath;
  const requestedScope = options.scopeFolderPath ? normalizeFolderPath(options.scopeFolderPath) : "";
  const sourceRoot = payload.folders.find((folder) => folder.depth === 0) ?? null;
  const sourceScope = requestedScope ? payload.folders.find((folder) => normalizeFolderPath(folder.path) === requestedScope) ?? null : null;
  const scopedFolders = requestedScope ? sourceScope && sourceRoot ? [
    sourceRoot,
    ...payload.folders.filter(
      (folder) => folder.id === sourceScope.id || normalizeFolderPath(folder.path).startsWith(`${requestedScope}/`)
    ).map((folder) => {
      if (folder.id === sourceScope.id) {
        return { ...folder, parentId: sourceRoot.id, depth: 1 };
      }
      const relativePath = normalizeFolderPath(folder.path).slice(requestedScope.length + 1);
      const relativeDepth = relativePath.split("/").filter(Boolean).length;
      return { ...folder, depth: relativeDepth + 1 };
    })
  ] : sourceRoot ? [sourceRoot] : [] : payload.folders;
  const requestedExclusions = new Set(options.excludedFolderIds ?? []);
  const scopedById = new Map(scopedFolders.map((folder) => [folder.id, folder]));
  const exclusionOf = /* @__PURE__ */ new Map();
  const resolveExclusion = (folderId) => {
    if (exclusionOf.has(folderId)) return exclusionOf.get(folderId);
    const folder = scopedById.get(folderId);
    let result = null;
    if (folder && folder.depth > 0) {
      if (requestedExclusions.has(folder.id)) result = "own";
      else if (folder.parentId && resolveExclusion(folder.parentId)) result = "inherited";
    }
    exclusionOf.set(folderId, result);
    return result;
  };
  for (const folder of scopedFolders) resolveExclusion(folder.id);
  const folders = scopedFolders.filter((folder) => !exclusionOf.get(folder.id));
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const scopedChildren = /* @__PURE__ */ new Map();
  for (const folder of scopedFolders) {
    if (folder.parentId === null) continue;
    const children = scopedChildren.get(folder.parentId) ?? [];
    children.push(folder);
    scopedChildren.set(folder.parentId, children);
  }
  const ownPageCount = /* @__PURE__ */ new Map();
  for (const node of payload.nodes) ownPageCount.set(node.folderId, (ownPageCount.get(node.folderId) ?? 0) + 1);
  const scopedPageCount = /* @__PURE__ */ new Map();
  const subtreePageCount = (folderId) => {
    if (scopedPageCount.has(folderId)) return scopedPageCount.get(folderId);
    const count = (ownPageCount.get(folderId) ?? 0) + (scopedChildren.get(folderId) ?? []).reduce((sum, child) => sum + subtreePageCount(child.id), 0);
    scopedPageCount.set(folderId, count);
    return count;
  };
  const folderOptions = scopedFolders.filter((folder) => folder.depth === 1 || folder.depth === 2).sort((left, right) => left.depth - right.depth || naturalCompare(left.path, right.path)).map((folder) => ({
    id: folder.id,
    title: folder.title,
    path: folder.path,
    depth: folder.depth,
    parentId: folder.depth === 1 ? null : folder.parentId,
    pageCount: subtreePageCount(folder.id),
    excluded: Boolean(exclusionOf.get(folder.id)),
    inheritedExclusion: exclusionOf.get(folder.id) === "inherited"
  }));
  const pages = payload.nodes.filter(
    (node) => folderById.has(node.folderId) && (!requestedScope || !sourceRoot || node.folderId !== sourceRoot.id)
  );
  const directPages = /* @__PURE__ */ new Map();
  for (const page of pages) {
    const list = directPages.get(page.folderId) ?? [];
    list.push(page);
    directPages.set(page.folderId, list);
  }
  const subtreeCount = /* @__PURE__ */ new Map();
  const countSubtree = (folderId) => {
    if (subtreeCount.has(folderId)) return subtreeCount.get(folderId);
    const own2 = directPages.get(folderId)?.length ?? 0;
    const children = (scopedChildren.get(folderId) ?? []).filter((folder) => folderById.has(folder.id));
    const total = own2 + children.reduce((sum, child) => sum + countSubtree(child.id), 0);
    subtreeCount.set(folderId, total);
    return total;
  };
  for (const folder of folders) countSubtree(folder.id);
  const hiddenFolders = scopedFolders.filter((folder) => exclusionOf.get(folder.id)).map((folder) => ({ id: folder.id, title: folder.title, reason: "excluded" }));
  const root = folders.find((folder) => folder.depth === 0) ?? null;
  const rootPages = root ? directPages.get(root.id) ?? [] : [];
  const topFolders = folders.filter((folder) => folder.depth === 1).sort((left, right) => naturalCompare(left.path, right.path));
  const sectorFolders = rootPages.length > 0 && root ? [...topFolders, root] : topFolders;
  const semanticEdges = payload.edges.filter(
    (edge) => !edge.structural && edge.source !== edge.target
  );
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const degree = /* @__PURE__ */ new Map();
  const bridgeDegree = /* @__PURE__ */ new Map();
  const topLevelOf = (folderId) => {
    let current = folderById.get(folderId);
    while (current && current.depth > 1)
      current = current.parentId ? folderById.get(current.parentId) : void 0;
    return current?.id ?? null;
  };
  for (const edge of semanticEdges) {
    const source = pageById.get(edge.source);
    const target = pageById.get(edge.target);
    if (!source || !target) continue;
    degree.set(source.id, (degree.get(source.id) ?? 0) + 1);
    degree.set(target.id, (degree.get(target.id) ?? 0) + 1);
    if (topLevelOf(source.folderId) !== topLevelOf(target.folderId)) {
      bridgeDegree.set(source.id, (bridgeDegree.get(source.id) ?? 0) + 1);
      bridgeDegree.set(target.id, (bridgeDegree.get(target.id) ?? 0) + 1);
    }
  }
  const maxWords = Math.max(1, ...pages.map((page) => page.wordCount ?? 0));
  const importanceOf = (page) => (degree.get(page.id) ?? 0) * 3 + (bridgeDegree.get(page.id) ?? 0) * 2 + (page.wordCount ?? 0) / maxWords * 1.5;
  let keptPageIds = null;
  let keptEdgeIds = null;
  if (preview) {
    const pageBudget = options.previewPageBudget ?? 10;
    const bridgeBudget = options.previewBridgeBudget ?? 6;
    const bridges = semanticEdges.filter((edge) => {
      const source = pageById.get(edge.source);
      const target = pageById.get(edge.target);
      return source && target && topLevelOf(source.folderId) !== topLevelOf(target.folderId);
    }).sort(
      (left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id)
    ).slice(0, bridgeBudget);
    keptEdgeIds = new Set(bridges.map((edge) => edge.id));
    keptPageIds = new Set(bridges.flatMap((edge) => [edge.source, edge.target]));
    for (const id3 of options.previewKeepPageIds ?? []) {
      if (pageById.has(id3)) keptPageIds.add(id3);
    }
    const ranked = [...pages].sort(
      (left, right) => importanceOf(right) - importanceOf(left) || naturalCompare(left.title, right.title)
    );
    if (bridges.length === 0) {
      const perFolder = /* @__PURE__ */ new Map();
      for (const page of ranked) {
        const key = topLevelOf(page.folderId) ?? "root";
        const seen = perFolder.get(key) ?? 0;
        if (seen >= 2 || keptPageIds.size >= pageBudget) continue;
        perFolder.set(key, seen + 1);
        keptPageIds.add(page.id);
      }
    }
    for (const page of ranked) {
      if (keptPageIds.size >= pageBudget) break;
      keptPageIds.add(page.id);
    }
    if (bridges.length === 0) {
      const kept = keptPageIds;
      const local = semanticEdges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)).sort(
        (left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id)
      ).slice(0, bridgeBudget);
      for (const edge of local) keptEdgeIds.add(edge.id);
    }
  }
  const visiblePages = pages.filter((page) => {
    if (!folderById.has(page.folderId)) return false;
    return keptPageIds ? keptPageIds.has(page.id) : true;
  });
  const visiblePagesByFolder = /* @__PURE__ */ new Map();
  for (const page of visiblePages) {
    const list = visiblePagesByFolder.get(page.folderId) ?? [];
    list.push(page);
    visiblePagesByFolder.set(page.folderId, list);
  }
  const weights = sectorFolders.map((folder) => Math.sqrt((subtreeCount.get(folder.id) ?? 0) + 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const sectorAngles = [];
  let cursor = -Math.PI / 2;
  sectorFolders.forEach((_, index) => {
    const arc = Math.PI * 2 * weights[index] / totalWeight;
    sectorAngles.push(sectorFolders.length === 1 ? -Math.PI / 2 : cursor + arc / 2);
    cursor += arc;
  });
  const orderedChildren = /* @__PURE__ */ new Map();
  const childFolders = (folderId) => {
    if (!orderedChildren.has(folderId)) orderedChildren.set(
      folderId,
      (scopedChildren.get(folderId) ?? []).filter((folder) => folder.depth > 1 && folderById.has(folder.id)).sort((left, right) => naturalCompare(left.path, right.path))
    );
    return orderedChildren.get(folderId);
  };
  const orderedPagesByFolder = /* @__PURE__ */ new Map();
  const orderedPages = (folderId) => {
    if (!orderedPagesByFolder.has(folderId)) orderedPagesByFolder.set(
      folderId,
      [...visiblePagesByFolder.get(folderId) ?? []].sort(
        (left, right) => naturalCompare(left.title, right.title) || left.id.localeCompare(right.id)
      )
    );
    return orderedPagesByFolder.get(folderId);
  };
  const nodes = [];
  const sectors = [];
  const clusterRadii = [];
  const pendingSectorAnchors = [];
  const folderNode = (folder, sectorId, x, y, radius) => ({
    id: folder.id,
    kind: "folder",
    contentKind: null,
    sourceKind: null,
    title: folder.title,
    label: displayFolderTitle(folder.title),
    x,
    y,
    radius,
    folderId: folder.parentId,
    sectorId,
    folderPath: folder.path,
    folderTitle: (() => {
      const parent = folder.parentId ? folderById.get(folder.parentId) : void 0;
      return parent && parent.depth > 0 ? displayFolderTitle(parent.title) : "";
    })(),
    navigateSlug: folder.pageSlug,
    summary: folder.summary,
    concepts: [],
    degree: 0,
    bridgeDegree: 0,
    importance: 100,
    nodeCount: directPages.get(folder.id)?.length ?? 0,
    subtreeCount: subtreeCount.get(folder.id) ?? 0
  });
  const pageNode = (page, sectorId, x, y) => {
    const folder = folderById.get(page.folderId);
    const importance = importanceOf(page);
    return {
      id: page.id,
      kind: "page",
      contentKind: page.kind ?? null,
      sourceKind: topologySourceKind(page, folder?.path),
      title: page.title,
      label: page.title,
      x,
      y,
      radius: importance >= 3 ? IMPORTANT_PAGE_RADIUS : PAGE_RADIUS,
      folderId: page.folderId,
      sectorId,
      folderPath: folder?.path ?? "",
      folderTitle: folder ? folder.depth === 0 ? "Garden root" : displayFolderTitle(folder.title) : "",
      navigateSlug: page.slug,
      summary: page.summary,
      concepts: [.../* @__PURE__ */ new Set([...page.primaryConcepts, ...page.supportingConcepts])],
      topic: page.topic,
      degree: degree.get(page.id) ?? 0,
      bridgeDegree: bridgeDegree.get(page.id) ?? 0,
      importance,
      nodeCount: 0,
      subtreeCount: 0
    };
  };
  const itemsByFolder = /* @__PURE__ */ new Map();
  function folderItems(id3) {
    const cached = itemsByFolder.get(id3);
    if (cached) return cached;
    const items = orderedPages(id3).map((page) => ({ id: page.id, radius: PAGE_RADIUS }));
    for (const child of childFolders(id3)) {
      const children = folderItems(child.id);
      const footprint = children.length ? packCluster(children, { x: 0, y: 0 }, 0).clusterRadius : EMPTY_SUBFOLDER_FOOTPRINT;
      items.push({ id: child.id, radius: SUBFOLDER_RADIUS, footprint });
    }
    itemsByFolder.set(id3, items);
    return items;
  }
  for (let index = 0; index < sectorFolders.length; index += 1) {
    const folder = sectorFolders[index];
    const items = folderItems(folder.id);
    const measured = packCluster(items, { x: 0, y: 0 }, 0);
    clusterRadii.push(measured.clusterRadius);
    pendingSectorAnchors.push({ folder, angle: sectorAngles[index], items });
  }
  let anchorDistance = MIN_ANCHOR_DISTANCE;
  for (let index = 0; index < sectorFolders.length && sectorFolders.length > 1; index += 1) {
    const next = (index + 1) % sectorFolders.length;
    const gap = normalizeAngle(sectorAngles[next] - sectorAngles[index]) || Math.PI * 2;
    const needed = (clusterRadii[index] + clusterRadii[next] + SECTOR_MARGIN) / (2 * Math.sin(Math.min(Math.PI, gap) / 2));
    anchorDistance = Math.max(anchorDistance, needed);
  }
  anchorDistance = Math.max(anchorDistance, Math.max(0, ...clusterRadii) * 0.45 + 90);
  const garden = {
    id: `garden:${payload.garden.slug}`,
    kind: "garden",
    contentKind: null,
    sourceKind: null,
    title: payload.garden.title,
    label: payload.garden.title,
    x: 0,
    y: 0,
    radius: GARDEN_RADIUS,
    folderId: null,
    sectorId: null,
    folderPath: "",
    folderTitle: "",
    summary: payload.garden.summary,
    concepts: [],
    degree: 0,
    bridgeDegree: 0,
    importance: 1e3,
    nodeCount: rootPages.length,
    subtreeCount: pages.length
  };
  nodes.push(garden);
  pendingSectorAnchors.forEach(({ folder, angle, items }, index) => {
    const anchor = { x: Math.cos(angle) * anchorDistance, y: Math.sin(angle) * anchorDistance };
    sectors.push({ folderId: folder.id, angle, clusterRadius: clusterRadii[index] });
    nodes.push(folderNode(folder, folder.id, anchor.x, anchor.y, FOLDER_RADIUS));
    function placeChildren(parentId, center, heading, children) {
      const { positions } = packCluster(children, center, heading);
      for (const page of orderedPages(parentId)) {
        const position = positions.get(page.id);
        nodes.push(pageNode(page, folder.id, position.x, position.y));
      }
      for (const child of childFolders(parentId)) {
        const position = positions.get(child.id);
        nodes.push(folderNode(child, folder.id, position.x, position.y, SUBFOLDER_RADIUS));
        const outward = Math.atan2(position.y - center.y, position.x - center.x);
        placeChildren(child.id, position, outward, folderItems(child.id));
      }
    }
    placeChildren(folder.id, anchor, angle, items);
  });
  const payloadNodes = new Map(payload.nodes.map((node) => [node.id, node]));
  const payloadFolders = new Map(payload.folders.map((folder) => [folder.id, folder]));
  for (const node of nodes) {
    const durable = node.kind === "page" ? payloadNodes.get(node.id) : node.kind === "folder" ? payloadFolders.get(node.id) : null;
    if (durable && Number.isFinite(durable.x) && Number.isFinite(durable.y)) {
      node.x = durable.x;
      node.y = durable.y;
    }
  }
  const placedChats = placeChatsBesidePages(nodes, payload.edges);
  if (options.positionOverrides) {
    for (const node of nodes) {
      const override = options.positionOverrides[node.id];
      if (override && Number.isFinite(override.x) && Number.isFinite(override.y)) {
        node.x = override.x;
        node.y = override.y;
      }
    }
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const hierarchyEdges = payload.sourceHierarchy ? payload.sourceHierarchy.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target)) : nodes.filter((node) => node.kind !== "garden" && !placedChats.has(node.id)).map((node) => {
    let folderId = node.folderId;
    let parentId = garden.id;
    while (folderId) {
      const parentFolder = folderById.get(folderId);
      if (node.kind === "folder" && parentFolder?.depth === 0) break;
      const visibleFolder = nodeById.get(folderId);
      if (visibleFolder?.kind === "folder" && visibleFolder.id !== node.id) {
        parentId = visibleFolder.id;
        break;
      }
      folderId = parentFolder?.parentId ?? null;
    }
    return {
      id: `hierarchy:${parentId}:${node.id}`,
      source: parentId,
      target: node.id
    };
  });
  const threshold = payload.build.threshold;
  const requestedMinStrength = options.minConnectionStrength ?? 0;
  const minStrength = Number.isFinite(requestedMinStrength) ? Math.min(1, Math.max(0, requestedMinStrength)) : 0;
  const edges = semanticEdges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target)).filter((edge) => keptEdgeIds ? keptEdgeIds.has(edge.id) : true).map((edge) => {
    const origin = edge.origin ?? "inferred";
    const score = edge.score ?? 0;
    const edgeThreshold = edge.threshold ?? threshold;
    const strength = origin === "inferred" ? connectionStrength(score, edgeThreshold) : AUTHORED_CONNECTION_STRENGTH;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const related = /^(?:(?:cross|inter)[-_]garden[-_])?related(?:[-_]to)?$/.test(edge.relationType ?? "related");
    const affinity = connectionStrength(score, edgeThreshold);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      origin,
      score,
      previousScore: edge.previousScore,
      threshold: edge.threshold,
      components: edge.components,
      relationType: edge.relationType ?? "related",
      direction: edge.direction ?? "undirected",
      explanation: edge.explanation ?? { state: "pending", text: "" },
      evidence: edge.evidence ?? [],
      crossFolder: source.sectorId !== target.sectorId,
      strength,
      width: related ? 0.72 + 0.55 * affinity : CONNECTION_STROKE_WIDTH,
      opacity: mapThreadOpacity(false, related ? affinity : strength)
    };
  }).filter((edge) => minStrength <= 0 || edge.strength >= minStrength);
  if (!payload.sourceHierarchy) edges.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const cappedEdges = capConnectionsPerNode(edges, options.maxConnectionsPerNode ?? 0);
  const bounds = boundsOf(nodes, 28);
  return {
    garden,
    scopeFolder: sourceScope ? { id: sourceScope.id, path: sourceScope.path, title: sourceScope.title } : null,
    nodes,
    hierarchyEdges,
    edges: cappedEdges,
    sectors,
    hiddenFolders,
    folderOptions,
    meaningfulFolderIds: topFolders.map((folder) => folder.id),
    visiblePageCount: visiblePages.length,
    totalPageCount: pages.length,
    bounds,
    analysis: analysisStatus(payload)
  };
}
function boundsOf(nodes, padding = 0) {
  if (nodes.length === 0) return { minX: -padding, minY: -padding, maxX: padding, maxY: padding };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const radius = node.radius ?? 0;
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}
var LABEL_PROXIMITY_GAP = 10;
function labelClearanceRadius(nodeRadius, labelWidth, labelHeight, layoutScale = 1) {
  const radius = Number.isFinite(nodeRadius) ? Math.max(0, nodeRadius) : 0;
  const width = Number.isFinite(labelWidth) ? Math.max(0, labelWidth) : 0;
  const height = Number.isFinite(labelHeight) ? Math.max(0, labelHeight) : 0;
  const scale = Number.isFinite(layoutScale) ? Math.max(1, layoutScale) : 1;
  return Math.max(
    radius + LABEL_PROXIMITY_GAP,
    Math.hypot(width, height) / (2 * scale) + LABEL_PROXIMITY_GAP
  );
}
function labelAwareLinkDistance(homeDistance, sourceClearance, targetClearance) {
  const authoredDistance = Number.isFinite(homeDistance) ? Math.max(0, homeDistance) : 0;
  const source = Number.isFinite(sourceClearance) ? Math.max(0, sourceClearance) : 0;
  const target = Number.isFinite(targetClearance) ? Math.max(0, targetClearance) : 0;
  return Math.max(44, authoredDistance, source + target + 12);
}
function fitTransform(bounds, viewport, insets, limits = { minScale: 0.35, maxScale: 1.4 }, focus) {
  const usableWidth = Math.max(80, viewport.width - insets.left - insets.right);
  const usableHeight = Math.max(80, viewport.height - insets.top - insets.bottom);
  const centerX = insets.left + usableWidth / 2;
  const centerY = insets.top + usableHeight / 2;
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const unpinnedScale = Math.min(usableWidth / boundsWidth, usableHeight / boundsHeight);
  if (focus) {
    const halfWidth = Math.max(1, Math.abs(bounds.minX - focus.x), Math.abs(bounds.maxX - focus.x));
    const halfHeight = Math.max(1, Math.abs(bounds.minY - focus.y), Math.abs(bounds.maxY - focus.y));
    const pinnedScale = Math.min(usableWidth / (2 * halfWidth), usableHeight / (2 * halfHeight));
    if (pinnedScale >= unpinnedScale * 0.8) {
      const k2 = Math.min(limits.maxScale, Math.max(limits.minScale, pinnedScale));
      return {
        k: k2,
        x: centerX - k2 * (focus.x + viewport.width / 2),
        y: centerY - k2 * (focus.y + viewport.height / 2)
      };
    }
  }
  const k = Math.min(limits.maxScale, Math.max(limits.minScale, unpinnedScale));
  const boundsCenterX = (bounds.minX + bounds.maxX) / 2 + viewport.width / 2;
  const boundsCenterY = (bounds.minY + bounds.maxY) / 2 + viewport.height / 2;
  return { k, x: centerX - k * boundsCenterX, y: centerY - k * boundsCenterY };
}
var LABEL_GAP = 5;
var LABEL_PADDING = 3;
function rectForSide(candidate, side) {
  const { x, y, radius, width, height } = candidate;
  switch (side) {
    case "right": {
      const left = x + radius + LABEL_GAP;
      return {
        side,
        dx: radius + LABEL_GAP,
        dy: 0,
        anchorX: 0,
        anchorY: 0.5,
        rect: { left, top: y - height / 2, right: left + width, bottom: y + height / 2 }
      };
    }
    case "left": {
      const right = x - radius - LABEL_GAP;
      return {
        side,
        dx: -(radius + LABEL_GAP),
        dy: 0,
        anchorX: 1,
        anchorY: 0.5,
        rect: { left: right - width, top: y - height / 2, right, bottom: y + height / 2 }
      };
    }
    case "above": {
      const bottom = y - radius - LABEL_GAP;
      return {
        side,
        dx: 0,
        dy: -(radius + LABEL_GAP),
        anchorX: 0.5,
        anchorY: 1,
        rect: { left: x - width / 2, top: bottom - height, right: x + width / 2, bottom }
      };
    }
    default: {
      const top = y + radius + LABEL_GAP;
      return {
        side: "below",
        dx: 0,
        dy: radius + LABEL_GAP,
        anchorX: 0.5,
        anchorY: 0,
        rect: { left: x - width / 2, top, right: x + width / 2, bottom: top + height }
      };
    }
  }
}
function rectsOverlap(left, right, padding) {
  return !(left.right + padding <= right.left || right.right + padding <= left.left || left.bottom + padding <= right.top || right.bottom + padding <= left.top);
}
function circleHitsRect(circle, rect, padding) {
  const nearestX = Math.max(rect.left - padding, Math.min(circle.x, rect.right + padding));
  const nearestY = Math.max(rect.top - padding, Math.min(circle.y, rect.bottom + padding));
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}
function placeLabels(candidates, obstacles, clip, blocked = []) {
  const placed = /* @__PURE__ */ new Map();
  const rects = [...blocked];
  const ordered = [...candidates].sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id)
  );
  const attempt = (candidate, ignoreSoft) => {
    for (const side of candidate.sides) {
      const placement = rectForSide(candidate, side);
      const rect = placement.rect;
      if (rect.left < clip.left || rect.top < clip.top || rect.right > clip.right || rect.bottom > clip.bottom)
        continue;
      if (rects.some((existing) => rectsOverlap(existing, rect, LABEL_PADDING))) continue;
      if (obstacles.some(
        (obstacle) => obstacle.id !== candidate.id && !(ignoreSoft && obstacle.soft) && circleHitsRect(obstacle, rect, 1)
      ))
        continue;
      return placement;
    }
    return null;
  };
  for (const candidate of ordered) {
    const placement = attempt(candidate, false) ?? (candidate.overlapSoft ? attempt(candidate, true) : null);
    if (!placement) continue;
    placed.set(candidate.id, placement);
    rects.push(placement.rect);
  }
  return placed;
}
function pageLabelSides(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? ["right", "below", "above", "left"] : ["left", "below", "above", "right"];
  }
  return dy >= 0 ? ["below", "right", "left", "above"] : ["above", "right", "left", "below"];
}
function folderLabelSides(angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  if (cos > 0.35) return ["left", "below", "above", "right"];
  if (cos < -0.35) return ["right", "below", "above", "left"];
  return sin < 0 ? ["below", "left", "right", "above"] : ["above", "left", "right", "below"];
}
function pageLabelBudget(zoomRatio, base = 8) {
  if (!Number.isFinite(zoomRatio) || zoomRatio <= 1.12) return base;
  return base + Math.floor((zoomRatio - 1.12) * 30);
}

// quartz/components/scripts/thoughtTopology3DRenderer.ts
var CLICK_SLOP_PX = 5;
var NODE_CLICK_TARGET_RADIUS_PX = 14;
var RIGHT_DOUBLE_CLICK_MS = 500;
var EMPTY_LESSON_PAGES_NOTICE = /No lesson pages have been generated yet\.?/gi;
var PAGE_LABEL_WRAP_PX = 128;
var FOLDER_LABEL_WRAP_PX = 180;
var GARDEN_LABEL_WRAP_PX = 230;
var ENTRANCE_SIMULATION_NODE_LIMIT = 300;
var INITIAL_NODE_BATCH = 200;
var INITIAL_EDGE_BATCH = 400;
var POSITION_STORAGE_PREFIX = "thought-topology-3d-home-positions:v1:";
function readStoredPositions(slug2) {
  try {
    const raw = window.localStorage.getItem(`${POSITION_STORAGE_PREFIX}${slug2}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeStoredPositions(slug2, positions) {
  try {
    window.localStorage.setItem(`${POSITION_STORAGE_PREFIX}${slug2}`, JSON.stringify(positions));
  } catch {
  }
}
function withoutEmptyLessonPagesNotice(value) {
  return value.replace(EMPTY_LESSON_PAGES_NOTICE, "").replace(/\s*[|:\-–—]\s*$/, "").trim();
}
var CONNECTION_CAP_CHOICES = [
  { value: 0, label: "All connections" },
  { value: 5, label: "Strongest 5 per page" },
  { value: 3, label: "Strongest 3 per page" },
  { value: 1, label: "Strongest 1 per page" }
];
var SETTINGS_STORAGE_PREFIX = "thought-topology-settings:v1:";
var DEFAULT_SETTINGS = {
  excludedFolderIds: [],
  grouping: "garden",
  activity: "off",
  minConnectionStrength: 0,
  showHierarchy: true,
  // A large Garden draws thousands of links; each page keeping its five
  // strongest reads far better by default, and "All connections" is one
  // click away in the Filters panel.
  maxConnectionsPerNode: 5
};
function readStoredSettings(scope, defaults) {
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${scope}`);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { ...defaults };
    const strength = Number(parsed.minConnectionStrength);
    const cap = Number(parsed.maxConnectionsPerNode);
    return {
      excludedFolderIds: Array.isArray(parsed.excludedFolderIds) ? parsed.excludedFolderIds.filter((id3) => typeof id3 === "string") : [],
      grouping: parsed.grouping === "community" ? "community" : "garden",
      activity: parsed.activity === "week" || parsed.activity === "today" ? parsed.activity : "off",
      minConnectionStrength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : defaults.minConnectionStrength,
      showHierarchy: parsed.showHierarchy !== false,
      maxConnectionsPerNode: typeof parsed.maxConnectionsPerNode === "number" && Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : defaults.maxConnectionsPerNode
    };
  } catch {
    return { ...defaults };
  }
}
function writeStoredSettings(scope, settings) {
  try {
    window.localStorage.setItem(`${SETTINGS_STORAGE_PREFIX}${scope}`, JSON.stringify(settings));
  } catch {
  }
}
function mixHex(from, to3, t) {
  const unit = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const parse = (value) => {
    const hex = value.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = Number.parseInt(full, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const a = parse(from);
  const b = parse(to3);
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * unit);
  return `#${[channel(0), channel(1), channel(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function isPreviewSurface(config) {
  return Boolean(config.preview) || document.documentElement.classList.contains("quartz-graph-preview");
}
function currentPageIds(payload, fullSlug) {
  const current = topologyNavigationSlug(fullSlug).toLocaleLowerCase();
  if (!current) return [];
  return payload.nodes.filter((node) => {
    const published = topologyNavigationSlug(node.slug).toLocaleLowerCase();
    return published && (current === published || current.endsWith(`/${published}`));
  }).map((node) => node.id);
}
var activitySeenByHost = /* @__PURE__ */ new WeakMap();
async function renderThoughtTopology3D(graph, fullSlug, config, payload, context) {
  const preview = isPreviewSurface(config);
  const isGlobalGraph = graph.classList.contains("global-graph-container");
  const compactSidebar = !isGlobalGraph && Boolean(graph.closest(".right.sidebar"));
  const interactive = !compactSidebar && (!preview || document.documentElement.classList.contains("quartz-graph-preview"));
  const settingsScope = context.scopeFolderPath ? `${payload.garden.slug}:folder:${context.scopeFolderPath}` : `${payload.garden.slug}:root`;
  const defaults = {
    ...DEFAULT_SETTINGS,
    minConnectionStrength: (payload.sourceConnectionCount ?? 0) > 5e3 ? 0.6 : DEFAULT_SETTINGS.minConnectionStrength
  };
  let settings = interactive ? readStoredSettings(settingsScope, defaults) : { ...defaults };
  let disposed = false;
  const renderer = new RenderSlot();
  let active = null;
  let recoveryTimer = null;
  let stableTimer = null;
  let recoveryAttempts = 0;
  let recoveryNotice = null;
  let renderPanel = () => {
  };
  if (!payload.nodes.some((node) => node.topic)) {
    const topics = detectTopics(payload.nodes.filter((n) => n.kind !== "chat").map((n) => ({
      id: n.id,
      title: n.title,
      concepts: n.primaryConcepts ?? []
    })), payload.edges.map((e) => ({ source: e.source, target: e.target, weight: e.score ?? 1 })));
    const byId = new Map(topics.flatMap((t) => t.memberIds.map((id3) => [id3, { index: t.index, label: t.label }])));
    payload = { ...payload, nodes: payload.nodes.map((n) => ({ ...n, topic: byId.get(n.id) })) };
  }
  const scheduleRecovery = () => {
    if (disposed || recoveryTimer !== null) return;
    if (stableTimer !== null) window.clearTimeout(stableTimer);
    stableTimer = null;
    if (recoveryAttempts >= 3) {
      renderer.clear();
      active = null;
      if (!recoveryNotice) {
        recoveryNotice = element(
          "button",
          "thought-topology-retry thought-topology-recovery",
          "Reload map"
        );
        recoveryNotice.type = "button";
        recoveryNotice.title = "The map could not restore its graphics. Reload to try again.";
        recoveryNotice.addEventListener("click", () => {
          recoveryAttempts = 0;
          void remount();
        });
        graph.append(recoveryNotice);
      }
      return;
    }
    const delay = 250 * 2 ** recoveryAttempts;
    recoveryAttempts += 1;
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = null;
      void remount();
    }, delay);
  };
  const remount = async () => {
    if (disposed) return;
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    recoveryTimer = null;
    if (stableTimer !== null) window.clearTimeout(stableTimer);
    stableTimer = null;
    recoveryNotice?.remove();
    recoveryNotice = null;
    try {
      const replacement = await renderer.replace(
        () => mountThoughtTopology(
          graph,
          fullSlug,
          config,
          payload,
          context,
          settings,
          scheduleRecovery
        )
      );
      if (replacement && !disposed) {
        active = replacement;
        stableTimer = window.setTimeout(() => {
          stableTimer = null;
          recoveryAttempts = 0;
        }, 3e4);
        renderPanel();
      }
    } catch {
      active = null;
      scheduleRecovery();
    }
  };
  active = await renderer.replace(
    () => mountThoughtTopology(
      graph,
      fullSlug,
      config,
      payload,
      context,
      settings,
      scheduleRecovery
    )
  ) ?? null;
  const outer = graph.parentElement;
  const panelHost = outer;
  let panel = null;
  if (interactive && !preview && panelHost) {
    panel = element("div", "thought-topology-filter");
    panel.dataset.placement = "surface";
    const toggle = element("button", "thought-topology-filter-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Filters");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/></svg>';
    const toggleText = element("span", "thought-topology-filter-toggle-text", "Filters");
    const badge = element("span", "thought-topology-filter-badge");
    toggle.append(toggleText, badge);
    const body = element("div", "thought-topology-filter-panel");
    body.hidden = true;
    const summary = element("p", "thought-topology-filter-summary");
    const foldersSection = element("section", "thought-topology-filter-section");
    const foldersTitle = element("div", "thought-topology-filter-title");
    foldersTitle.append(element("span", void 0, "Folders"));
    const showAll = element("button", "thought-topology-filter-link", "Show all");
    showAll.type = "button";
    foldersTitle.append(showAll);
    const folderList = element("ul", "thought-topology-filter-folders");
    foldersSection.append(foldersTitle, folderList);
    const display = element("section", "thought-topology-filter-section");
    const picker = (title, choices) => {
      const row = element("label", "thought-topology-filter-row thought-topology-filter-select");
      const input = element("select");
      input.setAttribute("aria-label", title);
      for (const [value, label] of choices) input.add(new Option(label, value));
      row.append(element("span", void 0, title), input);
      display.append(row);
      return input;
    };
    const grouping = picker("Group by", [["garden", "Gardens and folders"], ["community", "Leiden communities"]]);
    const activity = picker("Activity", [["off", "Off"], ["today", "Today"], ["week", "Last 7 days"]]);
    const searchFolders = element("input", "map-folder-search");
    searchFolders.type = "search";
    searchFolders.placeholder = "Search Gardens and folders";
    searchFolders.setAttribute("aria-label", searchFolders.placeholder);
    foldersSection.insertBefore(searchFolders, folderList);
    const linesSection = element("section", "thought-topology-filter-section");
    const linesTitle = element("div", "thought-topology-filter-title");
    linesTitle.append(element("span", void 0, "Connections"));
    const hierarchyRow = element("label", "thought-topology-filter-row");
    const hierarchyInput = element("input");
    hierarchyInput.type = "checkbox";
    hierarchyRow.append(hierarchyInput, element("span", void 0, "Show folder lines"));
    const strengthRow = element("div", "thought-topology-filter-row thought-topology-filter-range");
    const strengthLabel = element("label");
    const strengthId = `thought-topology-strength-${Math.random().toString(36).slice(2, 8)}`;
    strengthLabel.htmlFor = strengthId;
    strengthLabel.textContent = "Hide weaker connections";
    const strengthInput = element("input");
    strengthInput.type = "range";
    strengthInput.id = strengthId;
    strengthInput.min = "0";
    strengthInput.max = "90";
    strengthInput.step = "10";
    const strengthValue = element("span", "thought-topology-filter-range-value");
    strengthRow.append(strengthLabel, strengthInput, strengthValue);
    const capRow = element("label", "thought-topology-filter-row thought-topology-filter-select");
    capRow.append(element("span", void 0, "Per page"));
    const capSelect = element("select");
    for (const choice of CONNECTION_CAP_CHOICES) {
      const option = element("option", void 0, choice.label);
      option.value = String(choice.value);
      capSelect.append(option);
    }
    capRow.append(capSelect);
    linesSection.append(linesTitle, hierarchyRow, strengthRow, capRow);
    const reset = element("button", "thought-topology-filter-link", "Reset filters");
    reset.type = "button";
    const close = element("button", "thought-topology-filter-link", "Close");
    close.type = "button";
    const header = element("header", "map-filter-header");
    header.append(element("strong", void 0, "Filters"), close);
    body.append(header, summary, linesSection, display, foldersSection, reset);
    body.setAttribute("aria-label", "Knowledge map filters");
    panel.append(toggle, body);
    const expandedFolders = /* @__PURE__ */ new Set();
    const describeStrength = (value) => value <= 0 ? "showing all" : `below ${Math.round(value * 100)}%`;
    renderPanel = () => {
      if (!active) return;
      const excluded = new Set(settings.excludedFolderIds);
      const activeCount = excluded.size + (settings.grouping === "garden" ? 0 : 1) + (settings.activity === "off" ? 0 : 1) + (settings.minConnectionStrength !== defaults.minConnectionStrength ? 1 : 0) + (settings.showHierarchy ? 0 : 1) + (settings.maxConnectionsPerNode !== DEFAULT_SETTINGS.maxConnectionsPerNode ? 1 : 0);
      badge.textContent = activeCount > 0 ? String(activeCount) : "";
      badge.hidden = activeCount === 0;
      summary.textContent = `${active.visiblePageCount} of ${active.totalPageCount} pages, ${active.connectionCount} connections shown.`;
      hierarchyInput.checked = settings.showHierarchy;
      grouping.value = settings.grouping;
      activity.value = settings.activity;
      reset.disabled = activeCount === 0;
      strengthInput.value = String(Math.round(settings.minConnectionStrength * 100));
      strengthValue.textContent = describeStrength(settings.minConnectionStrength);
      capSelect.value = String(
        CONNECTION_CAP_CHOICES.some((choice) => choice.value === settings.maxConnectionsPerNode) ? settings.maxConnectionsPerNode : 0
      );
      showAll.hidden = excluded.size === 0;
      folderList.replaceChildren();
      const options = active.folderOptions;
      const children = /* @__PURE__ */ new Map();
      for (const option of options) {
        if (option.depth !== 2 || !option.parentId) continue;
        const list = children.get(option.parentId) ?? [];
        list.push(option);
        children.set(option.parentId, list);
      }
      const row = (option, nested) => {
        const item = element("li", nested ? "nested" : void 0);
        const label = element("label", "thought-topology-filter-row");
        const input = element("input");
        input.type = "checkbox";
        input.checked = !option.excluded;
        input.disabled = option.inheritedExclusion;
        input.addEventListener("change", () => {
          const next = new Set(settings.excludedFolderIds);
          if (input.checked) next.delete(option.id);
          else next.add(option.id);
          void applySettings({ ...settings, excludedFolderIds: [...next] });
        });
        const name = element(
          "span",
          "thought-topology-filter-name",
          displayFolderTitle(option.title)
        );
        const count = element(
          "span",
          "thought-topology-filter-count",
          option.pageCount === 1 ? "1 page" : `${option.pageCount} pages`
        );
        label.append(input, name, count);
        item.append(label);
        return item;
      };
      for (const option of options) {
        if (option.depth !== 1) continue;
        const query = searchFolders.value.trim().toLowerCase();
        const allKids = children.get(option.id) ?? [];
        const kids = !query || option.title.toLowerCase().includes(query) ? allKids : allKids.filter((k) => k.title.toLowerCase().includes(query));
        if (query && !option.title.toLowerCase().includes(query) && !kids.length) continue;
        const item = row(option, false);
        const only = element("button", "thought-topology-filter-link map-only", "Only");
        only.setAttribute("aria-label", "Show only " + displayFolderTitle(option.title));
        only.onclick = () => void applySettings({ ...settings, excludedFolderIds: options.filter((o) => o.depth === 1 && o.id !== option.id).map((o) => o.id) });
        item.append(only);
        if (kids.length > 0) {
          const disclose = element("button", "thought-topology-filter-disclose");
          disclose.type = "button";
          const open = Boolean(query) || expandedFolders.has(option.id);
          disclose.setAttribute("aria-expanded", open ? "true" : "false");
          disclose.textContent = open ? "Hide sub-folders" : kids.length === 1 ? "1 sub-folder" : `${kids.length} sub-folders`;
          disclose.addEventListener("click", () => {
            if (expandedFolders.has(option.id)) expandedFolders.delete(option.id);
            else expandedFolders.add(option.id);
            renderPanel();
          });
          item.append(disclose);
          if (open) {
            const nestedList = element("ul", "thought-topology-filter-folders nested");
            for (const kid of kids) nestedList.append(row(kid, true));
            item.append(nestedList);
          }
        }
        folderList.append(item);
      }
      if (folderList.childElementCount === 0) {
        folderList.append(
          element("li", "thought-topology-filter-empty", searchFolders.value.trim() ? "No matching folders." : "No folders in this view.")
        );
      }
    };
    const applySettings = async (next) => {
      if (disposed) return;
      settings = next;
      writeStoredSettings(settingsScope, settings);
      await remount();
      const canvas = graph.querySelector("canvas");
      if (canvas && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        canvas.animate([{ opacity: 0.72 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
      }
    };
    toggle.addEventListener("click", (e) => {
      body.toggleAttribute("data-instant", e.detail === 0);
      body.hidden = !body.hidden;
      toggle.setAttribute("aria-expanded", body.hidden ? "false" : "true");
      panel?.classList.toggle("open", !body.hidden);
    });
    showAll.addEventListener("click", () => {
      void applySettings({ ...settings, excludedFolderIds: [] });
    });
    close.onclick = () => {
      toggle.click();
      toggle.focus();
    };
    body.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.click();
      }
    };
    searchFolders.oninput = () => renderPanel();
    reset.onclick = () => {
      searchFolders.value = "";
      void applySettings({ ...defaults });
    };
    grouping.onchange = () => void applySettings({ ...settings, grouping: grouping.value === "community" ? "community" : "garden" });
    activity.onchange = () => void applySettings({ ...settings, activity: activity.value });
    hierarchyInput.addEventListener("change", () => {
      void applySettings({ ...settings, showHierarchy: hierarchyInput.checked });
    });
    strengthInput.addEventListener("input", () => {
      strengthValue.textContent = describeStrength(Number(strengthInput.value) / 100);
    });
    capSelect.addEventListener("change", () => {
      void applySettings({ ...settings, maxConnectionsPerNode: Number(capSelect.value) || 0 });
    });
    strengthInput.addEventListener("change", () => {
      void applySettings({ ...settings, minConnectionStrength: Number(strengthInput.value) / 100 });
    });
    for (const type of ["pointerdown", "pointerup", "click", "wheel"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    renderPanel();
    panelHost.append(panel);
  }
  return () => {
    disposed = true;
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    if (stableTimer !== null) window.clearTimeout(stableTimer);
    renderer.clear();
    active = null;
    recoveryNotice?.remove();
    panel?.remove();
  };
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== void 0) node.textContent = text;
  return node;
}
async function mountThoughtTopology(graph, fullSlug, config, payload, context, settings, onRendererInvalidated) {
  const resources = [];
  const cleanup = () => {
    for (const release of resources.splice(0).reverse()) {
      try {
        release();
      } catch (error) {
        console.error(error);
      }
    }
  };
  try {
    const mounted = await mountThoughtTopologyScene(
      graph,
      fullSlug,
      config,
      payload,
      context,
      settings,
      (release) => resources.push(release),
      onRendererInvalidated
    );
    return { ...mounted, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
async function mountThoughtTopologyScene(graph, fullSlug, config, payload, context, settings, onCleanup, onRendererInvalidated) {
  const preview = isPreviewSurface(config);
  const isGlobalGraph = graph.classList.contains("global-graph-container");
  const compactSidebar = !isGlobalGraph && Boolean(graph.closest(".right.sidebar"));
  const interactive = !compactSidebar && (!preview || document.documentElement.classList.contains("quartz-graph-preview"));
  const compact = !interactive && (preview || compactSidebar);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let batchStarted = performance.now();
  const yieldIfNeeded = () => {
    if (performance.now() - batchStarted < 6) return;
    return new Promise((resolve) => window.setTimeout(() => {
      batchStarted = performance.now();
      resolve();
    }, 0));
  };
  const gardenSlug = payload.garden.slug;
  const gardenSpheres = !context.scopeFolderPath && payload.folders.some(
    (folder) => folder.id === "aggregate:root" || folder.id === "profile-thought-topology:root"
  );
  const positionScope = context.scopeFolderPath ? `${gardenSlug}:folder:${context.scopeFolderPath}` : gardenSpheres ? `${gardenSlug}:gardens` : `${gardenSlug}:root`;
  const storedPositions = interactive ? readStoredPositions(positionScope) : {};
  const planOptions = {
    preview: compact,
    previewKeepPageIds: compactSidebar ? currentPageIds(payload, fullSlug) : [],
    scopeFolderPath: context.scopeFolderPath,
    // An explicitly requested route must include every hop, even when the
    // overview's density or folder filters would hide an intermediate page.
    excludedFolderIds: payload.isPagePath ? [] : settings.excludedFolderIds,
    minConnectionStrength: payload.isPagePath ? 0 : settings.minConnectionStrength,
    maxConnectionsPerNode: payload.isPagePath ? 0 : settings.maxConnectionsPerNode
  };
  const plan = planThoughtTopology(payload, planOptions);
  if (gardenSpheres) {
    plan.nodes = plan.nodes.filter((n) => n.id !== plan.garden.id);
    plan.hierarchyEdges = plan.hierarchyEdges.filter((e) => e.source !== plan.garden.id && e.target !== plan.garden.id);
  }
  const largeMap = plan.nodes.length > ENTRANCE_SIMULATION_NODE_LIMIT;
  const animateEntrance = !compact && !reducedMotion && plan.nodes.length <= ENTRANCE_SIMULATION_NODE_LIMIT;
  await yieldIfNeeded();
  const camera = new TopologyCamera3D();
  const basis = compact && !gardenSpheres ? planThoughtTopology(payload, { scopeFolderPath: context.scopeFolderPath }).nodes : plan.nodes;
  const cluster = settings.grouping === "community";
  const plannedHomes = sphericalTopologyPositions(cluster ? basis.map((n) => ({
    ...n,
    sectorId: n.topic ? "community:" + n.topic.index : n.sectorId
  })) : basis, cluster || gardenSpheres);
  const sourcePageOrder = new Map(payload.nodes.map((node, index) => [node.id, index]));
  const orderedNodes = payload.sourceHierarchy ? [...plan.nodes].sort((a, b) => (sourcePageOrder.get(a.id) ?? -1) - (sourcePageOrder.get(b.id) ?? -1)) : plan.nodes;
  placeChatsBesidePages(orderedNodes, payload.edges, plannedHomes);
  await yieldIfNeeded();
  const depthSpread = [...plannedHomes.values()].reduce(
    (extent, point) => Math.max(extent, Math.hypot(point.x, point.y, point.z)),
    180
  );
  for (const planned of plan.nodes) {
    const node = planned;
    const home = plannedHomes.get(node.id);
    const saved = storedPositions[node.id];
    node.x = Number.isFinite(saved?.x) ? saved.x : home.x;
    node.y = Number.isFinite(saved?.y) ? saved.y : home.y;
    node.z = Number.isFinite(saved?.z) ? saved.z : home.z;
  }
  const homePositions = new Map(
    plan.nodes.map((node) => [
      node.id,
      {
        x: node.x,
        y: node.y,
        z: node.z
      }
    ])
  );
  const permanentHomeIds = new Set(Object.keys(storedPositions));
  const isHomeFixed = (node) => node.kind === "garden" || permanentHomeIds.has(node.id);
  const plannedHome = (nodeId) => plannedHomes.get(nodeId);
  const debugEnabled = new URLSearchParams(window.location.search).get("topologyTest") === "1";
  const outer = graph.parentElement;
  const graphRoot = graph.closest(".graph");
  const sibling = (selector) => {
    const surfaceElement = outer?.querySelector(
      `:scope > ${selector}, :scope > .thought-topology-controls > ${selector}`
    );
    if (surfaceElement) return surfaceElement;
    if (!outer?.classList.contains("graph-outer")) return null;
    return graphRoot?.querySelector(`:scope > .thought-topology-meta > ${selector}`);
  };
  const heading = sibling(".thought-topology-heading");
  const headingDescription = heading?.querySelector(
    ":scope > p:not(.thought-topology-analysis)"
  );
  const analysisLine = heading?.querySelector(".thought-topology-analysis");
  const searchPanel = sibling(".global-graph-search");
  const calloutRoot = interactive ? sibling(".thought-callout") : null;
  const calloutContent = calloutRoot;
  const overlayClose = sibling(".global-graph-close");
  const overlayCloseVisibility = overlayClose?.style.visibility ?? "";
  const overlayClosePointerEvents = overlayClose?.style.pointerEvents ?? "";
  const obscureOverlayClose = (obscured) => {
    if (!overlayClose) return;
    overlayClose.style.visibility = obscured ? "hidden" : overlayCloseVisibility;
    overlayClose.style.pointerEvents = obscured ? "none" : overlayClosePointerEvents;
  };
  if (heading) {
    heading.hidden = preview;
    if (headingDescription) {
      headingDescription.textContent = plan.scopeFolder ? `Connections inside ${displayFolderTitle(plan.scopeFolder.title)}.` : "How the ideas in this garden are organized and connected.";
    }
    if (analysisLine) {
      analysisLine.textContent = plan.analysis.notice;
      analysisLine.hidden = !plan.analysis.notice;
    }
  }
  if (searchPanel) searchPanel.hidden = true;
  if (graphRoot) graphRoot.dataset.activeMode = "thought-topology";
  let width = Math.max(graph.offsetWidth, 1);
  let height = Math.max(graph.offsetHeight, 1);
  const isDark = document.documentElement.getAttribute("saved-theme") === "dark" || document.documentElement.dataset.theme === "dark";
  const palette = getComputedStyle(graph);
  const topics = Array.from({ length: 8 }, (_, i) => palette.getPropertyValue("--topology-topic-" + i).trim() || (isDark ? "#b8bfcc" : "#627287"));
  const colors = isDark ? {
    garden: "#60a5fa",
    folder: "#22d3ee",
    page: "#4ade80",
    pageStrong: "#a3e635",
    source: TOPOLOGY_SOURCE_COLORS.dark,
    edge: "#92a198",
    edgeWeak: "#6b7a72",
    edgeStrong: "#dfe7e1",
    hierarchy: "#55635c",
    edgeActive: "#e8ede7",
    edgeSelected: "#60a5fa",
    search: "#facc15",
    topics,
    text: "#ffffff",
    textMuted: "#e0e0e0",
    paper: "#000000"
  } : {
    garden: "#2563eb",
    folder: "#0e7490",
    page: "#15803d",
    pageStrong: "#4d7c0f",
    source: TOPOLOGY_SOURCE_COLORS.light,
    edge: "#40544b",
    edgeWeak: "#93a59b",
    edgeStrong: "#1f3028",
    hierarchy: "#a7b6ad",
    edgeActive: "#0f1a16",
    edgeSelected: "#1d4ed8",
    search: "#a16207",
    topics,
    text: "#233139",
    textMuted: "#45555e",
    paper: "#fffefb"
  };
  const fontFamily = !isDark && palette.getPropertyValue("--bodyFont").trim() || '"Alte Haas Map", "Helvetica Neue", Helvetica, Arial, sans-serif';
  await document.fonts.load("11px " + fontFamily);
  const app = new Application();
  onCleanup(() => {
    if (app.renderer) app.destroy({ removeView: true }, { children: true });
    else app.stage?.destroy({ children: true });
  });
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    // WebGL is substantially more stable for this long-lived, repeatedly
    // remounted scene. Some Chromium/WebGPU devices leave a live but blank
    // canvas after tab suspension or repeated filter/theme remounts.
    preference: "webgl",
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    eventMode: "static"
  });
  graph.appendChild(app.canvas);
  const stage = app.stage;
  stage.sortableChildren = true;
  const world = new Container({ isRenderGroup: true, zIndex: 0 });
  world.sortableChildren = true;
  const hierarchyLayer = new Container({ zIndex: 0 });
  const linkLayer = new Container({ zIndex: 1 });
  const nodeLayer = new Container({ zIndex: 2, sortableChildren: true });
  const plates = new Graphics({ zIndex: 4.5, eventMode: "none" });
  stage.addChild(plates);
  const labelLayer = new Container({ zIndex: 5, isRenderGroup: true });
  hierarchyLayer.visible = settings.showHierarchy;
  world.addChild(hierarchyLayer, linkLayer, nodeLayer);
  stage.addChild(world, labelLayer);
  let transform = zoomIdentity;
  let fitK = 1;
  let viewState = "fit";
  let userMovedView = false;
  let transitioning = false;
  let selectedNodeId = null;
  let selectedEdgeId = null;
  let hoveredNodeId = null;
  let hoveredEdgeId = null;
  let searchQuery = "";
  let searchHits = /* @__PURE__ */ new Set();
  let calloutVisible = false;
  let floatingCalloutTarget = null;
  let renderedCalloutKey = null;
  let inspectedNodeId = null;
  let labelsDirty = true;
  let stopAnimation = false;
  let renderLoop = null;
  let stopSimulation = () => {
  };
  const invalidate = () => {
    labelsDirty = true;
    renderLoop?.invalidate();
  };
  const cleanups = [];
  onCleanup(() => {
    stopAnimation = true;
    renderLoop?.dispose();
    for (const cleanup2 of cleanups.splice(0)) cleanup2();
  });
  const overview = !compactSidebar && outer ? element("div", "map-overview") : null;
  if (overview) {
    overview.append(
      element("strong", void 0, gardenSpheres && payload.garden.id === 0 ? "Knowledge" : plan.scopeFolder?.title || payload.garden.title),
      element("span", void 0, (gardenSpheres ? plan.nodes.filter((n) => n.kind === "folder" && n.id === n.sectorId).length + " Gardens \xB7 " : "") + plan.nodes.length.toLocaleString() + " nodes \xB7 " + (plan.edges.length + (settings.showHierarchy ? plan.hierarchyEdges.length : 0)).toLocaleString() + (payload.sourceConnectionCount === void 0 ? "" : " of " + payload.sourceConnectionCount.toLocaleString()) + " connections")
    );
    outer.append(overview);
    onCleanup(() => overview.remove());
  }
  const inspectorRoot = interactive && outer ? element("aside", "thought-inspector") : null;
  const inspectorContent = inspectorRoot ? element("div", "thought-inspector-content") : null;
  const inspectorClose = inspectorRoot ? element("button", "thought-inspector-close", "\xD7") : null;
  if (inspectorRoot && inspectorContent && inspectorClose) {
    inspectorRoot.setAttribute("role", "complementary");
    inspectorRoot.setAttribute("aria-label", "Map selection");
    inspectorRoot.setAttribute("aria-hidden", "true");
    inspectorClose.type = "button";
    inspectorClose.setAttribute("aria-label", "Close node connections");
    inspectorRoot.append(inspectorClose, inspectorContent);
    outer?.append(inspectorRoot);
    onCleanup(() => inspectorRoot.remove());
  }
  let rendererInvalidated = false;
  const invalidateRenderer = () => {
    if (rendererInvalidated || stopAnimation) return;
    rendererInvalidated = true;
    stopAnimation = true;
    renderLoop?.dispose();
    stopSimulation();
    onRendererInvalidated?.();
  };
  const handleContextLost = (event) => {
    event.preventDefault();
    invalidateRenderer();
  };
  app.canvas.addEventListener("webglcontextlost", handleContextLost);
  cleanups.push(() => app.canvas.removeEventListener("webglcontextlost", handleContextLost));
  const views = [];
  const viewById = /* @__PURE__ */ new Map();
  const hierarchyViews = [];
  const edgeViews = [];
  const neighbours = /* @__PURE__ */ new Map();
  for (const edge of plan.edges) {
    if (!neighbours.has(edge.source)) neighbours.set(edge.source, /* @__PURE__ */ new Set());
    if (!neighbours.has(edge.target)) neighbours.set(edge.target, /* @__PURE__ */ new Set());
    neighbours.get(edge.source).add(edge.target);
    neighbours.get(edge.target).add(edge.source);
  }
  const sectorAngle = new Map(plan.sectors.map((sector) => [sector.folderId, sector.angle]));
  const pageRank = new Map(
    plan.nodes.filter((node) => node.kind === "page").sort(
      (left, right) => right.importance - left.importance || naturalCompare(left.title, right.title)
    ).map((node, index) => [node.id, index])
  );
  const paletteOrder = new Map(payload.folders.filter((folder) => folder.depth === 1).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((folder, index) => [folder.id, folder.gardenTone ?? index]));
  const toneOf = (node) => mapTone(node.topic?.index, paletteOrder.get(node.sectorId ?? ""));
  const tone = (node) => colors.topics[toneOf(node)];
  const labelBorders = topics.map((color) => mixHex(color, "#c3d1c4", 0.82));
  const rawNodes = new Map(payload.nodes.map((n) => [n.id, n]));
  const activityStart = settings.activity === "today" ? (/* @__PURE__ */ new Date()).setHours(0, 0, 0, 0) : Date.now() - 7 * 864e5;
  const counts = /* @__PURE__ */ new Map();
  for (const n of plan.nodes) {
    const count = (rawNodes.get(n.id)?.activityTimes ?? []).filter((t) => t >= activityStart && t <= Date.now()).length;
    if (count) counts.set(n.id, count);
  }
  function activityText(n) {
    const count = counts.get(n.id);
    if (!count || settings.activity === "off") return "";
    return count + (n.contentKind === "chat" ? count === 1 ? " chat session" : " chat sessions" : count === 1 ? " document update" : " document updates") + (settings.activity === "today" ? " today" : " in the last 7 days");
  }
  function labelText(node) {
    return node.kind === "page" ? node.title : node.label;
  }
  function makeLabel(node) {
    const size = 11;
    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: labelText(node),
      alpha: 0,
      visible: false,
      style: {
        fontSize: size,
        fill: node.kind === "page" ? colors.textMuted : colors.text,
        fontFamily,
        fontWeight: !isDark && (node.kind === "garden" || node.id === node.sectorId) ? "700" : "400",
        wordWrap: false,
        wordWrapWidth: node.kind === "garden" ? GARDEN_LABEL_WRAP_PX : node.kind === "folder" ? FOLDER_LABEL_WRAP_PX : PAGE_LABEL_WRAP_PX,
        lineHeight: size * 1.2
      },
      resolution: Math.min((window.devicePixelRatio || 1) * 2, 3)
    });
    return label;
  }
  for (const node of plan.nodes) {
    const gfx = new Sprite({
      anchor: 0.5,
      interactive,
      visible: !largeMap,
      label: node.id,
      eventMode: interactive ? "static" : "none",
      hitArea: new Circle(0, 0, node.radius + 7),
      cursor: interactive && config.drag ? "grab" : "pointer"
    });
    const view = {
      node,
      gfx,
      label: makeLabel(node),
      placement: null,
      labelAlpha: 0,
      labelTarget: 0,
      alpha: 1,
      alphaTarget: 1,
      style: "rest"
    };
    gfx.zIndex = node.kind === "garden" ? 3 : node.kind === "folder" ? 2 : 1;
    gfx.renderable = false;
    nodeLayer.addChild(gfx);
    labelLayer.addChild(view.label);
    views.push(view);
    viewById.set(node.id, view);
    const pause = yieldIfNeeded();
    if (pause) await pause;
  }
  for (const edge of plan.hierarchyEdges) {
    const source = viewById.get(edge.source);
    const target = viewById.get(edge.target);
    if (!source || !target) continue;
    hierarchyViews.push({
      kind: "hierarchy",
      edge: {
        ...edge,
        origin: "provenance",
        score: 1,
        relationType: "contains",
        direction: "source-to-target",
        explanation: {
          state: "ready",
          text: target.node.kind === "folder" ? "The second folder sits inside the first." : "The page is filed in this folder."
        },
        evidence: [],
        crossFolder: false,
        strength: 0,
        width: HIERARCHY_STROKE_WIDTH,
        opacity: mapThreadOpacity(true, 0)
      },
      source,
      target,
      alpha: 0,
      alphaTarget: mapThreadOpacity(true, 0),
      color: colors.hierarchy,
      restColor: mixHex(tone(source.node), colors.hierarchy, 0.4),
      widthBoost: 0,
      selected: false
    });
    const pause = yieldIfNeeded();
    if (pause) await pause;
  }
  for (const edge of plan.edges) {
    const source = viewById.get(edge.source);
    const target = viewById.get(edge.target);
    if (!source || !target) continue;
    const restColor = mixHex(tone(source.node), tone(target.node), 0.5);
    edgeViews.push({
      kind: "semantic",
      edge,
      source,
      target,
      alpha: 0,
      alphaTarget: edge.opacity,
      color: restColor,
      restColor,
      widthBoost: 0,
      selected: false
    });
    const pause = yieldIfNeeded();
    if (pause) await pause;
  }
  const connectionViews = [...hierarchyViews, ...edgeViews];
  const edgeById = new Map(connectionViews.map((view) => [view.edge.id, view]));
  const shaders = createMapShaders(app.canvas, app.canvas.getContext("webgl2"), !isDark);
  const shaderNodes = views.map((view) => view.node);
  const shaderEdges = (settings.showHierarchy ? connectionViews : edgeViews).map((view) => ({
    ...view.edge,
    structural: view.kind === "hierarchy",
    opacity: isDark ? view.edge.opacity : view.edge.opacity * (view.kind === "hierarchy" ? 0.85 : view.edge.crossFolder ? 1.45 : 0.85)
  }));
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const shaderColors = topics.map(rgb), shaderInk = rgb(colors.text);
  shaders.setNodes(shaderNodes, toneOf);
  shaders.setLines(shaderNodes, shaderEdges, toneOf, null);
  shaders.resize(width, height);
  onCleanup(() => shaders.dispose());
  const simNodes = plan.nodes;
  const simNodeById = new Map(simNodes.map((node) => [node.id, node]));
  const labelLayoutScale = compact ? 1.8 : isGlobalGraph ? 1 : 1.15;
  const clearanceById = /* @__PURE__ */ new Map();
  for (const view of views) {
    clearanceById.set(view.node.id, labelClearanceRadius(
      view.node.radius,
      compactSidebar && view.node.kind !== "folder" || !shouldShowTopologyNodeLabel(view.node) ? 0 : view.label.width,
      compactSidebar && view.node.kind !== "folder" || !shouldShowTopologyNodeLabel(view.node) ? 0 : view.label.height,
      labelLayoutScale
    ));
    const pause = yieldIfNeeded();
    if (pause) await pause;
  }
  const returnTargets = /* @__PURE__ */ new Map();
  const returningNodeIds = /* @__PURE__ */ new Set();
  let activeDragNodeId = null;
  for (const node of simNodes) {
    if (isHomeFixed(node)) {
      const home = homePositions.get(node.id);
      node.fx = home?.x ?? node.x;
      node.fy = home?.y ?? node.y;
      node.fz = home?.z ?? node.z;
    } else if (animateEntrance) {
      node.x *= 0.12;
      node.y *= 0.12;
      node.z *= 0.12;
    }
  }
  const links = [...plan.hierarchyEdges, ...plan.edges].flatMap((edge) => {
    const source = simNodeById.get(edge.source);
    const target = simNodeById.get(edge.target);
    const sourceHome = homePositions.get(edge.source);
    const targetHome = homePositions.get(edge.target);
    if (!source || !target || !sourceHome || !targetHome) return [];
    return [
      {
        source,
        target,
        distance: labelAwareLinkDistance(
          Math.hypot(targetHome.x - sourceHome.x, targetHome.y - sourceHome.y),
          clearanceById.get(source.id) ?? source.radius,
          clearanceById.get(target.id) ?? target.radius
        )
      }
    ];
  });
  const homeXForNode = (node) => homePositions.get(node.id)?.x ?? node.x ?? 0;
  const homeYForNode = (node) => homePositions.get(node.id)?.y ?? node.y ?? 0;
  const homeXForce = forceX(homeXForNode).strength(isGlobalGraph ? 0.11 : 0.09);
  const homeYForce = forceY(homeYForNode).strength(isGlobalGraph ? 0.055 : 0.045);
  let simulationSettled = !animateEntrance;
  let positionsDirty = true;
  let draggingNode = false;
  const simulation = forceSimulation(simNodes).stop().force("charge", forceManyBody().strength(-125 * config.repelForce)).force("center", forceCenter(0, 0).strength(config.centerForce)).force(
    "collide",
    forceCollide((node) => clearanceById.get(node.id) ?? node.radius + 7).iterations(
      isGlobalGraph ? 6 : 3
    )
  ).force(
    "link",
    forceLink(links).distance((link) => link.distance)
  ).force("home-x", homeXForce).force("home-y", homeYForce).force("home-z", (alpha) => {
    for (const node of simNodes) {
      if (node.fz != null) {
        node.z = node.fz;
        node.vz = 0;
        continue;
      }
      const target = returnTargets.get(node.id)?.z ?? homePositions.get(node.id)?.z ?? 0;
      node.vz = ((node.vz ?? 0) + (target - node.z) * 0.1 * alpha) * 0.5;
      node.z += node.vz;
    }
  }).alphaDecay(0.018).velocityDecay(0.5).on("tick", () => {
    simulationSettled = false;
    invalidate();
  }).on("end", () => {
    for (const [nodeId, target] of returnTargets) {
      const node = simNodeById.get(nodeId);
      if (!node) continue;
      node.x = target.x;
      node.y = target.y;
      node.z = target.z;
      node.fx = target.pin ? target.x : null;
      node.fy = target.pin ? target.y : null;
      node.fz = target.pin ? target.z : null;
    }
    returnTargets.clear();
    returningNodeIds.clear();
    simulationSettled = true;
    positionsDirty = true;
    invalidate();
    if (viewState === "fit" && !userMovedView && !activeDragNodeId) fitView(true);
  });
  onCleanup(() => simulation.stop());
  stopSimulation = () => {
    simulation.stop();
  };
  if (reducedMotion && !compact && simNodes.length <= ENTRANCE_SIMULATION_NODE_LIMIT) {
    for (let tick = 0; tick < 360; tick++) {
      simulation.tick();
      const pause = yieldIfNeeded();
      if (pause) await pause;
    }
  }
  const projections = /* @__PURE__ */ new WeakMap();
  const projected = (node) => {
    const z = node.z ?? 0;
    let p = projections.get(node);
    if (p && p.px === node.x && p.py === node.y && p.pz === z && p.yaw === camera.yaw && p.pitch === camera.pitch) return p;
    const next = camera.project({ x: node.x, y: node.y, z });
    if (!p) {
      p = { ...next, px: 0, py: 0, pz: 0, yaw: 0, pitch: 0 };
      projections.set(node, p);
    }
    p.x = next.x;
    p.y = next.y;
    p.z = next.z;
    p.px = node.x;
    p.py = node.y;
    p.pz = z;
    p.yaw = camera.yaw;
    p.pitch = camera.pitch;
    return p;
  };
  const worldX = (node) => projected(node).x + width / 2;
  const worldY = (node) => projected(node).y + height / 2;
  const screenOf = (node) => ({
    x: transform.applyX(worldX(node)),
    y: transform.applyY(worldY(node))
  });
  const screenRadius = (node) => 0.25 * mapPointSize(node.kind !== "page", false) * Math.min(2.2, Math.max(0.85, Math.sqrt(transform.k / fitK)));
  function nodeAtScreenPoint(x, y) {
    let match;
    for (const view of views) {
      const position = screenOf(view.node);
      const distance = Math.hypot(x - position.x, y - position.y);
      const hitRadius = Math.max(
        largeMap ? 5 : NODE_CLICK_TARGET_RADIUS_PX,
        (view.node.radius + 7) * Math.sqrt(transform.k)
      );
      const depth = projected(view.node).z;
      if (distance > hitRadius || match && depth <= match.depth) continue;
      match = { view, depth };
    }
    return match?.view;
  }
  function canvasPoint(event) {
    const bounds = app.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function edgeGeometry(view) {
    const x1 = worldX(view.source.node);
    const y1 = worldY(view.source.node);
    const x2 = worldX(view.target.node);
    const y2 = worldY(view.target.node);
    return { x1, y1, x2, y2 };
  }
  function edgePoint(view, t) {
    const g = edgeGeometry(view);
    return {
      x: g.x1 + (g.x2 - g.x1) * t,
      y: g.y1 + (g.y2 - g.y1) * t
    };
  }
  function edgeAt(x, y) {
    const px = transform.invertX(x) - width / 2, py = transform.invertY(y) - height / 2;
    const reach = 4 / transform.k;
    let best = reach * reach, hit;
    for (const edge of connectionViews) {
      if (!canHoverConnection(edge)) continue;
      const a = projected(edge.source.node), b = projected(edge.target.node);
      if (px < Math.min(a.x, b.x) - reach || px > Math.max(a.x, b.x) + reach || py < Math.min(a.y, b.y) - reach || py > Math.max(a.y, b.y) + reach) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const distance = (px - a.x - t * dx) ** 2 + (py - a.y - t * dy) ** 2;
      if (distance < best) {
        best = distance;
        hit = edge;
      }
    }
    return hit;
  }
  const canvasSelection = select(app.canvas);
  const zoomBehavior = zoom().scaleExtent([0.01, 5]).on("zoom", (event) => {
    transform = event.transform;
    world.scale.set(transform.k, transform.k);
    world.position.set(transform.x, transform.y);
    if (event.sourceEvent) {
      viewState = "user";
      userMovedView = true;
    }
    invalidate();
    emitGraphContext();
  });
  function applyTransform(next, animate2) {
    const target = zoomIdentity.translate(next.x, next.y).scale(next.k);
    if (!interactive || !config.zoom) {
      transform = target;
      world.scale.set(target.k, target.k);
      world.position.set(target.x, target.y);
      invalidate();
      return;
    }
    if (animate2 && !reducedMotion) {
      transitioning = true;
      canvasSelection.transition().duration(420).call(zoomBehavior.transform, target).on("end interrupt", () => {
        transitioning = false;
      });
    } else {
      canvasSelection.call(zoomBehavior.transform, target);
    }
  }
  function currentInsets() {
    if (compact) return { top: 10, right: 10, bottom: 10, left: 10 };
    return { top: 14, right: 14, bottom: 14, left: 14 };
  }
  function blockedRects() {
    if (compact) return [];
    const canvasRect = graph.getBoundingClientRect();
    const rects = [];
    for (const blocker of [heading, searchPanel, overlayClose, calloutRoot, inspectorRoot]) {
      if (blocker === calloutRoot && !calloutVisible) continue;
      if (blocker === inspectorRoot && !inspectorRoot?.classList.contains("open")) continue;
      if (!blocker || blocker.hidden || blocker.offsetParent === null) continue;
      const rect2 = blocker.getBoundingClientRect();
      rects.push({
        left: rect2.left - canvasRect.left - 6,
        top: rect2.top - canvasRect.top - 6,
        right: rect2.right - canvasRect.left + 6,
        bottom: rect2.bottom - canvasRect.top + 6
      });
    }
    return rects;
  }
  function fitView(animate2, useHomeLayout = false) {
    const fitNodes = useHomeLayout ? plan.nodes.map((node) => ({ ...node, ...homePositions.get(node.id) ?? {} })) : plan.nodes;
    const gardenAnchor = useHomeLayout ? { ...plan.garden, ...homePositions.get(plan.garden.id) ?? {} } : plan.garden;
    const bounds = boundsOf(
      fitNodes.map((node) => ({ ...projected(node), radius: gardenSpheres ? 0 : node.radius })),
      gardenSpheres ? 0 : compact ? 18 : 44
    );
    const focus = projected(gardenAnchor);
    const halfWidth = Math.max(focus.x - bounds.minX, bounds.maxX - focus.x);
    const halfHeight = Math.max(focus.y - bounds.minY, bounds.maxY - focus.y);
    const next = fitTransform(
      gardenSpheres ? bounds : {
        minX: focus.x - halfWidth,
        maxX: focus.x + halfWidth,
        minY: focus.y - halfHeight,
        maxY: focus.y + halfHeight
      },
      { width, height },
      gardenSpheres ? { left: width * 0.08, right: width * 0.08, top: height * 0.07, bottom: height * 0.07 } : currentInsets(),
      {
        minScale: 0.01,
        maxScale: compact ? 1.25 : 1.35
      },
      gardenSpheres ? void 0 : focus
    );
    fitK = next.k;
    viewState = "fit";
    applyTransform(next, animate2);
  }
  function centerOn(node, animate2) {
    const insets = currentInsets();
    const centerX = insets.left + (width - insets.left - insets.right) / 2;
    const centerY = insets.top + (height - insets.top - insets.bottom) / 2;
    const k = Math.max(transform.k, Math.min(1.6, fitK * 1.3));
    viewState = "focus";
    applyTransform({ k, x: centerX - k * worldX(node), y: centerY - k * worldY(node) }, animate2);
  }
  function sectorMembers(folderId) {
    return new Set(
      plan.nodes.filter((node) => node.sectorId === folderId || node.id === folderId).map((node) => node.id)
    );
  }
  function emphasisFor(nodeId) {
    const node = viewById.get(nodeId)?.node;
    if (!node) return /* @__PURE__ */ new Set();
    if (node.kind === "folder") {
      const members = node.sectorId ? sectorMembers(node.sectorId) : /* @__PURE__ */ new Set([node.id]);
      members.add(node.id);
      return members;
    }
    const set = /* @__PURE__ */ new Set([node.id]);
    for (const neighbour of neighbours.get(node.id) ?? []) set.add(neighbour);
    return set;
  }
  function refreshStyles() {
    if (hoveredEdgeId && !canHoverConnection(edgeById.get(hoveredEdgeId))) hoveredEdgeId = null;
    let emphasis = null;
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : void 0;
    const hoveredEdge = hoveredEdgeId ? edgeById.get(hoveredEdgeId) : void 0;
    const focusedEdge = hoveredEdge ?? selectedEdge;
    if (inspectedNodeId) {
      emphasis = emphasisFor(inspectedNodeId);
    } else if (focusedEdge) {
      emphasis = /* @__PURE__ */ new Set([focusedEdge.edge.source, focusedEdge.edge.target]);
    } else if (selectedNodeId) {
      const selected = viewById.get(selectedNodeId)?.node;
      emphasis = selected && selected.kind !== "garden" ? emphasisFor(selectedNodeId) : null;
    }
    if (!inspectedNodeId && hoveredNodeId && viewById.get(hoveredNodeId)?.node.kind !== "garden") {
      const hovered = emphasisFor(hoveredNodeId);
      emphasis = emphasis ? /* @__PURE__ */ new Set([...emphasis, ...hovered]) : hovered;
    }
    if (searchQuery) {
      emphasis = emphasis ? /* @__PURE__ */ new Set([...emphasis, ...searchHits]) : new Set(searchHits);
    }
    for (const view of views) {
      const id3 = view.node.id;
      const highlighted = !emphasis || emphasis.has(id3);
      const style = selectedNodeId === id3 ? "selected" : hoveredNodeId === id3 ? "hovered" : emphasis && highlighted ? "related" : "rest";
      view.style = style;
      view.alphaTarget = highlighted ? 1 : view.node.kind === "page" ? 0.42 : 0.62;
    }
    for (const view of connectionViews) {
      const { source, target } = view.edge;
      const selected = view.edge.id === selectedEdgeId;
      const hovered = view.edge.id === hoveredEdgeId;
      const touchesFocus = selectedNodeId !== null && (source === selectedNodeId || target === selectedNodeId) || hoveredNodeId !== null && (source === hoveredNodeId || target === hoveredNodeId) || searchQuery !== "" && (searchHits.has(source) || searchHits.has(target));
      const withinEmphasis = emphasis ? emphasis.has(source) && emphasis.has(target) : true;
      const active = inspectedNodeId ? source === inspectedNodeId || target === inspectedNodeId : selected || hovered || touchesFocus || (emphasis === null ? true : withinEmphasis);
      view.selected = selected;
      const base = view.edge.opacity;
      view.alphaTarget = active ? base : base * 0.32;
      view.color = selected ? colors.edgeSelected : hovered ? colors.edgeActive : active && emphasis ? colors.edgeActive : view.restColor;
      view.widthBoost = selected ? 1.2 : hovered ? 0.8 : active && emphasis ? 0.4 : 0;
    }
    invalidate();
  }
  function labelMustStayAttached(nodeId) {
    return nodeId === activeDragNodeId || nodeId === selectedNodeId || nodeId === hoveredNodeId || returningNodeIds.has(nodeId) || permanentHomeIds.has(nodeId);
  }
  function attachedLabelPlacement(view) {
    const position = screenOf(view.node);
    const radius = screenRadius(view.node);
    const labelWidth = view.label.width;
    const labelHeight = view.label.height;
    const gap = 5;
    const horizontal = radius + gap;
    const vertical = radius + gap;
    const options = [
      {
        side: "right",
        dx: horizontal,
        dy: 0,
        anchorX: 0,
        anchorY: 0.5,
        rect: {
          left: position.x + horizontal,
          top: position.y - labelHeight / 2,
          right: position.x + horizontal + labelWidth,
          bottom: position.y + labelHeight / 2
        }
      },
      {
        side: "left",
        dx: -horizontal,
        dy: 0,
        anchorX: 1,
        anchorY: 0.5,
        rect: {
          left: position.x - horizontal - labelWidth,
          top: position.y - labelHeight / 2,
          right: position.x - horizontal,
          bottom: position.y + labelHeight / 2
        }
      },
      {
        side: "below",
        dx: 0,
        dy: vertical,
        anchorX: 0.5,
        anchorY: 0,
        rect: {
          left: position.x - labelWidth / 2,
          top: position.y + vertical,
          right: position.x + labelWidth / 2,
          bottom: position.y + vertical + labelHeight
        }
      },
      {
        side: "above",
        dx: 0,
        dy: -vertical,
        anchorX: 0.5,
        anchorY: 1,
        rect: {
          left: position.x - labelWidth / 2,
          top: position.y - vertical - labelHeight,
          right: position.x + labelWidth / 2,
          bottom: position.y - vertical
        }
      }
    ];
    const overflow = (placement) => Math.max(0, 4 - placement.rect.left) + Math.max(0, 4 - placement.rect.top) + Math.max(0, placement.rect.right - (width - 4)) + Math.max(0, placement.rect.bottom - (height - 4));
    return options.sort((left, right) => overflow(left) - overflow(right))[0];
  }
  const QUIET_NAME_ZOOM = 1.5;
  const gardenCaptions = views.filter((v) => v.node.kind === "folder");
  const isGarden = (n) => n.id === n.sectorId;
  const degreeById = /* @__PURE__ */ new Map();
  for (const edge of [...payload.sourceHierarchy ?? plan.hierarchyEdges, ...payload.edges]) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
  }
  gardenCaptions.sort(({ node: a }, { node: b }) => Number(isGarden(b)) - Number(isGarden(a)) || Number(b.folderId === b.sectorId) - Number(a.folderId === a.sectorId) || (degreeById.get(b.id) ?? 0) - (degreeById.get(a.id) ?? 0) || a.title.localeCompare(b.title));
  function placeGardenCaptions(ratio) {
    const boxes = [];
    const folderGardens = /* @__PURE__ */ new Set();
    const overview2 = ratio < 1.8;
    const budget = Math.max(6, Math.min(overview2 ? 21 : 38, Math.round(width * height / (overview2 ? 3e4 : 23e3))));
    for (const view of views) {
      view.placement = null;
      view.labelTarget = 0;
    }
    for (const view of gardenCaptions) {
      if (boxes.length >= budget) break;
      const { node, label } = view;
      const folder = !isGarden(node);
      if (overview2 && folder && (node.folderId !== node.sectorId || folderGardens.has(node.sectorId) || folderGardens.size >= 4)) continue;
      const { x, y } = screenOf(node);
      if (x < 0 || x > width || y < 8 || y > height - 8) continue;
      const w2 = label.width + 10, h = label.height + 4;
      const left = x + 7 + w2 <= width ? x + 7 : x - 7 - w2;
      const top = y - h / 2;
      if (left < 0 || top < 0 || top + h > height) continue;
      if (boxes.some((b) => left < b.right + 5 && left + w2 > b.left - 5 && top < b.bottom + 4 && top + h > b.top - 4)) continue;
      const rect2 = { left, top, right: left + w2, bottom: top + h };
      boxes.push(rect2);
      view.placement = { side: left > x ? "right" : "left", dx: left + 5 - x, dy: 0, anchorX: 0, anchorY: 0.5, rect: rect2 };
      view.labelTarget = calloutVisible ? 0.3 : 1;
      if (folder) folderGardens.add(node.sectorId);
    }
  }
  function updateLabels() {
    labelsDirty = false;
    const ratio = transform.k / (fitK || 1);
    if (gardenSpheres && !compact && !payload.isPagePath && !selectedNodeId && !selectedEdgeId && !searchQuery) {
      placeGardenCaptions(ratio);
      return;
    }
    const budget = pageLabelBudget(ratio);
    const scale = 1;
    for (const view of views) {
      if (view.label.scale.x !== scale) view.label.scale.set(scale, scale);
    }
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : void 0;
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId)?.node : void 0;
    const selectedNeighbours = selectedNodeId ? neighbours.get(selectedNodeId) ?? /* @__PURE__ */ new Set() : /* @__PURE__ */ new Set();
    const focusedSector = selectedNode?.kind === "folder" ? selectedNode.sectorId : null;
    const candidates = [];
    const obstacles = [];
    const wanted = /* @__PURE__ */ new Set();
    const BUDGET_TIER = 100;
    const budgetTier = /* @__PURE__ */ new Set();
    for (const view of views) {
      const { node } = view;
      const quietName = !shouldShowTopologyNodeLabel(node);
      const inFocus = payload.isPagePath || selectedNodeId === node.id || hoveredNodeId === node.id && !draggingNode || selectedNeighbours.has(node.id) || Boolean(
        selectedEdge && (selectedEdge.edge.source === node.id || selectedEdge.edge.target === node.id)
      ) || Boolean(searchQuery && searchHits.has(node.id));
      if (!inFocus && node.kind === "page" || compactSidebar && node.kind !== "folder" || quietName && !inFocus && ratio < QUIET_NAME_ZOOM) {
        view.placement = null;
        view.labelTarget = 0;
        continue;
      }
      const position = screenOf(node);
      const radius = screenRadius(node);
      obstacles.push({
        id: node.id,
        x: position.x,
        y: position.y,
        radius: radius + 2,
        soft: node.kind === "page"
      });
      let priority = null;
      let sides = ["below", "right", "left", "above"];
      if (node.kind === "page") {
        const anchor = node.sectorId ? viewById.get(node.sectorId)?.node : void 0;
        if (anchor) sides = pageLabelSides(node.x - anchor.x, node.y - anchor.y);
      }
      if (node.kind === "garden") {
        priority = 1e3;
      } else if (node.kind === "folder") {
        priority = node.sectorId === node.id ? 900 + node.subtreeCount * 0.01 : 880;
        const angle = sectorAngle.get(node.sectorId ?? "");
        if (angle !== void 0 && node.sectorId === node.id) sides = folderLabelSides(angle);
      } else if (selectedNodeId === node.id) {
        priority = 800;
      } else if (hoveredNodeId === node.id) {
        priority = 850;
      } else if (selectedEdge && (selectedEdge.edge.source === node.id || selectedEdge.edge.target === node.id)) {
        priority = 800;
      } else if (searchQuery) {
        priority = searchHits.has(node.id) ? 750 : null;
      } else if (selectedNeighbours.has(node.id)) {
        priority = 700;
      } else if (focusedSector && node.sectorId === focusedSector) {
        priority = 600 + node.importance;
      } else {
        priority = BUDGET_TIER + node.importance - (pageRank.get(node.id) ?? 0) * 1e-3;
      }
      if (priority === null) {
        view.placement = null;
        view.labelTarget = 0;
        continue;
      }
      wanted.add(node.id);
      if (priority < 900 && !labelMustStayAttached(node.id)) budgetTier.add(node.id);
      const text = labelText(node);
      if (view.label.text !== text) view.label.text = text;
      candidates.push({
        id: node.id,
        priority,
        x: position.x,
        y: position.y,
        radius,
        width: view.label.width,
        height: view.label.height,
        sides,
        overlapSoft: node.kind !== "page"
      });
    }
    const clip = {
      left: 4,
      top: 4,
      right: width - 4,
      bottom: height - 4
    };
    candidates.sort((a, b) => b.priority - a.priority);
    const overview2 = ratio < 1.8 && !selectedNodeId;
    const gardenFolders = /* @__PURE__ */ new Set();
    const labelBudget = Math.max(6, Math.min(overview2 ? 21 : 38, Math.round(width * height / (overview2 ? 3e4 : 23e3))));
    for (let i = 0; i < candidates.length; ) {
      const node = viewById.get(candidates[i].id).node;
      if (gardenSpheres && overview2 && node.kind === "folder" && node.id !== node.sectorId) {
        if (node.folderId !== node.sectorId || gardenFolders.has(node.sectorId) || gardenFolders.size >= 4) {
          candidates.splice(i, 1);
          continue;
        }
        gardenFolders.add(node.sectorId);
      }
      i++;
    }
    candidates.splice(labelBudget);
    const placements = placeLabels(candidates, obstacles, clip, blockedRects());
    if (compact) {
      const budgetWinners = candidates.filter((candidate) => candidate.priority < 600 && placements.has(candidate.id)).sort((left, right) => right.priority - left.priority);
      for (const loser of budgetWinners.slice(budget)) placements.delete(loser.id);
    }
    for (const view of views) {
      const placement = placements.get(view.node.id) ?? ((compact ? labelMustStayAttached(view.node.id) : labelMustStayAttached(view.node.id) && wanted.has(view.node.id) && !budgetTier.has(view.node.id)) ? attachedLabelPlacement(view) : null);
      view.placement = placement;
      view.labelTarget = placement ? calloutVisible ? 0.3 : view.alphaTarget < 1 ? 0.6 : 1 : 0;
    }
  }
  function showCallout() {
    if (!calloutRoot) return;
    calloutVisible = true;
    calloutRoot.classList.add("visible");
    calloutRoot.setAttribute("aria-hidden", "false");
    invalidate();
  }
  function hideCallout() {
    if (!calloutRoot) return;
    calloutVisible = false;
    floatingCalloutTarget = null;
    renderedCalloutKey = null;
    calloutRoot.classList.remove("visible");
    calloutRoot.setAttribute("aria-hidden", "true");
    invalidate();
  }
  function calloutText(className, text) {
    if (!calloutContent) return;
    const paragraph = element("p", className);
    appendMathText(paragraph, text);
    calloutContent.appendChild(paragraph);
  }
  function appendMathText(target, text) {
    const delimiter = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\.|[^$\n])+?)(?<!\\)\$/g;
    let cursor = 0;
    for (const match of text.matchAll(delimiter)) {
      const index = match.index ?? 0;
      if (index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, index)));
      const displayMode = match[1] !== void 0 || match[2] !== void 0;
      const formula = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
      const math = element(
        "span",
        displayMode ? "thought-callout-math thought-callout-math-display" : "thought-callout-math"
      );
      try {
        katex.render(formula, math, {
          displayMode,
          output: "htmlAndMathml",
          strict: "ignore",
          throwOnError: true,
          trust: false
        });
      } catch {
        math.classList.add("thought-callout-math-fallback");
        math.textContent = match[0];
      }
      target.appendChild(math);
      cursor = index + match[0].length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }
  function calloutTitle(text) {
    const title = element("h2", "thought-callout-title");
    appendMathText(title, text);
    return title;
  }
  function renderNodeCallout(view) {
    if (!calloutContent) return;
    const { node } = view;
    calloutContent.replaceChildren();
    calloutContent.appendChild(calloutTitle(node.title));
    if (node.kind !== "garden") {
      calloutText(
        "thought-callout-path",
        [plan.garden.title, node.folderTitle].filter(Boolean).join(" \u203A ")
      );
    }
    if (node.kind === "garden") {
      calloutText(
        "thought-callout-summary",
        gardenOverview(plan, plan.garden.title, payload.garden.summary)
      );
      calloutText(
        "thought-callout-meta",
        `${plan.meaningfulFolderIds.length} folders \xB7 ${plan.totalPageCount} pages \xB7 ${plan.edges.length} semantic connections`
      );
    } else if (node.kind === "folder") {
      calloutText(
        "thought-callout-summary",
        readableSummary(node.summary, {
          title: node.title,
          folderTitle: node.folderTitle || plan.garden.title
        })
      );
      calloutText(
        "thought-callout-meta",
        `${node.subtreeCount} ${node.subtreeCount === 1 ? "page" : "pages"}`
      );
    } else {
      calloutText(
        "thought-callout-summary",
        readableSummary(node.summary, {
          title: node.title,
          folderTitle: node.folderTitle || plan.garden.title
        })
      );
      const touching = plan.edges.filter(
        (edge) => edge.source === node.id || edge.target === node.id
      );
      const concepts = node.concepts.slice(0, 4).join(" \xB7 ");
      const sourceType = node.sourceKind ? topologySourceLabel(node.sourceKind) : "";
      calloutText(
        "thought-callout-meta",
        [
          node.topic ? `Topic: ${node.topic.label}` : "",
          sourceType,
          activityText(node),
          concepts,
          `${touching.length} ${touching.length === 1 ? "connection" : "connections"}`
        ].filter(Boolean).join(" \xB7 ")
      );
    }
  }
  function renderEdgeCallout(view) {
    if (!calloutContent) return;
    calloutContent.replaceChildren();
    calloutContent.appendChild(
      calloutTitle(
        `${view.source.node.title} ${view.kind === "hierarchy" ? "\u2192" : "\u2194"} ${view.target.node.title}`
      )
    );
    calloutText("thought-callout-meta", connectionMeta(view));
    calloutText("thought-callout-summary", inspectorConnectionExplanation(view));
  }
  function visibleConnectionsFor(nodeId) {
    const visibleConnections = settings.showHierarchy ? connectionViews : edgeViews;
    return visibleConnections.filter((view) => view.edge.source === nodeId || view.edge.target === nodeId).sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "semantic" ? -1 : 1;
      return right.edge.score - left.edge.score || left.edge.id.localeCompare(right.edge.id);
    });
  }
  function canHoverConnection(view) {
    return Boolean(
      view && (view.kind !== "hierarchy" || settings.showHierarchy) && (!inspectedNodeId || view.edge.source === inspectedNodeId || view.edge.target === inspectedNodeId)
    );
  }
  function inspectorNodeSummary(node) {
    if (node.kind === "garden") {
      return gardenOverview(plan, plan.garden.title, payload.garden.summary);
    }
    return readableSummary(node.summary, {
      title: node.title,
      folderTitle: node.folderTitle || plan.garden.title
    });
  }
  function inspectorConnectionExplanation(view) {
    const text = view.edge.explanation.text.trim();
    const question = /^You asked "(.*)"(?: and the answer cited |; | in .+?; )/.exec(text)?.[1];
    if (question) {
      const cited = text.includes(" and the answer cited ");
      return (cited ? "The answer cited this page when you asked \u201C" : "This page matches your question \u201C") + question + "\u201D";
    }
    if (view.kind === "hierarchy") return view.target.node.kind === "folder" ? "The second folder sits inside the first." : "The page is filed in this folder.";
    if (/through its recorded source references/.test(text)) return "The first page lists the second as a source.";
    const oldCross = /form a cross-Garden semantic match|latest Thought Topology builds/i.test(text);
    const oldRelated = /are connected(?: because|\.$)/.test(text) || text.includes("This connection is preserved from authored Markdown");
    if (text && !oldCross && !oldRelated) return text;
    const shared = view.edge.evidence.filter((item) => item.kind === "concept" || /^Shared (concept|term):/i.test(item.label)).map((item) => item.label.replace(/^Shared (concept|term):\s*/i, "").trim()).filter(Boolean);
    if (shared.length) return "Both pages cover " + new Intl.ListFormat("en").format([...new Set(shared)].slice(0, 3)) + ".";
    if (view.edge.origin !== "inferred") return "One page references the other in the Garden.";
    return "Breadboard found similar wording or ideas in the two pages.";
  }
  function connectionMeta(view) {
    const edge = view.edge;
    const cross = edge.relationType === "cross-garden-related" || edge.evidence.some((e) => /^Cross-Garden match:/i.test(e.label));
    const gardenOf = (node) => node.sectorId && gardenSpheres ? viewById.get(node.sectorId)?.node.title : payload.garden.title;
    const recordedPair = edge.evidence.find((e) => /^Cross-Garden match:/i.test(e.label))?.label.replace(/^Cross-Garden match:\s*/i, "").trim();
    const sourceGarden = gardenOf(view.source.node);
    const targetGarden = gardenOf(view.target.node);
    const pair = cross ? sourceGarden && targetGarden && sourceGarden !== targetGarden ? sourceGarden + " \u2194 " + targetGarden : recordedPair : "";
    return [relationLabel(edge.relationType), pair, view.kind === "semantic" ? affinityLabel(edge.score, edge.threshold) + " affinity \xB7 " + edge.score.toFixed(2) : ""].filter(Boolean).join(" \xB7 ");
  }
  function syncInspectorConnectionSelection() {
    if (!inspectorRoot) return;
    for (const card of inspectorRoot.querySelectorAll(".thought-connection")) {
      const selected = card.dataset.edgeId === selectedEdgeId;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
  }
  function investigateNode(view) {
    if (!context.onInvestigate) return;
    const aggregate = context.scopeCluster === "private-library" || context.scopeCluster === "public-library";
    const nodeSlug = view.node.navigateSlug ?? (view.node.kind === "garden" ? `garden:${context.scopeCluster}` : view.node.kind === "folder" ? aggregate ? view.node.folderPath : [context.scopeCluster, view.node.folderPath].filter(Boolean).join("/") : view.node.id);
    const selectedConnection = selectedEdgeId ? edgeById.get(selectedEdgeId) : void 0;
    const connection = selectedConnection && (selectedConnection.edge.source === view.node.id || selectedConnection.edge.target === view.node.id) ? selectedConnection : void 0;
    const prompt = connection ? [
      `Investigate the selected Thought Topology connection between \u201C${connection.source.node.title}\u201D (${connection.source.node.navigateSlug ?? connection.source.node.id}) and \u201C${connection.target.node.title}\u201D (${connection.target.node.navigateSlug ?? connection.target.node.id}).`,
      `Test the \u201C${relationLabel(connection.edge.relationType)}\u201D relationship against the relevant Garden notes and source evidence, explain what the connection means, and identify the most useful adjacent ideas to follow next.`
    ].join(" ") : [
      `Investigate \u201C${view.node.title}\u201D (${nodeSlug}) through this Garden\u2019s Thought Topology.`,
      "Traverse its strongest useful semantic and structural connections, open the relevant notes and source evidence, then explain what it connects to, why those connections matter, and which path is worth following next."
    ].join(" ");
    context.onInvestigate({
      nodeSlug,
      nodeTitle: view.node.title,
      prompt
    });
  }
  function renderNodeInspector(view) {
    if (!inspectorContent) return;
    const { node } = view;
    const connections = visibleConnectionsFor(node.id);
    const semanticCount = connections.filter((connection) => connection.kind === "semantic").length;
    const structuralCount = connections.length - semanticCount;
    const header = element("header", "thought-inspector-header");
    header.append(element("p", "thought-kicker", "Node connections"));
    const title = element("h2");
    appendMathText(title, withoutEmptyLessonPagesNotice(node.title));
    header.append(title);
    if (node.kind !== "garden") {
      header.append(
        element(
          "p",
          "thought-breadcrumb",
          [plan.garden.title, node.folderTitle].filter(Boolean).join(" \u203A ")
        )
      );
    }
    if (activityText(node)) header.append(element("p", "thought-breadcrumb", activityText(node)));
    const summaryText = withoutEmptyLessonPagesNotice(inspectorNodeSummary(node));
    if (summaryText) {
      const summary = element("p", "thought-summary");
      appendMathText(summary, summaryText);
      header.append(summary);
    }
    const connectionsSection = element("section", "thought-connections");
    connectionsSection.append(element("h3", void 0, "Visible connections"));
    connectionsSection.append(
      element(
        "p",
        "thought-note thought-connection-count",
        `${connections.length} under the current filters \xB7 ${semanticCount} semantic${settings.showHierarchy ? ` \xB7 ${structuralCount} structural` : ""}`
      )
    );
    const connectionList = element("div", "thought-connection-list");
    if (connections.length === 0) {
      connectionList.append(
        element(
          "p",
          "thought-connection-empty",
          "No connections are visible for this node with the current filters."
        )
      );
    } else {
      for (const connection of connections) {
        const other = connection.edge.source === node.id ? connection.target.node : connection.source.node;
        const card = element("button", "thought-connection");
        card.type = "button";
        card.dataset.edgeId = connection.edge.id;
        card.setAttribute("aria-pressed", String(selectedEdgeId === connection.edge.id));
        const cardHeading = element("span", "thought-connection-heading");
        const port = element("span", "thought-connection-port");
        port.dataset.kind = connection.kind;
        const otherTitle = element("span", "thought-connection-title");
        appendMathText(otherTitle, other.title);
        cardHeading.append(port, otherTitle);
        const relation = element(
          "span",
          "thought-connection-relation",
          connectionMeta(connection)
        );
        const explanation = element("span", "thought-connection-explanation");
        appendMathText(explanation, inspectorConnectionExplanation(connection));
        card.append(cardHeading, relation, explanation);
        card.addEventListener("click", () => {
          selectedNodeId = node.id;
          selectedEdgeId = connection.edge.id;
          refreshStyles();
          syncFloatingCallout();
          syncInspectorConnectionSelection();
          emitGraphContext();
        });
        connectionList.append(card);
      }
    }
    connectionsSection.append(connectionList);
    const actions = element("div", "thought-inspector-actions");
    const aggregateRoot = node.kind === "garden" && (context.scopeCluster === "private-library" || context.scopeCluster === "public-library");
    if (context.onInvestigate && !aggregateRoot) {
      const investigate = element(
        "button",
        "thought-action thought-action-primary",
        "Investigate with Bread"
      );
      investigate.type = "button";
      investigate.addEventListener("click", () => investigateNode(view));
      actions.append(investigate);
    }
    const open = element(
      "button",
      `thought-action${context.onInvestigate && !aggregateRoot ? "" : " thought-action-primary"}`,
      `Open ${node.kind === "page" ? "note" : node.kind}`
    );
    open.type = "button";
    open.addEventListener("click", () => openNode(view));
    actions.append(open);
    inspectorContent.replaceChildren(header, connectionsSection, actions);
    syncInspectorConnectionSelection();
  }
  function hideNodeInspector() {
    inspectedNodeId = null;
    inspectorRoot?.classList.remove("open");
    inspectorRoot?.setAttribute("aria-hidden", "true");
    obscureOverlayClose(false);
    invalidate();
  }
  function openNodeInspector(view) {
    if (!inspectorRoot) return;
    inspectedNodeId = view.node.id;
    selectedNodeId = view.node.id;
    selectedEdgeId = null;
    renderNodeInspector(view);
    inspectorRoot.classList.add("open");
    inspectorRoot.setAttribute("aria-hidden", "false");
    obscureOverlayClose(true);
    refreshStyles();
    syncFloatingCallout();
    emitGraphContext();
    invalidate();
  }
  function refreshNodeInspector() {
    const inspected = inspectedNodeId ? viewById.get(inspectedNodeId) : void 0;
    if (inspected) renderNodeInspector(inspected);
  }
  function positionFloatingCallout() {
    if (!calloutRoot || !floatingCalloutTarget || !calloutVisible) return;
    const padding = 12;
    let anchorX = 0;
    let anchorY = 0;
    let offsetX = 18;
    let offsetY = -12;
    if (floatingCalloutTarget.kind === "node") {
      const position = screenOf(floatingCalloutTarget.view.node);
      anchorX = position.x;
      anchorY = position.y;
      offsetX = screenRadius(floatingCalloutTarget.view.node) + 14;
    } else {
      const geometry = edgeGeometry(floatingCalloutTarget.view);
      const midpoint = edgePoint(floatingCalloutTarget.view, 0.5);
      anchorX = transform.applyX(midpoint.x);
      anchorY = transform.applyY(midpoint.y);
      const dx = geometry.x2 - geometry.x1;
      const dy = geometry.y2 - geometry.y1;
      const length = Math.max(1, Math.hypot(dx, dy));
      let normalX = -dy / length;
      let normalY = dx / length;
      if (normalY > 0) {
        normalX *= -1;
        normalY *= -1;
      }
      offsetX = normalX * 22;
      offsetY = normalY * 22;
    }
    let availableWidth = width;
    let availableHeight = height;
    if (inspectedNodeId && inspectorRoot) {
      if (inspectorRoot.offsetWidth < width - 1) availableWidth -= inspectorRoot.offsetWidth;
      else availableHeight -= inspectorRoot.offsetHeight;
    }
    calloutRoot.style.maxWidth = `${Math.max(0, availableWidth - 2 * padding)}px`;
    const calloutWidth = calloutRoot.offsetWidth || 320;
    const calloutHeight = calloutRoot.offsetHeight || 120;
    let left = anchorX + offsetX;
    if (offsetX < 0) left -= calloutWidth;
    if (left + calloutWidth > availableWidth - padding) left = anchorX - calloutWidth - 18;
    if (left < padding) left = anchorX + 18;
    left = Math.max(padding, Math.min(availableWidth - calloutWidth - padding, left));
    let top = anchorY + offsetY - calloutHeight * 0.22;
    top = Math.max(padding, Math.min(availableHeight - calloutHeight - padding, top));
    const target = floatingCalloutTarget;
    const depth = target.kind === "node" ? projected(target.view.node).z : (projected(target.view.source.node).z + projected(target.view.target.node).z) / 2;
    const tiltX = Math.sin(camera.pitch) * -18;
    const tiltY = Math.sin(camera.yaw) * 24;
    const scale = 1 + Math.max(-0.08, Math.min(0.08, depth / (depthSpread * 12)));
    const inset = Math.min(28, Math.max(0, (availableWidth - calloutWidth) / 2));
    left = Math.max(inset, Math.min(availableWidth - calloutWidth - inset, left));
    top = Math.max(20, Math.min(availableHeight - calloutHeight - 20, top));
    calloutRoot.style.transformOrigin = "50% 50%";
    calloutRoot.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0) perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`;
  }
  function syncFloatingCallout() {
    if (!calloutRoot) return;
    const hoveredNode = hoveredNodeId && hoveredNodeId !== inspectedNodeId ? viewById.get(hoveredNodeId) : void 0;
    const hoveredEdge = hoveredEdgeId && !(hoveredEdgeId === selectedEdgeId && inspectorRoot?.classList.contains("open")) ? edgeById.get(hoveredEdgeId) : void 0;
    const selectedNode = selectedNodeId && selectedNodeId !== inspectedNodeId ? viewById.get(selectedNodeId) : void 0;
    const selectedEdge = selectedEdgeId && !inspectorRoot?.classList.contains("open") ? edgeById.get(selectedEdgeId) : void 0;
    const target = hoveredNode ? { kind: "node", view: hoveredNode } : hoveredEdge ? { kind: "edge", view: hoveredEdge } : selectedNode ? { kind: "node", view: selectedNode } : selectedEdge ? { kind: "edge", view: selectedEdge } : null;
    if (!target) {
      hideCallout();
      return;
    }
    const id3 = target.kind === "node" ? target.view.node.id : target.view.edge.id;
    const key = `${target.kind}:${id3}`;
    const pinned = !hoveredNode && !hoveredEdge;
    floatingCalloutTarget = target;
    calloutRoot.dataset.pinned = String(pinned);
    calloutRoot.dataset.kind = target.kind;
    if (renderedCalloutKey !== key) {
      renderedCalloutKey = key;
      if (target.kind === "node") renderNodeCallout(target.view);
      else renderEdgeCallout(target.view);
    }
    showCallout();
    positionFloatingCallout();
  }
  function selectNode(view) {
    hideNodeInspector();
    if (selectedNodeId === view.node.id) {
      selectedNodeId = null;
      refreshStyles();
      syncFloatingCallout();
      emitGraphContext();
      return;
    }
    selectedNodeId = view.node.id;
    selectedEdgeId = null;
    refreshStyles();
    syncFloatingCallout();
    emitGraphContext();
  }
  function selectEdge(view) {
    inspectedNodeId = null;
    selectedEdgeId = view.edge.id;
    selectedNodeId = null;
    if (inspectorContent && inspectorRoot) {
      const header = element("header", "thought-inspector-header");
      const title = element("h2");
      const endpoint = (end) => {
        const button = element("button", "map-endpoint");
        button.type = "button";
        appendMathText(button, end.node.title);
        button.title = "Inspect " + end.node.title;
        button.onclick = () => openNodeInspector(end);
        return button;
      };
      title.append(endpoint(view.source), document.createTextNode(view.kind === "hierarchy" ? " \u2192 " : " \u2194 "), endpoint(view.target));
      const summary = element("p", "thought-summary");
      appendMathText(summary, inspectorConnectionExplanation(view));
      header.append(element("p", "thought-kicker", "Connection"), title, element("p", "thought-breadcrumb", connectionMeta(view)), summary);
      inspectorContent.replaceChildren(header);
      inspectorRoot.classList.add("open");
      inspectorRoot.setAttribute("aria-hidden", "false");
    }
    refreshStyles();
    syncFloatingCallout();
    emitGraphContext();
  }
  function clearSelection() {
    if (selectedNodeId === null && selectedEdgeId === null && inspectedNodeId === null && !calloutVisible)
      return;
    hideNodeInspector();
    selectedNodeId = null;
    selectedEdgeId = null;
    refreshStyles();
    syncFloatingCallout();
    emitGraphContext();
  }
  const handleInspectorClose = () => clearSelection();
  const handleInspectorKeydown = (event) => {
    if (event.key === "Escape" && (inspectedNodeId || selectedEdgeId)) clearSelection();
  };
  inspectorClose?.addEventListener("click", handleInspectorClose);
  window.addEventListener("keydown", handleInspectorKeydown);
  cleanups.push(() => {
    inspectorClose?.removeEventListener("click", handleInspectorClose);
    window.removeEventListener("keydown", handleInspectorKeydown);
  });
  let lastRightClick = null;
  function openNode(view) {
    if (openTopologyChat(view.node.id, view.node.navigateSlug)) return;
    const rawSlug = view.node.navigateSlug ?? (view.node.kind === "garden" || view.node.folderPath === "" ? gardenSlug : view.node.kind === "folder" ? `${gardenSlug}/${view.node.folderPath}` : void 0);
    if (!rawSlug) return;
    const targetSlug = topologyNavigationSlug(rawSlug);
    if (context.onNavigate) {
      context.onNavigate(view.node.id, targetSlug);
      return;
    }
    const target = resolveRelative(fullSlug, targetSlug);
    window.spaNavigate(
      new URL(target, window.location.toString())
    );
  }
  function pinNode(view) {
    const node = view.node;
    const position = { x: node.x, y: node.y, z: node.z };
    const positions = readStoredPositions(positionScope);
    positions[node.id] = position;
    homePositions.set(node.id, position);
    permanentHomeIds.add(node.id);
    returnTargets.delete(node.id);
    returningNodeIds.delete(node.id);
    node.fx = position.x;
    node.fy = position.y;
    node.fz = position.z;
    homeXForce.x(homeXForNode);
    homeYForce.y(homeYForNode);
    writeStoredPositions(positionScope, positions);
    refreshNodeInspector();
    invalidate();
    emitGraphContext();
  }
  function releaseNode(view) {
    const node = view.node;
    const positions = readStoredPositions(positionScope);
    delete positions[node.id];
    writeStoredPositions(positionScope, positions);
    permanentHomeIds.delete(node.id);
    const home = plannedHome(node.id);
    if (home) homePositions.set(node.id, home);
    node.fx = null;
    node.fy = null;
    node.fz = null;
    homeXForce.x(homeXForNode);
    homeYForce.y(homeYForNode);
    if (reducedMotion) {
      if (home) {
        node.x = home.x;
        node.y = home.y;
        node.z = home.z;
        if (isHomeFixed(node)) {
          node.fx = home.x;
          node.fy = home.y;
          node.fz = home.z;
        }
      }
    } else {
      if (node.kind === "garden" && home) {
        returnTargets.set(node.id, { ...home, pin: true });
        returningNodeIds.add(node.id);
      }
      simulationSettled = false;
      simulation.alpha(Math.max(simulation.alpha(), 0.25)).restart();
    }
    refreshNodeInspector();
    invalidate();
    emitGraphContext();
  }
  function handleRightNodeClick(view) {
    const now2 = performance.now();
    const doubleClick = lastRightClick?.nodeId === view.node.id && now2 - lastRightClick.at <= RIGHT_DOUBLE_CLICK_MS;
    openNodeInspector(view);
    if (doubleClick) {
      lastRightClick = null;
      if (permanentHomeIds.has(view.node.id)) releaseNode(view);
      else pinNode(view);
      return;
    }
    lastRightClick = { nodeId: view.node.id, at: now2 };
  }
  const accents = new Graphics({ eventMode: "none", zIndex: 4 });
  stage.addChild(accents);
  const resultNodes = /* @__PURE__ */ new Set(), resultEdges = /* @__PURE__ */ new Map();
  let answerPulseUntil = 0;
  const freshNodes = /* @__PURE__ */ new Set(), freshEdges = /* @__PURE__ */ new Set();
  const now = Date.now();
  let history = activitySeenByHost.get(graph);
  if (!history || history.slug !== payload.garden.slug) {
    history = { slug: payload.garden.slug, seen: /* @__PURE__ */ new Map() };
    activitySeenByHost.set(graph, history);
  }
  const seen = history.seen;
  function arrived(id3, at2) {
    const previous = seen.get(id3);
    const latest = at2 && at2 <= now ? at2 : 0;
    seen.set(id3, Math.max(previous ?? 0, latest));
    return latest > (previous ?? 0) && now - latest < (previous === void 0 ? 6e4 : 7 * 864e5);
  }
  for (const n of payload.nodes) {
    if (arrived(n.id, Math.max(0, ...n.activityTimes ?? [])) && viewById.has(n.id)) freshNodes.add(n.id);
  }
  for (const e of payload.edges) {
    if (!arrived(e.id, e.changedAt) || !edgeById.has(e.id)) continue;
    freshEdges.add(e.id);
    freshNodes.add(e.source);
    freshNodes.add(e.target);
  }
  const arrivalPulseUntil = freshNodes.size || freshEdges.size ? performance.now() + 1600 : 0;
  function drawAccents(time) {
    accents.clear();
    const waveAt = (until) => time < until && !reducedMotion ? (1 + Math.cos((until - time) / 140)) / 2 : 0.6;
    const answerWave = waveAt(answerPulseUntil), arrivalWave = waveAt(arrivalPulseUntil);
    const drawLine = (e, wave) => {
      const a = screenOf(e.source.node), b = screenOf(e.target.node);
      accents.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.3 + wave * 0.9, color: colors.text, alpha: 0.55 + 0.4 * wave });
    };
    for (const edge of resultEdges.values()) drawLine(edge, answerWave);
    if (time < arrivalPulseUntil) for (const id3 of freshEdges) {
      const edge = edgeById.get(id3);
      if (edge && !resultEdges.has(id3)) drawLine(edge, arrivalWave);
    }
    const ring = (id3, wave) => {
      const v = viewById.get(id3);
      if (!v) return;
      const p = screenOf(v.node);
      accents.circle(p.x, p.y, 6 + wave * 3).stroke({ width: 1.7, color: tone(v.node), alpha: 0.85 });
    };
    if (settings.activity !== "off") {
      for (const [id3, count] of counts) {
        const view = viewById.get(id3);
        if (!view) continue;
        const p = screenOf(view.node);
        accents.circle(p.x, p.y, screenRadius(view.node) + 2 + Math.min(4, Math.log2(count))).stroke({ width: 1, color: tone(view.node), alpha: 0.55 });
      }
    }
    for (const id3 of permanentHomeIds) if (!resultNodes.has(id3)) ring(id3, 0.6);
    for (const id3 of resultNodes) ring(id3, answerWave);
    if (time < arrivalPulseUntil) {
      for (const id3 of freshNodes) if (!resultNodes.has(id3)) ring(id3, arrivalWave);
    }
    return time < arrivalPulseUntil || !reducedMotion && time < answerPulseUntil;
  }
  if (interactive && !preview && outer && outer.dataset.graphSurface !== "garden") {
    let highlight2 = function(edges, nodes = []) {
      resultNodes.clear();
      resultEdges.clear();
      for (const id3 of nodes) resultNodes.add(id3);
      for (const edge of edges) {
        resultEdges.set(edge.edge.id, edge);
        resultNodes.add(edge.edge.source);
        resultNodes.add(edge.edge.target);
      }
      if (resultNodes.size) {
        const points2 = [...resultNodes].map((id3) => projected(viewById.get(id3).node));
        const bounds = boundsOf(points2, 56);
        const insets = currentInsets();
        if (inspectorRoot?.classList.contains("open")) insets.left += Math.min(width * 0.4, inspectorRoot.offsetWidth);
        if (!panel.hidden && width > 650) insets.right += Math.min(width * 0.38, panel.offsetWidth);
        const next = fitTransform(bounds, { width, height }, insets, { minScale: 0.01, maxScale: Math.max(fitK, Math.min(1.45, transform.k * 1.45)) });
        viewState = "focus";
        applyTransform(next, true);
      }
      answerPulseUntil = resultNodes.size && !reducedMotion ? performance.now() + 2200 : 0;
      invalidate();
    };
    var highlight = highlight2;
    const host = element("div", "map-assistant");
    const toggle = element("button", "map-assistant-toggle", "Assistant");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    const panel = element("section", "map-assistant-panel");
    panel.hidden = true;
    panel.setAttribute("aria-label", "Knowledge assistant");
    const header = element("header", "map-filter-header");
    const dismiss = element("button", "thought-topology-filter-link", "Close");
    header.append(element("strong", void 0, "Knowledge assistant"), dismiss);
    const messages = element("div", "map-assistant-messages");
    messages.setAttribute("aria-live", "polite");
    const purpose = element("p", "map-assistant-purpose", "Ask how nodes are connected. I\u2019ll highlight the nodes and links behind each answer.");
    const form = element("form", "map-assistant-compose");
    const input = element("input");
    input.placeholder = "Ask about this map\u2026";
    input.setAttribute("aria-label", "Ask about connections");
    const send = element("button", void 0, "Ask");
    send.type = "submit";
    form.append(input, send);
    const defaultPrompt = gardenSpheres && plan.edges.some((edge) => edge.crossFolder) ? "Find connections across Gardens" : "Show strongest connections";
    const explore = element("button", "map-assistant-prompt", defaultPrompt);
    panel.append(header, purpose, messages, explore, form);
    host.append(panel, toggle);
    outer.append(host);
    const setOpen = (open) => {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        explore.textContent = selectedNodeId ? "Find connections to this node" : selectedEdgeId ? "Explain this connection" : defaultPrompt;
        input.focus();
      } else toggle.focus();
    };
    toggle.onclick = () => setOpen(panel.hidden);
    dismiss.onclick = () => setOpen(false);
    panel.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    let eligible;
    form.onsubmit = (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      purpose.hidden = true;
      eligible ??= planThoughtTopology(payload, { ...planOptions, maxConnectionsPerNode: 0 }).edges.filter((edge) => viewById.has(edge.source) && viewById.has(edge.target));
      const found = answerMapQuestion(plan.nodes, eligible, q, {
        selectedNodeId,
        selectedEdge: selectedEdgeId ? edgeById.get(selectedEdgeId)?.edge : !selectedNodeId && resultEdges.size === 1 ? resultEdges.values().next().value?.edge : void 0,
        multipleGardens: gardenSpheres,
        visibleConnectionCount: shaderEdges.length
      });
      if (found.nodes.length || found.edges.length) clearSelection();
      const hits = found.edges.map((edge) => edgeById.get(edge.id) ?? {
        edge,
        kind: "semantic",
        source: viewById.get(edge.source),
        target: viewById.get(edge.target),
        alpha: 1,
        alphaTarget: 1,
        color: colors.edgeActive,
        restColor: colors.edgeActive,
        widthBoost: 0,
        selected: false
      });
      messages.replaceChildren(element("p", "map-question", q));
      const answer = element("p", "map-answer");
      appendMathText(answer, found.text);
      messages.append(answer);
      highlight2(hits, found.nodes.map((node) => node.id));
      for (const node of found.nodes) {
        const button = element("button", "map-source", node.title);
        button.type = "button";
        button.onclick = () => {
          setOpen(false);
          openNodeInspector(viewById.get(node.id));
          highlight2([], [node.id]);
        };
        messages.append(button);
      }
      for (const hit of hits) {
        const button = element("button", "map-source");
        button.type = "button";
        const arrow = hit.kind === "hierarchy" || hit.edge.direction === "directed" ? " \u2192 " : " \u2194 ";
        button.append(
          element("strong", void 0, hit.source.node.title + arrow + hit.target.node.title),
          element("small", void 0, connectionMeta(hit)),
          element("span", void 0, inspectorConnectionExplanation(hit))
        );
        button.onclick = () => {
          setOpen(false);
          edgeById.set(hit.edge.id, hit);
          selectEdge(hit);
          highlight2([hit]);
        };
        messages.append(button);
      }
      if (resultNodes.size) {
        const clear = element("button", "thought-topology-filter-link", "Clear highlights");
        clear.onclick = () => {
          highlight2([]);
          clear.remove();
        };
        messages.append(clear);
      }
      input.value = "";
      messages.scrollTop = 0;
    };
    explore.onclick = () => {
      input.value = explore.textContent ?? defaultPrompt;
      form.requestSubmit();
    };
    onCleanup(() => host.remove());
  }
  if (interactive) {
    let hoverFrame = 0;
    let lastPoint = null;
    const updateHover = () => {
      hoverFrame = 0;
      const node = lastPoint ? nodeAtScreenPoint(lastPoint.x, lastPoint.y) : void 0;
      const edge = lastPoint && !node ? edgeAt(lastPoint.x, lastPoint.y) : void 0;
      if (hoveredNodeId === (node?.node.id ?? null) && hoveredEdgeId === (edge?.edge.id ?? null)) return;
      hoveredNodeId = node?.node.id ?? null;
      hoveredEdgeId = edge?.edge.id ?? null;
      refreshStyles();
      syncFloatingCallout();
    };
    const hover = (e) => {
      if (e.buttons) return;
      lastPoint = canvasPoint(e);
      if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
    };
    const leave = () => {
      lastPoint = null;
      updateHover();
    };
    let press = null;
    const down = (e) => {
      press = e.button === 0 ? canvasPoint(e) : null;
    };
    const up2 = (e) => {
      const p = canvasPoint(e), start = press;
      press = null;
      if (!start || Math.hypot(p.x - start.x, p.y - start.y) > CLICK_SLOP_PX || nodeAtScreenPoint(p.x, p.y)) return;
      const edge = edgeAt(p.x, p.y);
      if (edge) {
        hoveredEdgeId = edge.edge.id;
        selectEdge(edge);
      }
    };
    app.canvas.addEventListener("pointermove", hover);
    app.canvas.addEventListener("pointerleave", leave);
    app.canvas.addEventListener("pointerdown", down);
    app.canvas.addEventListener("pointerup", up2);
    cleanups.push(() => {
      cancelAnimationFrame(hoverFrame);
      app.canvas.removeEventListener("pointermove", hover);
      app.canvas.removeEventListener("pointerleave", leave);
      app.canvas.removeEventListener("pointerdown", down);
      app.canvas.removeEventListener("pointerup", up2);
    });
    const handleContextMenu = (event) => {
      const point = canvasPoint(event);
      if (nodeAtScreenPoint(point.x, point.y) || hoveredEdgeId !== null) event.preventDefault();
    };
    app.canvas.addEventListener("contextmenu", handleContextMenu);
    cleanups.push(() => app.canvas.removeEventListener("contextmenu", handleContextMenu));
    if (config.drag) {
      let dragState = null;
      let nextDragIsPermanent = false;
      canvasSelection.call(
        drag().filter((event) => {
          const accepted = !event.ctrlKey && (event.type === "touchstart" || event.button === 0 || event.button === 2);
          if (accepted) nextDragIsPermanent = event.button === 2;
          return accepted;
        }).container(() => app.canvas).subject((event) => {
          const view = nodeAtScreenPoint(event.x, event.y);
          if (view && hoveredEdgeId !== null && hoveredNodeId === null) {
            const position = screenOf(view.node);
            const visualRadius = Math.max(6, screenRadius(view.node) + 3);
            if (Math.hypot(event.x - position.x, event.y - position.y) > visualRadius) {
              return void 0;
            }
          }
          return view ? { x: event.x, y: event.y, view } : void 0;
        }).on("start", (event) => {
          const view = event.subject.view;
          const source = event.sourceEvent;
          const permanent = nextDragIsPermanent || source?.button === 2 || Boolean((source?.buttons ?? 0) & 2);
          nextDragIsPermanent = false;
          if (!event.active && !reducedMotion && !largeMap) simulation.alphaTarget(1).restart();
          simulationSettled = false;
          draggingNode = true;
          activeDragNodeId = view.node.id;
          userMovedView = true;
          returnTargets.delete(view.node.id);
          returningNodeIds.delete(view.node.id);
          dragState = {
            view,
            moved: 0,
            permanent,
            pointer: { x: source?.clientX ?? event.x, y: source?.clientY ?? event.y },
            members: [
              {
                view,
                x: view.node.x,
                y: view.node.y,
                z: view.node.z,
                fz: view.node.fz,
                fx: view.node.fx,
                fy: view.node.fy
              }
            ]
          };
          view.node.fx = view.node.x;
          view.node.fy = view.node.y;
          view.node.fz = view.node.z;
        }).on("drag", (event) => {
          if (!dragState) return;
          const source = event.sourceEvent;
          const clientX = source?.clientX ?? event.x;
          const clientY = source?.clientY ?? event.y;
          dragState.moved = Math.max(
            dragState.moved,
            Math.hypot(clientX - dragState.pointer.x, clientY - dragState.pointer.y)
          );
          if (dragState.moved <= CLICK_SLOP_PX || dragState.members.length === 0) return;
          const dx = (event.x - event.subject.x) / transform.k;
          const dy = (event.y - event.subject.y) / transform.k;
          const delta = camera.unproject({ x: dx, y: dy, z: 0 });
          for (const member of dragState.members) {
            const x = member.x + delta.x;
            const y = member.y + delta.y;
            const z = member.z + delta.z;
            member.view.node.x = x;
            member.view.node.y = y;
            member.view.node.z = z;
            member.view.node.fz = z;
            member.view.node.fx = x;
            member.view.node.fy = y;
          }
          invalidate();
        }).on("end", (event) => {
          if (!dragState) return;
          const state = dragState;
          dragState = null;
          draggingNode = false;
          activeDragNodeId = null;
          if (!event.active && !reducedMotion) simulation.alphaTarget(0);
          if (reducedMotion || largeMap) {
            simulationSettled = true;
            positionsDirty = true;
          }
          if (state.moved <= CLICK_SLOP_PX) {
            for (const member of state.members) {
              const home = homePositions.get(member.view.node.id);
              if (isHomeFixed(member.view.node) && home) {
                member.view.node.fx = home.x;
                member.view.node.fy = home.y;
                member.view.node.fz = home.z;
              } else {
                member.view.node.fx = member.fx;
                member.view.node.fy = member.fy;
                member.view.node.fz = member.fz;
              }
            }
            if (state.permanent) handleRightNodeClick(state.view);
            else openNodeInspector(state.view);
            return;
          }
          lastRightClick = null;
          if (state.members.length === 0) return;
          if (state.permanent) {
            const positions = readStoredPositions(positionScope);
            for (const member of state.members) {
              const position = {
                x: member.view.node.x,
                y: member.view.node.y,
                z: member.view.node.z
              };
              homePositions.set(member.view.node.id, position);
              positions[member.view.node.id] = position;
              permanentHomeIds.add(member.view.node.id);
              returnTargets.delete(member.view.node.id);
              returningNodeIds.delete(member.view.node.id);
              member.view.node.fx = position.x;
              member.view.node.fy = position.y;
              member.view.node.fz = position.z;
            }
            homeXForce.x(homeXForNode);
            homeYForce.y(homeYForNode);
            writeStoredPositions(positionScope, positions);
            refreshNodeInspector();
            invalidate();
            emitGraphContext();
            return;
          }
          let homeForceChanged = false;
          for (const member of state.members) {
            const home = homePositions.get(member.view.node.id);
            if (!home) continue;
            if (reducedMotion || largeMap) {
              member.view.node.x = home.x;
              member.view.node.y = home.y;
              member.view.node.z = home.z;
              member.view.node.fx = isHomeFixed(member.view.node) ? home.x : null;
              member.view.node.fy = isHomeFixed(member.view.node) ? home.y : null;
              member.view.node.fz = isHomeFixed(member.view.node) ? home.z : null;
            } else {
              member.view.node.fx = null;
              member.view.node.fy = null;
              member.view.node.fz = null;
              const pin = isHomeFixed(member.view.node);
              const target = pin ? home : { x: member.x, y: member.y, z: member.z };
              returnTargets.set(member.view.node.id, { ...target, pin });
              returningNodeIds.add(member.view.node.id);
              if (!pin) {
                homePositions.set(member.view.node.id, target);
                homeForceChanged = true;
              }
            }
          }
          if (homeForceChanged) {
            homeXForce.x(homeXForNode);
            homeYForce.y(homeYForNode);
          }
          invalidate();
          emitGraphContext();
          void event;
        })
      );
    } else {
      for (const view of views)
        view.gfx.on(
          "pointertap",
          (event) => event.button === 2 ? handleRightNodeClick(view) : openNodeInspector(view)
        );
    }
    if (config.zoom) {
      zoomBehavior.filter(
        (event) => event.type === "wheel" || event.type === "touchstart" && event.touches.length > 1 || event.type === "mousedown" && (event.shiftKey || event.button === 1)
      );
      canvasSelection.call(zoomBehavior).on("dblclick.zoom", null);
    }
    if (config.drag) {
      let orbit = null;
      const startOrbit = (event) => {
        if (orbit && orbit.id !== event.pointerId) {
          orbit = null;
          return;
        }
        if (event.button !== 0 || event.shiftKey || event.ctrlKey) return;
        const point = canvasPoint(event);
        if (nodeAtScreenPoint(point.x, point.y)) return;
        orbit = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          moved: false
        };
      };
      const moveOrbit = (event) => {
        if (!orbit || orbit.id !== event.pointerId || draggingNode) return;
        if (!orbit.moved && Math.hypot(event.clientX - orbit.startX, event.clientY - orbit.startY) <= CLICK_SLOP_PX)
          return;
        if (!orbit.moved) {
          canvasSelection.interrupt();
          transitioning = false;
          hoveredNodeId = null;
          hoveredEdgeId = null;
          refreshStyles();
          syncFloatingCallout();
        }
        orbit.moved = true;
        camera.orbit(event.clientX - orbit.x, event.clientY - orbit.y);
        orbit.x = event.clientX;
        orbit.y = event.clientY;
        userMovedView = true;
        viewState = "user";
        invalidate();
        emitGraphContext();
      };
      const endOrbit = () => {
        orbit = null;
      };
      app.canvas.addEventListener("pointerdown", startOrbit);
      window.addEventListener("pointermove", moveOrbit);
      window.addEventListener("pointerup", endOrbit);
      window.addEventListener("pointercancel", endOrbit);
      window.addEventListener("blur", endOrbit);
      cleanups.push(() => {
        app.canvas.removeEventListener("pointerdown", startOrbit);
        window.removeEventListener("pointermove", moveOrbit);
        window.removeEventListener("pointerup", endOrbit);
        window.removeEventListener("pointercancel", endOrbit);
        window.removeEventListener("blur", endOrbit);
      });
    }
    let backgroundPress = null;
    const onPointerDown = (event) => {
      const point = canvasPoint(event);
      backgroundPress = {
        x: event.clientX,
        y: event.clientY,
        onTarget: Boolean(nodeAtScreenPoint(point.x, point.y)) || hoveredNodeId !== null || hoveredEdgeId !== null
      };
    };
    const onPointerUp = (event) => {
      const press2 = backgroundPress;
      backgroundPress = null;
      if (!press2 || press2.onTarget || hoveredNodeId !== null || hoveredEdgeId !== null) return;
      if (Math.hypot(event.clientX - press2.x, event.clientY - press2.y) > 4) return;
      clearSelection();
    };
    app.canvas.addEventListener("pointerdown", onPointerDown);
    app.canvas.addEventListener("pointerup", onPointerUp);
    cleanups.push(() => {
      app.canvas.removeEventListener("pointerdown", onPointerDown);
      app.canvas.removeEventListener("pointerup", onPointerUp);
    });
  }
  function searchable(node) {
    return [node.title, node.label, node.folderTitle, ...node.concepts].join(" ").toLowerCase();
  }
  function updateSearch(query) {
    searchQuery = query.trim().toLowerCase();
    searchHits = /* @__PURE__ */ new Set();
    if (searchQuery) {
      for (const view of views) {
        if (view.node.kind !== "garden" && searchable(view.node).includes(searchQuery))
          searchHits.add(view.node.id);
      }
    }
    refreshStyles();
    emitGraphContext();
    graph.dispatchEvent(
      new CustomEvent("graph-search-result", {
        detail: { query, matches: searchHits.size, total: views.length }
      })
    );
  }
  function commitSearch() {
    if (!searchQuery || searchHits.size === 0) return;
    const best = [...searchHits].map((id3) => viewById.get(id3)).sort((left, right) => {
      const leftStarts = left.node.title.toLowerCase().startsWith(searchQuery) ? 0 : 1;
      const rightStarts = right.node.title.toLowerCase().startsWith(searchQuery) ? 0 : 1;
      return leftStarts - rightStarts || naturalCompare(left.node.title, right.node.title);
    })[0];
    if (!best) return;
    if (selectedNodeId !== best.node.id) selectNode(best);
    if (best.node.kind === "page") centerOn(best.node, true);
  }
  const handleGraphSearch = (event) => {
    const detail = event.detail;
    updateSearch(detail?.query ?? "");
  };
  const handleGraphSearchCommit = () => commitSearch();
  graph.addEventListener("graph-search", handleGraphSearch);
  graph.addEventListener("graph-search-commit", handleGraphSearchCommit);
  onCleanup(() => {
    graph.removeEventListener("graph-search", handleGraphSearch);
    graph.removeEventListener("graph-search-commit", handleGraphSearchCommit);
  });
  if (graph.dataset.searchQuery) updateSearch(graph.dataset.searchQuery);
  function emitGraphContext() {
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : void 0;
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId)?.node : void 0;
    const directNeighborSlugs = selectedNode ? [...neighbours.get(selectedNode.id) ?? []].map((id3) => viewById.get(id3)?.node).filter((node) => Boolean(node)).map((node) => node.navigateSlug ?? node.id).slice(0, 12) : [];
    const detail = {
      selectedNodeSlug: selectedNode ? selectedNode.navigateSlug ?? selectedNode.id : null,
      selectedConnection: selectedEdge ? {
        edgeId: selectedEdge.edge.id,
        sourceSlug: selectedEdge.source.node.navigateSlug ?? selectedEdge.source.node.id,
        targetSlug: selectedEdge.target.node.navigateSlug ?? selectedEdge.target.node.id,
        type: selectedEdge.kind === "hierarchy" ? "hierarchy" : "link",
        origin: selectedEdge.edge.origin,
        relationType: selectedEdge.edge.relationType,
        score: selectedEdge.edge.score,
        explanation: inspectorConnectionExplanation(selectedEdge)
      } : null,
      visibleNodeSlugs: plan.nodes.slice(0, 24).map((node) => node.navigateSlug ?? node.id),
      directNeighborSlugs,
      activeCluster: context.scopeCluster,
      filters: searchQuery ? [searchQuery] : [],
      depth: context.configuredDepth < 0 ? 3 : context.configuredDepth,
      relationshipTypes: selectedEdge ? [selectedEdge.edge.relationType] : ["semantic-affinity"],
      dimension: "3d",
      viewport: { x: transform.x, y: transform.y, width, height, scale: transform.k }
    };
    const graphWindow = window;
    graphWindow.__breadboardGraphContext = detail;
    window.dispatchEvent(new CustomEvent("breadboard:graph-context", { detail }));
  }
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    const nextWidth = graph.offsetWidth;
    const nextHeight = graph.offsetHeight;
    if (!nextWidth || !nextHeight || nextWidth === width && nextHeight === height) return;
    const deltaWidth = nextWidth - width;
    const deltaHeight = nextHeight - height;
    width = nextWidth;
    height = nextHeight;
    app.renderer.resize(width, height);
    shaders.resize(width, height);
    if (viewState === "fit") fitView(false);
    else
      applyTransform(
        {
          k: transform.k,
          x: transform.x - transform.k * deltaWidth / 2,
          y: transform.y - transform.k * deltaHeight / 2
        },
        false
      );
    invalidate();
  });
  resizeObserver?.observe(graph);
  onCleanup(() => resizeObserver?.disconnect());
  const lerp = (current, target) => Math.abs(target - current) < 0.01 ? target : current + (target - current) * 0.22;
  let revealedNodes = largeMap ? 0 : views.length;
  let revealedEdges = largeMap ? 0 : connectionViews.length;
  function animate(time) {
    if (stopAnimation) return false;
    if (labelsDirty) updateLabels();
    let fading = false;
    revealedNodes = Math.min(views.length, revealedNodes + INITIAL_NODE_BATCH);
    revealedEdges = Math.min(connectionViews.length, revealedEdges + INITIAL_EDGE_BATCH);
    const sceneReady = revealedNodes === views.length && revealedEdges === connectionViews.length;
    const inverseScale = 1 / Math.sqrt(transform.k);
    plates.clear();
    for (let index = 0; index < revealedNodes; index++) {
      const view = views[index];
      const { node } = view;
      view.gfx.visible = true;
      view.gfx.position.set(worldX(node), worldY(node));
      view.gfx.zIndex = node.kind === "page" ? 0 : 1;
      view.gfx.scale.set(inverseScale, inverseScale);
      view.alpha = lerp(view.alpha, view.alphaTarget);
      view.gfx.alpha = view.alpha;
      view.labelAlpha = lerp(view.labelAlpha, view.labelTarget);
      fading ||= view.alpha !== view.alphaTarget || view.labelAlpha !== view.labelTarget;
      const placement = view.placement;
      if (placement && view.labelAlpha > 0.02) {
        const position = screenOf(node);
        view.label.visible = true;
        view.label.alpha = view.labelAlpha;
        view.label.anchor.set(placement.anchorX, placement.anchorY);
        view.label.position.set(position.x + placement.dx, position.y + placement.dy);
        const label = view.label, w2 = label.width, h = label.height;
        const left = Math.round(label.x - w2 * placement.anchorX - 4) + 0.5;
        const top = Math.round(label.y - h * placement.anchorY - 2) + 0.5;
        if (isDark) plates.rect(left, top, w2 + 8, h + 4);
        else plates.roundRect(left, top, w2 + 8, h + 4, 4);
        plates.fill({ color: colors.paper, alpha: view.labelAlpha }).stroke({ color: isDark ? colors.text : labelBorders[toneOf(node)], alpha: view.labelAlpha, width: 1 });
        const align = placement.side === "left" ? "right" : placement.side === "right" ? "left" : "center";
        if (view.label.style.align !== align) view.label.style.align = align;
      } else {
        view.label.visible = false;
      }
    }
    if (!simulationSettled || draggingNode || positionsDirty) {
      shaders.updatePositions(shaderNodes, shaderEdges);
      positionsDirty = false;
    }
    const pulsing = drawAccents(time);
    positionFloatingCallout();
    if (debugEnabled) {
      const debugWindow = window;
      debugWindow.__breadboardThoughtTopologyDebug = {
        dimension: "3d",
        sceneReady,
        spinning: false,
        camera: { yaw: camera.yaw, pitch: camera.pitch },
        selectedConnectionId: selectedEdgeId,
        highlightedNodes: [...resultNodes],
        highlightedEdges: [...resultEdges.keys()],
        answerPulseActive: time < answerPulseUntil,
        freshNodeCount: freshNodes.size,
        freshEdgeCount: freshEdges.size,
        selectedNodeId,
        inspectedNodeId,
        inspectorOpen: inspectorRoot?.classList.contains("open") ?? false,
        hoveredNodeId,
        activeDragNodeId,
        returningNodeIds: [...returningNodeIds],
        permanentNodeIds: [...permanentHomeIds],
        viewState,
        viewSettled: sceneReady && !transitioning && (simulationSettled || draggingNode),
        simulationSettled,
        calloutVisible,
        compactSidebar,
        visibleLayers: {
          nodes: nodeLayer.visible,
          connections: linkLayer.visible,
          hierarchy: hierarchyLayer.visible
        },
        transform: { k: transform.k, x: transform.x, y: transform.y },
        labels: Object.fromEntries(
          views.filter((view) => view.label.visible).map((view) => [view.node.id, view.label.text])
        ),
        nodes: Object.fromEntries(views.map((view) => [view.node.id, screenOf(view.node)])),
        worldNodes: Object.fromEntries(
          views.map((view) => [view.node.id, { x: view.node.x, y: view.node.y, z: view.node.z }])
        ),
        hierarchyEdges: Object.fromEntries(
          hierarchyViews.map((view) => {
            const mid = edgePoint(view, 0.5);
            return [
              view.edge.id,
              {
                source: view.source.node.id,
                target: view.target.node.id,
                x: transform.applyX(mid.x),
                y: transform.applyY(mid.y),
                baseWidth: view.edge.width,
                opacity: view.edge.opacity,
                strength: view.edge.strength,
                restColor: view.restColor,
                renderedWidth: view.selected ? view.edge.width + view.widthBoost + 1.2 : view.edge.width + view.widthBoost
              }
            ];
          })
        ),
        edges: Object.fromEntries(
          edgeViews.map((view) => {
            const mid = edgePoint(view, 0.5);
            return [
              view.edge.id,
              {
                x: transform.applyX(mid.x),
                y: transform.applyY(mid.y),
                baseWidth: view.edge.width,
                opacity: view.edge.opacity,
                strength: view.edge.strength,
                restColor: view.restColor,
                renderedWidth: view.selected ? view.edge.width + view.widthBoost + 1.2 : view.edge.width + view.widthBoost
              }
            ];
          })
        )
      };
    }
    try {
      const picked = hoveredEdgeId ?? hoveredNodeId ?? selectedEdgeId ?? selectedNodeId;
      shaders.draw(camera, { x: 0, y: 0 }, {
        x: transform.x + (transform.k - 1) * width / 2,
        y: transform.y + (transform.k - 1) * height / 2
      }, fitK, transform.k / fitK, picked === null ? null : { id: picked }, shaderColors, shaderInk);
      app.renderer.resetState();
      app.renderer.render({ container: stage, clear: false });
    } catch {
      invalidateRenderer();
      return false;
    }
    return !sceneReady || fading || transitioning || pulsing;
  }
  renderLoop = new GraphRenderLoop(animate);
  let intersecting = false;
  const updateVisibility = () => {
    const visible = !document.hidden && intersecting && !stopAnimation;
    renderLoop?.setActive(visible);
    if (visible) {
      if (!simulationSettled) simulation.restart();
      invalidate();
    } else {
      simulation.stop();
    }
  };
  const rect = graph.getBoundingClientRect();
  intersecting = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    intersecting = entries.some((entry) => entry.isIntersecting);
    updateVisibility();
  });
  intersectionObserver?.observe(graph);
  document.addEventListener("visibilitychange", updateVisibility);
  onCleanup(() => {
    intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", updateVisibility);
    canvasSelection.interrupt();
  });
  updateVisibility();
  graph.dataset.mapReady = "true";
  onCleanup(() => {
    if (!graph.querySelector("canvas")) delete graph.dataset.mapReady;
  });
  refreshStyles();
  fitView(false, !simulationSettled);
  emitGraphContext();
  renderLoop.invalidate();
  const cleanup = () => {
    stopAnimation = true;
    hideCallout();
    if (calloutRoot) {
      calloutRoot.style.removeProperty("transform-origin");
      calloutRoot.style.removeProperty("transform");
    }
    obscureOverlayClose(false);
    inspectorRoot?.remove();
    const hasReplacementCanvas = graph.querySelectorAll(":scope > canvas").length > 1;
    if (!hasReplacementCanvas) {
      if (graphRoot && graphRoot.dataset.activeMode === "thought-topology")
        delete graphRoot.dataset.activeMode;
      if (heading) heading.hidden = true;
    }
  };
  onCleanup(cleanup);
  return {
    cleanup,
    folderOptions: plan.folderOptions,
    visiblePageCount: plan.visiblePageCount,
    totalPageCount: plan.totalPageCount,
    connectionCount: plan.edges.length + (settings.showHierarchy ? plan.hierarchyEdges.length : 0)
  };
}

// quartz/components/scripts/thoughtTopologyViewer.ts
async function renderThoughtTopology(...args) {
  args[0].dataset.topologyDimension = "3d";
  return renderThoughtTopology3D(...args);
}
export {
  renderThoughtTopology
};
