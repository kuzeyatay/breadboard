import { NextRequest, NextResponse } from 'next/server';
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from '@/lib/external-runtime-filesystem';
import { QUARTZ_BASE_URL, quartzUrl } from '@/lib/quartz-url';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const PREVIEW_STYLE = `
html,
body {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--light);
}

.left.sidebar,
.right.sidebar,
.breadcrumb-container,
.article-title,
.content-meta,
.graph.home-knowledge-graph > h3,
.graph.home-knowledge-graph .global-graph-icon,
.graph.home-knowledge-graph .global-graph-outer,
article,
footer,
.page-footer,
.tags {
  display: none !important;
}

#quartz-root,
#quartz-body,
.center,
.page-header,
.popover-hint,
.graph.home-knowledge-graph {
  display: block !important;
  width: 100vw !important;
  max-width: none !important;
  min-width: 0 !important;
  height: 100vh !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}

.graph.home-knowledge-graph > .graph-outer {
  width: 100vw !important;
  height: 100vh !important;
  min-height: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  cursor: default;
}
`;

// The preview is served from the dashboard origin, while the full Quartz site
// has its own origin and theme storage. Seed Quartz's theme synchronously,
// before prescript.js reads its generic `theme` key and before the canvas is
// painted. Relying only on the postMessage bridge leaves the first graph render
// at the operating-system preference, which can be dark inside a light app.
const PREVIEW_THEME_SCRIPT = `
<script>
(() => {
  try {
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    const parentTheme = window.parent.document.documentElement.dataset.theme;
    const theme = requestedTheme === "dark" || requestedTheme === "light"
      ? requestedTheme
      : parentTheme === "dark" ? "dark" : "light";
    document.documentElement.classList.add("quartz-graph-preview");
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = theme === "dark" ? "#0b0c0a" : "#f5f3ee";
    window.localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("saved-theme", theme);
  } catch {}
})();
</script>
`;

// The full Quartz graph is tuned for a reading surface, not this compact card.
// Apply the preview overrides before Quartz dispatches its initial `nav` event,
// so the first simulation already has enough repulsion and appropriately sized
// labels instead of visibly rearranging itself after load.
const PREVIEW_LAYOUT_SCRIPT = `
<script>
document.addEventListener("DOMContentLoaded", () => {
  const graph = document.querySelector(".graph.home-knowledge-graph .graph-container");
  if (!graph) return;
  try {
    const config = JSON.parse(graph.dataset.cfg || "{}");
    config.repelForce = Math.max(Number(config.repelForce) || 0, 4);
    config.fontSize = Math.min(Number(config.fontSize) || 0.72, 0.72);
    const topology = window.__breadboardThoughtTopologyBootstrap;
    if (topology) {
      config.mode = topology.mode;
      config.preview = true;
      if (topology.mode === "thought-topology") config.topologyUrl = topology.url;
    }
    graph.dataset.cfg = JSON.stringify(config);
  } catch {}
});
</script>
`;

const PREVIEW_READY_SCRIPT = `
<script>
(() => {
  const messageType = "breadboard:quartz-graph-preview";
  let settled = false;
  let readyScheduled = false;
  const post = (status, message) => {
    window.parent.postMessage({ type: messageType, status, message }, window.location.origin);
  };
  const announceWhenReady = () => {
    const canvas = document.querySelector(".graph.home-knowledge-graph > .graph-outer canvas");
    if (!canvas) return false;
    if (readyScheduled) return true;
    readyScheduled = true;
    // Pixi inserts its canvas before its first render. Reveal only after that
    // render has reached the compositor, otherwise a light map briefly exposes
    // the graphics surface's black initialization frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!canvas.isConnected) {
        readyScheduled = false;
        return;
      }
      settled = true;
      observer.disconnect();
      post("ready");
    }));
    return true;
  };
  const observer = new MutationObserver(announceWhenReady);
  window.addEventListener("DOMContentLoaded", () => {
    if (!announceWhenReady()) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  });
  window.addEventListener("error", (event) => {
    if (!settled) post("error", event.message || "The garden preview could not load.");
  });
  window.addEventListener("unhandledrejection", () => {
    if (!settled) post("error", "The garden preview could not load.");
  });
  window.setTimeout(() => {
    if (!settled && !announceWhenReady()) post("error", "The garden preview timed out.");
  }, 12000);
})();
</script>
`;

