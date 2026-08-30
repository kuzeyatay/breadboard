import fs, { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { captureAgentEditsSnapshot } from "./runtime-v2-agent-edits-executor.mjs";

// The canonical assistant efforts (lib/assistant-reasoning.ts) include "max";
// a user whose account default is "max" must not crash every worker at startup.
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const OPENCODE_EFFORTS = new Set([...EFFORTS, "max"]);
const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TUTOR_CAPABILITIES = new Set([
  "chat",
  "deep_solve",
  "deep_question",
  "deep_research",
  "visualize",
  "math_animator",
  "mastery_path",
]);
const TUTOR_TOOLS = new Set(["web_search", "paper_search", "brainstorm", "reason"]);
const TRADING_ANALYSTS = new Set(["market", "social", "news", "fundamentals"]);
const TRADING_VENDORS = new Set(["yfinance", "alpha_vantage", "yfinance,alpha_vantage"]);
const SHORTS_WHISPER_MODELS = new Set(["tiny", "base", "small", "medium"]);
const LEGAL_SKILLS = new Set(["docx", "xlsx", "pptx"]);
const LEGAL_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const LEGAL_DOCUMENT_FORMATS = new Set(["docx", "xlsx", "pptx", "pdf", "odt", "ods", "odp"]);
const LEGAL_UNSUPPORTED_TYPES = new Set(["video", "audio", "model"]);
const GET_DOC_SOURCES = new Set(["openalex", "arxiv", "europepmc", "crossref", "semanticscholar", "core"]);
const MEETING_SOURCE_KINDS = new Set(["upload", "artifact", "attachment", "transcript", "auto"]);
const MEETING_TRANSCRIPTION_MODELS = new Set(["base", "small", "medium", "large", "turbo"]);
const RESOURCE2SKILL_DOMAINS = new Set(["web", "ppt", "excel", "blender", "reaper"]);
const BOLT_SLIDES_THEMES = new Set([
  "auto",
  "dark-product",
  "editorial-luxury",
  "swiss",
  "dark-technical",
  "warm-minimal",
  "fintech",
  "aurora-glass",
  "cinematic",
  "paper-editorial",
]);
const HARDWARE_BOARDS = new Set([
  "arduino-uno",
  "esp32-devkit-v1",
  "raspberry-pi-pico",
]);
const HARDWARE_PROTOTYPES = new Set(["breadboard", "perfboard", "pcb"]);
const HARDWARE_FIRMWARE = new Set(["arduino", "platformio"]);
const HARDWARE_ENCLOSURE_PREFERENCES = new Set(["auto", "always", "never"]);
const HARDWARE_CAD_BACKENDS = new Set(["auto", "cadquery", "solidworks"]);
const PARAMETRIC_CAD_PROCESSES = new Set(["fdm", "sla", "sls"]);
const PARAMETRIC_CAD_UNITS = new Set(["mm", "inch"]);
const WARDROBE_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const STOCK_ANALYST_DEPTHS = new Set([
  "single",
  "multi-quick",
  "multi-standard",
  "multi-full",
  "multi-specialist",
]);
const STOCK_ANALYST_LANGUAGES = new Set(["en", "zh", "ko"]);
const STOCK_ANALYST_STRATEGIES = new Set(["auto", "all"]);
const VIBE_TRADING_MEMORY_PRESETS = new Set(["off", "on", "full"]);
const VIBE_TRADING_EXCHANGES = new Set(["binance", "coinbase", "kraken", "bybit"]);
const MONEY_PRINTER_ASPECTS = new Set(["9:16", "16:9", "1:1"]);
const MONEY_PRINTER_SOURCES = new Set(["pexels", "pixabay", "coverr", "local"]);
const MONEY_PRINTER_CONCAT = new Set(["random", "sequential"]);
const TERMINAL_EVENTS = new Set(["run.completed", "run.failed", "run.aborted"]);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedString(value, maximumBytes, { empty = false } = {}) {
  return typeof value === "string" &&
    (empty || value.length > 0) &&
    value === value.trim() &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000\r\n]/u.test(value);
}

function boundedText(value, maximumBytes, { empty = false } = {}) {
  return typeof value === "string" &&
    (empty || value.trim().length > 0) &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\u0000/u.test(value);
}

function optionalText(value, maximumBytes) {
  return value === null || boundedText(value, maximumBytes, { empty: true });
}

function skill(value) {
  if (value === null) return true;
  const validShape = exactRecord(value, ["id", "slug"]) ||
    exactRecord(value, ["id", "slug", "contentHash"]);
  return validShape &&
    boundedString(value.id, 256) &&
    boundedString(value.slug, 256) &&
    (value.contentHash === undefined || boundedString(value.contentHash, 256));
}

function absoluteDirectory(value) {
  if (!boundedString(value, 4_096) || !path.isAbsolute(value)) return false;
  try {
    const metadata = statSync(path.resolve(value));
    return metadata.isDirectory();
  } catch {
    return false;
  }
}

function baseUrl(value) {
  if (!boundedString(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash;
  } catch {
    return false;
  }
}

function scopeSlug(value) {
  return boundedString(value, 512) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/u.test(value);
}

function commonCodingRequest(value, keys) {
  return exactRecord(value, keys) &&
    optionalText(value.instruction, 256 * 1024) &&
    skill(value.skill) &&
    absoluteDirectory(value.repositoryPath) &&
    boundedString(value.repositoryName, 512) &&
    scopeSlug(value.gardenSlug) &&
    Number.isSafeInteger(value.attachmentCount) &&
    value.attachmentCount >= 0 &&
    value.attachmentCount <= 4 &&
    typeof value.graftEnabled === "boolean";
}

export function validateRuntimeV2CodexRequest(value) {
  if (
    !commonCodingRequest(value, [
      "task",
      "instruction",
      "skill",
      "model",
      "reasoningEffort",
      "baseUrl",
      "repositoryPath",
      "repositoryName",
      "gardenSlug",
      "attachmentCount",
      "graftEnabled",
    ]) ||
    !boundedText(value.task, 16_000) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl)
  ) fail("The canonical Codex Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2RufloRequest(value) {
  if (
    !commonCodingRequest(value, [
      "objective",
      "instruction",
      "skill",
      "workers",
      "queenType",
      "consensus",
      "topology",
      "repositoryPath",
      "repositoryName",
      "gardenSlug",
      "attachmentCount",
      "graftEnabled",
    ]) ||
    !boundedText(value.objective, 16_000) ||
    !Number.isSafeInteger(value.workers) ||
    value.workers < 1 ||
    value.workers > 12 ||
    !["strategic", "tactical", "adaptive"].includes(value.queenType) ||
    !["byzantine", "raft", "gossip", "crdt", "quorum"].includes(value.consensus) ||
    !["hierarchical-mesh", "hierarchical", "mesh", "adaptive"].includes(value.topology)
  ) fail("The canonical Ruflo Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2OpenCodeRequest(value) {
  if (
    !commonCodingRequest(value, [
      "task",
      "instruction",
      "skill",
      "model",
      "reasoningEffort",
      "baseUrl",
      "repositoryPath",
      "repositoryName",
      "gardenSlug",
      "attachmentCount",
      "graftEnabled",
    ]) ||
    !boundedText(value.task, 16_000) ||
    !boundedString(value.model, 256) ||
    !OPENCODE_EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl)
  ) fail("The canonical OpenCode Runtime request is invalid.");
  return value;
}

function tutorRequest(value) {
  return exactRecord(value, [
    "message",
    "capability",
    "tools",
    "fresh",
    "useMaterial",
    "questionCount",
    "language",
  ]) &&
    boundedText(value.message, 16_000) &&
    TUTOR_CAPABILITIES.has(value.capability) &&
    Array.isArray(value.tools) &&
    value.tools.length <= TUTOR_TOOLS.size &&
    new Set(value.tools).size === value.tools.length &&
    value.tools.every((tool) => TUTOR_TOOLS.has(tool)) &&
    typeof value.fresh === "boolean" &&
    typeof value.useMaterial === "boolean" &&
    Number.isSafeInteger(value.questionCount) &&
    value.questionCount >= 1 &&
    value.questionCount <= 20 &&
    boundedString(value.language, 32);
}

function tutorScope(value) {
  if (!exactRecord(value, ["surface", "clusterSlug", "gardenName"])) return false;
  if (value.surface === "dashboard_terminal") {
    return value.clusterSlug === null && value.gardenName === null;
  }
  return value.surface === "garden_chat" &&
    scopeSlug(value.clusterSlug) &&
    (value.gardenName === null || boundedString(value.gardenName, 512));
}

function exactIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function validateRuntimeV2DeepTutorRequest(value) {
  if (
    !exactRecord(value, [
      "request",
      "scope",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
    ]) ||
    !tutorRequest(value.request) ||
    !tutorScope(value.scope) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 256 * 1024, { empty: true })
  ) fail("The canonical Deep Tutor Runtime request is invalid.");
  return value;
}

function deerFlowSettings(value) {
  return exactRecord(value, [
    "subagents",
    "maxSubagents",
    "planMode",
    "web",
    "memory",
    "shell",
  ]) &&
    typeof value.subagents === "boolean" &&
    Number.isSafeInteger(value.maxSubagents) &&
    value.maxSubagents >= 1 && value.maxSubagents <= 12 &&
    typeof value.planMode === "boolean" &&
    typeof value.web === "boolean" &&
    typeof value.memory === "boolean" &&
    typeof value.shell === "boolean";
}

