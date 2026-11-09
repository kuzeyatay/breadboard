import { validateSpotifyRequest, type SpotifyRequest, type SpotifyResponse } from "./spotify-control";

type Hold = { viewId: string; pending?: Promise<SpotifyResponse>; timer?: ReturnType<typeof setTimeout>; stopped: boolean };
const unavailable = (): SpotifyResponse => ({status:503,body:JSON.stringify({message:"The Spotify player view is closed."})});

/** One tab owns these holds. Node timers continue when Chromium throttles or
 * freezes the hidden renderer; navigation/destruction releases every hold. */
export class SpotifyViewLeases {
  private readonly holds = new Map<string, Hold>();
  private closed = false;
  constructor(private readonly send: (request: SpotifyRequest) => Promise<SpotifyResponse>) {}

  request(request: unknown): Promise<SpotifyResponse> {
    validateSpotifyRequest(request);
    if (this.closed) return Promise.resolve(unavailable());
    if (request.resource !== "engine" || request.method === "GET") return this.send(request);
    const viewId = request.body!.viewId as string;
    if (request.method === "DELETE") return this.release(viewId);
    let hold = this.holds.get(viewId);
    if (!hold) {
      if (this.holds.size >= 8) return Promise.resolve({status:429,body:JSON.stringify({message:"Too many active Spotify players."})});
      hold = {viewId,stopped:false};
      this.holds.set(viewId,hold);
    }
    return this.renew(hold);
  }

  /** Start renewing a hold unless one is already running; its timer keeps it alive. */
  ensureHold(viewId: string): void {
    if (!this.holds.has(viewId)) void this.request({resource:"engine",method:"POST",body:{viewId}});
  }

  private renew(hold: Hold): Promise<SpotifyResponse> {
    if (hold.stopped || this.closed) return Promise.resolve(unavailable());
    if (hold.pending) return hold.pending;
    clearTimeout(hold.timer);
    const started = Date.now();
    const pending = this.send({resource:"engine",method:"POST",body:{viewId:hold.viewId}})
      .then(response => {
        if ([400,401,403].includes(response.status)) {
          hold.stopped = true;
          if (this.holds.get(hold.viewId) === hold) this.holds.delete(hold.viewId);
        }
        return response;
      }, () => unavailable());
    hold.pending = pending;
    void pending.then(response => {
      hold.pending = undefined;
      if (hold.stopped || this.closed) return;
      const delay = response.status >= 500 || response.status === 429 ? 5_000 : Math.max(1_000,20_000-(Date.now()-started));
      hold.timer = setTimeout(() => { void this.renew(hold); },delay);
      hold.timer.unref?.();
    });
    return pending;
  }

  private async release(viewId: string): Promise<SpotifyResponse> {
    const hold = this.holds.get(viewId);
    if (hold) {
      hold.stopped = true;
      clearTimeout(hold.timer);
      this.holds.delete(viewId);
      // A late POST must settle before DELETE, otherwise it recreates the hold.
      await hold.pending;
    }
    return this.send({resource:"engine",method:"DELETE",body:{viewId}}).catch(unavailable);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.holds.keys()].map(viewId=>this.release(viewId)));
  }
}
