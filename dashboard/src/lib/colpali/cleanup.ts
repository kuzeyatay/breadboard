// Dropping a document's vectors when the document goes.
//
// Its own module, and this small, for one reason: `document-blob-store.ts` is
// imported by the composer-safe and synchronous parts of the attachment
// pipeline, and `service.ts` pulls in the config module and `fetch`. A direct
// import would drag the whole ColPali client into every caller that only wanted
// to store a file.

/**
 * Ask the service to forget a document, without waiting and without failing.
 *
 * A delete must not depend on a sidecar being up. If the service is down the
 * vectors are simply orphaned — unreachable, since nothing can ask about a blob
 * that no longer exists — and the next `npm run setup:colpali` or a manual
 * sweep of the index directory reclaims the space.
 */
export function forgetColpaliIndex(blobId: string): void {
  void (async () => {
    try {
      const { colpaliForget } = await import("./service.ts");
      await colpaliForget(blobId);
    } catch {
      // Nothing to do and nothing to report: the document is already gone.
    }
  })();
}