export function validateRuntimeV2DeerFlowRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "reasoningEffort",
      "settings",
      "conversationPublicId",
      "conversationContext",
      "coldStart",
    ]) ||
    !boundedText(value.task, 256 * 1024) ||
    value.task.length > 200_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !deerFlowSettings(value.settings) ||
    !boundedString(value.conversationPublicId, 128) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !boundedText(value.conversationContext, 60_000, { empty: true }) ||
    value.conversationContext.length > 15_000 ||
    typeof value.coldStart !== "boolean"
  ) fail("The canonical DeerFlow Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2DeepResearchRequest(value) {
  if (
    !exactRecord(value, [
      "query",
      "breadth",
      "depth",
      "output",
      "memoryContext",
      "conversationContext",
    ]) ||
    !boundedText(value.query, 16 * 1024) ||
    value.query.length > 4_000 ||
    !Number.isSafeInteger(value.breadth) ||
    value.breadth < 1 || value.breadth > 10 ||
    !Number.isSafeInteger(value.depth) ||
    value.depth < 1 || value.depth > 5 ||
    !["report", "answer"].includes(value.output) ||
    !boundedText(value.memoryContext, 128 * 1024, { empty: true }) ||
    value.memoryContext.length > 32_000 ||
    !boundedText(value.conversationContext, 60_000, { empty: true }) ||
    value.conversationContext.length > 15_000
  ) fail("The canonical Deep Research Runtime request is invalid.");
  return value;
}

function videoUseSource(value) {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "artifact") {
    return exactRecord(value, ["kind", "artifactId"]) &&
      boundedString(value.artifactId, 128) &&
      /^art_[a-z0-9-]{6,64}$/iu.test(value.artifactId);
  }
  if (value.kind === "attachment") {
    return exactRecord(value, ["kind", "blobId", "filename"]) &&
      boundedString(value.blobId, 64) &&
      /^vid_[0-9a-f]{32}$/u.test(value.blobId) &&
      boundedString(value.filename, 1_024) &&
      value.filename.length <= 200 &&
      value.filename === path.basename(value.filename) &&
      !/[\\/]/u.test(value.filename);
  }
  if (value.kind === "url") {
    if (
      !exactRecord(value, ["kind", "url"]) ||
      !boundedString(value.url, 8_192) ||
      value.url.length > 2_000
    ) return false;
    try {
      const parsed = new URL(value.url);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }
  return false;
}

export function validateRuntimeV2VideoUseRequest(value) {
  if (
    !exactRecord(value, [
      "conversationPublicId",
      "request",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
    ]) ||
    !boundedString(value.conversationPublicId, 128) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !exactRecord(value.request, ["source", "prompt", "quality"]) ||
    !videoUseSource(value.request.source) ||
    !boundedText(value.request.prompt, 16 * 1024) ||
    value.request.prompt.length > 4_000 ||
    !["final", "preview"].includes(value.request.quality) ||
    !boundedString(value.model, 256) ||
    !["low", "medium", "high"].includes(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 60 * 1024, { empty: true }) ||
    value.conversationContext.length > 15_000
  ) fail("The canonical Video Use Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2OpenscienceRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "reasoningEffort",
      "options",
      "conversationPublicId",
      "conversationContext",
    ]) ||
    !boundedText(value.task, 64 * 1024) ||
    value.task.length > 20_000 ||
    !boundedString(value.model, 256) ||
    !OPENCODE_EFFORTS.has(value.reasoningEffort) ||
    !exactRecord(value.options, ["harness", "deliverFiles"]) ||
    !["research", "plan"].includes(value.options.harness) ||
    typeof value.options.deliverFiles !== "boolean" ||
    !boundedString(value.conversationPublicId, 128) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !boundedText(value.conversationContext, 60 * 1024, { empty: true }) ||
    value.conversationContext.length > 15_000
  ) fail("The canonical OpenScience Runtime request is invalid.");
  return value;
}

function tradingAgentRequest(value) {
  return exactRecord(value, [
    "ticker",
    "tradeDate",
    "analysts",
    "researchDepth",
    "riskRounds",
    "assetType",
  ]) &&
    typeof value.ticker === "string" &&
    /^\^?[A-Z0-9][A-Z0-9.\-^]{0,14}$/u.test(value.ticker) &&
    exactIsoDate(value.tradeDate) &&
    Array.isArray(value.analysts) &&
    value.analysts.length >= 1 &&
    value.analysts.length <= TRADING_ANALYSTS.size &&
    new Set(value.analysts).size === value.analysts.length &&
    value.analysts.every((analyst) => TRADING_ANALYSTS.has(analyst)) &&
    Number.isSafeInteger(value.researchDepth) &&
    value.researchDepth >= 1 &&
    value.researchDepth <= 5 &&
    Number.isSafeInteger(value.riskRounds) &&
    value.riskRounds >= 1 &&
    value.riskRounds <= 5 &&
    ["stock", "crypto"].includes(value.assetType);
}

function tradingAgentSettings(value) {
  return exactRecord(value, [
    "analysts",
    "researchDepth",
    "riskRounds",
    "assetType",
    "deepModel",
    "quickModel",
    "reasoningEffort",
    "outputLanguage",
    "marketVendor",
    "newsVendor",
  ]) &&
    Array.isArray(value.analysts) &&
    value.analysts.length >= 1 &&
    value.analysts.length <= TRADING_ANALYSTS.size &&
    new Set(value.analysts).size === value.analysts.length &&
    value.analysts.every((analyst) => TRADING_ANALYSTS.has(analyst)) &&
    Number.isSafeInteger(value.researchDepth) &&
    value.researchDepth >= 1 &&
    value.researchDepth <= 5 &&
    Number.isSafeInteger(value.riskRounds) &&
    value.riskRounds >= 1 &&
    value.riskRounds <= 5 &&
    ["stock", "crypto"].includes(value.assetType) &&
    boundedString(value.deepModel, 120, { empty: true }) &&
    boundedString(value.quickModel, 120, { empty: true }) &&
    ["", "low", "medium", "high", "xhigh"].includes(value.reasoningEffort) &&
    boundedString(value.outputLanguage, 40) &&
    TRADING_VENDORS.has(value.marketVendor) &&
    TRADING_VENDORS.has(value.newsVendor);
}

export function validateRuntimeV2TradingAgentRequest(value) {
  if (
    !exactRecord(value, ["request", "settings", "model", "reasoningEffort", "baseUrl"]) ||
    !tradingAgentRequest(value.request) ||
    !tradingAgentSettings(value.settings) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl)
  ) fail("The canonical Trading Agent Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2CareerOpsRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "reasoningEffort",
      "baseUrl",
      "maxSteps",
      "conversationContext",
    ]) ||
    !boundedText(value.task, 256 * 1024) ||
    value.task.length > 200_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !Number.isSafeInteger(value.maxSteps) ||
    value.maxSteps < 1 ||
    value.maxSteps > 60 ||
    !boundedText(value.conversationContext, 32 * 1024, { empty: true })
  ) fail("The canonical Career Ops Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2AgentReachRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "reasoningEffort",
      "baseUrl",
      "maxSteps",
      "conversationContext",
    ]) ||
    !boundedText(value.task, 128 * 1024) ||
    value.task.length > 100_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !Number.isSafeInteger(value.maxSteps) ||
    value.maxSteps < 1 ||
    value.maxSteps > 40 ||
    !boundedText(value.conversationContext, 32 * 1024, { empty: true })
  ) fail("The canonical Agent Reach Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2MaxResearchRequest(value) {
  if (
    !exactRecord(value, [
      "question",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
      "openscienceEnabled",
    ]) ||
    !boundedText(value.question, 16 * 1024) ||
    value.question.length > 8_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    typeof value.openscienceEnabled !== "boolean" ||
    !boundedText(value.conversationContext, 80 * 1024, { empty: true }) ||
    value.conversationContext.length > 20_000
  ) fail("The canonical Max Research Runtime request is invalid.");
  return value;
}

function stockAnalystWatchlist(value) {
  if (!boundedString(value, 400, { empty: true })) return false;
  if (!value) return true;
  const symbols = value.split(",");
  return symbols.length <= 40 &&
    symbols.every((symbol) => /^[A-Z0-9][A-Z0-9.-]{0,15}$/u.test(symbol));
}

function stockAnalystSettings(value) {
  return exactRecord(value, [
    "model",
    "depth",
    "language",
    "strategies",
    "watchlist",
    "memory",
    "temperature",
  ]) &&
    boundedString(value.model, 120, { empty: true }) &&
    STOCK_ANALYST_DEPTHS.has(value.depth) &&
    STOCK_ANALYST_LANGUAGES.has(value.language) &&
    STOCK_ANALYST_STRATEGIES.has(value.strategies) &&
    stockAnalystWatchlist(value.watchlist) &&
    typeof value.memory === "boolean" &&
    typeof value.temperature === "number" &&
    Number.isFinite(value.temperature) &&
    value.temperature >= 0 &&
    value.temperature <= 2;
}

export function validateRuntimeV2StockAnalystRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "baseUrl",
      "settings",
      "memoryContext",
      "conversationContext",
      "serviceModel",
      "coldStart",
    ]) ||
    !boundedText(value.task, 256 * 1024) ||
    value.task.length > 200_000 ||
    !boundedString(value.model, 256) ||
    !baseUrl(value.baseUrl) ||
    !stockAnalystSettings(value.settings) ||
    !boundedText(value.memoryContext, 128 * 1024, { empty: true }) ||
    value.memoryContext.length > 32_000 ||
    !boundedText(value.conversationContext, 60_000, { empty: true }) ||
    value.conversationContext.length > 15_000 ||
    !boundedString(value.serviceModel, 256) ||
    value.serviceModel !== (value.settings?.model || value.model) ||
    typeof value.coldStart !== "boolean"
  ) fail("The canonical Stock Analyst Runtime request is invalid.");
  return value;
}

