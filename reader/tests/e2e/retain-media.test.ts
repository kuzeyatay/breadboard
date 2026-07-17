/**
 * E2E tests for the `retainMedia` option (`x-retain-media` header).
 *
 * `retainMedia` controls how <video>, <audio>, and embedded video <iframe>
 * elements appear in markdown output. Modes: none | text | link | image | html.
 *
 * The `link` mode also respects `markdown.linkStyle` / `markdown.linkReferenceStyle`,
 * including full reference-style definitions emitted at the end of the document.
 *
 * Source resolution for video/audio: prefers `<source src>`, then first
 * candidate of `<source srcset>`, then `<source data-src>`; relative URLs
 * rebase against the page URL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAgent } from '../helpers/client';

async function crawlHtml(html: string, opts: Record<string, unknown> = {}) {
    return getAgent()
        .post('/')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send({ html, url: 'https://example.com/test', ...opts });
}

async function crawlHtmlWithHeaders(html: string, headers: Record<string, string>, opts: Record<string, unknown> = {}) {
    let req = getAgent()
        .post('/')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) {
        req = req.set(k, v);
    }
    return req.send({ html, url: 'https://example.com/test', ...opts });
}

const VIDEO_HTML = `<html><body>
    <p>Intro paragraph so readability keeps the article.</p>
    <video><source src="https://example.com/clip.mp4" type="video/mp4"></video>
    <p>Outro paragraph after the video.</p>
</body></html>`;

const AUDIO_HTML = `<html><body>
    <p>Intro paragraph so readability keeps the article.</p>
    <audio><source src="https://example.com/song.mp3" type="audio/mpeg"></audio>
    <p>Outro paragraph after the audio.</p>
</body></html>`;

const MIXED_HTML = `<html><body>
    <p>Intro paragraph.</p>
    <video><source src="https://example.com/v1.mp4"></video>
    <audio><source src="https://example.com/a1.mp3"></audio>
    <video><source src="https://example.com/v2.mp4"></video>
    <p>Outro paragraph.</p>
</body></html>`;

const YOUTUBE_HTML = `<html><body>
    <p>Watch this video.</p>
    <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>
    <p>End of page.</p>
</body></html>`;

// ── retainMedia: none ────────────────────────────────────────────────────────

describe('retainMedia: none', () => {
    it('removes <video> entirely', async () => {
        const res = await crawlHtml(VIDEO_HTML, { retainMedia: 'none', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.doesNotMatch(res.body.data.content, /clip\.mp4/);
        assert.doesNotMatch(res.body.data.content, /Video \d+/);
    });

    it('removes <audio> entirely', async () => {
        const res = await crawlHtml(AUDIO_HTML, { retainMedia: 'none', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.doesNotMatch(res.body.data.content, /song\.mp3/);
        assert.doesNotMatch(res.body.data.content, /Audio \d+/);
    });

    it('falls through to iframe fallback content for video iframes', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"><p>Captions here.</p></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'none', respondWith: 'markdown' });
        assert.doesNotMatch(res.body.data.content, /youtube\.com/);
        assert.doesNotMatch(res.body.data.content, /!\[Video/);
    });
});

// ── retainMedia: text ────────────────────────────────────────────────────────

describe('retainMedia: text', () => {
    it('replaces <video> with a bare "Video N" label', async () => {
        const res = await crawlHtml(VIDEO_HTML, { retainMedia: 'text', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Video \d+/);
        assert.doesNotMatch(res.body.data.content, /clip\.mp4/);
        assert.doesNotMatch(res.body.data.content, /\[Video/);
    });

    it('replaces <audio> with a bare "Audio N" label', async () => {
        const res = await crawlHtml(AUDIO_HTML, { retainMedia: 'text', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Audio \d+/);
        assert.doesNotMatch(res.body.data.content, /song\.mp3/);
    });

    it('replaces embedded video iframe with "Video N" label', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, { retainMedia: 'text', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Video \d+/);
        assert.doesNotMatch(res.body.data.content, /youtube\.com/);
    });
});

// ── retainMedia: link ────────────────────────────────────────────────────────

describe('retainMedia: link (inlined, default link style)', () => {
    it('is the default when retainMedia is not specified', async () => {
        const res = await crawlHtml(VIDEO_HTML, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /\[Video \d+\]\(https:\/\/example\.com\/clip\.mp4\)/);
    });

    it('renders <video> as a markdown link', async () => {
        const res = await crawlHtml(VIDEO_HTML, { retainMedia: 'link', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /\[Video \d+\]\(https:\/\/example\.com\/clip\.mp4\)/);
    });

    it('renders <audio> as a markdown link', async () => {
        const res = await crawlHtml(AUDIO_HTML, { retainMedia: 'link', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /\[Audio \d+\]\(https:\/\/example\.com\/song\.mp3\)/);
    });

    it('renders embedded video iframe as a markdown link to the canonical URL', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, { retainMedia: 'link', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ\)/);
    });
});

describe('retainMedia: link + linkStyle: discarded', () => {
    it('emits only the bare label for <video>', async () => {
        const res = await crawlHtml(VIDEO_HTML, {
            retainMedia: 'link',
            markdown: { linkStyle: 'discarded' },
            respondWith: 'markdown',
        });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Video \d+/);
        assert.doesNotMatch(res.body.data.content, /clip\.mp4/);
        assert.doesNotMatch(res.body.data.content, /\[Video/);
    });

    it('emits only the bare label for an embedded video iframe', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, {
            retainMedia: 'link',
            markdown: { linkStyle: 'discarded' },
            respondWith: 'markdown',
        });
        assert.match(res.body.data.content, /Video \d+/);
        assert.doesNotMatch(res.body.data.content, /youtube\.com/);
    });
});

describe('retainMedia: link + linkStyle: referenced', () => {
    it('full style: emits [Video N][id] in body and [id]: url in footer for <video>', async () => {
        const res = await crawlHtml(VIDEO_HTML, {
            retainMedia: 'link',
            markdown: { linkStyle: 'referenced', linkReferenceStyle: 'full' },
            respondWith: 'markdown',
        });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /\[Video \d+\]\[\d+\]/);
        assert.match(content, /\[\d+\]: https:\/\/example\.com\/clip\.mp4/);
    });

    it('collapsed style: emits [Video N][] in body and [Video N]: url in footer', async () => {
        const res = await crawlHtml(VIDEO_HTML, {
            retainMedia: 'link',
            markdown: { linkStyle: 'referenced', linkReferenceStyle: 'collapsed' },
            respondWith: 'markdown',
        });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /\[Video \d+\]\[\]/);
        assert.match(content, /\[Video \d+\]: https:\/\/example\.com\/clip\.mp4/);
    });

    it('shortcut style: emits [Video N] in body and [Video N]: url in footer', async () => {
        const res = await crawlHtml(VIDEO_HTML, {
            retainMedia: 'link',
            markdown: { linkStyle: 'referenced', linkReferenceStyle: 'shortcut' },
            respondWith: 'markdown',
        });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /\[Video \d+\]: https:\/\/example\.com\/clip\.mp4/);
    });

    it('full style: emits reference entry for embedded video iframe using canonical URL', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, {
            retainMedia: 'link',
            markdown: { linkStyle: 'referenced', linkReferenceStyle: 'full' },
            respondWith: 'markdown',
        });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /\[Video \d+\]\[\d+\]/);
        assert.match(content, /\[\d+\]: https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ/);
    });
});

// ── retainMedia: image ───────────────────────────────────────────────────────

describe('retainMedia: image', () => {
    it('renders <video> as a markdown image', async () => {
        const res = await crawlHtml(VIDEO_HTML, { retainMedia: 'image', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/example\.com\/clip\.mp4\)/);
    });

    it('renders <audio> as a markdown image', async () => {
        const res = await crawlHtml(AUDIO_HTML, { retainMedia: 'image', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /!\[Audio \d+\]\(https:\/\/example\.com\/song\.mp3\)/);
    });

    it('renders embedded video iframe as a markdown image using the canonical URL', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, { retainMedia: 'image', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ\)/);
    });
});

// ── retainMedia: html (default) ──────────────────────────────────────────────

describe('retainMedia: html', () => {
    it('renders <video> preserving its source child element', async () => {
        const res = await crawlHtml(VIDEO_HTML, { retainMedia: 'html', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /<video>/);
        assert.match(content, /<source src="https:\/\/example\.com\/clip\.mp4"/);
    });

    it('renders <audio> preserving its source child element', async () => {
        const res = await crawlHtml(AUDIO_HTML, { retainMedia: 'html', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /<audio>/);
        assert.match(content, /<source src="https:\/\/example\.com\/song\.mp3"/);
    });

    it('renders embedded video iframe using the original embed src (not canonical watch URL)', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, { retainMedia: 'html', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /<iframe [^>]*src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
        assert.doesNotMatch(content, /youtube\.com\/watch/);
    });

    it('strips class/id/style/data-*/aria-* from iframe but keeps functional attributes', async () => {
        const html = `<html><body><p>x</p>
            <iframe class="embed" id="yt" style="border:0" data-consent="1"
                    aria-label="video" frameborder="0" allowfullscreen
                    src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'html', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /<iframe/);
        assert.doesNotMatch(content, /class=/);
        assert.doesNotMatch(content, /\bid=/);
        assert.doesNotMatch(content, /style=/);
        assert.doesNotMatch(content, /data-consent/);
        assert.doesNotMatch(content, /aria-label/);
        assert.match(content, /allowfullscreen/);
        assert.match(content, /frameborder/);
    });

    it('renders <video> preserving its original attributes minus class/id/style/data-*/aria-*', async () => {
        const html = `<html><body>
            <p>x</p>
            <video class="player" data-tracking="1" autoplay muted loop>
                <source src="https://example.com/clip.mp4" type="video/mp4">
            </video>
            <p>y</p>
        </body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'html', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /<video/);
        assert.doesNotMatch(content, /class=/);
        assert.doesNotMatch(content, /data-tracking/);
        assert.match(content, /autoplay/);
        assert.match(content, /muted/);
        assert.match(content, /loop/);
    });
});

