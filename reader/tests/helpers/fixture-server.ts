/**
 * Local HTTP fixture server for e2e tests that need to exercise the
 * crawler's real network path (engine: 'curl', 'browser', etc).
 *
 * Binds dual-stack ('::') on a kernel-assigned port so the same server
 * answers on both ::1 and 127.0.0.1. Use the returned `localhost`-based
 * URL from `server.url(path)`; bare 127.0.0.1 in the URL is rejected by
 * `assertNormalizedUrl` (private IP guard).
 *
 * Routes:
 *   GET /                     → 200, simple HTML page (override status with ?status=NNN)
 *   GET /status/:code         → returns the path-encoded status code
 *   GET /redirect?to=URL      → 302 Location: URL
 *   GET /slow?ms=N            → response delayed by N ms
 *   GET /html                 → 200 HTML with custom body via ?body=...
 *
 * Custom handlers can be registered with `server.use(method, path, handler)`
 * which take precedence over the built-ins.
 */
import http from 'http';
import type { AddressInfo } from 'net';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void | Promise<void>;

export interface FixtureServer {
    readonly port: number;
    /** URL with `localhost` host. Pass to the crawler. */
    url(path?: string): string;
    use(method: string, path: string, handler: Handler): void;
    close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
    const routes = new Map<string, Handler>();

    const handle: Handler = (req, res, url) => {
        const path = url.pathname;
        const key = `${req.method} ${path}`;
        const custom = routes.get(key);
        if (custom) return custom(req, res, url);

        if (path === '/' || path === '/html') {
            const status = parseInt(url.searchParams.get('status') || '200', 10);
            const bodyParam = url.searchParams.get('body');
            const body = bodyParam
                ? bodyParam
                : `<!DOCTYPE html><html><head><title>Fixture ${status}</title></head>` +
                  `<body><h1>Fixture page returning ${status}</h1>` +
                  `<p>This is the response body for HTTP status ${status}.</p></body></html>`;
            res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(body);
            return;
        }

        const statusMatch = path.match(/^\/status\/(\d{3})$/);
        if (statusMatch) {
            const status = parseInt(statusMatch[1], 10);
            res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
                `<!DOCTYPE html><html><head><title>Status ${status}</title></head>` +
                `<body><h1>Status ${status}</h1></body></html>`
            );
            return;
        }

        if (path === '/redirect') {
            const to = url.searchParams.get('to') || '/';
            res.writeHead(302, { Location: to });
            res.end();
            return;
        }

        if (path === '/slow') {
            const ms = parseInt(url.searchParams.get('ms') || '0', 10);
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<!DOCTYPE html><html><body><p>Slow response</p></body></html>');
            }, ms);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
    };

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        Promise.resolve(handle(req, res, url)).catch((err) => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`fixture handler error: ${err?.message || err}`);
            }
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '::', resolve));
    const port = (server.address() as AddressInfo).port;

    return {
        port,
        url(path = '/') {
            return `http://localhost:${port}${path.startsWith('/') ? path : '/' + path}`;
        },
        use(method, path, handler) {
            routes.set(`${method.toUpperCase()} ${path}`, handler);
        },
        async close() {
            await new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve()))
            );
        },
    };
}
