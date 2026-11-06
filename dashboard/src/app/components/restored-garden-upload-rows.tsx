"use client";

import type { RestoredGardenUpload } from "./use-garden-restored-uploads";

export function RestoredGardenUploadRows({ uploads }: { uploads: RestoredGardenUpload[] }) {
  if (uploads.length === 0) return null;
  return (
    <div className="border-b border-gray-800/70 py-1" data-testid="restored-uploads">
      {uploads.map(upload => (
        <div key={upload.requestId} className="flex w-full items-center gap-2.5 px-3 py-2" title={upload.error || upload.step || "Uploading…"}>
          {upload.error ? (
            <span className="h-4 w-4 shrink-0 text-center text-red-400" aria-hidden="true">!</span>
          ) : (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-gray-300">{upload.filename}</span>
            <span role="status" className={`block truncate text-[11px] ${upload.error ? "text-red-400" : "text-gray-500"}`}>
              {upload.error || (upload.step ? `Uploading… · ${upload.step}` : "Uploading…")}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