function vibeTradingSettings(value) {
  return exactRecord(value, [
    "model",
    "temperature",
    "memory",
    "dataCache",
    "cryptoExchange",
  ]) &&
    boundedString(value.model, 120, { empty: true }) &&
    typeof value.temperature === "number" &&
    Number.isFinite(value.temperature) &&
    value.temperature >= 0 &&
    value.temperature <= 2 &&
    VIBE_TRADING_MEMORY_PRESETS.has(value.memory) &&
    typeof value.dataCache === "boolean" &&
    VIBE_TRADING_EXCHANGES.has(value.cryptoExchange);
}

export function validateRuntimeV2VibeTradingRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "reasoningEffort",
      "baseUrl",
      "settings",
      "conversationContext",
      "coldStart",
    ]) ||
    !boundedText(value.task, 256 * 1024) ||
    value.task.length > 200_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !vibeTradingSettings(value.settings) ||
    !boundedText(value.conversationContext, 60_000, { empty: true }) ||
    value.conversationContext.length > 15_000 ||
    typeof value.coldStart !== "boolean"
  ) fail("The canonical Vibe Trading Runtime request is invalid.");
  return value;
}

function moneyPrinterRequest(value) {
  const terms = value?.terms;
  const validTerms = terms === null ||
    (Array.isArray(terms) &&
      terms.length <= 1_000 &&
      terms.every((term) => boundedText(term, 1_024)) &&
      Buffer.byteLength(JSON.stringify(terms), "utf8") <= 64 * 1024);
  return exactRecord(value, [
    "subject",
    "script",
    "aspect",
    "source",
    "language",
    "voice",
    "paragraphs",
    "clipSeconds",
    "concat",
    "subtitles",
    "music",
    "videoCount",
    "terms",
  ]) &&
    boundedText(value.subject, 64 * 1024) &&
    value.subject.length <= 40_000 &&
    boundedText(value.script, 64 * 1024, { empty: true }) &&
    value.script.length <= 40_000 &&
    MONEY_PRINTER_ASPECTS.has(value.aspect) &&
    MONEY_PRINTER_SOURCES.has(value.source) &&
    boundedString(value.language, 64, { empty: true }) &&
    (value.language === "" || /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value.language)) &&
    boundedString(value.voice, 256) &&
    Number.isSafeInteger(value.paragraphs) &&
    value.paragraphs >= 1 && value.paragraphs <= 10 &&
    Number.isSafeInteger(value.clipSeconds) &&
    value.clipSeconds >= 1 && value.clipSeconds <= 30 &&
    MONEY_PRINTER_CONCAT.has(value.concat) &&
    typeof value.subtitles === "boolean" &&
    typeof value.music === "boolean" &&
    Number.isSafeInteger(value.videoCount) &&
    value.videoCount >= 1 && value.videoCount <= 5 &&
    validTerms;
}

export function validateRuntimeV2MoneyPrinterRequest(value) {
  if (
    !exactRecord(value, ["conversationPublicId", "request", "model", "baseUrl"]) ||
    !boundedString(value.conversationPublicId, 128) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !moneyPrinterRequest(value.request) ||
    !boundedString(value.model, 256) ||
    !baseUrl(value.baseUrl)
  ) fail("The canonical MoneyPrinter Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2WardrobeRequest(value) {
  const validPhotos = Array.isArray(value?.photos) &&
    value.photos.length >= 1 &&
    value.photos.length <= 10 &&
    value.photos.every((photo) =>
      exactRecord(photo, ["name", "mediaType", "sizeBytes"]) &&
      boundedString(photo.name, 500) &&
      photo.name === path.basename(photo.name) &&
      !photo.name.includes("\\") &&
      IMAGE_MEDIA_TYPES.has(photo.mediaType) &&
      Number.isSafeInteger(photo.sizeBytes) &&
      photo.sizeBytes >= 1 &&
      photo.sizeBytes <= 10 * 1024 * 1024
    );
  if (
    !exactRecord(value, [
      "request",
      "model",
      "baseUrl",
      "conversationPublicId",
      "conversationContext",
      "photos",
    ]) ||
    !exactRecord(value.request, ["direction", "maxItemsPerPhoto", "quality"]) ||
    !boundedText(value.request.direction, 4_800, { empty: true }) ||
    value.request.direction.length > 1_200 ||
    !Number.isSafeInteger(value.request.maxItemsPerPhoto) ||
    value.request.maxItemsPerPhoto < 1 ||
    value.request.maxItemsPerPhoto > 8 ||
    !WARDROBE_QUALITIES.has(value.request.quality) ||
    !boundedString(value.model, 256) ||
    !baseUrl(value.baseUrl) ||
    !boundedString(value.conversationPublicId, 256, { empty: true }) ||
    !boundedText(value.conversationContext, 60_000, { empty: true }) ||
    value.conversationContext.length > 15_000 ||
    !validPhotos
  ) fail("The canonical Wardrobe Runtime request is invalid.");
  return value;
}

function shortsSource(value) {
  if (!isRecord(value)) return false;
  if (value.kind === "upload") {
    return exactRecord(value, ["kind", "uploadId", "filename"]) &&
      typeof value.uploadId === "string" &&
      /^[a-f0-9]{32}$/u.test(value.uploadId) &&
      boundedText(value.filename, 1_024) &&
      value.filename.length <= 200;
  }
  if (value.kind !== "url" || !exactRecord(value, ["kind", "url"]) ||
      !boundedString(value.url, 2_000)) return false;
  try {
    const parsed = new URL(value.url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function shortsRequest(value) {
  return exactRecord(value, ["source", "clipCount", "aspectRatio", "resolution", "language"]) &&
    shortsSource(value.source) &&
    Number.isSafeInteger(value.clipCount) &&
    value.clipCount >= 1 &&
    value.clipCount <= 10 &&
    ["9:16", "1:1", "16:9"].includes(value.aspectRatio) &&
    ["360", "480", "720", "1080"].includes(value.resolution) &&
    typeof value.language === "string" &&
    (value.language === "" || /^[a-z]{2}$/u.test(value.language));
}

export function validateRuntimeV2ShortsRequest(value) {
  if (
    !exactRecord(value, [
      "request",
      "conversationPublicId",
      "model",
      "whisperModel",
      "baseUrl",
    ]) ||
    !shortsRequest(value.request) ||
    !boundedString(value.conversationPublicId, 128) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !boundedString(value.model, 256) ||
    !SHORTS_WHISPER_MODELS.has(value.whisperModel) ||
    !baseUrl(value.baseUrl)
  ) fail("The canonical Shorts Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2OpenGymRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
      "conversationPublicId",
      "maxSteps",
    ]) ||
    !boundedText(value.task, 256 * 1024) ||
    value.task.length > 100_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 32 * 1024, { empty: true }) ||
    !(value.conversationPublicId === null || (
      boundedString(value.conversationPublicId, 128) &&
      /^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId)
    )) ||
    !Number.isSafeInteger(value.maxSteps) ||
    value.maxSteps < 1 ||
    value.maxSteps > 40
  ) fail("The canonical openGym Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2OpenPlanterRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
    ]) ||
    !boundedText(value.task, 256 * 1024) ||
    value.task.length > 100_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 32 * 1024, { empty: true })
  ) fail("The canonical OpenPlanter Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2Resource2SkillRequest(value) {
  if (
    !exactRecord(value, [
      "task",
      "domain",
      "model",
      "reasoningEffort",
      "maxIterations",
      "baseUrl",
      "conversationContext",
    ]) ||
    !boundedText(value.task, 32 * 1024) ||
    value.task.length > 20_000 ||
    !RESOURCE2SKILL_DOMAINS.has(value.domain) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !Number.isSafeInteger(value.maxIterations) ||
    value.maxIterations < 1 ||
    value.maxIterations > 120 ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 16 * 1024, { empty: true }) ||
    value.conversationContext.length > 6_000
  ) fail("The canonical Resource2Skill Runtime request is invalid.");
  return value;
}

function matraixStringList(value, maximumItems) {
  return Array.isArray(value) &&
    value.length <= maximumItems &&
    new Set(value).size === value.length &&
    value.every((item) => boundedText(item, 1_024) && item === item.trim());
}

function matraixFilters(value) {
  if (!isRecord(value) || Object.keys(value).length > 64) return false;
  return Object.entries(value).every(([dimension, values]) =>
    boundedString(dimension, 512) &&
    matraixStringList(values, 64) &&
    values.length > 0);
}

