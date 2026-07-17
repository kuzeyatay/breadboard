# Reader Cookbooks

Recipes for shaping Reader's output to fit a specific downstream pipeline. The default output ("drop into an LLM and read") is fine for ad-hoc use; the recipes below trade defaults for token efficiency, latency, or compatibility with a specific consumer.

For the full list of headers and body fields these recipes pull from, see the [Using request headers](./README.md#using-request-headers) section of the README.

## Contents

- [Reader Cookbooks](#reader-cookbooks)
  - [Contents](#contents)
  - [Using presets](#using-presets)
  - [RAG inference (the user will see what the LLM sees)](#rag-inference-the-user-will-see-what-the-llm-sees)
  - [Semantic indexing (build embeddings; URLs are noise)](#semantic-indexing-build-embeddings-urls-are-noise)
  - [Deep research (long-context model needs URLs, but only once)](#deep-research-long-context-model-needs-urls-but-only-once)
  - [Visual snapshot / pageshot for multimodal reasoning](#visual-snapshot--pageshot-for-multimodal-reasoning)
  - [Scrape a known template (article body only)](#scrape-a-known-template-article-body-only)
  - [Inject a page script (click-to-reveal content)](#inject-a-page-script-click-to-reveal-content)
  - [Iframes and shadow DOM](#iframes-and-shadow-dom)
  - [Geo- and locale-sensitive scraping](#geo--and-locale-sensitive-scraping)
  - [PDF, MS Office, and raw HTML uploads](#pdf-ms-office-and-raw-html-uploads)
    - [PDF and Office files](#pdf-and-office-files)
    - [Raw HTML](#raw-html)

## Using presets

`x-preset` is a one-header shortcut that bundles the options from the manual recipes below. Preset values only kick in for options the caller hasn't set explicitly — you can always override a single field.

| Preset | Best for | Key settings |
|---|---|---|
| `reader` | Displaying to humans | `respondWith: frontmatter`, `retainMedia: html`, `detachInvisibles`, `removeOverlay` |
| `index` | Embedding / vector stores | `retainLinks: text`, `retainImages: alt`, `retainMedia: none`, `markdownChunking: s3` |
| `research` | AI research agents | `respondWith: markdown+frontmatter`, `markdownChunking: h3`, all links/images/media |
| `agent` | Day-to-day AI agents | `respondWith: frontmatter`, `markdownChunking: h3`, `retainImages: alt` |
| `spider` | Recursive site crawling | `respondWith: markdown+frontmatter`, `markdownChunking: h3`, `withLinksSummary: all` |

```bash
# Semantic indexing with one header — equivalent to the manual recipe below
curl https://r.jina.ai/https://example.com/article \
  -H 'x-preset: index'

# Override a single field (keep URLs even though the preset drops them)
curl https://r.jina.ai/https://example.com/article \
  -H 'x-preset: index' \
  -H 'x-retain-links: all'
```

## RAG inference (the user will see what the LLM sees)

The chat model needs to *cite* the source: image URLs render as inline images in the answer, link URLs become clickable references. Just use the default — no tuning needed.

```bash
curl https://r.jina.ai/https://example.com/article
```

Reader's defaults (`x-retain-images: all`, `x-retain-links: all`, `readability` filtering on) already produce the shape a chat model wants. Add `x-with-generated-alt: true` only if you need VLM captions for images that lack alt text.

## Semantic indexing (build embeddings; URLs are noise)

For chunk → embed → vector store, URLs are pure overhead — they bloat tokens and can pull semantically similar chunks apart by their slugs. Keep the readable text, drop the addresses, and chunk in one shot.

```bash
curl https://r.jina.ai/https://example.com/article \
  -H 'Accept: application/json' \
  -H 'x-retain-links: text' \
  -H 'x-retain-images: alt' \
  -H 'x-markdown-chunking: h3'
```

Anchor text and alt text are kept (they carry meaning); URLs are dropped. JSON + `x-markdown-chunking: h3` splits at `#`, `##`, and `###` — typically one chunk per subsection, which lines up well with embedding window sizes. Use `h2` for coarser chunks if the source has dense headings.

If headings are sparse or unreliable, switch to the structured (`s1` … `s5`) family — block-level splits that don't depend on heading discipline. `s3` is a reasonable starting point; `s2` is coarser, `s4` / `s5` are finer.

**Preset shortcut:** `x-preset: index` applies the same combination (with `s3` chunking).

## Deep research (long-context model needs URLs, but only once)

Deep-research / agentic models cite URLs but choke if every link reference appears inline a dozen times. They also rarely need image URLs — captions are enough. Move the URLs into a single canonical footer and keep only anchor text inline.

```bash
curl https://r.jina.ai/https://example.com/article \
  -H 'x-retain-links: text' \
  -H 'x-with-links-summary: true' \
  -H 'x-retain-images: alt'
```

The model reads the article with clean anchor text inline, then consults the deduplicated link footer when it needs to attribute or fetch a source. For gpt-oss-style citation tokens (`【1†...】`) instead of plain anchor text, swap `x-retain-links: text` for `x-retain-links: gpt-oss` — it auto-enables the summary footer for you.

**Preset shortcut:** `x-preset: research` applies a similar setup (keeps all links inline with URLs and chunks at `h3`). Use `x-preset: spider` if you also want the full link inventory collected for further crawling.

## Visual snapshot / pageshot for multimodal reasoning

Capture the full rendered page — overlays gone, lazy-loaded media settled — for visual QA, archival, or feeding a multimodal model that prefers pixels over markdown.

```bash
curl https://r.jina.ai/https://example.com/article \
  -H 'x-respond-with: pageshot' \
  -H 'x-remove-overlay: true' \
  -H 'x-timeout: 30'
```

`pageshot` captures the entire scrollable page (use `screenshot` for the viewport only). Reader automatically picks `media-idle` timing for shot/vlm requests, so images and fonts will be painted before the snapshot is taken. `x-remove-overlay: true` strips cookie banners and modal dialogs that would otherwise dominate the snapshot. The 30-second timeout bounds a misbehaving page without giving up too early.

## Scrape a known template (article body only)

When you control the source — a specific blog, docs site, or product catalog — you already know the DOM shape. Skip Reader's heuristics and target the element directly.

```bash
curl https://r.jina.ai/https://example.com/blog/post-slug \
  -H 'x-target-selector: article.post-body' \
  -H 'x-remove-selector: nav, .related-posts, .comments, footer'
```

`x-target-selector` doubles as a `wait-for-selector` — Reader won't return until the element appears, so this is also a guard against partial renders. `x-remove-selector` strips the navigation chrome and templated noise that repeats on every page of the same site.

## Inject a page script (click-to-reveal content)

Some pages hide the content you want behind a click — "Show transcript", "Read more", "Load comments". The `injectPageScript` body field runs JavaScript in the page on every navigation. Reader exposes a `window.waitForSelector(selector)` helper that resolves to the element once it appears, so the script reduces to one line.

YouTube's transcript is the canonical example. Wait for the transcript toggle, click it:

```bash
curl -F 'url=https://www.youtube.com/watch?v=dQw4w9WgXcQ' \
     -F "injectPageScript=waitForSelector('ytd-video-description-transcript-section-renderer button').then((el) => el.click())" \
     -H 'Accept: application/json' \
     https://r.jina.ai/
```

After the click, Reader's own page-settle logic takes over — the headless browser dispatches a `mutationIdle` event on `document` whenever the `MutationObserver` has seen no DOM changes for 200ms, and Reader waits for that signal before extracting. So you don't need to chain anything onto the click; the transcript content will be in the DOM by the time Reader serializes the page.

A few notes:

- `injectPageScript` accepts an array — repeat the `-F` flag for multiple steps; each runs as a separate `frame.evaluate(...)` in order.
- Injecting a script disables Reader's early-return optimization, so set a sensible `x-timeout` if the click triggers slow async work.
- For content inside iframes (Twitter embeds, etc.), use `injectFrameScript` — same shape, runs in every frame rather than just the main one.

## Iframes and shadow DOM

By default Reader serializes only the main document. Iframe contents live in their own document, and shadow roots are separate node trees — neither is technically part of the page being serialized, so they're skipped. That's the right default for most articles, but it loses content on:

- Pages that embed real content via iframe (CodeSandbox / JSFiddle examples in docs, Notion / Airtable embeds, Twitter / YouTube cards inside articles).
- Modern component-heavy sites built on web components (Stencil, Lit, many design-system docs) where the actual text lives inside shadow roots.

Pull both into the main document for extraction:

```bash
curl 'https://r.jina.ai/https://example.com/docs-page' \
  -H 'x-with-iframe: true' \
  -H 'x-with-shadow-dom: true'
```

Use `x-with-iframe: quoted` instead of `true` to wrap iframe contents in a markdown blockquote — useful when you want the model to know "this came from an embed" rather than treat it as inline body copy.

A few notes:

- Both options violate the standard same-origin / encapsulation boundaries, so use them deliberately. They make the output longer and the request slower.
- Turning on either option forces `network-idle` timing — Reader waits for every iframe and resource to fully load. Combine with `x-timeout` (max 180s) to bound the wait.
- These flags are about *extraction*. If you only need to *interact* with a frame (click a button inside an iframe), reach for `injectFrameScript` instead — see the previous cookbook.

## Geo- and locale-sensitive scraping

Pricing pages, restricted content, and regional search results all change based on where the request appears to come from. Pin geography and language explicitly.

```bash
curl https://r.jina.ai/https://shop.example.com/product/123 \
  -H 'x-proxy: de' \
  -H 'x-locale: de-DE' \
  -H 'x-set-cookie: country=DE; Path=/'
```

`x-proxy: de` exits through a German residential IP. `x-locale: de-DE` sets `navigator.language` and `Accept-Language` for the headless browser. `x-set-cookie` handles the third common gating mechanism — sites that override geo via a cookie. Note: any request with `x-set-cookie` skips the cache, so don't pair this with cache-warming pipelines.

Note: this requires a premium key.

## PDF, MS Office, and raw HTML uploads

Reader can ingest content you already have on hand — PDF, Word, Excel, PowerPoint, or raw HTML — no need to host it first. The same options that apply to web pages (`x-retain-images`, `x-markdown-chunking`, `Accept: application/json`) work on uploads too.

### PDF and Office files

Use the `file` body field — Reader sniffs the MIME type from the bytes, so the same field accepts `.pdf`, `.docx`, `.xlsx`, and `.pptx`. **Multipart** is the right default; it streams and avoids base64 overhead:

```bash
curl -X POST 'https://r.jina.ai/' \
  -F 'file=@./report.pdf' \
  -H 'Accept: application/json' \
  -H 'x-markdown-chunking: s3'
```

**Selecting a single PDF page.** PDFs are returned as one document by default. To get one page, append `#N` (1-indexed) to the optional `url` field:

```bash
curl -X POST 'https://r.jina.ai/' \
  -F 'file=@./long-report.pdf' \
  -F 'page=7' \
  -H 'Accept: application/json'
```

Subsequent page requests reuse the cached parse, so paging through a long document is cheap after the first call.

Notes:

- File requests are cached by sha256 of the bytes — re-uploading the same file is a hit.
- Office files round-trip through LibreOffice. If fidelity matters (complex Excel layouts, custom slide masters), export to PDF on your side first and upload that.

### Raw HTML

Send HTML you already have via the `html` body field — Reader skips the fetcher and runs the same conversion pipeline:

```bash
curl -X POST 'https://r.jina.ai/' \
  -H 'Content-Type: application/json' \
  -d '{"html": "<html>...</html>", "url": "https://example.com/source"}'
```

`url` is optional but recommended whenever the HTML contains relative links or images — Reader uses it as the base for resolving them.
