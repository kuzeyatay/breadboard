This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## URL Sources With Jina Reader

Breadboard's existing Links panel imports pasted URLs as source documents. The dashboard calls Jina Reader directly, converts the page to faithful Markdown, writes the result under the garden's `sources/` folder, and then runs the same source ingestion/indexing path used by uploaded Markdown files. ChatMock is not used to scrape or summarize the URL before storage.

Start the local Reader service from the cloned `reader/` repo:

```bash
cd ../reader
npm install
PORT=8082 npm run serve
```

Configure the dashboard:

```env
READER_PROVIDER=jina-reader-local
READER_BASE_URL=http://127.0.0.1:8082
READER_TIMEOUT_MS=60000
READER_ALLOW_REMOTE_FALLBACK=false
READER_REMOTE_BASE_URL=https://r.jina.ai
```

Reader's local crawl server exposes the same URL shape as hosted Reader: `READER_BASE_URL/https://example.com/article`. Breadboard requests `X-Respond-With: frontmatter`, keeps Reader's Markdown body as the source material, and stores Breadboard metadata such as `source_type: url`, `original_url`, `canonical_url`, `fetched_at`, `converter`, and `content_hash` in the source frontmatter.

Known limitations: JavaScript-heavy pages can still time out, paywalled/login-only pages may not be readable, robots or site blocking can prevent conversion, and remote fallback may be rate-limited. If local Reader is not running, the Links panel will show a clear error asking you to start Reader or update `READER_BASE_URL`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
