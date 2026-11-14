"use client";

import { useState, useSyncExternalStore } from "react";
import { gardenFileApi, type GardenFileEntry } from "@/lib/garden-files/types";
import { gardenUploadFileKey, gardenUploadTasksSnapshot, gardenUploadTasksServerSnapshot, subscribeGardenUploads, startGardenUploadTask, cancelGardenUploadTask } from "@/lib/garden-upload-store";
import { ANYDOC_PARSE_FILE_RE } from "@/lib/anydoc/formats";
import { usePageLoading } from "@/app/components/use-page-loading";
import styles from "./garden-files.module.css";

export default function GardenFileKnowledge({ file, onClose }: { file: GardenFileEntry; onClose: () => void }) {
  const [taskId, setTaskId] = useState<string | null>(null), [preparing, setPreparing] = useState(false), [error, setError] = useState("");
  const tasks = useSyncExternalStore(subscribeGardenUploads, gardenUploadTasksSnapshot, gardenUploadTasksServerSnapshot);
  const task = tasks.find(item => item.id === taskId), key = task?.files[0] && gardenUploadFileKey(task.files[0]);
  const failure = key ? task?.errors[key] : "", done = key && task?.statuses[key] === "done";
  usePageLoading(preparing || task?.state === "uploading");
  const start = async () => {
    setPreparing(true); setError("");
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error("Choose a file smaller than 128 MB to add to knowledge.");
      const response = await fetch(`${gardenFileApi(file.gardenId, file.id)}/content?version=${file.version}`);
      if (!response.ok) throw new Error("The original file could not be read. Try again.");
      const original = new File([await response.blob()], file.name, { type: file.mimeType });
      setTaskId(startGardenUploadTask({ clusterSlug: file.gardenId, files: [original], options: { label: file.name, handwriting: false, parseWithVlm: false, parseWithAnydoc: ANYDOC_PARSE_FILE_RE.test(file.name), generateMap: false } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be added to knowledge."); }
    finally { setPreparing(false); }
  };
  return <div className={styles.history} role="region" aria-label="Add to knowledge">
    <div><strong>{done ? "Added to knowledge" : "Add to knowledge"}</strong><button onClick={onClose} aria-label="Close knowledge actions">×</button></div>
    {!taskId && <p>Create searchable notes from this file. The new notes follow this garden’s sharing settings. Your original stays in Files.</p>}
    {(error || failure) && <p role="alert">{error || failure}</p>}
    {task?.state === "uploading" && <p role="status">{key && task.steps[key] || "Adding to knowledge…"}</p>}
    {done && <p>The notes are available in the garden. <a href={`/gardens/${encodeURIComponent(file.gardenId)}`}>Open workspace</a></p>}
    <div>{task?.state === "uploading" ? <button onClick={() => cancelGardenUploadTask(task.id)}>Cancel</button> : !done && <button disabled={preparing} onClick={() => void start()}>{preparing ? "Preparing…" : taskId || error ? "Retry" : "Add to knowledge"}</button>}</div>
  </div>;
}
