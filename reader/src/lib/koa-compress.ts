import zlib from 'zlib';
import { Stream, Transform, Readable } from 'stream';
import type { Context, Next, Middleware } from 'koa';

type Encoding = 'zstd' | 'br' | 'gzip' | 'deflate';

type EncoderFactory = (opts?: any) => Transform;

export interface CompressOptions {
    filter?: (mimeType: string) => boolean;
    threshold?: number;
    encodingPreference?: Encoding[];
    br?: zlib.BrotliOptions | false | null;
    gzip?: zlib.ZlibOptions | false | null;
    deflate?: zlib.ZlibOptions | false | null;
    zstd?: object | false | null;
}

const encodingMethods: Record<Encoding, EncoderFactory> = {
    zstd: zlib.createZstdCompress,
    br: zlib.createBrotliCompress,
    gzip: zlib.createGzip,
    deflate: zlib.createDeflate,
};

type OneShot = (buf: Buffer | string, opts: any) => Promise<Buffer>;

function makeOneShot(fn: any): OneShot {
    return (buf, opts) => new Promise((resolve, reject) => {
        fn(buf, opts, (err: Error | null, result: Buffer) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

const oneShotEncoders: Record<Encoding, OneShot> = {
    zstd: makeOneShot(zlib.zstdCompress),
    br: makeOneShot(zlib.brotliCompress),
    gzip: makeOneShot(zlib.gzip),
    deflate: makeOneShot(zlib.deflate),
};

const defaultPreference: Encoding[] = ['zstd', 'br', 'gzip', 'deflate'];

const encoderDefaults: Record<Encoding, object> = {
    gzip: {},
    deflate: {},
    br: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
    zstd: {},
};

const NO_TRANSFORM_REGEX = /(?:^|,)\s*?no-transform\s*?(?:,|$)/;
const EMPTY_BODY_STATUSES = new Set([204, 205, 304]);
const COMPRESSIBLE_DEFAULT_RE = /^(?:text\/|application\/(?:json|xml|javascript|ld\+json|graphql|x-ndjson)\b|[^;]+\+(?:json|xml|text))/i;

function defaultFilter(type: string): boolean {
    return !!type && COMPRESSIBLE_DEFAULT_RE.test(type);
}

interface ParsedAccept {
    explicit: Record<string, number>;
    wildcard?: number;
}

function parseAcceptEncoding(header: string): ParsedAccept {
    const explicit: Record<string, number> = {};
    let wildcard: number | undefined;
    for (const part of header.split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const [rawName, ...params] = seg.split(';').map((s) => s.trim());
        const name = rawName.toLowerCase();
        let q = 1;
        for (const p of params) {
            const m = /^q\s*=\s*(.+)$/i.exec(p);
            if (m) {
                const v = parseFloat(m[1]);
                if (!isNaN(v)) q = Math.max(0, Math.min(1, v));
            }
        }
        if (name === '*') wildcard = q;
        else explicit[name] = q;
    }
    return { explicit, wildcard };
}

// RFC 9110 §8.4.1: "identity" is the no-transformation coding. It's the only place
// in this module where the literal matters — we read its q to decide whether the
// client strictly prefers no compression over the best compressible option.
const IDENTITY = 'identity';

function negotiateEncoding(
    header: string | undefined,
    available: Encoding[],
    preference: Encoding[],
): Encoding | undefined {
    if (!header) return undefined;

    const { explicit, wildcard } = parseAcceptEncoding(header);

    // RFC 9110: identity is implicitly acceptable unless excluded.
    const identityQ = explicit[IDENTITY] ?? wildcard ?? 1;

    let best: { enc: Encoding; q: number; prefIdx: number; } | undefined;
    for (const enc of available) {
        const q = explicit[enc] ?? wildcard;
        if (q === undefined || q === 0) continue;
        const prefIdx = preference.indexOf(enc);
        if (
            !best ||
            q > best.q ||
            (q === best.q && prefIdx !== -1 && (best.prefIdx === -1 || prefIdx < best.prefIdx))
        ) {
            best = { enc, q, prefIdx };
        }
    }

    // No compressible encoding acceptable, or client strictly prefers identity.
    if (!best || identityQ > best.q) return undefined;
    return best.enc;
}

export default function compress(options: CompressOptions = {}): Middleware {
    const filter = options.filter || defaultFilter;
    const preference = options.encodingPreference || defaultPreference;
    const threshold = options.threshold ?? 1024;

    const enabled = preference.filter((enc) => {
        const opt = (options as any)[enc];
        return opt !== false && opt !== null;
    });

    return async function compressMiddleware(ctx: Context, next: Next) {
        ctx.vary('Accept-Encoding');

        await next();

        const body = ctx.body;
        const type = ctx.response.type;
        const size = ctx.response.length;
        const forced = (ctx as any).compress;

        if (
            !body ||
            ctx.res.headersSent ||
            !ctx.writable ||
            forced === false ||
            ctx.request.method === 'HEAD' ||
            EMPTY_BODY_STATUSES.has(+ctx.response.status) ||
            ctx.response.get('Content-Encoding') ||
            !(forced === true || filter(type || '')) ||
            NO_TRANSFORM_REGEX.test(ctx.response.get('Cache-Control'))
        ) {
            return;
        }

        if (threshold && typeof size === 'number' && size < threshold) return;

        const encoding = negotiateEncoding(
            ctx.get('accept-encoding') as string | undefined,
            enabled,
            preference,
        );

        if (!encoding) {
            const cc = ctx.response.get('Cache-Control') || '';
            ctx.set('Cache-Control', cc ? `${cc}, no-transform` : 'no-transform');

            return;
        };

        const encoderOpts = { ...encoderDefaults[encoding], ...((options as any)[encoding] || {}) };
        const source = await normalizeBody(body);
        if (!source) return;

        if (source.kind === 'stream') {
            // Length unknown until the stream ends — chunked transfer.
            ctx.set('Content-Encoding', encoding);
            ctx.res.removeHeader('Content-Length');
            const stream = encodingMethods[encoding](encoderOpts);
            ctx.body = stream;
            source.value.pipe(stream);
            return;
        }

        if (!source.value.length) {
            // Don't bother compressing an empty body, and some encoders error on zero-length input.
            return;
        }

        // One-shot path: compress fully so we can emit an accurate Content-Length.
        const compressed = await oneShotEncoders[encoding](source.value, encoderOpts);
        ctx.set('Content-Encoding', encoding);
        if (source.size !== undefined) {
            // Only set Content-Length if we know the original size, to avoid misleading clients about compression ratio.
            ctx.set('X-Decompressed-Content-Length', source.size.toString());
        }
        const cc = ctx.response.get('Cache-Control') || '';
        ctx.set('Cache-Control', cc ? `${cc}, no-transform` : 'no-transform');
        ctx.body = compressed; // Koa's body setter writes Content-Length = compressed.length
    };
}

type NormalizedBody =
    | { kind: 'buffer'; value: Buffer | string; size?: number; }
    | { kind: 'stream'; value: Readable; };

const WebReadableStream: typeof globalThis.ReadableStream | undefined =
    (globalThis as any).ReadableStream;

async function normalizeBody(body: unknown): Promise<NormalizedBody | undefined> {
    if (body == null) return undefined;
    if (typeof body === 'string') return { kind: 'buffer', value: body, size: Buffer.byteLength(body) };
    if (Buffer.isBuffer(body)) return { kind: 'buffer', value: body, size: body.byteLength };
    if (body instanceof ArrayBuffer) return { kind: 'buffer', value: Buffer.from(body), size: body.byteLength };
    if (ArrayBuffer.isView(body)) {
        // Any TypedArray (Uint8/16/32, Int8/16/32, Float32/64, BigInt64/Uint64,
        // Uint8Clamped) or DataView. Buffer was matched above to avoid a copy.
        // Slice via byteOffset/byteLength so views over a larger buffer stay correct.
        return { kind: 'buffer', value: Buffer.from(body.buffer, body.byteOffset, body.byteLength), size: body.byteLength };
    }
    if (body instanceof Stream) return { kind: 'stream', value: body as Readable };
    // Web ReadableStream — must come before the Symbol.asyncIterator branch (it is one).
    if (WebReadableStream && body instanceof WebReadableStream) {
        return { kind: 'stream', value: Readable.fromWeb(body as any) };
    }

    if (body instanceof Blob) {
        const ab = await body.arrayBuffer();
        return { kind: 'buffer', value: Buffer.from(ab), size: ab.byteLength };
    }
    // Async iterables / iterators — must come after Stream and ReadableStream, both of
    // which also expose Symbol.asyncIterator.
    if (typeof (body as any)[Symbol.asyncIterator] === 'function') {
        return { kind: 'stream', value: Readable.from(body as AsyncIterable<unknown>) };
    }
    if (typeof body === 'object') {
        const json = Buffer.from(JSON.stringify(body));
        return { kind: 'buffer', value: json, size: json.byteLength };
    }
    return undefined;
}
