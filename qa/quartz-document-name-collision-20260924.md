# Quartz document/garden name collision

The Circuits source note exists at `circuits/sources/circuits.md` with the title
`Circuits.pdf`. Its content was intact; the failure happened before reading it.

The old document APIs searched for the garden name anywhere in a path and
discarded everything through that segment. For `sources/circuits`, that removed
the document basename and produced an empty path. A bare `circuits` identifier
also disappeared. The document API normalized identifiers twice, so even some
fully qualified paths could fail on the second pass.

There were independent copies in document CRUD, markdown edits, media uploads,
PDF reads, and PDF history. The PDF read route had a partial fix for bare slugs,
but still rejected a nested path ending with the garden name. Both garden hosts
also classified bare same-name documents as garden roots.

## Changes

- `dashboard/src/lib/garden-document-path.ts` now owns prefix removal, URL/query
  parsing, decoding, and reserved/invalid path checks. Only leading route
  prefixes are removed; a bare name and interior folders remain valid.
- The document, media, PDF, history, and markdown-edit APIs use that shared code.
- Both garden hosts recognize a document whose basename matches its garden.
- Source files, publication paths, and user content did not need renaming.

## Verification

37 targeted tests pass, including an actual headless-browser reader with the
real document API and Quartz renderer. They cover Circuits.pdf in Sources and
at the garden root, both canonical page transports, encoded paths, read/edit/
delete behavior, PDF/history identities, invalid paths, and existing reader and
media behavior. The new path module also passes a strict TypeScript check.

Command (from `dashboard`):

```powershell
node --test --test-concurrency=1 tests/garden-document-path.test.mjs tests/garden-video-embed.test.mjs tests/quartz-document-api.test.mjs tests/markdown-edit-route.test.mjs tests/source-pdf-response.test.mjs tests/quartz-same-name-document-browser.test.mjs tests/quartz-reader-shell-browser.test.mjs
```

## Activation

The running desktop uses the precompiled `.next-desktop/standalone/server.js`.
It does not reload these source changes. A learning worker was active during
verification, so a rebuild/restart is awaiting the user's timing decision.
