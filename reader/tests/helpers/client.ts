import supertest from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import server from '../../build/stand-alone/crawl.js';

export function getAgent(): ReturnType<typeof supertest> {
    return supertest(server.httpServer);
}

export const SAMPLE_HTML = readFileSync(
    join(__dirname, '..', '..', 'fixtures', 'sample.html'),
    'utf-8',
);

export async function crawl(opts: Record<string, unknown> = {}) {
    return getAgent()
        .post('/')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send({ html: SAMPLE_HTML, url: 'https://example.com/test', ...opts });
}

export async function crawlWithHeaders(
    headers: Record<string, string>,
    body: Record<string, unknown> = {},
) {
    let req = getAgent()
        .post('/')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json');

    for (const [k, v] of Object.entries(headers)) {
        req = req.set(k, v);
    }

    return req.send({
        html: SAMPLE_HTML,
        url: 'https://example.com/test',
        ...body,
    });
}

export function getContent(res: any): string {
    const content = res.body?.data?.content;
    if (typeof content !== 'string') {
        throw new Error(`Expected string content field, got: ${JSON.stringify(res.body)}`);
    }
    return content;
}

export function parseSSELines(res: any): any[] {
    const text: string = res.text ?? '';
    return text
        .split('\n')
        .filter((l: string) => l.startsWith('data:'))
        .map((l: string) => l.slice('data:'.length).trim())
        .filter((s: string) => s && s !== '[DONE]')
        .map((s: string) => JSON.parse(s));
}

export async function crawlStream(respondWith: string, extraOpts: Record<string, unknown> = {}) {
    return getAgent()
        .post('/')
        .set('Accept', 'text/event-stream')
        .set('Content-Type', 'application/json')
        .send({ html: SAMPLE_HTML, url: 'https://example.com/test', respondWith, ...extraOpts });
}
