import {
  FilesetResolver,
  InteractiveSegmenterLegacy,
} from "@mediapipe/tasks-vision";
import { fetchFirstAvailableModel, mirroredModelFileUrls } from "./modelSources.js";

const WASM_ROOT = "/vendor/mediapipe/vision";
const MODEL_REPOSITORY = "timeline-studio-onnx-models";
const MODEL_REVISION = "f1005093a90dec7a23746518f9623ee6aaba9cdc";
const MAGIC_TOUCH_MODEL_PATH = "object-outline/magic_touch_512.tflite";
const MAGIC_TOUCH_MODEL_BYTES = 18_000_426;
const pendingDetectionRequests = new Map();
let detectorWorker = null;
let magicTouchPromise = null;

function requestId(prefix) {
  return globalThis.crypto?.randomUUID
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError() {
  const error = new Error("实物描边分析已取消。");
  error.name = "AbortError";
  return error;
}

function getDetectorWorker() {
  if (detectorWorker) return detectorWorker;
  detectorWorker = new Worker(new URL("../workers/nanodet.worker.js", import.meta.url), { type: "module" });
  detectorWorker.addEventListener("message", (event) => {
    const message = event.data;
    const pending = pendingDetectionRequests.get(message?.requestId);
    if (!pending) return;
    if (message.type === "progress") {
      pending.onProgress?.(message);
      return;
    }
    pendingDetectionRequests.delete(message.requestId);
    pending.signal?.removeEventListener("abort", pending.handleAbort);
    if (message.type === "result") pending.resolve(message.result);
    else pending.reject(new Error(message.error || "NanoDet-Plus 实物检测失败。"));
  });
  detectorWorker.addEventListener("error", (event) => {
    const error = new Error(event.message || "NanoDet-Plus Worker 运行失败。");
    pendingDetectionRequests.forEach((pending) => pending.reject(error));
    pendingDetectionRequests.clear();
    detectorWorker?.terminate();
    detectorWorker = null;
  });
  return detectorWorker;
}

export function detectObjectsWithNanoDet({ blob, signal, onProgress, scoreThreshold = 0.24 }) {
  if (signal?.aborted) return Promise.reject(abortError());
  const worker = getDetectorWorker();
  const id = requestId("nanodet");
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      pendingDetectionRequests.delete(id);
      reject(abortError());
    };
    pendingDetectionRequests.set(id, {
      resolve,
      reject,
      signal,
      onProgress,
      handleAbort,
    });
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage({ requestId: id, type: "detect", blob, scoreThreshold });
  });
}

export function selectPrimaryObject(detections, previousSubject = null) {
  const candidates = (detections || []).filter((item) => {
    if (!item?.box || String(item.label).toLowerCase() === "person") return false;
    const width = Math.max(0, item.box.xmax - item.box.xmin);
    const height = Math.max(0, item.box.ymax - item.box.ymin);
    return width * height >= 0.008 && width <= 0.98 && height <= 0.98;
  });
  const previousBox = previousSubject?.box;
  const previousLabel = previousSubject?.label;
  const overlap = (left, right) => {
    if (!left || !right) return 0;
    const width = Math.max(0, Math.min(left.xmax, right.xmax) - Math.max(left.xmin, right.xmin));
    const height = Math.max(0, Math.min(left.ymax, right.ymax) - Math.max(left.ymin, right.ymin));
    const intersection = width * height;
    const leftArea = (left.xmax - left.xmin) * (left.ymax - left.ymin);
    const rightArea = (right.xmax - right.xmin) * (right.ymax - right.ymin);
    return intersection / Math.max(0.000001, leftArea + rightArea - intersection);
  };
  return candidates
    .map((item) => {
      const width = item.box.xmax - item.box.xmin;
      const height = item.box.ymax - item.box.ymin;
      const area = width * height;
      const centerX = (item.box.xmin + item.box.xmax) / 2;
      const centerY = (item.box.ymin + item.box.ymax) / 2;
      const centered = Math.max(0, 1 - Math.hypot(centerX - 0.5, centerY - 0.5) / 0.71);
      const previousIoU = overlap(item.box, previousBox);
      const identityBonus = previousLabel && item.label === previousLabel ? 0.5 : 0;
      return {
        ...item,
        rank: Number(item.score) * 0.55 + Math.min(0.25, area) + centered * 0.2
          + previousIoU * 1.2 + identityBonus,
      };
    })
    .sort((left, right) => right.rank - left.rank)[0] || null;
}

