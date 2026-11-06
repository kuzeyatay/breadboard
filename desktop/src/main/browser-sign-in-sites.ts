import type { Cookie } from "electron";

type SignInCookie = Pick<Cookie, "domain" | "name" | "value" | "expirationDate" | "httpOnly">;
type SignInRule = { domain: string; site?: string; matches: (cookies: SignInCookie[]) => boolean };
const has = (cookies: SignInCookie[], name: string) => cookies.some(cookie => cookie.name === name);

// Deliberately specific: generic session, sessionid, auth, visitor, CSRF and
// device cookies are also issued to anonymous visitors and are not evidence.
// Provider rules are scoped to their own domains, never to arbitrary sites.
const PROVIDERS: SignInRule[] = [
  // https://policies.google.com/technologies/cookies
  { domain: "google.com", matches: cookies => has(cookies, "SID") && has(cookies, "HSID") },
  { domain: "youtube.com", matches: cookies => has(cookies, "SID") && has(cookies, "HSID") },
  // https://docs.github.com/en/site-policy/privacy-policies/github-cookies
  { domain: "github.com", matches: cookies => has(cookies, "user_session") &&
    cookies.some(cookie => cookie.name === "logged_in" && cookie.value === "yes") },
  // https://www.linkedin.com/legal/l/cookie-table
  { domain: "linkedin.com", matches: cookies => has(cookies, "li_at") },
  // https://privacy.claude.com/en/articles/10023541-what-cookies-does-anthropic-use
  ...["claude.ai", "anthropic.com"].map(domain => ({ domain,
    matches: (cookies: SignInCookie[]) => has(cookies, "sessionKey") || has(cookies, "sessionKeyV2") })),
  // https://help.x.com/en/rules-and-policies/x-cookies
  ...["x.com", "twitter.com"].map(domain => ({ domain, site: "x.com",
    matches: (cookies: SignInCookie[]) => has(cookies, "auth_token") })),
  // https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-web-browser-cookies
  { domain: "login.microsoftonline.com", matches: cookies => has(cookies, "ESTSAUTH") || has(cookies, "ESTSAUTHPERSISTENT") },
];

function cookieHost(domain: string | undefined): string | null {
  const host = (domain ?? "").toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  try {
    const url = new URL(`https://${host}`);
    return url.hostname === host && !url.port && !url.username && !url.password && url.pathname === "/" ? host : null;
  } catch { return null; }
}

function frameworkSession(cookies: SignInCookie[]): boolean {
  // These frameworks issue this cookie only for an authenticated session.
  // A chunked token must include its first chunk, not only an orphaned tail.
  // https://authjs.dev/concepts/session-strategies
  // https://better-auth.com/docs/concepts/cookies
  // https://developer.wordpress.org/advanced-administration/wordpress/cookies/
  return cookies.some(cookie => cookie.httpOnly && (
    /^(?:__Secure-|__Host-)?(?:next-auth|authjs)\.session-token(?:\.0)?$/.test(cookie.name) ||
    /^(?:__Secure-|__Host-)?better-auth\.session_token(?:\.0)?$/.test(cookie.name) ||
    /^wordpress_logged_in_[a-f0-9]{32}$/i.test(cookie.name)
  ));
}

/**
 * Only recognized login sessions are listed; cookie material stays in main.
 * This is local detection, not server verification: a remotely revoked token
 * may remain until the site clears it, and unknown/local-storage logins are
 * omitted. Never infer authentication from an arbitrary cookie or visit.
 */
export function browserSignedInSites(cookies: SignInCookie[], now = Date.now() / 1_000): string[] {
  const groups = new Map<string, { cookies: SignInCookie[]; provider?: SignInRule }>();
  for (const cookie of cookies) {
    const host = cookieHost(cookie.domain);
    if (!host || !cookie.value.trim() || /^(?:0|false|null|undefined|deleted|logged_out|signed_out)$/i.test(cookie.value.trim())) continue;
    if (cookie.expirationDate !== undefined && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate <= now)) continue;
    const provider = PROVIDERS.find(rule => host === rule.domain || host.endsWith(`.${rule.domain}`));
    // Keep unrelated subdomains and tenant domains separate. Only known
    // providers can consolidate account and application cookie domains.
    const site = provider?.domain ?? host.replace(/^www\./, "");
    const group = groups.get(site) ?? { cookies: [], provider };
    group.cookies.push(cookie);
    groups.set(site, group);
  }
  const sites = new Set<string>();
  for (const [site, group] of groups) {
    if (group.provider?.matches(group.cookies) || frameworkSession(group.cookies)) {
      sites.add(group.provider?.site ?? site);
    }
  }
  return [...sites].sort();
}
