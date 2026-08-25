import type {
  DesktopApi,
  OpenDocxResult,
  PickImageResult,
} from "@/vendor/genoffice/docs/src/shared/ipc";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";

interface BridgeOptions {
  artifactId: string;
  conversationId: string;
  initialVersion: number;
}

const SAVE_COMPLETE_EVENT = "breadboard:genoffice-save-complete";

function reportSave(result: { ok: boolean; error?: string }): void {
  window.dispatchEvent(new CustomEvent(SAVE_COMPLETE_EVENT, { detail: result }));
}

function noopSubscription(): () => void {
  return () => {};
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  return "Breadboard could not save the Word document.";
}

function pickImage(): Promise<PickImageResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        const comma = dataUrl.indexOf(",");
        const mime = file.type as PickImageResult["mime"];
        if (comma < 0 || !["image/png", "image/jpeg", "image/gif"].includes(mime)) {
          resolve(null);
          return;
        }
        resolve({ base64: dataUrl.slice(comma + 1), mime, name: file.name });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

export function installGenOfficeBridge({
  artifactId,
  conversationId,
  initialVersion,
}: BridgeOptions): DesktopApi {
  const query = new URLSearchParams({ conversationId });
  const endpoint = `/api/hermes/artifacts/${encodeURIComponent(artifactId)}/genoffice`;
  const virtualPath = `breadboard-artifact://${artifactId}`;
  let version = initialVersion;
  let pending = true;

  const load = async (): Promise<OpenDocxResult> => {
    const response = await fetch(`${endpoint}?${query}`, { cache: "no-store" });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(detail?.error || `The Word document could not be opened (${response.status}).`);
    }
    version = Number(response.headers.get("X-Breadboard-Artifact-Version") ?? version);
    const encodedName = response.headers.get("X-Breadboard-Artifact-Filename") ?? "document.docx";
    const name = decodeURIComponent(encodedName);
    const data = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { path: virtualPath, name, data, hash };
  };

  const save = async (data: ArrayBuffer) => {
    try {
      const params = new URLSearchParams({
        conversationId,
        expectedVersion: String(version),
      });
      const response = await fetch(`${endpoint}?${params}`, {
        method: "PUT",
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        body: data,
      });
      const payload = await response.json().catch(() => null) as {
        artifact?: PresentedArtifact;
        error?: string;
      } | null;
      if (!response.ok || !payload?.artifact) {
        const result = { ok: false, error: payload?.error || `Save failed (${response.status}).` };
        reportSave(result);
        return result;
      }
      version = payload.artifact.version;
      window.parent.postMessage(
        { type: "breadboard:genoffice-artifact-saved", artifact: payload.artifact },
        window.location.origin,
      );
      const result = { ok: true };
      reportSave(result);
      return result;
    } catch (error) {
      const result = { ok: false, error: errorText(error) };
      reportSave(result);
      return result;
    }
  };

  const api: DesktopApi = {
    getLanguage: async () => "en",
    onLanguageChanged: noopSubscription,
    getTheme: async () => "light",
    onThemeChanged: noopSubscription,
    onChromePressed: noopSubscription,
    openDocx: async () => null,
    openDocxPath: async () => null,
    openDocxDecrypt: async () => ({ ok: false, reason: "unsupported" }),
    setDocPassword: async () => ({ ok: false }),
    docPasswordIntentRevision: async () => 0,
    discardDocPasswordIntents: async () => ({ ok: true }),
    consumePendingOpenDocx: async () => {
      if (!pending) return null;
      pending = false;
      return load();
    },
    consumeNewBlankDoc: async () => false,
    onOpenDocx: noopSubscription,
    onRenamedDocx: noopSubscription,
    saveDocx: async (_path, data) => save(data),
    writeRecoveryCopy: async () => ({ ok: true }),
    onTeardown: noopSubscription,
    saveDocxAs: async (_name, data) => ({ ...(await save(data)), path: virtualPath }),
    saveDocxNew: async (_name, data) => ({ ...(await save(data)), path: virtualPath }),
    getRecentFiles: async () => [],
    pickImage,
    fontMetrics: async () => null,
    getAiSettings: async () => ({
      provider: "breadboard",
      providers: { breadboard: { apiKey: "", model: "workspace" } },
    }),
    webSearch: async () => ({
      results: [],
      method: "error",
      error: "Web search is not available in the contained document editor.",
    }),
    imageSearch: async () => ({
      images: [],
      method: "error",
      error: "Image search is not available in the contained document editor.",
    }),
    fetchImage: async () => null,
    print: async () => {
      window.print();
      return { ok: true };
    },
    exportPdf: async () => ({ ok: false, error: "Save the document, then use Breadboard's PDF tools." }),
    printPdfBuffer: async () => ({ ok: false, error: "PDF export is unavailable in the embedded editor." }),
    saveMergedPdf: async () => ({ ok: false, error: "PDF export is unavailable in the embedded editor." }),
    openNewTab: async () => {},
    listDocsTabs: async () => [{ id: artifactId, title: "Breadboard document", focused: true }],
    focusDocsTab: async () => {},
    onMenuCommand: noopSubscription,
    onCloseCheck: noopSubscription,
    reportCloseCheck: () => {},
    onCloseSaveRequest: noopSubscription,
    reportCloseSaveResult: () => {},
    reportViewMenuState: () => {},
  };

  window.desktop = api;
  return api;
}
