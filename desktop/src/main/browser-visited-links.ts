import * as fs from "node:fs";
import * as path from "node:path";
import type { WebContents } from "electron";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_VISITED_LINKS_FILE = "browser-visited-links.json";
const MAX_VISITED_LINKS = 10_000;
const VISITED_LINK_WORLD = 1001;

/** Keep query strings, ignore fragments, and recognize Google's redirect links. */
export function normalizedVisitedLink(input: string, base?: string): string | null {
  try {
    let url = new URL(input, base);
    if (/^(?:www\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(url.hostname) && url.pathname === "/url") {
      const target = url.searchParams.get("q") || url.searchParams.get("url");
      if (target) url = new URL(target);
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    const value = url.toString();
    return value.length <= 8_192 ? value : null;
  } catch {
    return null;
  }
}

/** Only Google result pages receive Breadboard's visited-result styling. */
export function isGoogleSearchResultsPage(input: string): boolean {
  try {
    const url = new URL(input);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password &&
      /^(?:www\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(url.hostname) &&
      url.pathname === "/search" && Boolean(url.searchParams.get("q")?.trim());
  } catch {
    return false;
  }
}

/** Scope visits to the referring origin so sites cannot inspect unrelated history. */
export class BrowserVisitedLinkStore {
  private entries = new Map<string, [string, string]>();

  constructor(private readonly configDir?: string) {
    if (!configDir) return;
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(configDir, BROWSER_VISITED_LINKS_FILE), "utf8"));
      if (saved?.version !== 1 || !Array.isArray(saved.entries)) throw new Error("Invalid visited links file");
      for (const entry of saved.entries.slice(-MAX_VISITED_LINKS)) {
        if (!Array.isArray(entry) || entry.length !== 2 ||
            typeof entry[0] !== "string" || typeof entry[1] !== "string" ||
            normalizedVisitedLink(entry[0]) === null || new URL(entry[0]).origin !== entry[0] ||
            normalizedVisitedLink(entry[1]) !== entry[1]) throw new Error("Invalid visited link record");
        this.entries.set(JSON.stringify(entry), [entry[0], entry[1]]);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  linksFor(pageUrl: string): string[] {
    if (!normalizedVisitedLink(pageUrl)) return [];
    const origin = new URL(pageUrl).origin;
    return [...this.entries.values()].filter(([source]) => source === origin).map(([, url]) => url);
  }

  remember(pageUrl: string, targetUrl: string): boolean {
    const target = normalizedVisitedLink(targetUrl, pageUrl);
    if (!normalizedVisitedLink(pageUrl) || !target) return false;
    const entry: [string, string] = [new URL(pageUrl).origin, target];
    const key = JSON.stringify(entry);
    if (this.entries.has(key)) return false;
    const next = new Map(this.entries);
    next.set(key, entry);
    if (next.size > MAX_VISITED_LINKS) next.delete(next.keys().next().value!);
    if (this.configDir) {
      atomicWriteFile(path.join(this.configDir, BROWSER_VISITED_LINKS_FILE), JSON.stringify({ version: 1, entries: [...next.values()] }));
    }
    this.entries = next;
    return true;
  }
}

export const BROWSER_VISITED_LINK_CSS = `
  a[data-breadboard-visited] h3 {
    color: #681da8 !important;
  }
  html[data-breadboard-visited-theme="dark"] a[data-breadboard-visited] h3 {
    color: #c58af9 !important;
  }
`;

/** Runs in an isolated world; no product bridge or cross-site history enters the page. */
export function browserVisitedLinksScript(pageUrl: string, links: string[]): string {
  return `(() => {
    if (location.origin !== ${JSON.stringify(new URL(pageUrl).origin)}) return;
    const links = ${JSON.stringify(links)};
    if (globalThis.__breadboardVisitedLinks) {
      globalThis.__breadboardVisitedLinks.update(links);
      return;
    }
    const normalize = ${normalizedVisitedLink.toString()};
    const isResultsPage = ${isGoogleSearchResultsPage.toString()};
    let visited = new Set(links);
    let pending = false;
    const darkPreference = matchMedia('(prefers-color-scheme: dark)');
    const scan = () => {
      pending = false;
      if (!document.documentElement) return;
      const scheme = getComputedStyle(document.documentElement).colorScheme;
      let dark = scheme === 'dark' || (scheme.includes('dark') && darkPreference.matches);
      for (const node of [document.body, document.documentElement]) {
        if (!node) continue;
        const rgb = getComputedStyle(node).backgroundColor.match(/[\\d.]+/g)?.map(Number);
        if (!rgb || rgb.length < 3 || (rgb.length > 3 && rgb[3] < 0.5)) continue;
        dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 128;
        break;
      }
      const onResultsPage = isResultsPage(location.href);
      if (onResultsPage) document.documentElement.dataset.breadboardVisitedTheme = dark ? 'dark' : 'light';
      else delete document.documentElement.dataset.breadboardVisitedTheme;
      for (const anchor of document.querySelectorAll('a[href]')) {
        const target = normalize(anchor.getAttribute('href'), document.baseURI);
        const marked = onResultsPage && anchor.closest('#search, #rso') !== null &&
          anchor.querySelector('h3') !== null && target !== null &&
          new URL(target).origin !== location.origin && visited.has(target);
        anchor.toggleAttribute('data-breadboard-visited', marked);
      }
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(scan);
    };
    new MutationObserver(schedule).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'class', 'style']
    });
    darkPreference.addEventListener('change', schedule);
    addEventListener('pageshow', schedule);
    globalThis.__breadboardVisitedLinks = { update(links) { visited = new Set(links); scan(); } };
    scan();
  })()`;
}

export class BrowserVisitedLinks {
  private readonly store: BrowserVisitedLinkStore;
  private readonly pages = new Set<WebContents>();
  private readonly styledPages = new WeakSet<WebContents>();

  constructor(configDir?: string, private readonly log: (message: string) => void = () => {}) {
    try {
      this.store = new BrowserVisitedLinkStore(configDir);
    } catch (error) {
      this.log(`Could not load visited links: ${String(error)}`);
      // Preserve the unreadable file; this session can still mark new visits.
      this.store = new BrowserVisitedLinkStore();
    }
  }

  remember(sourceUrl: string, targetUrl: string): void {
    if (!isGoogleSearchResultsPage(sourceUrl)) return;
    try {
      if (!this.store.remember(sourceUrl, targetUrl)) return;
      const origin = new URL(sourceUrl).origin;
      for (const contents of this.pages) {
        if (contents.isDestroyed()) continue;
        const url = contents.getURL();
        if (normalizedVisitedLink(url) && new URL(url).origin === origin) this.refresh(contents);
      }
    } catch (error) {
      this.log(`Could not save visited link: ${String(error)}`);
    }
  }

  private refresh(contents: WebContents): void {
    if (contents.isDestroyed()) return;
    const url = contents.getURL();
    if (!normalizedVisitedLink(url)) return;
    const isResultsPage = isGoogleSearchResultsPage(url);
    // Refresh an already styled document when same-document navigation leaves
    // search, so the script clears its result markers.
    if (!isResultsPage && !this.styledPages.has(contents)) return;
    if (isResultsPage && !this.styledPages.has(contents)) {
      this.styledPages.add(contents);
      void contents.insertCSS(BROWSER_VISITED_LINK_CSS, { cssOrigin: "user" })
        .catch(() => this.styledPages.delete(contents));
    }
    void contents.executeJavaScriptInIsolatedWorld(VISITED_LINK_WORLD, [{
      code: browserVisitedLinksScript(url, this.store.linksFor(url)),
    }]).catch(() => undefined);
  }

  attach(contents: WebContents): void {
    this.pages.add(contents);
    contents.once("destroyed", () => this.pages.delete(contents));
    let previousUrl = contents.getURL();
    contents.on("will-navigate", (event, targetUrl) => {
      if (!event.defaultPrevented) this.remember(contents.getURL(), targetUrl);
    });
    contents.on("did-navigate", (_event, url) => {
      this.remember(previousUrl, url);
      previousUrl = url;
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.remember(previousUrl, url);
      previousUrl = url;
      this.refresh(contents);
    });
    contents.on("dom-ready", () => {
      this.styledPages.delete(contents);
      this.refresh(contents);
    });
  }
}