async function getMagicTouch() {
  if (!magicTouchPromise) {
    magicTouchPromise = (async () => {
      const [{ response }, fileset] = await Promise.all([
        fetchFirstAvailableModel(mirroredModelFileUrls({
          repository: MODEL_REPOSITORY,
          revision: MODEL_REVISION,
          path: MAGIC_TOUCH_MODEL_PATH,
        })),
        FilesetResolver.forVisionTasks(WASM_ROOT),
      ]);
      const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
      if (modelAssetBuffer.byteLength !== MAGIC_TOUCH_MODEL_BYTES) {
        throw new Error(`MAGIC_TOUCH_MODEL_SIZE_MISMATCH:${modelAssetBuffer.byteLength}:${MAGIC_TOUCH_MODEL_BYTES}`);
      }
      const create = (delegate) => InteractiveSegmenterLegacy.createFromOptions(fileset, {
        baseOptions: {
          modelAssetBuffer,
          delegate,
        },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      try {
        return await create("GPU");
      } catch (error) {
        console.warn("MagicTouch GPU 初始化失败，回退 CPU。", error);
        return create("CPU");
      }
    })().catch((error) => {
      magicTouchPromise = null;
      throw error;
    });
  }
  return magicTouchPromise;
}

export async function prepareObjectSegmenter({ signal } = {}) {
  if (signal?.aborted) throw abortError();
  const segmenter = await getMagicTouch();
  if (signal?.aborted) throw abortError();
  return segmenter;
}

function resizeAlpha(alpha, sourceWidth, sourceHeight, width, height) {
  if (sourceWidth === width && sourceHeight === height) return alpha;
  const source = document.createElement("canvas");
  source.width = sourceWidth;
  source.height = sourceHeight;
  const sourceContext = source.getContext("2d");
  const imageData = sourceContext.createImageData(sourceWidth, sourceHeight);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = alpha[index];
  }
  sourceContext.putImageData(imageData, 0, 0);
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const targetContext = target.getContext("2d", { willReadFrequently: true });
  targetContext.drawImage(source, 0, 0, width, height);
  const rgba = targetContext.getImageData(0, 0, width, height).data;
  const resized = new Uint8ClampedArray(width * height);
  for (let index = 0; index < resized.length; index += 1) resized[index] = rgba[index * 4 + 3];
  return resized;
}

export async function segmentObjectWithMagicTouch(image, point, options = {}) {
  if (options.signal?.aborted) throw abortError();
  const initializedAt = performance.now();
  const segmenter = await getMagicTouch();
  const initializedMs = performance.now() - initializedAt;
  if (options.signal?.aborted) throw abortError();
  const inferenceStartedAt = performance.now();
  const result = segmenter.segment(image, {
    keypoint: {
      x: Math.max(0, Math.min(1, Number(point?.x) || 0.5)),
      y: Math.max(0, Math.min(1, Number(point?.y) || 0.5)),
    },
  });
  const inferenceMs = performance.now() - inferenceStartedAt;
  try {
    const mask = result.confidenceMasks?.[1] || result.confidenceMasks?.at(-1);
    if (!mask) throw new Error("MagicTouch 没有返回实物蒙版。");
    const probabilities = mask.getAsFloat32Array();
    const raw = new Uint8ClampedArray(probabilities.length);
    const threshold = Math.max(0.2, Math.min(0.8, Number(options.threshold) || 0.5));
    for (let index = 0; index < probabilities.length; index += 1) {
      const probability = Math.max(0, Math.min(1, probabilities[index]));
      raw[index] = probability >= threshold ? Math.round(probability * 255) : 0;
    }
    const width = Number(image.videoWidth || image.naturalWidth || image.width) || mask.width;
    const height = Number(image.videoHeight || image.naturalHeight || image.height) || mask.height;
    return {
      alpha: resizeAlpha(raw, mask.width, mask.height, width, height),
      width,
      height,
      initializedMs,
      inferenceMs,
      totalMs: initializedMs + inferenceMs,
      qualityScore: Number(result.qualityScores?.[1] ?? result.qualityScores?.at(-1)) || 0,
      modelId: "MediaPipe MagicTouch 512",
      modelPath: `${MODEL_REPOSITORY}@${MODEL_REVISION}/${MAGIC_TOUCH_MODEL_PATH}`,
    };
  } finally {
    result.close?.();
  }
}

export async function disposeObjectSegmentationModels() {
  detectorWorker?.terminate();
  detectorWorker = null;
  pendingDetectionRequests.clear();
  if (magicTouchPromise) {
    const segmenter = await magicTouchPromise.catch(() => null);
    segmenter?.close?.();
    magicTouchPromise = null;
  }
}