function matraixPool(value) {
  if (value === null) return true;
  return boundedString(value, 1_024) &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !/[\\:\u0000\r\n]/u.test(value) &&
    value.split("/").every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

function matraixRunRequest(value) {
  return exactRecord(value, [
    "brief",
    "respondents",
    "seed",
    "filters",
    "stratify",
    "groupBy",
    "sources",
    "allocation",
    "pool",
  ]) &&
    boundedText(value.brief, 32 * 1024) &&
    value.brief.length <= 20_000 &&
    Number.isSafeInteger(value.respondents) &&
    value.respondents >= 1 &&
    value.respondents <= 60 &&
    Number.isFinite(value.seed) &&
    Number.isInteger(value.seed) &&
    matraixFilters(value.filters) &&
    matraixStringList(value.stratify, 64) &&
    matraixStringList(value.groupBy, 64) &&
    matraixStringList(value.sources, 64) &&
    ["equalTotal", "perCell", "proportional"].includes(value.allocation) &&
    matraixPool(value.pool);
}

export function validateRuntimeV2MatraixRequest(value) {
  if (
    !exactRecord(value, [
      "request",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
    ]) ||
    !matraixRunRequest(value.request) ||
    !boundedString(value.model, 256) ||
    !(value.reasoningEffort === "" || EFFORTS.has(value.reasoningEffort)) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 256 * 1024, { empty: true })
  ) fail("The canonical MatrAIx Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2HyperframesRequest(value) {
  if (
    !exactRecord(value, [
      "brief",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
    ]) ||
    !boundedText(value.brief, 32 * 1024) ||
    value.brief.length > 20_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 256 * 1024, { empty: true })
  ) fail("The canonical HyperFrames Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2OpenMontageRequest(value) {
  if (
    !exactRecord(value, [
      "brief",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationContext",
    ]) ||
    !boundedText(value.brief, 32 * 1024) ||
    value.brief.length > 20_000 ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 256 * 1024, { empty: true })
  ) fail("The canonical OpenMontage Runtime request is invalid.");
  return value;
}

function boltSlidesBrandUrl(value) {
  if (value === null) return true;
  if (!boundedString(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password;
  } catch {
    return false;
  }
}

function boltSlidesRequest(value) {
  return exactRecord(value, ["brief", "slides", "theme", "brandUrl"]) &&
    boundedText(value.brief, 32 * 1024) &&
    value.brief.length <= 20_000 &&
    Number.isSafeInteger(value.slides) &&
    value.slides >= 5 &&
    value.slides <= 24 &&
    BOLT_SLIDES_THEMES.has(value.theme) &&
    boltSlidesBrandUrl(value.brandUrl);
}

export function validateRuntimeV2BoltSlidesRequest(value) {
  if (
    !exactRecord(value, [
      "brief",
      "request",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationPublicId",
      "conversationContext",
    ]) ||
    !boundedText(value.brief, 32 * 1024) ||
    value.brief.length > 20_000 ||
    !boltSlidesRequest(value.request) ||
    !boundedString(value.model, 256) ||
    !(value.reasoningEffort === "" || EFFORTS.has(value.reasoningEffort)) ||
    !baseUrl(value.baseUrl) ||
    !(value.conversationPublicId === "" || (
      boundedString(value.conversationPublicId, 128) &&
      /^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId)
    )) ||
    !boundedText(value.conversationContext, 256 * 1024, { empty: true })
  ) fail("The canonical Bolt Slides Runtime request is invalid.");
  return value;
}

function hardwareBlueprintParsedRequest(value) {
  return exactRecord(value, [
    "brief",
    "board",
    "prototypeType",
    "firmwarePlatform",
    "enclosure",
    "cadBackend",
  ]) &&
    boundedText(value.brief, 32 * 1024) &&
    value.brief.length <= 20_000 &&
    (value.board === null || boundedString(value.board, 512)) &&
    (value.prototypeType === null || HARDWARE_PROTOTYPES.has(value.prototypeType)) &&
    (value.firmwarePlatform === null || HARDWARE_FIRMWARE.has(value.firmwarePlatform)) &&
    (value.enclosure === null || typeof value.enclosure === "boolean") &&
    (value.cadBackend === null || HARDWARE_CAD_BACKENDS.has(value.cadBackend));
}

function hardwareBlueprintPreferences(value) {
  return exactRecord(value, [
    "board",
    "prototypeType",
    "firmwarePlatform",
    "enclosure",
    "cadBackend",
  ]) &&
    (value.board === null || HARDWARE_BOARDS.has(value.board)) &&
    (value.prototypeType === null || HARDWARE_PROTOTYPES.has(value.prototypeType)) &&
    (value.firmwarePlatform === null || HARDWARE_FIRMWARE.has(value.firmwarePlatform)) &&
    HARDWARE_ENCLOSURE_PREFERENCES.has(value.enclosure) &&
    HARDWARE_CAD_BACKENDS.has(value.cadBackend);
}

export function validateRuntimeV2HardwareBlueprintRequest(value) {
  if (
    !exactRecord(value, [
      "conversationPublicId",
      "brief",
      "parsed",
      "model",
      "reasoningEffort",
      "baseUrl",
      "preferences",
      "conversationContext",
    ]) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !boundedText(value.brief, 32 * 1024) ||
    value.brief.length > 20_000 ||
    !hardwareBlueprintParsedRequest(value.parsed) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !hardwareBlueprintPreferences(value.preferences) ||
    !boundedText(value.conversationContext, 256 * 1024, { empty: true })
  ) fail("The canonical Hardware Blueprint Runtime request is invalid.");
  return value;
}

function parametricCadPrinterBed(value) {
  return value === null || (
    exactRecord(value, ["x", "y", "z"]) &&
    [value.x, value.y, value.z].every((dimension) =>
      Number.isFinite(dimension) && dimension > 0 && dimension <= 10_000
    )
  );
}

function parametricCadParsedRequest(value) {
  return exactRecord(value, ["brief", "process", "printerBed", "units", "fresh"]) &&
    boundedText(value.brief, 32 * 1024) &&
    value.brief.length <= 20_000 &&
    (value.process === null || PARAMETRIC_CAD_PROCESSES.has(value.process)) &&
    parametricCadPrinterBed(value.printerBed) &&
    (value.units === null || PARAMETRIC_CAD_UNITS.has(value.units)) &&
    typeof value.fresh === "boolean";
}

function parametricCadParameterValues(value) {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length >= 1 &&
    entries.length <= 120 &&
    entries.every(([id, parameterValue]) =>
      boundedString(id, 80) &&
      (
        (typeof parameterValue === "number" && Number.isFinite(parameterValue)) ||
        typeof parameterValue === "boolean" ||
        (
          typeof parameterValue === "string" &&
          parameterValue.length <= 200 &&
          boundedText(parameterValue, 800, { empty: true })
        )
      )
    );
}

export function validateRuntimeV2ParametricCadRequest(value) {
  const validConversation = /^conv_[A-Za-z0-9_-]{24}$/u.test(value?.conversationPublicId);
  if (value?.operation === "run") {
    if (
      !exactRecord(value, [
        "operation",
        "conversationPublicId",
        "clientMessageId",
        "brief",
        "parsed",
        "model",
        "reasoningEffort",
        "baseUrl",
      ]) ||
      !validConversation ||
      !(
        value.clientMessageId === "" ||
        (
          boundedString(value.clientMessageId, 128) &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.clientMessageId)
        )
      ) ||
      !boundedText(value.brief, 32 * 1024) ||
      value.brief.length > 20_000 ||
      !parametricCadParsedRequest(value.parsed) ||
      !boundedString(value.model, 256) ||
      !EFFORTS.has(value.reasoningEffort) ||
      !baseUrl(value.baseUrl)
    ) fail("The canonical Parametric CAD Runtime request is invalid.");
    return value;
  }
  if (
    value?.operation !== "parameter-update" ||
    !exactRecord(value, ["operation", "conversationPublicId", "projectId", "values"]) ||
    !validConversation ||
    !/^cadp_[0-9a-f]{32}$/u.test(value.projectId) ||
    !parametricCadParameterValues(value.values)
  ) fail("The canonical Parametric CAD Runtime request is invalid.");
  return value;
}

function legalRunRequest(value) {
  return exactRecord(value, ["maxTurns", "skills", "effort", "allowShell"]) &&
    Number.isSafeInteger(value.maxTurns) &&
    value.maxTurns >= 5 &&
    value.maxTurns <= 200 &&
    Array.isArray(value.skills) &&
    value.skills.length <= LEGAL_SKILLS.size &&
    new Set(value.skills).size === value.skills.length &&
    value.skills.every((entry) => LEGAL_SKILLS.has(entry)) &&
    (value.effort === null || LEGAL_EFFORTS.has(value.effort)) &&
    typeof value.allowShell === "boolean";
}

function legalSettings(value) {
  return exactRecord(value, ["shellTimeout"]) &&
    Number.isSafeInteger(value.shellTimeout) &&
    value.shellTimeout >= 10 &&
    value.shellTimeout <= 900;
}

function legalContent(value) {
  return exactRecord(value, ["taskBytes", "memoryBytes", "conversationBytes"]) &&
    Number.isSafeInteger(value.taskBytes) &&
    value.taskBytes >= 1 &&
    value.taskBytes <= 4 * 1024 * 1024 &&
    Number.isSafeInteger(value.memoryBytes) &&
    value.memoryBytes >= 0 &&
    value.memoryBytes <= 16 * 1024 * 1024 &&
    Number.isSafeInteger(value.conversationBytes) &&
    value.conversationBytes >= 0 &&
    value.conversationBytes <= 16 * 1024 * 1024;
}

function legalName(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    Buffer.byteLength(value, "utf8") <= 1_024 &&
    !/[\\/\u0000\r\n]/u.test(value);
}

