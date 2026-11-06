/** Initial widget reads cannot queue behind other tabs' long-lived streams. */
export async function readTerminalData(path: string, signal?: AbortSignal): Promise<Response> {
  const desktop = (window as unknown as { breadboardDesktop?: {
    readTerminalData?: (id: string, path: string) => Promise<{ status: number; body: string }>;
    cancelTerminalData?: (id: string) => void;
  } }).breadboardDesktop;
  signal?.throwIfAborted();
  if (!desktop?.readTerminalData || !desktop.cancelTerminalData) return fetch(path, { cache: "no-store", signal });
  const id = crypto.randomUUID();
  return new Promise<Response>((resolve, reject) => {
    const abort = () => { desktop.cancelTerminalData!(id); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
    desktop.readTerminalData!(id, path).then(result => {
      if (!signal?.aborted) resolve(new Response([204, 205, 304].includes(result.status) ? null : result.body,
        { status: result.status, headers: { "Content-Type": "application/json" } }));
    }).catch(reject).finally(() => signal?.removeEventListener("abort", abort));
  });
}
