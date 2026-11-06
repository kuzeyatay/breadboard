type NativeResponse = { status: number; body: string };
const requestType = "second-brain:text-highlight-request";
const responseType = "second-brain:text-highlight-response";

function desktopTransport() {
  return (window as unknown as { breadboardDesktop?: {
    textHighlightRequest?: (body: string) => Promise<NativeResponse>;
  } }).breadboardDesktop?.textHighlightRequest;
}

/** Relay only the mounted, trusted Quartz reader to the app's save transport. */
export function installTextHighlightBridge(frame: () => Window | null | undefined, origin: string) {
  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (!origin || event.origin !== origin || event.source !== frame() || data?.type !== requestType ||
        typeof data.requestId !== "string" || data.requestId.length > 128 || typeof data.body !== "string" ||
        new TextEncoder().encode(data.body).length > 8 * 1024 * 1024) return;
    const source = event.source as Window;
    const reply = (body: object) => source.postMessage({ ...body, type: responseType, requestId: data.requestId }, origin);
    const transport = desktopTransport();
    reply({ available: Boolean(transport) });
    if (transport) void transport(data.body).then(
      result => reply({ result }),
      () => reply({ error: "Highlight save failed." }),
    );
  };
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}

function viaParent(origin: string, body: string): Promise<NativeResponse | null> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: NativeResponse | null, error?: string) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (error) reject(new Error(error)); else resolve(result);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window.parent || event.origin !== origin || data?.type !== responseType || data.requestId !== requestId) return;
      if (data.available === false) finish(null);
      else if (data.available === true) {
        clearTimeout(timer);
        timer = setTimeout(() => finish(null, "Highlight save timed out."), 20_000);
      } else if (data.result) finish(data.result);
      else if (data.error) finish(null, "Highlight save failed.");
    };
    // Older desktop shells and ordinary browsers keep the authenticated HTTP path.
    timer = setTimeout(() => finish(null), 500);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: requestType, requestId, body }, origin);
  });
}

export async function requestTextHighlightSync(endpoint: string, body: string, priority: "high" | "low") {
  const target = new URL(endpoint, window.location.href);
  let native: NativeResponse | null = null;
  if (target.pathname === "/api/text-highlights" && !target.search) {
    const transport = desktopTransport();
    if (target.origin === window.location.origin && transport) native = await transport(body);
    else if (window.parent !== window && target.origin !== window.location.origin) native = await viaParent(target.origin, body);
  }
  if (native) return new Response(native.body, { status: native.status, headers: { "Content-Type": "application/json" } });
  return fetch(endpoint, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body, priority,
    keepalive: new TextEncoder().encode(body).length < 60_000, signal: AbortSignal.timeout(15_000),
  });
}
