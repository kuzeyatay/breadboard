import { NextRequest, NextResponse } from 'next/server';
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

function injectPreviewShell(
  html: string,
  clusterSlug: string,
  refresh: string,
  origin: string,
): string {
  const baseHref = quartzUrl(clusterSlug);
  const contentIndexUrl = proxyUrl(origin, 'contentIndex', refresh, clusterSlug);
  const prescriptUrl = proxyUrl(origin, 'prescript', refresh, clusterSlug);
  const postscriptUrl = proxyUrl(origin, 'postscript', refresh, clusterSlug);
  const headInjection = [
    `<base href="${baseHref}">`,
    `<style>${PREVIEW_STYLE}</style>`,
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

async function proxyQuartzJavaScript(asset: 'prescript' | 'postscript'): Promise<NextResponse> {
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
    Object.entries(parsed).filter(([slug]) => slug === clusterSlug || slug.startsWith(prefix)),
  );

  return JSON.stringify(filtered);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const asset = searchParams.get('asset');
    const clusterSlug = searchParams.get('clusterSlug')?.trim();

    if (!clusterSlug) return previewError('Missing cluster.', 400);
    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    if (asset === 'prescript' || asset === 'postscript') {
      return proxyQuartzJavaScript(asset);
    }

    if (asset === 'contentIndex') {
      const response = await fetch(`${QUARTZ_BASE_URL}/static/contentIndex.json`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        return NextResponse.json({ error: 'Quartz content index is not available.' }, { status: response.status });
      }

      const contentIndex = await response.text();
      const filteredContentIndex = filterContentIndex(contentIndex, cluster.slug);

      return new NextResponse(filteredContentIndex, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    const refresh = searchParams.get('refresh') ?? Date.now().toString();

    const response = await fetch(quartzUrl(cluster.slug), {
      cache: 'no-store',
    });

    if (!response.ok) {
      return previewError('Quartz is not ready yet.', response.status);
    }

    const html = injectPreviewShell(await response.text(), cluster.slug, refresh, request.nextUrl.origin);

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