function previewError(message: string, status = 502): NextResponse {
  return new NextResponse(
    `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#161618;color:#646464;font:13px system-ui,sans-serif;">${message}</body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

function proxyUrl(origin: string, asset: string, refresh: string, clusterSlug: string): string {
  const url = new URL('/api/quartz-graph-preview', origin);
  url.searchParams.set('asset', asset);
  url.searchParams.set('refresh', refresh);
  url.searchParams.set('clusterSlug', clusterSlug);
  return url.toString();
}

function browserRequestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const requestHost = forwardedHost || request.headers.get('host')?.trim();
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(/:$/, '');

  if (!requestHost) return request.nextUrl.origin;

  try {
    return new URL(`${protocol}://${requestHost}`).origin;
  } catch {
    return request.nextUrl.origin;
  }
}

function injectPreviewShell(
  html: string,
  clusterSlug: string,
  refresh: string,
  origin: string,
  topologyMode: 'links' | 'thought-topology',
): string {
  const baseHref = quartzUrl(clusterSlug);
  const contentIndexUrl = proxyUrl(origin, 'contentIndex', refresh, clusterSlug);
  const prescriptUrl = proxyUrl(origin, 'prescript', refresh, clusterSlug);
  const postscriptUrl = proxyUrl(origin, 'postscript', refresh, clusterSlug);
  const topologyUrl = new URL('/api/thought-topology', origin);
  topologyUrl.searchParams.set('clusterSlug', clusterSlug);
  const headInjection = [
    PREVIEW_THEME_SCRIPT,
    `<script>window.__breadboardThoughtTopologyBootstrap=${JSON.stringify({
      mode: topologyMode,
      url: topologyUrl.toString(),
      preview: true,
    }).replace(/</g, '\\u003c')};</script>`,
    PREVIEW_LAYOUT_SCRIPT,
    `<base href="${baseHref}">`,
    `<style>${PREVIEW_STYLE}</style>`,
    PREVIEW_READY_SCRIPT,
  ].join('');

  return html
    .replace(/<head([^>]*)>/i, `<head$1>${headInjection}`)
    .replace(
      /const fetchData = fetch\((["']).*?contentIndex\.json\1\)\.then\(data => data\.json\(\)\)/,
      `const fetchData = fetch("${contentIndexUrl}").then(data => data.json())`,
    )
    .replace(
      /src=(["'])(?:\.\.\/)?prescript\.js(?:\?[^"']*)?\1/g,
      `src="${prescriptUrl}"`,
    )
    .replace(
      /src=(["'])(?:\.\.\/)?postscript\.js(?:\?[^"']*)?\1/g,
      `src="${postscriptUrl}"`,
    );
}

function localQuartzPublicPath(): string | null {
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!contentPath) return null;

  const quartzRoot = path.dirname(path.resolve(contentPath));
  const publicPath = path.join(quartzRoot, 'public');
  return fs.existsSync(publicPath) ? publicPath : null;
}

function readLocalQuartzTextFile(...segments: string[]): string | null {
  const publicPath = localQuartzPublicPath();
  if (!publicPath) return null;

  const filePath = path.resolve(publicPath, ...segments);
  const normalizedPublicPath = `${publicPath}${path.sep}`;
  if (filePath !== publicPath && !filePath.startsWith(normalizedPublicPath)) {
    return null;
  }

  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function proxyQuartzJavaScript(asset: 'prescript' | 'postscript'): Promise<NextResponse> {
  const localScript = readLocalQuartzTextFile(`${asset}.js`);
  if (localScript !== null) {
    return new NextResponse(localScript, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const response = await fetch(`${QUARTZ_BASE_URL}/${asset}.js`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return previewError('Quartz script is not available.', response.status);
  }

  return new NextResponse(await response.text(), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function filterContentIndex(contentIndexText: string, clusterSlug: string): string {
  const prefix = `${clusterSlug}/`;
  const parsed = JSON.parse(contentIndexText) as Record<string, unknown>;
  const filtered = Object.fromEntries(
    Object.entries(parsed)
      .filter(([slug]) => slug === clusterSlug || slug.startsWith(prefix))
      .map(([slug, value]) => {
        if (!value || typeof value !== 'object') return [slug, value];
        const title = (value as { title?: unknown }).title;
        if (typeof title !== 'string' || title.length <= 30) return [slug, value];
        const extension = title.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '';
        const leadingLength = Math.max(12, 29 - extension.length);
        return [
          slug,
          { ...value, title: `${title.slice(0, leadingLength)}…${extension}` },
        ];
      }),
  );

  return JSON.stringify(filtered);
}

function textFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

async function publishedQuartzRevision(clusterSlug: string): Promise<{
  ok: true;
  revision: string;
} | {
  ok: false;
  status: number;
}> {
  const publicPath = localQuartzPublicPath();
  if (publicPath) {
    // In the desktop runtime Quartz publishes these files atomically. Stats
    // make the five-second freshness check cheap even for very large gardens;
    // the embedded frame still fetches all assets with no-store after a change.
    const files = [
      path.join(publicPath, 'static', 'contentIndex.json'),
      path.join(publicPath, clusterSlug, 'index.html'),
      path.join(publicPath, 'postscript.js'),
    ];
    const revision = files.map((file) => {
      try {
        const stat = fs.statSync(file);
        return `${stat.size}:${Math.round(stat.mtimeMs)}`;
      } catch {
        return 'missing';
      }
    }).join('|');
    return { ok: true, revision: `local:${revision}` };
  }

  const contentIndex = await readQuartzContentIndex();
  if (!contentIndex.ok) return contentIndex;
  return {
    ok: true,
    revision: `remote:${textFingerprint(filterContentIndex(contentIndex.text, clusterSlug))}`,
  };
}

async function readQuartzContentIndex(): Promise<{
  ok: true;
  text: string;
} | {
  ok: false;
  status: number;
}> {
  const localContentIndex = readLocalQuartzTextFile('static', 'contentIndex.json');
  if (localContentIndex !== null) {
    return { ok: true, text: localContentIndex };
  }

  const response = await fetch(`${QUARTZ_BASE_URL}/static/contentIndex.json`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  return { ok: true, text: await response.text() };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const asset = searchParams.get('asset');
    const clusterSlug = searchParams.get('clusterSlug')?.trim();

    if (!clusterSlug) return previewError('Missing garden.', 400);
    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    if (asset === 'prescript' || asset === 'postscript') {
      return proxyQuartzJavaScript(asset);
    }

    if (asset === 'contentIndex') {
      const contentIndex = await readQuartzContentIndex();
      if (!contentIndex.ok) {
        return NextResponse.json(
          { error: 'Quartz content index is not available.' },
          { status: contentIndex.status },
        );
      }

      const filteredContentIndex = filterContentIndex(contentIndex.text, cluster.slug);

      return new NextResponse(filteredContentIndex, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (asset === 'revision') {
      const published = await publishedQuartzRevision(cluster.slug);
      if (!published.ok) {
        return NextResponse.json(
          { error: 'Quartz publication state is not available.' },
          { status: published.status },
        );
      }
      return NextResponse.json(
        { revision: published.revision },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const refresh = searchParams.get('refresh') ?? Date.now().toString();
    const localHtml = readLocalQuartzTextFile(cluster.slug, 'index.html');
    let html = localHtml;
    if (html === null) {
      const response = await fetch(quartzUrl(cluster.slug), {
        cache: 'no-store',
      });

      if (!response.ok) {
        return previewError('Quartz is not ready yet.', response.status);
      }

      html = await response.text();
    }

    const injectedHtml = injectPreviewShell(
      html,
      cluster.slug,
      refresh,
      browserRequestOrigin(request),
      cluster.thought_topology_enabled === 1 ? 'thought-topology' : 'links',
    );

    return new NextResponse(injectedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