function legalAttachment(value) {
  if (!isRecord(value) || !legalName(value.name)) return false;
  if (value.kind === "document") {
    return exactRecord(value, [
      "kind",
      "name",
      "format",
      "inputIndex",
      "description",
      "editable",
      "hasExtractedText",
      "figures",
    ]) &&
      LEGAL_DOCUMENT_FORMATS.has(value.format) &&
      Number.isSafeInteger(value.inputIndex) &&
      value.inputIndex >= 1 &&
      value.inputIndex <= 10 &&
      boundedText(value.description, 4_096, { empty: true }) &&
      typeof value.editable === "boolean" &&
      typeof value.hasExtractedText === "boolean" &&
      Array.isArray(value.figures) &&
      value.figures.length <= 200 &&
      new Set(value.figures).size === value.figures.length &&
      value.figures.every((name) =>
        typeof name === "string" && /^figure-\d{1,4}\.[a-z0-9]{1,5}$/iu.test(name));
  }
  if (value.kind === "text" || value.kind === "image") {
    return exactRecord(value, ["kind", "name", "inputIndex"]) &&
      Number.isSafeInteger(value.inputIndex) &&
      value.inputIndex >= 1 &&
      value.inputIndex <= 10;
  }
  return value.kind === "skipped" &&
    exactRecord(value, ["kind", "name", "reason", "attachmentType"]) &&
    ["unreadable-document", "oversized-image", "unsupported"].includes(value.reason) &&
    ["document", "image", ...LEGAL_UNSUPPORTED_TYPES].includes(value.attachmentType) &&
    (value.reason !== "unreadable-document" || value.attachmentType === "document") &&
    (value.reason !== "oversized-image" || value.attachmentType === "image") &&
    (value.reason !== "unsupported" || LEGAL_UNSUPPORTED_TYPES.has(value.attachmentType));
}

export function validateRuntimeV2LegalRequest(value) {
  if (
    !exactRecord(value, [
      "request",
      "settings",
      "model",
      "reasoningEffort",
      "baseUrl",
      "conversationPublicId",
      "contentInputIndex",
      "content",
      "attachments",
    ]) ||
    !legalRunRequest(value.request) ||
    !legalSettings(value.settings) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !(value.conversationPublicId === "" || (
      boundedString(value.conversationPublicId, 128) &&
      /^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId)
    )) ||
    value.contentInputIndex !== 0 ||
    !legalContent(value.content) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > 10 ||
    !value.attachments.every(legalAttachment)
  ) fail("The canonical Legal Agent Runtime request is invalid.");
  const indexes = value.attachments
    .filter((entry) => entry.kind !== "skipped")
    .map((entry) => entry.inputIndex);
  if (
    new Set(indexes).size !== indexes.length ||
    indexes.some((entry, index) => entry !== index + 1)
  ) fail("The canonical Legal Agent attachment manifest is invalid.");
  return value;
}

function getDocSearchRequest(value) {
  return exactRecord(value, [
    "query", "limit", "openAccessOnly", "yearFrom", "yearTo", "sources",
  ]) &&
    boundedText(value.query, 4_000) &&
    Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 50 &&
    typeof value.openAccessOnly === "boolean" &&
    (value.yearFrom === null || (Number.isSafeInteger(value.yearFrom) && value.yearFrom >= 1400 && value.yearFrom < 2200)) &&
    (value.yearTo === null || (Number.isSafeInteger(value.yearTo) && value.yearTo >= 1400 && value.yearTo < 2200)) &&
    (value.sources === null || (
      Array.isArray(value.sources) &&
      value.sources.length <= GET_DOC_SOURCES.size &&
      new Set(value.sources).size === value.sources.length &&
      value.sources.every((entry) => GET_DOC_SOURCES.has(entry))
    ));
}

export function validateRuntimeV2GetDocRequest(value) {
  if (
    !exactRecord(value, ["request", "model", "reasoningEffort", "baseUrl", "conversationContext"]) ||
    !getDocSearchRequest(value.request) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 32 * 1024, { empty: true })
  ) fail("The canonical Get Doc Runtime request is invalid.");
  return value;
}

function nullableText(value, maximumBytes) {
  return value === null || boundedText(value, maximumBytes, { empty: true });
}

