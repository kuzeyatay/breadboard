import { gardenFileApi, type GardenFileEntry } from "./types";

export interface GardenFileUpload {
  id: string; gardenId: string; path: string; state: "queued" | "uploading" | "done" | "failed" | "cancelled";
  progress: number; error?: string; entry?: GardenFileEntry;
}

/** Transfers survive reader navigation; completed entries release their File objects. */
export function createGardenFileUploadQueue(makeRequest = () => new XMLHttpRequest()) {
  let entries: GardenFileUpload[] = [];
  const files = new Map<string, File>(), listeners = new Set<() => void>();
  let active: { id: string; request: XMLHttpRequest } | null = null;
  const notify = () => { for (const listener of listeners) listener(); };
  const update = (id: string, patch: Partial<GardenFileUpload>) => { entries = entries.map(entry => entry.id === id ? { ...entry, ...patch } : entry); notify(); };
  const drain = () => {
    if (active) return;
    const entry = entries.find(item => item.state === "queued"), file = entry && files.get(entry.id);
    if (!entry || !file) return;
    const request = makeRequest(); active = { id: entry.id, request };
    update(entry.id, { state: "uploading", progress: 0, error: undefined });
    request.open("POST", gardenFileApi(entry.gardenId));
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("x-file-path", encodeURIComponent(entry.path));
    request.setRequestHeader("x-file-size", String(file.size));
    request.setRequestHeader("x-file-import-key", entry.id);
    request.upload.onprogress = event => { if (event.lengthComputable) update(entry.id, { progress: Math.round(event.loaded / event.total * 100) }); };
    const finish = () => { active = null; drain(); };
    request.onload = () => {
      let body: { file?: GardenFileEntry; error?: string } = {};
      try { body = JSON.parse(request.responseText); } catch { /* Preserve the upload for retry. */ }
      if (request.status >= 200 && request.status < 300 && body.file) {
        files.delete(entry.id); update(entry.id, { state: "done", progress: 100, entry: body.file });
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sb:garden-file-updated", { detail: body.file }));
      } else update(entry.id, { state: "failed", error: body.error || "Upload failed. Try again." });
      finish();
    };
    request.onerror = () => { update(entry.id, { state: "failed", error: "The connection was interrupted. Try again." }); finish(); };
    request.onabort = () => { files.delete(entry.id); update(entry.id, { state: "cancelled" }); finish(); };
    request.send(file);
  };
  return {
    snapshot: () => entries,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    add(gardenId: string, folder: string, incoming: { file: File; path: string }[]) {
      const next = incoming.map(item => {
        const id = crypto.randomUUID(); files.set(id, item.file);
        return { id, gardenId, path: `${folder ? `${folder}/` : ""}${item.path}`, state: "queued" as const, progress: 0 };
      });
      entries = [...entries, ...next]; notify(); drain();
    },
    retry(id: string) { if (!files.has(id)) return; update(id, { state: "queued", error: undefined }); drain(); },
    cancel(id: string) {
      if (active?.id === id) active.request.abort();
      else { files.delete(id); update(id, { state: "cancelled" }); }
    },
    dismiss() { entries = entries.filter(entry => entry.state === "queued" || entry.state === "uploading" || entry.state === "failed"); notify(); },
  };
}
export const gardenFileUploadQueue = createGardenFileUploadQueue();
