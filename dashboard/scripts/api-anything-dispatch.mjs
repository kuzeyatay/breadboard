import { API_ANYTHING_TOOLS, apiAnythingFallback, apiAnythingResult } from "./api-anything-contract.mjs";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const name = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(value);

/** The host is the real vendored api-anything/host module, injected for focused tests. */
export async function dispatchApiAnything(host, tool, args = {}, { approvedPlan, timeoutMs = 20_000 } = {}) {
  if (!record(args) || Buffer.byteLength(JSON.stringify(args)) > 128 * 1024) {
    return apiAnythingResult({ ok: false, class: "input", reason: "API arguments must be a bounded JSON object." });
  }
  if (tool === "__breadboard_list_tools") return { ok: true, tools: API_ANYTHING_TOOLS };
  if (tool === "status") {
    const sites = host.hostSites();
    return { ok: true, provider: "api-anything", available: true, sites: sites.length,
      operations: sites.reduce((sum, site) => sum + site.operations.length, 0), transport: "http", browserFallback: true };
  }
  if (tool === "find_sites") {
    if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 500)) {
      return apiAnythingResult({ ok: false, class: "input", reason: "query must be text, up to 500 characters." });
    }
    const query = (args.query ?? "").trim().toLowerCase();
    let domain = query;
    try { domain = new URL(query).hostname; } catch { /* A name or task, not a URL. */ }
    const words = query.split(/[^a-z0-9]+/u).filter(Boolean);
    const matches = host.hostSites().map(site => {
      const exact = site.name === query || site.hosts.some(host => host === domain || domain.endsWith(`.${host}`));
      const haystack = `${site.name} ${site.hosts.join(" ")} ${site.operations.map(op => `${op.name} ${op.description ?? ""}`).join(" ")}`.toLowerCase();
      const score = exact ? 1000 : words.length && words.every(word => haystack.includes(word)) ? words.length : 0;
      return { site, score };
    }).filter(item => !query || item.score > 0).sort((a, b) => b.score - a.score || a.site.name.localeCompare(b.site.name));
    const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(30, args.limit)) : 12;
    return { ok: true, provider: "api-anything", sites: matches.slice(0, limit).map(item => item.site),
      total: matches.length, truncated: matches.length > limit,
      fallback: { recommended: matches.length === 0, ...(matches.length ? {} : { reason: "No installed website API matches. Use the existing browser tools." }) } };
  }
  if (!name(args.site)) return apiAnythingResult({ ok: false, class: "input", reason: "A valid installed site name is required." });
  if (tool === "describe_site") {
    const site = host.hostSite(args.site);
    return site ? { ok: true, provider: "api-anything", ...site } : apiAnythingFallback("No API is installed for this site.", "not_found");
  }
  if (tool !== "call_operation" || !name(args.operation) || (args.args !== undefined && !record(args.args))) {
    return apiAnythingResult({ ok: false, class: "input", reason: "Use a listed tool, exact operation name and an args object." });
  }
  const description = host.hostSite(args.site);
  if (!description?.site.operations.some(op => op.name === args.operation)) {
    return apiAnythingFallback("This website operation is not installed. Use the existing browser tools.", "not_found");
  }
  // Breadboard owns browser sessions and their visible activity. API Anything's
  // separate hidden browser must not take over when plain HTTP cannot do the job.
  const plan = host.planCall(args.site, args.operation, args.args ?? {}, { maxTier: 1 });
  if (!plan.ok) return apiAnythingResult(plan.result);
  if (!plan.readOnly && !approvedPlan) {
    return { ok: false, class: "approval_required", approvalRequired: true,
      preview: { site: plan.site, operation: plan.op, signedIn: plan.signedIn, request: plan.request, tier: plan.tier },
      // Consumed by the trusted client only; never returned to the agent or renderer.
      pendingPlan: plan };
  }
  if (approvedPlan && (approvedPlan.site !== args.site || approvedPlan.op !== args.operation)) {
    return apiAnythingResult({ ok: false, class: "refused", write: "not_sent", reason: "Approval does not match this operation." }, false);
  }
  const result = await host.callPlanned(approvedPlan ?? plan, { allowWrites: !plan.readOnly && !!approvedPlan, maxTier: 1, timeoutMs });
  return apiAnythingResult(result, plan.readOnly);
}