// ── x-retain-media header ────────────────────────────────────────────────────

describe('x-retain-media header', () => {
    it('none suppresses video', async () => {
        const res = await crawlHtmlWithHeaders(VIDEO_HTML, { 'X-Retain-Media': 'none' }, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.doesNotMatch(res.body.data.content, /clip\.mp4/);
    });

    it('text produces bare label', async () => {
        const res = await crawlHtmlWithHeaders(VIDEO_HTML, { 'X-Retain-Media': 'text' }, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Video \d+/);
        assert.doesNotMatch(res.body.data.content, /clip\.mp4/);
    });

    it('link produces markdown link', async () => {
        const res = await crawlHtmlWithHeaders(VIDEO_HTML, { 'X-Retain-Media': 'link' }, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /\[Video \d+\]\(https:\/\/example\.com\/clip\.mp4\)/);
    });

    it('image produces markdown image', async () => {
        const res = await crawlHtmlWithHeaders(VIDEO_HTML, { 'X-Retain-Media': 'image' }, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/example\.com\/clip\.mp4\)/);
    });

    it('html produces html element', async () => {
        const res = await crawlHtmlWithHeaders(VIDEO_HTML, { 'X-Retain-Media': 'html' }, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /<video/);
        assert.match(res.body.data.content, /clip\.mp4/);
    });

    it('invalid value is ignored and default link is used', async () => {
        const res = await crawlHtmlWithHeaders(VIDEO_HTML, { 'X-Retain-Media': 'bogus' }, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /\[Video \d+\]\(https:\/\/example\.com\/clip\.mp4\)/);
    });
});

