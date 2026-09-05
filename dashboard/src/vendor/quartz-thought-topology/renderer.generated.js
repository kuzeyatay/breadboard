// Generated from ../quartz/quartz/components/scripts/thoughtTopologyRenderer.ts. Do not edit by hand.
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
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
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
      constructorHandlers.set(Map, (o, fn) => new Map(cloneArray(Array.from(o), fn)));
      constructorHandlers.set(Set, (o, fn) => new Set(cloneArray(Array.from(o), fn)));
      if (opts.constructorHandlers) {
        for (const handler2 of opts.constructorHandlers) {
          constructorHandlers.set(handler2[0], handler2[1]);
        }
      }
      let handler = null;
      return opts.proto ? cloneProto : clone2;
      function cloneArray(a, fn) {
        const keys = Object.keys(a);
        const a2 = new Array(keys.length);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const cur = a[k];
          if (typeof cur !== "object" || cur === null) {
            a2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            a2[k] = handler(cur, fn);
          } else if (ArrayBuffer.isView(cur)) {
            a2[k] = copyBuffer(cur);
          } else {
            a2[k] = fn(cur);
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
      constructorHandlers.set(Map, (o, fn) => new Map(cloneArray(Array.from(o), fn)));
      constructorHandlers.set(Set, (o, fn) => new Set(cloneArray(Array.from(o), fn)));
      if (opts.constructorHandlers) {
        for (const handler2 of opts.constructorHandlers) {
          constructorHandlers.set(handler2[0], handler2[1]);
        }
      }
      let handler = null;
      return opts.proto ? cloneProto : clone2;
      function cloneArray(a, fn) {
        const keys = Object.keys(a);
        const a2 = new Array(keys.length);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const cur = a[k];
          if (typeof cur !== "object" || cur === null) {
            a2[k] = cur;
          } else if (cur.constructor !== Object && (handler = constructorHandlers.get(cur.constructor))) {
            a2[k] = handler(cur, fn);
          } else if (ArrayBuffer.isView(cur)) {
            a2[k] = copyBuffer(cur);
          } else {
            const index = refs.indexOf(cur);
            if (index !== -1) {
              a2[k] = refsNew[index];
            } else {
              a2[k] = fn(cur);
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

// quartz/components/scripts/thoughtTopologyRenderer.ts
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
import { Application, Circle, Container, Graphics, Text } from "pixi.js";

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

// quartz/components/scripts/sourceNodeVisual.ts
var TOPOLOGY_SOURCE_COLORS = {
  light: {
    pdf: "#be123c",
    link: "#2563eb",
    video: "#b45309",
    audio: "#7e22ce",
    document: "#15803d"
  },
  dark: {
    pdf: "#fb7185",
    link: "#60a5fa",
    video: "#f59e0b",
    audio: "#c084fc",
    document: "#4ade80"
  }
};
function topologySourceKind(node, folderPath = "") {
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

// quartz/components/scripts/thoughtTopologyLayout.ts
var CONNECTION_STROKE_WIDTH = 1;
var HIERARCHY_STROKE_WIDTH = 0.7;
var CONNECTION_MIN_OPACITY = 0.14;
var CONNECTION_MAX_OPACITY = 0.82;
var CONNECTION_STRENGTH_SPAN = 0.35;
function connectionStrength(score, threshold) {
  const base = Number.isFinite(threshold) ? threshold : 0;
  const span = Math.max(1e-6, Math.min(CONNECTION_STRENGTH_SPAN, 1 - base));
  return Math.min(1, Math.max(0, (score - base) / span));
}
function connectionOpacity(strength) {
  const unit = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
  return CONNECTION_MIN_OPACITY + (CONNECTION_MAX_OPACITY - CONNECTION_MIN_OPACITY) * unit;
}
function topologyNavigationSlug(value) {
  const slug2 = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.md$/i, "").split("/").filter(Boolean).map(
    (segment) => segment.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/\?/g, "").replace(/#/g, "")
  ).join("/");
  return slug2.endsWith("_index") ? slug2.replace(/_index$/, "index") : slug2;
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
    for (const id of [edge.source, edge.target]) {
      const list = byNode.get(id) ?? [];
      list.push(edge);
      byNode.set(id, list);
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
function naturalCompare(left, right) {
  return left.localeCompare(right, void 0, { numeric: true, sensitivity: "base" });
}
function affinityLabel(score, threshold = 0.3) {
  const base = Number.isFinite(threshold) ? threshold : 0.3;
  return score >= base + 0.28 ? "Very strong" : score >= base + 0.12 ? "Strong" : "Moderate";
}
function relationLabel(relationType) {
  const value = (relationType ?? "related").replace(/[-_]+/g, " ").trim();
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
      detail: "Concept and lexical mode. Semantic bridges will appear after vector analysis runs for this Garden."
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
function planThoughtTopology(payload, options = {}) {
  const preview = Boolean(options.preview);
  const normalizeFolderPath = (value) => {
    const trimmed = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/index$/i, "");
    try {
      return decodeURIComponent(trimmed).toLocaleLowerCase();
    } catch {
      return trimmed.toLocaleLowerCase();
    }
  };
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
  const subtreePageCount = (folderId) => {
    const own2 = payload.nodes.filter((node) => node.folderId === folderId).length;
    return own2 + scopedFolders.filter((folder) => folder.parentId === folderId).reduce((sum, child) => sum + subtreePageCount(child.id), 0);
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
    const children = folders.filter((folder) => folder.parentId === folderId);
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
    const ranked = [...pages].sort(
      (left, right) => importanceOf(right) - importanceOf(left) || naturalCompare(left.title, right.title)
    );
    if (keptPageIds.size === 0) {
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
  const childFolders = (folderId) => folders.filter((folder) => folder.parentId === folderId && folder.depth > 1).sort((left, right) => naturalCompare(left.path, right.path));
  const orderedPages = (folderId) => [...visiblePagesByFolder.get(folderId) ?? []].sort(
    (left, right) => naturalCompare(left.title, right.title) || left.id.localeCompare(right.id)
  );
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
      degree: degree.get(page.id) ?? 0,
      bridgeDegree: bridgeDegree.get(page.id) ?? 0,
      importance,
      nodeCount: 0,
      subtreeCount: 0
    };
  };
  const childItems = (childId) => [
    ...orderedPages(childId).map((page) => ({ id: page.id, radius: PAGE_RADIUS })),
    ...childFolders(childId).flatMap(
      (grandchild) => orderedPages(grandchild.id).map((page) => ({ id: page.id, radius: PAGE_RADIUS }))
    )
  ];
  const childFootprint = (childId) => {
    const items = childItems(childId);
    if (items.length === 0) return EMPTY_SUBFOLDER_FOOTPRINT;
    return packCluster(items, { x: 0, y: 0 }, 0).clusterRadius;
  };
  for (let index = 0; index < sectorFolders.length; index += 1) {
    const folder = sectorFolders[index];
    const items = [
      ...orderedPages(folder.id).map((page) => ({ id: page.id, radius: PAGE_RADIUS })),
      ...childFolders(folder.id).map((child) => ({
        id: child.id,
        radius: SUBFOLDER_RADIUS,
        footprint: childFootprint(child.id)
      }))
    ];
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
    const packed = packCluster(items, anchor, angle);
    sectors.push({ folderId: folder.id, angle, clusterRadius: clusterRadii[index] });
    nodes.push(folderNode(folder, folder.id, anchor.x, anchor.y, FOLDER_RADIUS));
    for (const page of orderedPages(folder.id)) {
      const position = packed.positions.get(page.id);
      nodes.push(pageNode(page, folder.id, position.x, position.y));
    }
    for (const child of childFolders(folder.id)) {
      const position = packed.positions.get(child.id);
      const outward = Math.atan2(position.y - anchor.y, position.x - anchor.x);
      const childNode = folderNode(child, folder.id, position.x, position.y, SUBFOLDER_RADIUS);
      nodes.push(childNode);
      const childPacked = packCluster(childItems(child.id), position, outward);
      for (const page of orderedPages(child.id)) {
        const childPosition = childPacked.positions.get(page.id);
        nodes.push(pageNode(page, folder.id, childPosition.x, childPosition.y));
      }
      for (const grandchild of childFolders(child.id)) {
        for (const page of orderedPages(grandchild.id)) {
          const slot = childPacked.positions.get(page.id) ?? position;
          nodes.push(pageNode(page, folder.id, slot.x, slot.y));
        }
      }
    }
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
  const hierarchyEdges = nodes.filter((node) => node.kind !== "garden").map((node) => {
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
      // Every line is the same hairline; strength shows as colour weight.
      width: CONNECTION_STROKE_WIDTH,
      opacity: connectionOpacity(strength)
    };
  }).filter((edge) => minStrength <= 0 || edge.strength >= minStrength).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
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

// quartz/components/scripts/thoughtTopologyRenderer.ts
var CLICK_SLOP_PX = 5;
var NODE_CLICK_TARGET_RADIUS_PX = 14;
var RIGHT_DOUBLE_CLICK_MS = 500;
var EMPTY_LESSON_PAGES_NOTICE = /No lesson pages have been generated yet\.?/gi;
var PAGE_LABEL_WRAP_PX = 128;
var FOLDER_LABEL_WRAP_PX = 180;
var GARDEN_LABEL_WRAP_PX = 230;
var POSITION_STORAGE_PREFIX = "thought-topology-home-positions:v2:";
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
  minConnectionStrength: 0,
  showHierarchy: true,
  // A large Garden draws thousands of links; each page keeping its five
  // strongest reads far better by default, and "All connections" is one
  // click away in the Filters panel.
  maxConnectionsPerNode: 5
};
function readStoredSettings(scope) {
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${scope}`);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const strength = Number(parsed.minConnectionStrength);
    const cap = Number(parsed.maxConnectionsPerNode);
    return {
      excludedFolderIds: Array.isArray(parsed.excludedFolderIds) ? parsed.excludedFolderIds.filter((id) => typeof id === "string") : [],
      minConnectionStrength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0,
      showHierarchy: parsed.showHierarchy !== false,
      maxConnectionsPerNode: typeof parsed.maxConnectionsPerNode === "number" && Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : DEFAULT_SETTINGS.maxConnectionsPerNode
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function writeStoredSettings(scope, settings) {
  try {
    window.localStorage.setItem(`${SETTINGS_STORAGE_PREFIX}${scope}`, JSON.stringify(settings));
  } catch {
  }
}
function mixHex(from, to, t) {
  const unit = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const parse = (value) => {
    const hex = value.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = Number.parseInt(full, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const a = parse(from);
  const b = parse(to);
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * unit);
  return `#${[channel(0), channel(1), channel(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function isPreviewSurface(config) {
  return Boolean(config.preview) || document.documentElement.classList.contains("quartz-graph-preview");
}
async function renderThoughtTopology(graph, fullSlug, config, payload, context) {
  const preview = isPreviewSurface(config);
  const isGlobalGraph = graph.classList.contains("global-graph-container");
  const folderLabelsOnly = !isGlobalGraph && Boolean(graph.closest(".right.sidebar"));
  const interactive = !preview && !folderLabelsOnly;
  const settingsScope = context.scopeFolderPath ? `${payload.garden.slug}:folder:${context.scopeFolderPath}` : `${payload.garden.slug}:root`;
  let settings = interactive ? readStoredSettings(settingsScope) : { ...DEFAULT_SETTINGS };
  let disposed = false;
  let mounting = null;
  let active = null;
  let recoveryTimer = null;
  let recoveryAttempts = 0;
  let renderPanel = () => {
  };
  const scheduleRecovery = () => {
    if (disposed || recoveryTimer !== null) return;
    const delay = Math.min(100 * 2 ** recoveryAttempts, 5e3);
    recoveryAttempts += 1;
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = null;
      void remount();
    }, delay);
  };
  const remount = async () => {
    if (disposed) return;
    const run = async () => {
      const previous = active;
      try {
        const replacement = await mountThoughtTopology(
          graph,
          fullSlug,
          config,
          payload,
          context,
          settings,
          scheduleRecovery
        );
        if (disposed) {
          replacement.cleanup();
          return;
        }
        active = replacement;
        previous?.cleanup();
        recoveryAttempts = 0;
        renderPanel();
      } catch {
        active = previous;
        scheduleRecovery();
      }
    };
    mounting = (mounting ?? Promise.resolve()).then(run, run);
    await mounting;
  };
  active = await mountThoughtTopology(
    graph,
    fullSlug,
    config,
    payload,
    context,
    settings,
    scheduleRecovery
  );
  const outer = graph.parentElement;
  const controlsHost = outer?.querySelector(
    ":scope > .thought-topology-controls"
  );
  const panelHost = controlsHost ?? outer;
  let panel = null;
  if (interactive && panelHost) {
    panel = element("div", "thought-topology-filter");
    panel.dataset.placement = controlsHost ? "column" : "surface";
    const toggle = element("button", "thought-topology-filter-toggle");
    toggle.type = "button";
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
    body.append(summary, foldersSection, linesSection);
    panel.append(toggle, body);
    const expandedFolders = /* @__PURE__ */ new Set();
    const describeStrength = (value) => value <= 0 ? "showing all" : `below ${Math.round(value * 100)}%`;
    renderPanel = () => {
      if (!active) return;
      const excluded = new Set(settings.excludedFolderIds);
      const activeCount = excluded.size + (settings.minConnectionStrength > 0 ? 1 : 0) + (settings.showHierarchy ? 0 : 1) + (settings.maxConnectionsPerNode !== DEFAULT_SETTINGS.maxConnectionsPerNode ? 1 : 0);
      badge.textContent = activeCount > 0 ? String(activeCount) : "";
      badge.hidden = activeCount === 0;
      summary.textContent = `${active.visiblePageCount} of ${active.totalPageCount} pages, ${active.connectionCount} connections shown.`;
      hierarchyInput.checked = settings.showHierarchy;
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
        const item = row(option, false);
        const kids = children.get(option.id) ?? [];
        if (kids.length > 0) {
          const disclose = element("button", "thought-topology-filter-disclose");
          disclose.type = "button";
          const open = expandedFolders.has(option.id);
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
      if (options.length === 0) {
        folderList.append(
          element("li", "thought-topology-filter-empty", "No folders in this view.")
        );
      }
    };
    const applySettings = async (next) => {
      if (disposed) return;
      settings = next;
      writeStoredSettings(settingsScope, settings);
      await remount();
    };
    toggle.addEventListener("click", () => {
      body.hidden = !body.hidden;
      toggle.setAttribute("aria-expanded", body.hidden ? "false" : "true");
      panel?.classList.toggle("open", !body.hidden);
    });
    showAll.addEventListener("click", () => {
      void applySettings({ ...settings, excludedFolderIds: [] });
    });
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
    active?.cleanup();
    active = null;
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
  const preview = isPreviewSurface(config);
  const isGlobalGraph = graph.classList.contains("global-graph-container");
  const folderLabelsOnly = !isGlobalGraph && Boolean(graph.closest(".right.sidebar"));
  const interactive = !preview && !folderLabelsOnly;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const gardenSlug = payload.garden.slug;
  const positionScope = context.scopeFolderPath ? `${gardenSlug}:folder:${context.scopeFolderPath}` : `${gardenSlug}:root`;
  const storedPositions = interactive ? readStoredPositions(positionScope) : {};
  const planOptions = {
    preview,
    scopeFolderPath: context.scopeFolderPath,
    excludedFolderIds: settings.excludedFolderIds,
    minConnectionStrength: settings.minConnectionStrength,
    maxConnectionsPerNode: settings.maxConnectionsPerNode
  };
  const plan = planThoughtTopology(payload, { ...planOptions, positionOverrides: storedPositions });
  const homePositions = new Map(plan.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const permanentHomeIds = new Set(Object.keys(storedPositions));
  let plannedHomeCache = null;
  const plannedHome = (nodeId) => {
    if (!plannedHomeCache) {
      plannedHomeCache = new Map(
        planThoughtTopology(payload, planOptions).nodes.map((node) => [
          node.id,
          { x: node.x, y: node.y }
        ])
      );
    }
    return plannedHomeCache.get(nodeId);
  };
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
  const cssVar = (name) => {
    const scoped = getComputedStyle(graph.closest(".graph") ?? graph).getPropertyValue(name).trim();
    return scoped || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };
  const isDark = document.documentElement.getAttribute("saved-theme") === "dark" || document.documentElement.dataset.theme === "dark";
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
    text: cssVar("--dark") || "#f4f1e8",
    textMuted: cssVar("--darkgray") || "#e6ebe5",
    paper: cssVar("--light") || "#18181a"
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
    text: cssVar("--dark") || "#0f1a16",
    textMuted: cssVar("--darkgray") || "#13201b",
    paper: cssVar("--light") || "#e6f0e6"
  };
  const fontFamily = cssVar("--bodyFont") || "system-ui, sans-serif";
  const app = new Application();
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    // WebGL is substantially more stable for this long-lived, repeatedly
    // remounted 2D scene. Some Chromium/WebGPU devices leave a live but blank
    // canvas after tab suspension or repeated filter/theme remounts.
    preference: "webgl",
    resolution: window.devicePixelRatio,
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
  const labelLayer = new Container({ zIndex: 5, isRenderGroup: true });
  hierarchyLayer.visible = !folderLabelsOnly && settings.showHierarchy;
  linkLayer.visible = !folderLabelsOnly;
  nodeLayer.visible = !folderLabelsOnly;
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
  const cleanups = [];
  const inspectorRoot = interactive && outer ? element("aside", "thought-inspector") : null;
  const inspectorContent = inspectorRoot ? element("div", "thought-inspector-content") : null;
  const inspectorClose = inspectorRoot ? element("button", "thought-inspector-close", "\xD7") : null;
  if (inspectorRoot && inspectorContent && inspectorClose) {
    inspectorRoot.setAttribute("role", "complementary");
    inspectorRoot.setAttribute("aria-label", "Node connections");
    inspectorRoot.setAttribute("aria-hidden", "true");
    inspectorClose.type = "button";
    inspectorClose.setAttribute("aria-label", "Close node connections");
    inspectorRoot.append(inspectorClose, inspectorContent);
    outer?.append(inspectorRoot);
  }
  let rendererInvalidated = false;
  const invalidateRenderer = () => {
    if (rendererInvalidated || stopAnimation) return;
    rendererInvalidated = true;
    stopAnimation = true;
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
  function drawNode(view) {
    const { node, gfx, style } = view;
    const radius = node.radius;
    gfx.clear();
    const sourceColor = node.sourceKind ? colors.source[node.sourceKind] : null;
    const nodeColor = sourceColor ?? (node.kind === "garden" ? colors.garden : node.kind === "folder" ? colors.folder : style === "related" || node.radius >= 3.5 ? colors.pageStrong : colors.page);
    gfx.circle(0, 0, radius + 5).fill({ color: nodeColor, alpha: style === "selected" ? 0.32 : 0.24 });
    if (permanentHomeIds.has(node.id)) {
      gfx.circle(0, 0, radius + 5.5).stroke({ width: 1, color: nodeColor, alpha: 0.8 });
    }
    if (node.kind === "garden") {
      gfx.circle(0, 0, radius).fill({ color: nodeColor, alpha: 0.98 }).stroke({ width: 1.2, color: nodeColor, alpha: 1 });
      return;
    }
    if (node.kind === "folder") {
      if (style === "selected" || style === "hovered") {
        gfx.circle(0, 0, radius + 4).stroke({ width: 1.5, color: colors.garden, alpha: style === "selected" ? 0.75 : 0.45 });
      }
      gfx.circle(0, 0, radius).fill({ color: nodeColor, alpha: 0.98 }).stroke({ width: 1.1, color: nodeColor, alpha: 1 });
      return;
    }
    if (style === "selected") {
      gfx.circle(0, 0, radius).fill({ color: sourceColor ?? colors.garden, alpha: 1 });
      return;
    }
    if (style === "hovered") {
      gfx.circle(0, 0, radius + 3.5).stroke({ width: 1.2, color: sourceColor ?? colors.garden, alpha: 0.55 });
    }
    gfx.circle(0, 0, radius).fill({ color: nodeColor, alpha: 0.98 }).stroke({ width: 1, color: nodeColor, alpha: 1 });
  }
  function labelText(node) {
    return node.kind === "page" ? node.title : node.label;
  }
  function makeLabel(node) {
    const size = node.kind === "garden" ? 13 : node.kind === "folder" ? 12.5 : 10.5;
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
        fontWeight: node.kind === "garden" ? "600" : node.kind === "folder" ? "500" : "400",
        stroke: { color: colors.paper, width: 3, join: "round" },
        wordWrap: true,
        wordWrapWidth: node.kind === "garden" ? GARDEN_LABEL_WRAP_PX : node.kind === "folder" ? FOLDER_LABEL_WRAP_PX : PAGE_LABEL_WRAP_PX,
        lineHeight: size * 1.2
      },
      resolution: window.devicePixelRatio * 2
    });
    return label;
  }
  for (const node of plan.nodes) {
    const gfx = new Graphics({
      interactive,
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
    drawNode(view);
    gfx.zIndex = node.kind === "garden" ? 3 : node.kind === "folder" ? 2 : 1;
    nodeLayer.addChild(gfx);
    labelLayer.addChild(view.label);
    views.push(view);
    viewById.set(node.id, view);
  }
  for (const edge of plan.hierarchyEdges) {
    const source = viewById.get(edge.source);
    const target = viewById.get(edge.target);
    if (!source || !target) continue;
    const gfx = new Graphics({
      interactive,
      eventMode: interactive ? "static" : "none",
      cursor: "pointer",
      label: edge.id
    });
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
          text: `${target.node.title} is organized under ${source.node.title} in this garden.`
        },
        evidence: [],
        crossFolder: false,
        strength: 0,
        width: HIERARCHY_STROKE_WIDTH,
        opacity: 0.26
      },
      gfx,
      source,
      target,
      alpha: 0,
      alphaTarget: 0.26,
      color: colors.hierarchy,
      restColor: colors.hierarchy,
      widthBoost: 0,
      selected: false
    });
    hierarchyLayer.addChild(gfx);
  }
  for (const edge of plan.edges) {
    const source = viewById.get(edge.source);
    const target = viewById.get(edge.target);
    if (!source || !target) continue;
    const gfx = new Graphics({
      interactive,
      eventMode: interactive ? "static" : "none",
      cursor: "pointer",
      label: edge.id
    });
    const restColor = mixHex(colors.edgeWeak, colors.edgeStrong, edge.strength);
    edgeViews.push({
      kind: "semantic",
      edge,
      gfx,
      source,
      target,
      alpha: 0,
      alphaTarget: edge.opacity,
      color: restColor,
      restColor,
      widthBoost: 0,
      selected: false
    });
    linkLayer.addChild(gfx);
  }
  const connectionViews = [...hierarchyViews, ...edgeViews];
  const edgeById = new Map(connectionViews.map((view) => [view.edge.id, view]));
  const simNodes = plan.nodes;
  const simNodeById = new Map(simNodes.map((node) => [node.id, node]));
  const labelLayoutScale = preview ? 1.8 : isGlobalGraph ? 1 : 1.15;
  const clearanceById = new Map(
    views.map((view) => [
      view.node.id,
      labelClearanceRadius(
        view.node.radius,
        folderLabelsOnly && view.node.kind !== "folder" || !shouldShowTopologyNodeLabel(view.node) ? 0 : view.label.width,
        folderLabelsOnly && view.node.kind !== "folder" || !shouldShowTopologyNodeLabel(view.node) ? 0 : view.label.height,
        labelLayoutScale
      )
    ])
  );
  const returnTargets = /* @__PURE__ */ new Map();
  const returningNodeIds = /* @__PURE__ */ new Set();
  let activeDragNodeId = null;
  if (!reducedMotion && !folderLabelsOnly) {
    for (const node of simNodes) {
      if (permanentHomeIds.has(node.id)) {
        const home = homePositions.get(node.id);
        node.fx = home?.x ?? node.x;
        node.fy = home?.y ?? node.y;
      } else {
        node.x = Number.NaN;
        node.y = Number.NaN;
      }
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
  let simulationSettled = reducedMotion || folderLabelsOnly;
  let draggingNode = false;
  const simulation = forceSimulation(simNodes).force("charge", forceManyBody().strength(-125 * config.repelForce)).force("center", forceCenter(0, 0).strength(config.centerForce)).force(
    "collide",
    forceCollide((node) => clearanceById.get(node.id) ?? node.radius + 7).iterations(
      isGlobalGraph ? 6 : 3
    )
  ).force(
    "link",
    forceLink(links).distance((link) => link.distance)
  ).force("home-x", homeXForce).force("home-y", homeYForce).alphaDecay(0.018).velocityDecay(0.5).on("tick", () => {
    simulationSettled = false;
    labelsDirty = true;
  }).on("end", () => {
    for (const [nodeId, target] of returnTargets) {
      const node = simNodeById.get(nodeId);
      if (!node) continue;
      node.x = target.x;
      node.y = target.y;
      node.fx = target.pin ? target.x : null;
      node.fy = target.pin ? target.y : null;
    }
    returnTargets.clear();
    returningNodeIds.clear();
    simulationSettled = true;
    labelsDirty = true;
    if (viewState === "fit" && !userMovedView && !activeDragNodeId) fitView(true);
  });
  if (folderLabelsOnly) {
    simulation.stop();
  } else if (reducedMotion) {
    simulation.stop();
    simulation.tick(360);
  }
  const worldX = (node) => node.x + width / 2;
  const worldY = (node) => node.y + height / 2;
  const screenOf = (node) => ({
    x: transform.applyX(worldX(node)),
    y: transform.applyY(worldY(node))
  });
  const screenRadius = (node) => node.radius * Math.sqrt(transform.k);
  function nodeAtScreenPoint(x, y) {
    let match;
    for (const view of views) {
      const position = screenOf(view.node);
      const distance = Math.hypot(x - position.x, y - position.y);
      const hitRadius = Math.max(
        NODE_CLICK_TARGET_RADIUS_PX,
        (view.node.radius + 7) * Math.sqrt(transform.k)
      );
      if (distance > hitRadius || match && distance >= match.distance) continue;
      match = { view, distance };
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
  function distanceToEdge(view, point) {
    let best = Infinity;
    let previous = edgePoint(view, 0);
    for (let step = 1; step <= 12; step += 1) {
      const next = edgePoint(view, step / 12);
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const denominator = dx * dx + dy * dy;
      const unit = denominator === 0 ? 0 : Math.max(
        0,
        Math.min(
          1,
          ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / denominator
        )
      );
      best = Math.min(
        best,
        Math.hypot(point.x - (previous.x + unit * dx), point.y - (previous.y + unit * dy))
      );
      previous = next;
    }
    return best;
  }
  function drawEdge(view) {
    const g = edgeGeometry(view);
    const k = transform.k;
    const restWidth = view.edge.width + view.widthBoost;
    const strokeWidth = (view.selected ? restWidth + 1.2 : restWidth) / k;
    const gfx = view.gfx;
    gfx.clear();
    const path = () => {
      gfx.moveTo(g.x1, g.y1);
      gfx.lineTo(g.x2, g.y2);
    };
    if (interactive) {
      path();
      gfx.stroke({ alpha: 1e-3, width: 14 / k, color: view.color });
    }
    path();
    gfx.stroke({ alpha: view.alpha, width: strokeWidth, color: view.color });
  }
  const canvasSelection = select(app.canvas);
  const zoomBehavior = zoom().scaleExtent([0.2, 5]).on("zoom", (event) => {
    transform = event.transform;
    world.scale.set(transform.k, transform.k);
    world.position.set(transform.x, transform.y);
    if (event.sourceEvent) {
      viewState = "user";
      userMovedView = true;
    }
    labelsDirty = true;
    emitGraphContext();
  });
  function applyTransform(next, animate2) {
    const target = zoomIdentity.translate(next.x, next.y).scale(next.k);
    if (!interactive || !config.zoom) {
      transform = target;
      world.scale.set(target.k, target.k);
      world.position.set(target.x, target.y);
      labelsDirty = true;
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
    if (preview) return { top: 10, right: 10, bottom: 10, left: 10 };
    return { top: 14, right: 14, bottom: 14, left: 14 };
  }
  function blockedRects() {
    if (preview) return [];
    const canvasRect = graph.getBoundingClientRect();
    const rects = [];
    for (const blocker of [heading, searchPanel, overlayClose, calloutRoot, inspectorRoot]) {
      if (blocker === calloutRoot && !calloutVisible) continue;
      if (blocker === inspectorRoot && !inspectorRoot?.classList.contains("open")) continue;
      if (!blocker || blocker.hidden || blocker.offsetParent === null) continue;
      const rect = blocker.getBoundingClientRect();
      rects.push({
        left: rect.left - canvasRect.left - 6,
        top: rect.top - canvasRect.top - 6,
        right: rect.right - canvasRect.left + 6,
        bottom: rect.bottom - canvasRect.top + 6
      });
    }
    return rects;
  }
  function fitView(animate2, useHomeLayout = false) {
    const visiblePlanNodes = folderLabelsOnly ? plan.nodes.filter((node) => node.kind === "folder") : plan.nodes;
    const fitNodes = useHomeLayout ? visiblePlanNodes.map((node) => ({ ...node, ...homePositions.get(node.id) ?? {} })) : visiblePlanNodes;
    const gardenAnchor = useHomeLayout ? { ...plan.garden, ...homePositions.get(plan.garden.id) ?? {} } : plan.garden;
    const bounds = boundsOf(fitNodes, preview ? 18 : 44);
    const next = fitTransform(
      bounds,
      { width, height },
      currentInsets(),
      {
        minScale: 0.3,
        maxScale: preview ? 1.25 : 1.35
      },
      { x: gardenAnchor.x, y: gardenAnchor.y }
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
    let emphasis = null;
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : void 0;
    const hoveredEdge = hoveredEdgeId ? edgeById.get(hoveredEdgeId) : void 0;
    const focusedEdge = hoveredEdge ?? selectedEdge;
    if (focusedEdge) {
      emphasis = /* @__PURE__ */ new Set([focusedEdge.edge.source, focusedEdge.edge.target]);
    } else if (selectedNodeId) {
      const selected = viewById.get(selectedNodeId)?.node;
      emphasis = selected && selected.kind !== "garden" ? emphasisFor(selectedNodeId) : null;
    }
    if (hoveredNodeId && viewById.get(hoveredNodeId)?.node.kind !== "garden") {
      const hovered = emphasisFor(hoveredNodeId);
      emphasis = emphasis ? /* @__PURE__ */ new Set([...emphasis, ...hovered]) : hovered;
    }
    if (searchQuery) {
      emphasis = emphasis ? /* @__PURE__ */ new Set([...emphasis, ...searchHits]) : new Set(searchHits);
    }
    for (const view of views) {
      const id = view.node.id;
      const highlighted = !emphasis || emphasis.has(id);
      const style = selectedNodeId === id ? "selected" : hoveredNodeId === id ? "hovered" : emphasis && highlighted ? "related" : "rest";
      if (style !== view.style) {
        view.style = style;
        drawNode(view);
      }
      view.alphaTarget = highlighted ? 1 : view.node.kind === "page" ? 0.42 : 0.62;
    }
    for (const view of connectionViews) {
      const { source, target } = view.edge;
      const selected = view.edge.id === selectedEdgeId;
      const hovered = view.edge.id === hoveredEdgeId;
      const touchesFocus = selectedNodeId !== null && (source === selectedNodeId || target === selectedNodeId) || hoveredNodeId !== null && (source === hoveredNodeId || target === hoveredNodeId) || searchQuery !== "" && (searchHits.has(source) || searchHits.has(target));
      const withinEmphasis = emphasis ? emphasis.has(source) && emphasis.has(target) : true;
      const active = selected || hovered || touchesFocus || (emphasis === null ? true : withinEmphasis);
      view.selected = selected;
      view.alphaTarget = selected ? 1 : hovered ? Math.min(1, view.edge.opacity + 0.42) : active ? emphasis ? Math.min(1, view.edge.opacity + 0.3) : view.edge.opacity : 0.05;
      view.color = selected ? colors.edgeSelected : hovered ? colors.edgeActive : active && emphasis ? colors.edgeActive : view.restColor;
      view.widthBoost = selected ? 1.2 : hovered ? 0.8 : active && emphasis ? 0.4 : 0;
    }
    labelsDirty = true;
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
  function labelScale() {
    const ratio = transform.k / (fitK || transform.k || 1);
    return Math.min(1.7, Math.max(0.9, Math.sqrt(ratio)));
  }
  const QUIET_NAME_ZOOM = 1.5;
  function updateLabels() {
    labelsDirty = false;
    const ratio = transform.k / (fitK || 1);
    const budget = pageLabelBudget(ratio);
    const scale = labelScale();
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
      const inFocus = selectedNodeId === node.id || hoveredNodeId === node.id && !draggingNode || selectedNeighbours.has(node.id) || Boolean(
        selectedEdge && (selectedEdge.edge.source === node.id || selectedEdge.edge.target === node.id)
      ) || Boolean(searchQuery && searchHits.has(node.id));
      if (folderLabelsOnly && node.kind !== "folder" || quietName && !inFocus && ratio < QUIET_NAME_ZOOM) {
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
    const placements = placeLabels(candidates, obstacles, clip, blockedRects());
    if (preview) {
      const budgetWinners = candidates.filter((candidate) => candidate.priority < 600 && placements.has(candidate.id)).sort((left, right) => right.priority - left.priority);
      for (const loser of budgetWinners.slice(budget)) placements.delete(loser.id);
    }
    for (const view of views) {
      const placement = placements.get(view.node.id) ?? ((preview ? labelMustStayAttached(view.node.id) : wanted.has(view.node.id) && !budgetTier.has(view.node.id)) ? attachedLabelPlacement(view) : null);
      view.placement = placement;
      view.labelTarget = placement ? view.alphaTarget < 1 ? 0.6 : 1 : 0;
    }
  }
  function showCallout() {
    if (!calloutRoot) return;
    calloutVisible = true;
    calloutRoot.classList.add("visible");
    calloutRoot.setAttribute("aria-hidden", "false");
    labelsDirty = true;
  }
  function hideCallout() {
    if (!calloutRoot) return;
    calloutVisible = false;
    floatingCalloutTarget = null;
    renderedCalloutKey = null;
    calloutRoot.classList.remove("visible");
    calloutRoot.setAttribute("aria-hidden", "true");
    labelsDirty = true;
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
      const sourceType = node.sourceKind ? `${node.sourceKind === "pdf" ? "PDF" : node.sourceKind[0].toUpperCase() + node.sourceKind.slice(1)} source` : "";
      calloutText(
        "thought-callout-meta",
        [
          sourceType,
          concepts,
          `${touching.length} ${touching.length === 1 ? "connection" : "connections"}`
        ].filter(Boolean).join(" \xB7 ")
      );
    }
  }
  function renderEdgeCallout(view) {
    if (!calloutContent) return;
    const { edge } = view;
    calloutContent.replaceChildren();
    calloutContent.appendChild(
      calloutTitle(
        `${view.source.node.title} ${view.kind === "hierarchy" ? "\u2192" : "\u2194"} ${view.target.node.title}`
      )
    );
    calloutText(
      "thought-callout-meta",
      [
        relationLabel(edge.relationType),
        view.kind === "semantic" ? `${affinityLabel(edge.score, edge.threshold)} affinity \xB7 ${edge.score.toFixed(2)}` : "",
        edge.crossFolder ? "Bridges folders" : ""
      ].filter(Boolean).join(" \xB7 ")
    );
    calloutText(
      "thought-callout-summary",
      edge.explanation.text.trim() ? edge.explanation.text : edge.origin === "inferred" ? "This connection is supported by the displayed semantic evidence." : "This connection comes from the garden's authored structure."
    );
  }
  function visibleConnectionsFor(nodeId) {
    const visibleConnections = settings.showHierarchy ? connectionViews : edgeViews;
    return visibleConnections.filter((view) => view.edge.source === nodeId || view.edge.target === nodeId).sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "semantic" ? -1 : 1;
      return right.edge.score - left.edge.score || left.edge.id.localeCompare(right.edge.id);
    });
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
    if (view.edge.explanation.text.trim()) return view.edge.explanation.text;
    return view.edge.origin === "inferred" ? "This connection is supported by the displayed semantic evidence." : "This connection comes from the garden's authored structure.";
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
        const weight = element(
          "span",
          "thought-connection-weight",
          connection.kind === "semantic" ? `${Math.round(connection.edge.score * 100)}%` : "Structure"
        );
        cardHeading.append(port, otherTitle, weight);
        const relation = element(
          "span",
          "thought-connection-relation",
          [
            relationLabel(connection.edge.relationType),
            connection.kind === "semantic" ? `${affinityLabel(connection.edge.score, connection.edge.threshold)} affinity` : "Garden hierarchy",
            connection.edge.crossFolder ? "Bridges folders" : ""
          ].filter(Boolean).join(" \xB7 ")
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
    labelsDirty = true;
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
    labelsDirty = true;
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
    const calloutWidth = Math.min(
      calloutRoot.offsetWidth || 320,
      Math.max(180, width - 2 * padding)
    );
    const calloutHeight = calloutRoot.offsetHeight || 120;
    let left = anchorX + offsetX;
    if (offsetX < 0) left -= calloutWidth;
    if (left + calloutWidth > width - padding) left = anchorX - calloutWidth - 18;
    if (left < padding) left = Math.min(width - calloutWidth - padding, anchorX + 18);
    let top = anchorY + offsetY - calloutHeight * 0.22;
    top = Math.max(padding, Math.min(height - calloutHeight - padding, top));
    calloutRoot.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }
  function syncFloatingCallout() {
    if (!calloutRoot) return;
    const hoveredNode = hoveredNodeId && hoveredNodeId !== inspectedNodeId ? viewById.get(hoveredNodeId) : void 0;
    const hoveredEdge = hoveredEdgeId ? edgeById.get(hoveredEdgeId) : void 0;
    const selectedNode = selectedNodeId && selectedNodeId !== inspectedNodeId ? viewById.get(selectedNodeId) : void 0;
    const selectedEdge = selectedEdgeId && !inspectedNodeId ? edgeById.get(selectedEdgeId) : void 0;
    const target = hoveredNode ? { kind: "node", view: hoveredNode } : hoveredEdge ? { kind: "edge", view: hoveredEdge } : selectedNode ? { kind: "node", view: selectedNode } : selectedEdge ? { kind: "edge", view: selectedEdge } : null;
    if (!target) {
      hideCallout();
      return;
    }
    const id = target.kind === "node" ? target.view.node.id : target.view.edge.id;
    const key = `${target.kind}:${id}`;
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
    hideNodeInspector();
    selectedEdgeId = view.edge.id;
    selectedNodeId = null;
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
    if (event.key === "Escape" && inspectedNodeId) clearSelection();
  };
  inspectorClose?.addEventListener("click", handleInspectorClose);
  window.addEventListener("keydown", handleInspectorKeydown);
  cleanups.push(() => {
    inspectorClose?.removeEventListener("click", handleInspectorClose);
    window.removeEventListener("keydown", handleInspectorKeydown);
  });
  let lastRightClick = null;
  function openNode(view) {
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
    const position = { x: node.x, y: node.y };
    const positions = readStoredPositions(positionScope);
    positions[node.id] = position;
    homePositions.set(node.id, position);
    permanentHomeIds.add(node.id);
    returnTargets.delete(node.id);
    returningNodeIds.delete(node.id);
    node.fx = position.x;
    node.fy = position.y;
    homeXForce.x(homeXForNode);
    homeYForce.y(homeYForNode);
    writeStoredPositions(positionScope, positions);
    drawNode(view);
    refreshNodeInspector();
    labelsDirty = true;
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
    homeXForce.x(homeXForNode);
    homeYForce.y(homeYForNode);
    if (reducedMotion) {
      if (home) {
        node.x = home.x;
        node.y = home.y;
      }
    } else {
      simulationSettled = false;
      simulation.alpha(Math.max(simulation.alpha(), 0.25)).restart();
    }
    drawNode(view);
    refreshNodeInspector();
    labelsDirty = true;
    emitGraphContext();
  }
  function handleRightNodeClick(view) {
    const now = performance.now();
    const doubleClick = lastRightClick?.nodeId === view.node.id && now - lastRightClick.at <= RIGHT_DOUBLE_CLICK_MS;
    openNodeInspector(view);
    if (doubleClick) {
      lastRightClick = null;
      if (permanentHomeIds.has(view.node.id)) releaseNode(view);
      else pinNode(view);
      return;
    }
    lastRightClick = { nodeId: view.node.id, at: now };
  }
  if (interactive) {
    for (const view of views) {
      view.gfx.on("pointerover", () => {
        hoveredNodeId = view.node.id;
        refreshStyles();
        syncFloatingCallout();
      }).on("pointerleave", () => {
        if (hoveredNodeId === view.node.id) hoveredNodeId = null;
        refreshStyles();
        syncFloatingCallout();
      });
    }
    for (const view of connectionViews) {
      view.gfx.on("pointerover", () => {
        hoveredEdgeId = view.edge.id;
        refreshStyles();
        syncFloatingCallout();
      }).on("pointerleave", () => {
        if (hoveredEdgeId === view.edge.id) hoveredEdgeId = null;
        refreshStyles();
        syncFloatingCallout();
      }).on("pointertap", (event) => {
        event.stopPropagation();
        const point = world.toLocal(event.global);
        const closest = [...connectionViews].sort(
          (left, right) => distanceToEdge(left, point) - distanceToEdge(right, point)
        )[0];
        selectEdge(closest ?? view);
      });
    }
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
          const accepted = !event.ctrlKey && (event.button === 0 || event.button === 2);
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
          if (!event.active && !reducedMotion) simulation.alphaTarget(1).restart();
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
                fx: view.node.fx,
                fy: view.node.fy
              }
            ]
          };
          view.node.fx = view.node.x;
          view.node.fy = view.node.y;
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
          for (const member of dragState.members) {
            const x = member.x + dx;
            const y = member.y + dy;
            member.view.node.x = x;
            member.view.node.y = y;
            member.view.node.fx = x;
            member.view.node.fy = y;
          }
          labelsDirty = true;
        }).on("end", (event) => {
          if (!dragState) return;
          const state = dragState;
          dragState = null;
          draggingNode = false;
          activeDragNodeId = null;
          if (!event.active && !reducedMotion) simulation.alphaTarget(0);
          if (reducedMotion) simulationSettled = true;
          if (state.moved <= CLICK_SLOP_PX) {
            for (const member of state.members) {
              const home = homePositions.get(member.view.node.id);
              if (permanentHomeIds.has(member.view.node.id) && home) {
                member.view.node.fx = home.x;
                member.view.node.fy = home.y;
              } else {
                member.view.node.fx = member.fx;
                member.view.node.fy = member.fy;
              }
            }
            if (state.permanent) handleRightNodeClick(state.view);
            else openNode(state.view);
            return;
          }
          lastRightClick = null;
          if (state.members.length === 0) return;
          if (state.permanent) {
            const positions = readStoredPositions(positionScope);
            for (const member of state.members) {
              const position = { x: member.view.node.x, y: member.view.node.y };
              homePositions.set(member.view.node.id, position);
              positions[member.view.node.id] = position;
              permanentHomeIds.add(member.view.node.id);
              returnTargets.delete(member.view.node.id);
              returningNodeIds.delete(member.view.node.id);
              member.view.node.fx = position.x;
              member.view.node.fy = position.y;
            }
            homeXForce.x(homeXForNode);
            homeYForce.y(homeYForNode);
            writeStoredPositions(positionScope, positions);
            for (const member of state.members) drawNode(member.view);
            refreshNodeInspector();
            labelsDirty = true;
            emitGraphContext();
            return;
          }
          let homeForceChanged = false;
          for (const member of state.members) {
            const home = homePositions.get(member.view.node.id);
            if (!home) continue;
            if (reducedMotion) {
              member.view.node.x = home.x;
              member.view.node.y = home.y;
              member.view.node.fx = permanentHomeIds.has(member.view.node.id) ? home.x : null;
              member.view.node.fy = permanentHomeIds.has(member.view.node.id) ? home.y : null;
            } else {
              member.view.node.fx = null;
              member.view.node.fy = null;
              const pin = permanentHomeIds.has(member.view.node.id);
              const target = pin ? home : { x: member.x, y: member.y };
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
          labelsDirty = true;
          emitGraphContext();
          void event;
        })
      );
    } else {
      for (const view of views)
        view.gfx.on(
          "pointertap",
          (event) => event.button === 2 ? handleRightNodeClick(view) : openNode(view)
        );
    }
    if (config.zoom) {
      canvasSelection.call(zoomBehavior).on("dblclick.zoom", null);
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
      const press = backgroundPress;
      backgroundPress = null;
      if (!press || press.onTarget || hoveredNodeId !== null || hoveredEdgeId !== null) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
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
    const best = [...searchHits].map((id) => viewById.get(id)).sort((left, right) => {
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
  if (graph.dataset.searchQuery) updateSearch(graph.dataset.searchQuery);
  function emitGraphContext() {
    const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : void 0;
    const selectedNode = selectedNodeId ? viewById.get(selectedNodeId)?.node : void 0;
    const directNeighborSlugs = selectedNode ? [...neighbours.get(selectedNode.id) ?? []].map((id) => viewById.get(id)?.node).filter((node) => Boolean(node)).map((node) => node.navigateSlug ?? node.id).slice(0, 12) : [];
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
        explanation: selectedEdge.edge.explanation.text
      } : null,
      visibleNodeSlugs: plan.nodes.map((node) => node.navigateSlug ?? node.id).slice(0, 24),
      directNeighborSlugs,
      activeCluster: context.scopeCluster,
      filters: searchQuery ? [searchQuery] : [],
      depth: context.configuredDepth < 0 ? 3 : context.configuredDepth,
      relationshipTypes: selectedEdge ? [selectedEdge.edge.relationType] : ["semantic-affinity"],
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
    labelsDirty = true;
  });
  resizeObserver?.observe(graph);
  const lerp = (current, target) => Math.abs(target - current) < 0.01 ? target : current + (target - current) * 0.22;
  function animate() {
    if (stopAnimation) return;
    if (labelsDirty) updateLabels();
    const inverseScale = 1 / Math.sqrt(transform.k);
    for (const view of views) {
      const { node } = view;
      view.gfx.position.set(worldX(node), worldY(node));
      view.gfx.scale.set(inverseScale, inverseScale);
      view.alpha = lerp(view.alpha, view.alphaTarget);
      view.gfx.alpha = view.alpha;
      view.labelAlpha = lerp(view.labelAlpha, view.labelTarget);
      const placement = view.placement;
      if (placement && view.labelAlpha > 0.02) {
        const position = screenOf(node);
        view.label.visible = true;
        view.label.alpha = view.labelAlpha;
        view.label.anchor.set(placement.anchorX, placement.anchorY);
        view.label.position.set(position.x + placement.dx, position.y + placement.dy);
        const align = placement.side === "left" ? "right" : placement.side === "right" ? "left" : "center";
        if (view.label.style.align !== align) view.label.style.align = align;
      } else {
        view.label.visible = false;
      }
    }
    for (const view of connectionViews) {
      view.alpha = lerp(view.alpha, view.alphaTarget);
      drawEdge(view);
    }
    positionFloatingCallout();
    if (debugEnabled) {
      const debugWindow = window;
      debugWindow.__breadboardThoughtTopologyDebug = {
        selectedConnectionId: selectedEdgeId,
        selectedNodeId,
        inspectedNodeId,
        inspectorOpen: inspectorRoot?.classList.contains("open") ?? false,
        hoveredNodeId,
        activeDragNodeId,
        returningNodeIds: [...returningNodeIds],
        permanentNodeIds: [...permanentHomeIds],
        viewState,
        viewSettled: !transitioning && (simulationSettled || draggingNode),
        simulationSettled,
        calloutVisible,
        folderLabelsOnly,
        transform: { k: transform.k, x: transform.x, y: transform.y },
        labels: Object.fromEntries(
          views.filter((view) => view.label.visible).map((view) => [view.node.id, view.label.text])
        ),
        nodes: Object.fromEntries(views.map((view) => [view.node.id, screenOf(view.node)])),
        worldNodes: Object.fromEntries(
          views.map((view) => [view.node.id, { x: view.node.x, y: view.node.y }])
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
      app.renderer.render(stage);
    } catch {
      invalidateRenderer();
      return;
    }
    requestAnimationFrame(animate);
  }
  refreshStyles();
  fitView(false, true);
  emitGraphContext();
  requestAnimationFrame(animate);
  const cleanup = () => {
    stopAnimation = true;
    simulation.stop();
    resizeObserver?.disconnect();
    graph.removeEventListener("graph-search", handleGraphSearch);
    graph.removeEventListener("graph-search-commit", handleGraphSearchCommit);
    for (const cleanup2 of cleanups) cleanup2();
    hideCallout();
    obscureOverlayClose(false);
    inspectorRoot?.remove();
    const hasReplacementCanvas = graph.querySelectorAll(":scope > canvas").length > 1;
    if (!hasReplacementCanvas) {
      if (graphRoot && graphRoot.dataset.activeMode === "thought-topology")
        delete graphRoot.dataset.activeMode;
      if (heading) heading.hidden = true;
    }
    app.destroy({ removeView: true });
  };
  return {
    cleanup,
    folderOptions: plan.folderOptions,
    visiblePageCount: plan.visiblePageCount,
    totalPageCount: plan.totalPageCount,
    connectionCount: plan.edges.length
  };
}
export {
  renderThoughtTopology
};
