// Breadboard stand-in for sim's lib/uploads/utils/file-utils.server.ts (simstudioai/sim,
// Apache-2.0). Sim's version resolves internal `/api/files/serve/` URLs through its own
// storage layer and streams external ones through an SSRF-pinned agent. Breadboard has no
// object store behind the engine, so internal URLs are unresolvable and external ones are
// fetched plainly (see core/security/input-validation.server for why pinning is dropped).

import { isInternalFileUrl } from "@/lib/sim/core/uploads/utils/file-utils";

export interface DownloadFileFromUrlOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  userId?: string;
}

export async function downloadFileFromUrl(
  fileUrl: string,
  options: DownloadFileFromUrlOptions = {},
): Promise<Buffer> {
  options.signal?.throwIfAborted();

  if (isInternalFileUrl(fileUrl)) {
    throw new Error("Internal file URLs are not resolvable: Breadboard has no object store");
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(fileUrl, { signal });
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (options.maxBytes !== undefined && buffer.length > options.maxBytes) {
      throw new Error(`Downloaded file exceeds ${options.maxBytes} bytes`);
    }
    return buffer;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