// ── source resolution ────────────────────────────────────────────────────────

describe('media source resolution', () => {
    it('uses <source src> when present', async () => {
        const html = `<html><body><p>x</p>
            <video><source src="https://cdn.example.com/a.mp4"></video>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /\(https:\/\/cdn\.example\.com\/a\.mp4\)/);
    });

    it('falls back to the first <source srcset> candidate when src is absent', async () => {
        const html = `<html><body><p>x</p>
            <video><source srcset="https://cdn.example.com/hi.mp4 2x, https://cdn.example.com/lo.mp4 1x"></video>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /\(https:\/\/cdn\.example\.com\/hi\.mp4/);
    });

    it('falls back to <source data-src> when neither src nor srcset is present', async () => {
        const html = `<html><body><p>x</p>
            <video><source data-src="https://cdn.example.com/lazy.mp4"></video>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /\(https:\/\/cdn\.example\.com\/lazy\.mp4\)/);
    });

    it('rebases relative source URLs against the page URL', async () => {
        const html = `<html><body><p>x</p>
            <video><source src="/media/relative.mp4"></video>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, {
            url: 'https://example.com/articles/123',
            retainMedia: 'image',
            respondWith: 'markdown',
        });
        assert.match(res.body.data.content, /\(https:\/\/example\.com\/media\/relative\.mp4\)/);
    });
});

// ── embedded video iframes ───────────────────────────────────────────────────

