/**
 * The browser half: ask a route for an archive and hand it to the user, or
 * push one back up.
 *
 * It imports only `format.ts`, which is pure, so nothing server-side is dragged
 * into the dashboard bundle behind a type.
 */

import { transferFileName } from "./format.ts";
import type { TransferImportResult, TransferKind } from "./format.ts";

export { TRANSFER_ACCEPT, TRANSFER_FILE_FORMATS } from "./format.ts";

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFromDisposition(
  disposition: string | null,
  fallback: string,
): string {
  if (!disposition) return fallback;
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

async function errorFrom(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}) as { error?: unknown });
  const message = (body as { error?: unknown }).error;
  return new Error(
    typeof message === "string" && message ? message : "Something went wrong.",
  );
}

/** Download a garden as a `.garden` file. */
export async function exportGardenFile(
  slug: string,
  name: string,
): Promise<void> {
  await downloadTransfer(
    `/api/transfer/garden/${encodeURIComponent(slug)}`,
    "garden",
    name,
  );
}

/** Download a cluster, and everything filed under it, as a `.cluster` file. */
export async function exportClusterFile(
  clusterPath: string,
  label: string,
): Promise<void> {
  await downloadTransfer(
    `/api/transfer/cluster?path=${encodeURIComponent(clusterPath)}`,
    "cluster",
    label,
  );
}

async function downloadTransfer(
  url: string,
  kind: TransferKind,
  label: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw await errorFrom(response);

  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(
      response.headers.get("Content-Disposition"),
      transferFileName(kind, label),
    ),
  );
}

/** Upload a `.garden` or `.cluster` file. `targetFolder` is where it lands. */
export async function importTransferFile(
  file: File,
  targetFolder: string | null,
): Promise<TransferImportResult> {
  const body = new FormData();
  body.append("file", file);
  if (targetFolder) body.append("targetFolder", targetFolder);

  const response = await fetch("/api/transfer/import", { method: "POST", body });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as TransferImportResult;
}

/** "Imported 3 gardens into Signals" — one line the caller can toast. */
export function describeImport(result: TransferImportResult): string {
  const count = result.gardens.length;
  const gardens = `${count} garden${count === 1 ? "" : "s"}`;
  if (result.kind === "cluster") {
    return `Imported ${gardens} into the cluster "${result.clusterPath ?? ""}".`;
  }
  const [garden] = result.gardens;
  const where = garden?.folder ? ` into "${garden.folder}"` : "";
  return `Imported "${garden?.name ?? "garden"}"${where}.`;
}
