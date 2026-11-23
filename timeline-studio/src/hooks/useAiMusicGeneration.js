import { useCallback, useEffect, useRef, useState } from "react";

import { buildEnglishMusicPrompt, createAiMusicFileName, translateMusicDescriptionToEnglish } from "../lib/aiMusicPrompt.js";
import { repeatPcm16WavAtBestBoundary } from "../lib/aiMusicLoop.js";
import { decodeWaveform } from "../lib/media.js";
import { getModelSourcePreference } from "../lib/modelSources.js";
import { waitForModelCacheServiceWorker } from "../lib/serviceWorker.js";

export function useAiMusicGeneration({ activeLanguage, imageUrlRefs, setActiveTool, setMediaTab, setSelectedLibraryAssetId, setUserAssets }) {
  const workerRef = useRef(null);
  const [job, setJob] = useState({ state: "idle", progress: 0, phase: "", error: "" });

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setJob({ state: "idle", progress: 0, phase: "", error: "" });
  }, []);

  useEffect(() => cancel, [cancel]);

  const generate = useCallback(async (selection) => {
    setJob({ state: "running", progress: 0.64, phase: "translating", error: "" });
    let prompt;
    try {
      const descriptionEnglish = await translateMusicDescriptionToEnglish(selection.description || "", activeLanguage);
      prompt = buildEnglishMusicPrompt({ ...selection, descriptionEnglish });
    } catch (error) {
      setJob({ state: "error", progress: 0, phase: "", error: error?.message || String(error) });
      return;
    }
    await navigator.storage?.persist?.().catch(() => false);
    // The model cache is owned by the service worker. On a first-page visit,
    // wait until it controls the page so the initial parallel download is
    // persisted instead of falling through as an uncached worker fetch.
    await waitForModelCacheServiceWorker();
    const worker = workerRef.current ?? new Worker(new URL("../workers/ai-music.worker.js", import.meta.url), { type: "module" });
    const warmRuntime = Boolean(workerRef.current);
    workerRef.current = worker;
    setJob({ state: "running", progress: warmRuntime ? 0.64 : 0.01, phase: warmRuntime ? "conditioning" : "checking", error: "" });
    worker.onmessage = async ({ data }) => {
      if (data.type === "progress") {
        setJob((current) => ({ ...current, progress: data.progress, phase: data.phase }));
        return;
      }
      if (data.type === "error") {
        worker.terminate();
        workerRef.current = null;
        const cacheWriteFailed = String(data.message || "").startsWith("AI_MUSIC_CACHE_WRITE_FAILED");
        setJob({
          state: "error",
          progress: 0,
          phase: "",
          error: cacheWriteFailed
            ? (String(activeLanguage).toLowerCase().startsWith("zh")
              ? `模型下载或本地缓存失败（${String(data.message).split(": ").at(-1)}），请重试。`
              : `Model download or local caching failed (${String(data.message).split(": ").at(-1)}). Try again.`)
            : data.message,
        });
        return;
      }
      if (data.type !== "complete") return;
      const requestedSeconds = Number(selection.seconds) || 30;
      const wav = requestedSeconds > 60
        ? repeatPcm16WavAtBestBoundary(data.wav, 2, 5)
        : data.wav;
      const blob = new Blob([wav], { type: "audio/wav" });
      const src = URL.createObjectURL(blob);
      imageUrlRefs.current.add(src);
      const decoded = await decodeWaveform(blob, 96);
      const asset = {
        id: crypto.randomUUID(),
        type: "audio",
        kind: "music",
        name: createAiMusicFileName(selection),
        meta: `AI music · ${decoded.duration.toFixed(1)}s`,
        src,
        previewSrc: src,
        blob,
        duration: decoded.duration,
        peaks: decoded.peaks,
        provider: "Stable Audio 3 Small · ONNX",
        generated: true,
        prompt,
      };
      setUserAssets((current) => [asset, ...current]);
      setSelectedLibraryAssetId(asset.id);
      setActiveTool("media");
      setMediaTab("mine");
      setJob({ state: "complete", progress: 1, phase: "complete", error: "" });
    };
    worker.onerror = (event) => {
      worker.terminate();
      workerRef.current = null;
      setJob({ state: "error", progress: 0, phase: "", error: event.message || "Music generation failed." });
    };
    worker.postMessage({
      type: "generate",
      prompt,
      seconds: (Number(selection.seconds) || 30) / (Number(selection.seconds) > 60 ? 2 : 1),
      steps: 8,
      seed: Math.floor(Math.random() * 0x7fffffff),
      modelSourcePreference: getModelSourcePreference(activeLanguage),
    });
  }, [activeLanguage, imageUrlRefs, setActiveTool, setMediaTab, setSelectedLibraryAssetId, setUserAssets]);

  return { job, generate, cancel };
}