describe('embedded video iframes: platform detection', () => {
    it('rewrites a YouTube embed iframe to the canonical watch URL (image mode)', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, { retainMedia: 'image', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ\)/);
    });

    it('handles youtube-nocookie.com embeds', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="https://www.youtube-nocookie.com/embed/abcDEF12345"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=abcDEF12345\)/);
    });

    it('rewrites a Bilibili player iframe to the canonical BV URL', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1&autoplay=0"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { url: 'https://example.com/articles/1', retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD\)/);
    });

    it('preserves a Bilibili iframe that lacks bvid (legacy aid form)', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="https://player.bilibili.com/player.html?aid=12345&page=1"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/player\.bilibili\.com\/player\.html\?aid=12345/);
    });

    it('normalizes Vimeo player iframes to vimeo.com/<id>', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="https://player.vimeo.com/video/76979871"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/vimeo\.com\/76979871\)/);
    });

    it('normalizes Dailymotion embed iframes', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="https://www.dailymotion.com/embed/video/x7tgcdz"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.dailymotion\.com\/video\/x7tgcdz\)/);
    });

    it('drops non-video iframes that have no inner content', async () => {
        const html = `<html><body><p>before</p>
            <iframe src="https://example.com/ads/banner.html"></iframe>
            <p>after</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        const content: string = res.body.data.content;
        assert.doesNotMatch(content, /!\[Video/);
        assert.doesNotMatch(content, /ads\/banner/);
        assert.match(content, /before/);
        assert.match(content, /after/);
    });

    it('exposes fallback content inside a non-video iframe as-is', async () => {
        const html = `<html><body><p>before</p>
            <iframe src="https://example.com/widget.html"><p>Your browser does not support iframes.</p></iframe>
            <p>after</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        const content: string = res.body.data.content;
        assert.doesNotMatch(content, /!\[Video/);
        assert.match(content, /before\n\nYour browser does not support iframes\.\n\nafter/);
    });

    it('a video iframe emits the video link and drops the fallback content', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"><p>Captions: Hello world</p></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        const content: string = res.body.data.content;
        assert.match(content, /!\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ\)/);
        assert.doesNotMatch(content, /Captions: Hello world/);
    });

    it('falls back to iframe[href] when src is absent', async () => {
        const html = `<html><body><p>x</p>
            <iframe href="https://www.youtube.com/embed/hrefOnly123"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=hrefOnly123\)/);
    });

    it('prefers iframe[src] over iframe[href] when both are present', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="https://www.youtube.com/embed/fromSrc" href="https://www.youtube.com/embed/fromHref"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=fromSrc\)/);
        assert.doesNotMatch(res.body.data.content, /fromHref/);
    });

    it('accepts protocol-relative YouTube embeds (//www.youtube.com/embed/...)', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="//www.youtube.com/embed/protoRelative1"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/www\.youtube\.com\/watch\?v=protoRelative1\)/);
    });

    it('accepts protocol-relative Twitch player embeds', async () => {
        const html = `<html><body><p>x</p>
            <iframe src="//player.twitch.tv/?channel=somechannel&parent=example.com"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        assert.match(res.body.data.content, /!\[Video \d+\]\(https:\/\/player\.twitch\.tv\/\?channel=somechannel/);
    });

    it('html mode uses the original embed src, not the canonical watch URL', async () => {
        const res = await crawlHtml(YOUTUBE_HTML, { retainMedia: 'html', respondWith: 'markdown' });
        const content: string = res.body.data.content;
        assert.match(content, /<iframe [^>]*src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
        assert.doesNotMatch(content, /youtube\.com\/watch/);
    });
});

// ── counter sharing and sequential indices ───────────────────────────────────

describe('counter sharing and sequential indices', () => {
    it('iframe video and <video> share the video counter', async () => {
        const html = `<html><body><p>x</p>
            <video><source src="https://example.com/a.mp4"></video>
            <iframe src="https://www.youtube.com/embed/abc12345DEF"></iframe>
            <p>y</p></body></html>`;
        const res = await crawlHtml(html, { retainMedia: 'image', respondWith: 'markdown' });
        const content: string = res.body.data.content;
        assert.match(content, /!\[Video 1\]\(https:\/\/example\.com\/a\.mp4\)/);
        assert.match(content, /!\[Video 2\]\(https:\/\/www\.youtube\.com\/watch\?v=abc12345DEF\)/);
    });

    it('two videos and one audio interleave their own counters', async () => {
        const res = await crawlHtml(MIXED_HTML, { retainMedia: 'image', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /!\[Video 1\]\(https:\/\/example\.com\/v1\.mp4\)/);
        assert.match(content, /!\[Audio 1\]\(https:\/\/example\.com\/a1\.mp3\)/);
        assert.match(content, /!\[Video 2\]\(https:\/\/example\.com\/v2\.mp4\)/);
    });
});