function httpsUrl(value) {
  if (!boundedString(value, 4_096)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function getDocDocument(value) {
  return exactRecord(value, [
    "id", "title", "authors", "year", "venue", "doi", "abstract", "description",
    "openAccess", "citationCount", "landingPage", "pdfUrl", "pdfSource", "sources",
  ]) &&
    /^doc_[1-9][0-9]{0,2}$/u.test(value.id) &&
    boundedText(value.title, 2_000) &&
    Array.isArray(value.authors) && value.authors.length <= 25 &&
    value.authors.every((entry) => boundedText(entry, 512)) &&
    (value.year === null || (Number.isSafeInteger(value.year) && value.year >= 1400 && value.year < 2200)) &&
    nullableText(value.venue, 2_000) &&
    nullableText(value.doi, 512) &&
    nullableText(value.abstract, 16_000) &&
    boundedText(value.description, 4_000, { empty: true }) &&
    typeof value.openAccess === "boolean" &&
    (value.citationCount === null || (Number.isSafeInteger(value.citationCount) && value.citationCount >= 0)) &&
    (value.landingPage === null || httpsUrl(value.landingPage)) &&
    (value.pdfUrl === null || httpsUrl(value.pdfUrl)) &&
    (value.pdfSource === null || boundedString(value.pdfSource, 64)) &&
    Array.isArray(value.sources) && value.sources.length <= GET_DOC_SOURCES.size &&
    value.sources.every((entry) => GET_DOC_SOURCES.has(entry));
}

export function validateRuntimeV2GetDocDownloadRequest(value) {
  if (
    !exactRecord(value, ["sourceRunId", "documentId", "conversationPublicId", "document"]) ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(value.sourceRunId) ||
    !/^doc_[1-9][0-9]{0,2}$/u.test(value.documentId) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !getDocDocument(value.document) ||
    value.document.id !== value.documentId ||
    value.document.pdfUrl === null
  ) fail("The canonical Get Doc download Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2MeetingNotesRequest(value) {
  const requestValid = exactRecord(value?.request, [
    "sourceKind", "prompt", "language", "speakers", "transcriptOnly",
  ]) &&
    MEETING_SOURCE_KINDS.has(value.request.sourceKind) &&
    boundedText(value.request.prompt, 4_000, { empty: true }) &&
    (value.request.language === null || /^[a-z]{2,3}$/u.test(value.request.language)) &&
    typeof value.request.speakers === "boolean" &&
    typeof value.request.transcriptOnly === "boolean";
  const sourceValid = exactRecord(value?.source, [
    "kind", "filename", "title", "label", "artifactId", "byteSize", "error",
  ]) &&
    ["audio", "transcript", "error"].includes(value.source.kind) &&
    boundedString(value.source.filename, 512) &&
    value.source.filename === path.basename(value.source.filename) &&
    boundedText(value.source.title, 1_000) &&
    boundedText(value.source.label, 2_000) &&
    (value.source.artifactId === null || boundedString(value.source.artifactId, 128)) &&
    (value.source.error === null || boundedText(value.source.error, 4_000)) &&
    Number.isSafeInteger(value.source.byteSize) &&
    value.source.byteSize >= 1 &&
    value.source.byteSize <= 2 * 1024 * 1024 * 1024;
  if (
    !exactRecord(value, [
      "conversationPublicId", "request", "source", "engine", "voiceboxModel",
      "model", "reasoningEffort", "baseUrl", "conversationContext",
    ]) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId) ||
    !requestValid ||
    !sourceValid ||
    !["scriberr", "voicebox", "none"].includes(value.engine) ||
    (value.source.kind === "transcript" && value.engine !== "none") ||
    (value.source.kind === "error" && value.engine !== "none") ||
    (value.source.kind === "audio" && !["scriberr", "voicebox", "none"].includes(value.engine)) ||
    !MEETING_TRANSCRIPTION_MODELS.has(value.voiceboxModel) ||
    !boundedString(value.model, 256) ||
    !EFFORTS.has(value.reasoningEffort) ||
    !baseUrl(value.baseUrl) ||
    !boundedText(value.conversationContext, 32 * 1024, { empty: true })
  ) fail("The canonical Meeting Notes Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2InboxZeroRequest(value) {
  const conversationPublicIdValid = value?.conversationPublicId === null || (
    boundedString(value?.conversationPublicId, 128) &&
    /^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId)
  );
  if (
    !exactRecord(value, [
      "task", "conversationKey", "runtimeChatId", "preferredEmail", "allowActions",
      "chatmockBaseUrl", "model", "conversationPublicId", "conversationContext",
    ]) ||
    typeof value.task !== "string" ||
    value.task.length > 20_000 ||
    !boundedText(value.task, 80_000) ||
    !boundedString(value.conversationKey, 512) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.runtimeChatId,
    ) ||
    !(value.preferredEmail === null || boundedString(value.preferredEmail, 320)) ||
    typeof value.allowActions !== "boolean" ||
    !baseUrl(value.chatmockBaseUrl) ||
    !boundedString(value.model, 256) ||
    !conversationPublicIdValid ||
    typeof value.conversationContext !== "string" ||
    value.conversationContext.length > 15_000 ||
    !boundedText(value.conversationContext, 60_000, { empty: true })
  ) fail("The canonical Inbox Zero Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2SocialsManagerRequest(value) {
  const conversationPublicIdValid = value?.conversationPublicId === null || (
    boundedString(value?.conversationPublicId, 128) &&
    /^conv_[A-Za-z0-9_-]{24}$/u.test(value.conversationPublicId)
  );
  if (
    !exactRecord(value, [
      "brief", "model", "baseUrl", "conversationPublicId", "conversationContext",
    ]) ||
    typeof value.brief !== "string" ||
    value.brief.length > 100_000 ||
    !boundedText(value.brief, 256 * 1024) ||
    !boundedString(value.model, 256) ||
    !baseUrl(value.baseUrl) ||
    !conversationPublicIdValid ||
    typeof value.conversationContext !== "string" ||
    value.conversationContext.length > 15_000 ||
    !boundedText(value.conversationContext, 60_000, { empty: true })
  ) fail("The canonical Socials Manager Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2AgentTarsRequest(value) {
  if (
    !exactRecord(value, ["agentId", "task", "profileId"]) ||
    typeof value.agentId !== "string" ||
    !/^uta_[0-9a-f]{32}$/u.test(value.agentId) ||
    !boundedText(value.task, 32 * 1024) ||
    value.task.length > 8_000 ||
    typeof value.profileId !== "string" ||
    !/^utp_[0-9a-f]{32}$/u.test(value.profileId)
  ) fail("The canonical Agent TARS Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2OpenworkRequest(value) {
  if (
    !exactRecord(value, [
      "task", "model", "reasoningEffort", "prompt", "conversationContext", "serviceScopeId",
    ]) ||
    !boundedText(value.task, 64 * 1024) ||
    value.task.length > 20_000 ||
    !boundedString(value.model, 256) ||
    !OPENCODE_EFFORTS.has(value.reasoningEffort) ||
    !exactRecord(value.prompt, ["deliverFiles", "allowCommands"]) ||
    typeof value.prompt.deliverFiles !== "boolean" ||
    typeof value.prompt.allowCommands !== "boolean" ||
    typeof value.conversationContext !== "string" ||
    value.conversationContext.length > 15_000 ||
    !boundedText(value.conversationContext, 60_000, { empty: true }) ||
    !boundedString(value.serviceScopeId, 128) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.serviceScopeId)
  ) fail("The canonical OpenWork Runtime request is invalid.");
  return value;
}

const REQUEST_VALIDATORS = Object.freeze({
  codex: validateRuntimeV2CodexRequest,
  ruflo: validateRuntimeV2RufloRequest,
  "deep-tutor": validateRuntimeV2DeepTutorRequest,
  "deer-flow": validateRuntimeV2DeerFlowRequest,
  "deep-research": validateRuntimeV2DeepResearchRequest,
  "video-use": validateRuntimeV2VideoUseRequest,
  openscience: validateRuntimeV2OpenscienceRequest,
  opencode: validateRuntimeV2OpenCodeRequest,
  "trading-agent": validateRuntimeV2TradingAgentRequest,
  "career-ops": validateRuntimeV2CareerOpsRequest,
  "agent-reach": validateRuntimeV2AgentReachRequest,
  "agent-tars": validateRuntimeV2AgentTarsRequest,
  openwork: validateRuntimeV2OpenworkRequest,
  shorts: validateRuntimeV2ShortsRequest,
  "open-gym": validateRuntimeV2OpenGymRequest,
  legal: validateRuntimeV2LegalRequest,
  openplanter: validateRuntimeV2OpenPlanterRequest,
  resource2skill: validateRuntimeV2Resource2SkillRequest,
  matraix: validateRuntimeV2MatraixRequest,
  hyperframes: validateRuntimeV2HyperframesRequest,
  openmontage: validateRuntimeV2OpenMontageRequest,
  "bolt-slides": validateRuntimeV2BoltSlidesRequest,
  "hardware-blueprint": validateRuntimeV2HardwareBlueprintRequest,
  "inbox-zero": validateRuntimeV2InboxZeroRequest,
  "socials-manager": validateRuntimeV2SocialsManagerRequest,
  "get-doc": validateRuntimeV2GetDocRequest,
  "get-doc-download": validateRuntimeV2GetDocDownloadRequest,
  "meeting-notes": validateRuntimeV2MeetingNotesRequest,
  "money-printer": validateRuntimeV2MoneyPrinterRequest,
  "max-research": validateRuntimeV2MaxResearchRequest,
  wardrobe: validateRuntimeV2WardrobeRequest,
  "parametric-cad": validateRuntimeV2ParametricCadRequest,
  "stock-analyst": validateRuntimeV2StockAnalystRequest,
  "vibe-trading": validateRuntimeV2VibeTradingRequest,
});

const MANAGER_MODULES = Object.freeze({
  codex: ["lib", "codex", "run-manager.ts"],
  ruflo: ["lib", "ruflo", "run-manager.ts"],
  "deep-tutor": ["lib", "deep-tutor", "run-manager.ts"],
  "deer-flow": ["lib", "deer-flow", "run-manager.ts"],
  "deep-research": ["lib", "deep-research", "runtime-worker-run-manager.ts"],
  "video-use": ["lib", "video-use", "run-manager.ts"],
  openscience: ["lib", "openscience", "run-manager.ts"],
  opencode: ["lib", "opencode", "run-manager.ts"],
  "trading-agent": ["lib", "tradingagents", "run-manager.ts"],
  "career-ops": ["lib", "career-ops", "run-manager.ts"],
  "agent-reach": ["lib", "agent-reach", "run-manager.ts"],
  "agent-tars": ["lib", "ui-tars", "runtime-worker-run-manager.ts"],
  openwork: ["lib", "openwork", "run-manager.ts"],
  shorts: ["lib", "shorts", "run-manager.ts"],
  "open-gym": ["lib", "open-gym", "run-manager.ts"],
  legal: ["lib", "legal", "run-manager.ts"],
  openplanter: ["lib", "openplanter", "run-manager.ts"],
  resource2skill: ["lib", "resource2skill", "run-manager.ts"],
  matraix: ["lib", "matraix", "run-manager.ts"],
  hyperframes: ["lib", "hyperframes", "run-manager.ts"],
  openmontage: ["lib", "openmontage", "run-manager.ts"],
  "bolt-slides": ["lib", "bolt-slides", "run-manager.ts"],
  "hardware-blueprint": ["lib", "hardware", "run-manager.ts"],
  "inbox-zero": ["lib", "inbox-zero", "run-manager.ts"],
  "socials-manager": ["lib", "socials-manager", "run-manager.ts"],
  "get-doc": ["lib", "get-doc", "run-manager.ts"],
  "get-doc-download": ["lib", "get-doc", "download-run-manager.ts"],
  "meeting-notes": ["lib", "meeting-notes", "runtime-worker-run-manager.ts"],
  "money-printer": ["lib", "money-printer", "run-manager.ts"],
  "max-research": ["lib", "max-research", "run-manager.ts"],
  wardrobe: ["lib", "wardrobe", "run-manager.ts"],
  "parametric-cad": ["lib", "cad", "runtime-worker-adapter.ts"],
  "stock-analyst": ["lib", "stock-analyst", "run-manager.ts"],
  "vibe-trading": ["lib", "vibe-trading", "run-manager.ts"],
});

export const RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    workerKind: "outer-codex-node",
    jobType: "codex-run",
    scopePrefix: "oa_codex_",
    maximumInputs: 4,
  }),
  ruflo: Object.freeze({
    id: "ruflo",
    workerKind: "outer-ruflo-node",
    jobType: "ruflo-run",
    scopePrefix: "oa_ruflo_",
    maximumInputs: 4,
  }),
  "deep-tutor": Object.freeze({
    id: "deep-tutor",
    workerKind: "outer-deep-tutor-node",
    jobType: "deep-tutor-run",
    scopePrefix: "oa_deep_tutor_",
    maximumInputs: 0,
  }),
  "deer-flow": Object.freeze({
    id: "deer-flow",
    workerKind: "outer-deer-flow-node",
    jobType: "deer-flow-run",
    scopePrefix: "oa_deer_flow_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  }),
  "deep-research": Object.freeze({
    id: "deep-research",
    workerKind: "outer-deep-research-node",
    jobType: "deep-research-run",
    scopePrefix: "oa_deep_research_",
    maximumInputs: 0,
    maximumProjectionBytes: 8 * 1024 * 1024,
  }),
  "video-use": Object.freeze({
    id: "video-use",
    workerKind: "outer-video-use-node",
    jobType: "video-use-run",
    scopePrefix: "oa_video_use_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  }),
  openscience: Object.freeze({
    id: "openscience",
    workerKind: "outer-openscience-node",
    jobType: "openscience-run",
    scopePrefix: "oa_openscience_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  }),
  opencode: Object.freeze({
    id: "opencode",
    workerKind: "outer-opencode-node",
    jobType: "opencode-run",
    scopePrefix: "oa_opencode_",
    maximumInputs: 4,
  }),
  "trading-agent": Object.freeze({
    id: "trading-agent",
    workerKind: "outer-trading-agent-node",
    jobType: "trading-agent-run",
    scopePrefix: "oa_trading_agent_",
    maximumInputs: 0,
  }),
  "career-ops": Object.freeze({
    id: "career-ops",
    workerKind: "outer-career-ops-node",
    jobType: "career-ops-run",
    scopePrefix: "oa_career_ops_",
    maximumInputs: 0,
  }),
  "agent-reach": Object.freeze({
    id: "agent-reach",
    workerKind: "outer-agent-reach-node",
    jobType: "agent-reach-run",
    scopePrefix: "oa_agent_reach_",
    maximumInputs: 0,
  }),
  "agent-tars": Object.freeze({
    id: "agent-tars",
    workerKind: "outer-agent-tars-node",
    jobType: "agent-tars-run",
    scopePrefix: "oa_agent_tars_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  }),
  openwork: Object.freeze({
    id: "openwork",
    workerKind: "outer-openwork-node",
    jobType: "openwork-run",
    scopePrefix: "oa_openwork_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  }),
  shorts: Object.freeze({
    id: "shorts",
    workerKind: "outer-shorts-node",
    jobType: "shorts-run",
    scopePrefix: "oa_shorts_",
    maximumInputs: 0,
  }),
  "open-gym": Object.freeze({
    id: "open-gym",
    workerKind: "outer-open-gym-node",
    jobType: "open-gym-run",
    scopePrefix: "oa_open_gym_",
    maximumInputs: 0,
  }),
  legal: Object.freeze({
    id: "legal",
    workerKind: "outer-legal-node",
    jobType: "legal-run",
    scopePrefix: "oa_legal_",
    maximumInputs: 11,
  }),
  openplanter: Object.freeze({
    id: "openplanter",
    workerKind: "outer-openplanter-node",
    jobType: "openplanter-run",
    scopePrefix: "oa_openplanter_",
    maximumInputs: 0,
  }),
  resource2skill: Object.freeze({
    id: "resource2skill",
    workerKind: "outer-resource2skill-node",
    jobType: "resource2skill-run",
    scopePrefix: "oa_resource2skill_",
    maximumInputs: 0,
  }),
  matraix: Object.freeze({
    id: "matraix",
    workerKind: "outer-matraix-node",
    jobType: "matraix-run",
    scopePrefix: "oa_matraix_",
    maximumInputs: 0,
  }),
  hyperframes: Object.freeze({
    id: "hyperframes",
    workerKind: "outer-hyperframes-node",
    jobType: "hyperframes-run",
    scopePrefix: "oa_hyperframes_",
    maximumInputs: 0,
  }),
  openmontage: Object.freeze({
    id: "openmontage",
    workerKind: "outer-openmontage-node",
    jobType: "openmontage-run",
    scopePrefix: "oa_openmontage_",
    maximumInputs: 0,
  }),
  "bolt-slides": Object.freeze({
    id: "bolt-slides",
    workerKind: "outer-bolt-slides-node",
    jobType: "bolt-slides-run",
    scopePrefix: "oa_bolt_slides_",
    maximumInputs: 0,
  }),
  "hardware-blueprint": Object.freeze({
    id: "hardware-blueprint",
    workerKind: "outer-hardware-blueprint-node",
    jobType: "hardware-blueprint-run",
    scopePrefix: "oa_hardware_blueprint_",
    maximumInputs: 0,
  }),
  "inbox-zero": Object.freeze({
    id: "inbox-zero",
    workerKind: "outer-inbox-zero-node",
    jobType: "inbox-zero-run",
    scopePrefix: "oa_inbox_zero_",
    maximumInputs: 0,
  }),
  "socials-manager": Object.freeze({
    id: "socials-manager",
    workerKind: "outer-socials-manager-node",
    jobType: "socials-manager-run",
    scopePrefix: "oa_socials_manager_",
    maximumInputs: 0,
  }),
  "get-doc": Object.freeze({
    id: "get-doc",
    workerKind: "outer-get-doc-node",
    jobType: "get-doc-run",
    scopePrefix: "oa_get_doc_",
    maximumInputs: 0,
  }),
  "get-doc-download": Object.freeze({
    id: "get-doc-download",
    workerKind: "get-doc-download-node",
    jobType: "get-doc-download",
    scopePrefix: "oa_get_doc_download_",
    maximumInputs: 0,
  }),
  "meeting-notes": Object.freeze({
    id: "meeting-notes",
    workerKind: "outer-meeting-notes-node",
    jobType: "meeting-notes-run",
    scopePrefix: "oa_meeting_notes_",
    maximumInputs: 1,
    maximumProjectionBytes: 8 * 1024 * 1024,
  }),
  "money-printer": Object.freeze({
    id: "money-printer",
    workerKind: "outer-money-printer-node",
    jobType: "money-printer-run",
    scopePrefix: "oa_money_printer_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  }),
  "max-research": Object.freeze({
    id: "max-research",
    workerKind: "outer-max-research-node",
    jobType: "max-research-run",
    scopePrefix: "oa_max_research_",
    maximumInputs: 0,
  }),
  wardrobe: Object.freeze({
    id: "wardrobe",
    workerKind: "outer-wardrobe-node",
    jobType: "wardrobe-run",
    scopePrefix: "oa_wardrobe_",
    maximumInputs: 10,
  }),
  "parametric-cad": Object.freeze({
    id: "parametric-cad",
    workerKind: "outer-parametric-cad-node",
    jobType: "parametric-cad-run",
    scopePrefix: "oa_parametric_cad_",
    maximumInputs: 0,
  }),
  "stock-analyst": Object.freeze({
    id: "stock-analyst",
    workerKind: "outer-stock-analyst-node",
    jobType: "stock-analyst-run",
    scopePrefix: "oa_stock_analyst_",
    maximumInputs: 0,
  }),
  "vibe-trading": Object.freeze({
    id: "vibe-trading",
    workerKind: "outer-vibe-trading-node",
    jobType: "vibe-trading-run",
    scopePrefix: "oa_vibe_trading_",
    maximumInputs: 0,
  }),
});

export function validateRuntimeV2OuterAgentRequest(adapterId, value) {
  const validate = REQUEST_VALIDATORS[adapterId];
  if (!validate) fail("The Runtime worker adapter is not registered.");
  return validate(value);
}

export function expectedRuntimeV2OuterAgentInputCount(adapterId, request) {
  if (
    [
      "deep-tutor",
      "deer-flow",
      "deep-research",
      "video-use",
      "openscience",
      "trading-agent",
      "career-ops",
      "agent-reach",
      "agent-tars",
      "openwork",
      "shorts",
      "open-gym",
      "openplanter",
      "resource2skill",
      "matraix",
      "hyperframes",
      "openmontage",
      "bolt-slides",
      "hardware-blueprint",
      "inbox-zero",
      "socials-manager",
      "get-doc",
      "get-doc-download",
      "money-printer",
      "max-research",
      "parametric-cad",
      "stock-analyst",
      "vibe-trading",
    ]
      .includes(adapterId)
  ) return 0;
  if (adapterId === "legal") {
    return 1 + request.attachments.filter((entry) => entry.kind !== "skipped").length;
  }
  if (adapterId === "meeting-notes") return 1;
  if (adapterId === "wardrobe") return request.photos.length;
  return request.attachmentCount;
}

function trustedSecret(name) {
  const value = process.env[name]?.trim() ?? "";
  if (Buffer.byteLength(value, "utf8") > 4_096 || /[\u0000\r\n]/u.test(value)) {
    fail("The trusted Runtime credential is invalid.");
  }
  return value || "local";
}

function imageAttachments(launch) {
  return launch.inputBlobs.map((blob, index) => {
    if (!IMAGE_MEDIA_TYPES.has(blob.mediaType) || blob.sizeBytes > 10 * 1024 * 1024) {
      fail("The sealed outer-agent image is invalid.");
    }
    const inputPath = launch.inputPaths[index];
    if (!inputPath) fail("The sealed outer-agent image is unavailable.");
    const bytes = fs.readFileSync(inputPath);
    return {
      type: "image",
      dataUrl: `data:${blob.mediaType};base64,${bytes.toString("base64")}`,
    };
  });
}

function wardrobePhotos(launch, request) {
  if (
    launch.inputBlobs.length !== request.photos.length ||
    launch.inputPaths.length !== request.photos.length
  ) fail("The sealed Wardrobe Runtime photos are incomplete.");
  return request.photos.map((photo, index) => {
    const blob = launch.inputBlobs[index];
    const inputPath = launch.inputPaths[index];
    if (
      !blob ||
      !inputPath ||
      blob.displayName !== photo.name ||
      blob.mediaType !== photo.mediaType ||
      blob.sizeBytes !== photo.sizeBytes
    ) fail("The sealed Wardrobe Runtime photo metadata does not match its request.");
    return {
      name: photo.name,
      inputPath,
      mediaType: photo.mediaType,
      sizeBytes: photo.sizeBytes,
    };
  });
}

async function readyGraftContext(sourceRoot, request) {
  if (!request.graftEnabled) return null;
  const graftModule = await import(pathToFileURL(
    path.join(sourceRoot, "lib", "code-index", "index-service.ts"),
  ).href);
  if (!graftModule.graftIndexExists(request.repositoryPath)) return null;
  const server = graftModule.graftServerFor(request.repositoryPath);
  if (!server) return null;
  const repositoryPath = path.resolve(request.repositoryPath);
  const graphDirectory = graftModule.graftGraphDirectory(repositoryPath);
  return {
    server,
    instruction: graftModule.graftInstruction({ repositoryPath, graphDirectory }),
    repositoryPath,
    graphDirectory,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminalStatus(events) {
  const terminal = events.findLast((event) => TERMINAL_EVENTS.has(event.type));
  if (terminal?.type === "run.completed") return "completed";
  if (terminal?.type === "run.aborted") return "aborted";
  if (terminal?.type === "run.failed") return "failed";
  return null;
}

function codingRunSnapshot(request) {
  if (!request || typeof request.repositoryPath !== "string") {
    return { finish: () => null };
  }
  const before = captureAgentEditsSnapshot(request.repositoryPath);
  let finished;
  return {
    finish() {
      if (finished !== undefined) return finished;
      if (!before) {
        finished = null;
        return finished;
      }
      const after = captureAgentEditsSnapshot(request.repositoryPath);
      finished = after ? { before, after } : null;
      return finished;
    },
  };
}

function withSnapshotReceipt(event, snapshots) {
  const edits = snapshots.finish();
  return edits
    ? { ...event, payload: { ...event.payload, edits } }
    : event;
}

export async function executeRuntimeV2OuterAgentAdapter({
  adapterId,
  launch,
  sourceRoot,
  signal,
  update,
}) {
  const adapter = RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS[adapterId];
  if (!adapter) fail("The Runtime worker adapter is not registered.");
  const manager = await import(pathToFileURL(path.join(sourceRoot, ...MANAGER_MODULES[adapterId])).href);
  const request = launch.request;
  // Snapshot in the disposable worker before any coding toolchain can write.
  // The terminal event is held back until the matching after-snapshot exists,
  // so a browser can never observe completion without its durable undo refs.
  const snapshots = codingRunSnapshot(adapterId === "deep-tutor" ? null : request);
  const base = {
    userId: launch.executionScope.userId,
    runtimeJobId: launch.identity.jobId,
  };
  let local;
  if (adapterId === "codex") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      instruction: request.instruction ?? undefined,
      skill: request.skill ?? undefined,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      repositoryPath: request.repositoryPath,
      repositoryName: request.repositoryName,
      gardenSlug: request.gardenSlug,
      attachments: imageAttachments(launch),
      graft: await readyGraftContext(sourceRoot, request),
    });
  } else if (adapterId === "ruflo") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      objective: request.objective,
      instruction: request.instruction ?? undefined,
      skill: request.skill ?? undefined,
      workers: request.workers,
      queenType: request.queenType,
      consensus: request.consensus,
      topology: request.topology,
      repositoryPath: request.repositoryPath,
      repositoryName: request.repositoryName,
      gardenSlug: request.gardenSlug,
      attachments: imageAttachments(launch),
      graft: await readyGraftContext(sourceRoot, request),
    });
  } else if (adapterId === "deer-flow") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      settings: request.settings,
      conversationPublicId: request.conversationPublicId,
      conversationContext: request.conversationContext,
      runtimeColdStart: request.coldStart,
    });
  } else if (adapterId === "deep-research") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      query: request.query,
      breadth: request.breadth,
      depth: request.depth,
      output: request.output,
      memoryContext: request.memoryContext,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "video-use") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      conversationPublicId: request.conversationPublicId,
      request: request.request,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "openscience") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      options: request.options,
      conversationPublicId: request.conversationPublicId,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "opencode") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      instruction: request.instruction ?? undefined,
      skill: request.skill ?? undefined,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      repositoryPath: request.repositoryPath,
      repositoryName: request.repositoryName,
      gardenSlug: request.gardenSlug,
      attachments: imageAttachments(launch),
      graft: await readyGraftContext(sourceRoot, request),
    });
  } else if (adapterId === "trading-agent") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request: request.request,
      settings: request.settings,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
    });
  } else if (adapterId === "career-ops") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      maxSteps: request.maxSteps,
      conversationContext: request.conversationContext,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
    });
  } else if (adapterId === "agent-reach") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      maxSteps: request.maxSteps,
      conversationContext: request.conversationContext,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "agent-tars") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      runtimeDataRoot: launch.dataRoot,
      agentId: request.agentId,
      task: request.task,
      profileId: request.profileId,
    });
  } else if (adapterId === "openwork") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      runtimeWorkspacePath: launch.workspacePath,
      serviceScopeId: request.serviceScopeId,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "shorts") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request: request.request,
      conversationPublicId: request.conversationPublicId,
      model: request.model,
      whisperModel: request.whisperModel,
      baseUrl: request.baseUrl,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "open-gym") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
      conversationPublicId: request.conversationPublicId,
      maxSteps: request.maxSteps,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
    });
  } else if (adapterId === "legal") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request: request.request,
      settings: request.settings,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      conversationPublicId: request.conversationPublicId,
      runtimeWorkspacePath: launch.workspacePath,
      runtimeInputPaths: launch.inputPaths,
      runtimeContent: request.content,
      runtimeAttachments: request.attachments,
    });
  } else if (adapterId === "openplanter") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "resource2skill") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      domain: request.domain,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      maxIterations: request.maxIterations,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "matraix") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request: request.request,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "hyperframes") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      brief: request.brief,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "openmontage") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      brief: request.brief,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "bolt-slides") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      brief: request.brief,
      request: request.request,
      model: request.model,
      reasoningEffort: request.reasoningEffort || undefined,
      baseUrl: request.baseUrl,
      conversationPublicId: request.conversationPublicId,
      conversationContext: request.conversationContext,
      apiKey: trustedSecret("CHATMOCK_API_KEY"),
      runtimeWorkspacePath: launch.workspacePath,
    });
  } else if (adapterId === "hardware-blueprint") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      conversationPublicId: request.conversationPublicId,
      brief: request.brief,
      parsed: request.parsed,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      preferences: request.preferences,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "inbox-zero") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      conversationKey: request.conversationKey,
      runtimeChatId: request.runtimeChatId,
      preferredEmail: request.preferredEmail ?? undefined,
      allowActions: request.allowActions,
      chatmockBaseUrl: request.chatmockBaseUrl,
      chatmockApiKey: trustedSecret("CHATMOCK_API_KEY"),
      model: request.model,
      conversationPublicId: request.conversationPublicId ?? undefined,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "socials-manager") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      brief: request.brief,
      model: request.model,
      baseUrl: request.baseUrl,
      conversationPublicId: request.conversationPublicId,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "get-doc") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request: request.request,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "get-doc-download") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      runtimeWorkspacePath: launch.workspacePath,
      sourceRunId: request.sourceRunId,
      documentId: request.documentId,
      conversationPublicId: request.conversationPublicId,
      document: request.document,
    });
  } else if (adapterId === "meeting-notes") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      runtimeWorkspacePath: launch.workspacePath,
      runtimeInputPath: launch.inputPaths[0],
      conversationPublicId: request.conversationPublicId,
      request: request.request,
      source: request.source,
      engine: request.engine,
      voiceboxModel: request.voiceboxModel,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "money-printer") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      conversationPublicId: request.conversationPublicId,
      request: request.request,
      model: request.model,
      baseUrl: request.baseUrl,
    });
  } else if (adapterId === "max-research") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      question: request.question,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
      openscienceEnabled: request.openscienceEnabled,
    });
  } else if (adapterId === "wardrobe") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request: request.request,
      attachments: [],
      runtimePhotos: wardrobePhotos(launch, request),
      model: request.model,
      baseUrl: request.baseUrl,
      conversationPublicId: request.conversationPublicId,
      conversationContext: request.conversationContext,
    });
  } else if (adapterId === "parametric-cad") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request,
    });
  } else if (adapterId === "stock-analyst") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      baseUrl: request.baseUrl,
      settings: request.settings,
      memoryContext: request.memoryContext,
      conversationContext: request.conversationContext,
      runtimeServiceModel: request.serviceModel,
      runtimeColdStart: request.coldStart,
    });
  } else if (adapterId === "vibe-trading") {
    local = manager.startRuntimeWorkerRun({
      ...base,
      task: request.task,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      settings: request.settings,
      conversationContext: request.conversationContext,
      coldStart: request.coldStart,
    });
  } else {
    local = manager.startRuntimeWorkerRun({
      ...base,
      request: request.request,
      scope: {
        userId: launch.executionScope.userId,
        ...request.scope,
      },
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      baseUrl: request.baseUrl,
      conversationContext: request.conversationContext,
    });
  }

  update([], local.status);
  let cursor = 0;
  let stopped = false;
  let stopPromise = null;
  const stop = () => {
    if (stopped) return stopPromise ?? Promise.resolve();
    stopped = true;
    try {
      stopPromise = Promise.resolve(
        manager.abortRuntimeWorkerRun(
          launch.executionScope.userId,
          launch.identity.jobId,
        ),
      ).then(() => undefined, () => undefined);
    } catch {
      // Rust remains the final process-tree authority after the grace window.
      stopPromise = Promise.resolve();
    }
    return stopPromise;
  };
  signal.addEventListener("abort", stop, { once: true });
  // A Runtime stop can arrive while the worker is importing a large adapter.
  // EventTarget does not replay an already-fired abort event to a later
  // listener, so close that load-time race explicitly before polling.
  if (signal.aborted) await stop();
  try {
    while (true) {
      const next = manager.getRuntimeWorkerEventsSince(
        launch.executionScope.userId,
        launch.identity.jobId,
        cursor,
      );
      if (next.length > 0) {
        cursor = next.at(-1).sequenceNumber;
        const terminalIndex = next.findIndex((event) => TERMINAL_EVENTS.has(event.type));
        if (terminalIndex >= 0) {
          if (terminalIndex > 0) update(next.slice(0, terminalIndex));
          const terminalEvent = withSnapshotReceipt(next[terminalIndex], snapshots);
          update([terminalEvent]);
          return { status: terminalStatus([terminalEvent]), edits: snapshots.finish() };
        }
        update(next);
      }
      if (signal.aborted) {
        // Domain managers use this promise to confirm their scoped upstream or
        // nested-job cancellation before the worker publishes an aborted
        // checkpoint. Rust still enforces the outer grace window and reaps the
        // whole worker tree if an adapter never acknowledges.
        await stop();
        const finalEvents = manager.getRuntimeWorkerEventsSince(
          launch.executionScope.userId,
          launch.identity.jobId,
          cursor,
        );
        const terminalIndex = finalEvents.findIndex((event) => TERMINAL_EVENTS.has(event.type));
        if (terminalIndex >= 0) {
          if (terminalIndex > 0) update(finalEvents.slice(0, terminalIndex));
          const terminalEvent = withSnapshotReceipt(finalEvents[terminalIndex], snapshots);
          update([terminalEvent]);
          return { status: terminalStatus([terminalEvent]), edits: snapshots.finish() };
        }
        if (finalEvents.length > 0) update(finalEvents);
        return { status: "aborted", edits: snapshots.finish() };
      }
      if (manager.isRuntimeWorkerTerminal(launch.executionScope.userId, launch.identity.jobId)) {
        return { status: "failed", edits: snapshots.finish() };
      }
      await wait(100);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
