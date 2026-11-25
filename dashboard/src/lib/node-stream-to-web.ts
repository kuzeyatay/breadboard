import type { Readable } from "node:stream";

/**
 * A pull-based replacement for `Readable.toWeb()` for response bodies.
 *
 * Node's adapter pushes every `data` event into the web stream's controller.
 * When a client goes away mid-response (a browser abandoning a video range
 * request, a closed tab), the web stream closes while the file stream is still
 * flowing, and the next push throws `ERR_INVALID_STATE: Controller is already
 * closed` as an *uncaught* exception — 66 of them in one dashboard log. Here
 * the file is read only when the consumer asks for more, and cancelling
 * destroys the file stream, so nothing is ever written to a closed controller.
 */
export function nodeStreamToWeb(stream: Readable): ReadableStream<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (!stream.destroyed) stream.destroy();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (finished) return;
        if (done) {
          finished = true;
          controller.close();
          return;
        }
        const chunk = typeof value === "string" ? Buffer.from(value) : value;
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } catch (error) {
        if (finished) return;
        finish();
        controller.error(error);
      }
    },
    cancel() {
      finish();
      // Settle the iterator so its listeners are released; a destroyed stream
      // may reject here, which is expected once the reader has gone.
      void iterator.return?.().catch(() => undefined);
    },
  }, { highWaterMark: 0 });
}
