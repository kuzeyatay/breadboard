# Architecture

## Introduction
Jina Reader is an API-first SaaS application that turns URLs of web pages, PDFs, and other documents into markdown or images. It's built to help developers prepare data context for LLMs — now widely known as context engineering.

## Application Architecture
Jina Reader is a multi-threaded Node.js application.

- Web pages are rendered using a headless Chrome browser, with text content extracted via a stack of techniques (see [HTML to Markdown profiles](#multiple-html-to-markdown-profiles)).
- PDF parsing and rendering are done using PDF.js.
- MS Office documents are processed using LibreOffice.

## Stateless Core Features

### URL to Markdown / Image
Given a URL, Jina Reader fetches the content and renders it using headless Chrome if it's a web page (HTML/xHTML). If the content is a PDF, it uses PDF.js to parse and render. For MS Office documents, LibreOffice converts them to PDF + HTML first, after which the PDF/HTML path takes over.

Advanced options let you filter or manipulate the page content — CSS-selector-based filtering, custom JavaScript execution, custom proxy routing, and more.

### HTML to Markdown
Reader can also take raw HTML and convert it to markdown, using the same conversion pipeline as the URL-to-Markdown feature.

### PDF to Markdown / Image
Reader can take a PDF file, extract text content as markdown, and render each page as an image.

### MS Office to Markdown / Image
Reader can take MS Office documents (Word, Excel, PowerPoint) and convert them to markdown or images by first converting them to PDF/HTML using LibreOffice.

### Image to Text
Reader can take an image and produce a text description (captioning). This is built on the `jina-vlm` small vision-language model and can be extended to VQA tasks. Note: this is not exactly OCR.

## Multiple URL-to-HTML Engines
Reader supports several engines for fetching/rendering web pages to HTML.

### Browser
The most-used engine. The current implementation runs latest headless Chrome via the `puppeteer` library. It provides the most accurate rendering and can execute JavaScript on the page, which is essential for modern web pages.

### CURL
A lightweight engine that uses `curl-impersonate` to fetch the raw HTML of a web page. It does not execute JavaScript. Reader's implementation includes a simulated cookie layer to handle basic cookie-based redirection.

### CF-Browser-Rendering
Uses Cloudflare's Browser Rendering REST API for URL-to-HTML. Strict rate limits apply; this engine is meant for testing and as a fallback.

### Auto
The default. Reader intelligently uses the CURL and Browser engines in combination, based on content characteristics and request requirements.

## Multiple HTML-to-Markdown Profiles
Reader supports several profiles for converting HTML to markdown.

### `@mozilla/readability`
Readability is automatically used to clean HTML before converting to markdown. It produces a clean, readable version of the HTML content for many pages.

### Rule-based engine
A custom implementation inspired by the `turndown` library, with custom rules and plugins to convert HTML into markdown.

### ReaderLM v2
An experimental engine that uses a specifically trained small language model to convert HTML to markdown.

### ReaderLM v3 / JinaOCR / VLM
WIP / future engine that uses a vision-language model to convert webpage screenshots directly to markdown.

## Abuse Mitigation (SaaS)
- **Request filtering**: block requests targeting suspicious addresses.
- **Request throttling**: cap concurrent requests per page.
- **Anonymous-user pressure relief**: when one URL receives excessive anonymous traffic, temporarily block that website for anonymous users.
- **Excessive HTML nodes/depth**: fall back to HTML-to-text instead of markdown.

## Progressive Clustering
- **Stage 0**: fully stateless — no caching, no rate limit, no persistence.
- **Stage 1**: S3-like object storage for caching, no rate limit.
- **Stage 2**: MongoDB + S3-like object storage. MongoDB indexes the cached objects; rate limiting is available. This is the SaaS configuration and is not part of the open source branch.

## Vendor-Provided Features
- **Proxy**: Reader supports a built-in proxy provider for fetching content via a different IP.
- **SERP**: Reader primarily relies on external SERP providers for web search results.
- **VLM**: Reader relies on a vision-language model for image captioning. The current model is `gemini-2.5-flash-lite`, but it can be switched to any model with similar capabilities.

## Deployment Architecture
The SaaS version of Jina Reader is deployed as a Docker image on GCP Cloud Run. MongoDB Atlas is used for metadata indexing and rate limiting; Google Cloud Storage is used for cache data. Internal services and dependencies — such as billing, `jina-vlm`, and `readerlm-v2` — are reached over a private VPC peering link.

We run two independent clusters: **US** and **EU**. The US cluster spans 3 regions (`us-central1`, `us-east1`, `us-west1`); the EU cluster runs in 1 region (`europe-west1`).

Due to the high resource requirements of headless Chrome and LibreOffice, Reader is best deployed on serverless platforms that handle auto-scaling and resource management.
