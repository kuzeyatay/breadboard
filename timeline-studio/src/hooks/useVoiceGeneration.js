import { useCallback } from "react";
import { isModelDownloadError } from "../lib/modelSources.js";
import {
  isPiperSymbolError, isStorageQuotaError, TtsInputError,
} from "../lib/ttsText.js";
import {
  applyVoiceOutputGain, convertVoiceBlob, extractVoiceEmbedding, OPENVOICE_EMBEDDING_VERSION,
} from "../lib/openVoiceRuntime.js";
import { splitVoiceCaptionText } from "../lib/voiceCaptionSegmentation.js";
import { synthesizeBaseVoice } from "../lib/baseVoiceSynthesis.js";

export function useVoiceGeneration(d) {
  return useCallback(async (captionSegment = null) => {
    captionSegment = captionSegment?.id && typeof captionSegment?.text === "string"
      ? captionSegment
      : null;
    const rawText = (captionSegment?.text ?? d.script).trim();
    if (!rawText || d.status === "generating" || d.status === "captioning") return;
    d.setVoiceTab("synthesis"); d.setStatus("generating"); d.setStatusText("ttsStatusPreparingModel"); d.setProgress(6);
    try {
      const sentenceSegments = splitVoiceCaptionText(rawText);
      let targetEmbedding = d.selectedVoiceProfile?.embedding;
      if (targetEmbedding) {
        if (
          d.selectedVoiceProfile.embeddingVersion !== OPENVOICE_EMBEDDING_VERSION
          && d.selectedVoiceProfile.referenceBlob
        ) {
          d.setStatusText(d.t("cloneEncoding", "重新提取音色"));
          targetEmbedding = await extractVoiceEmbedding(d.selectedVoiceProfile.referenceBlob, (event) => {
            if (event.phase) d.setStatusText(event.phase);
            if (Number.isFinite(event.progress)) d.setProgress(Math.max(1, Math.min(45, Math.round(event.progress * 0.45))));
          });
          await d.addVoiceProfile?.({
            ...d.selectedVoiceProfile,
            embedding: Float32Array.from(targetEmbedding),
            embeddingVersion: OPENVOICE_EMBEDDING_VERSION,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      const generatedItems = [];
      for (let index = 0; index < sentenceSegments.length; index += 1) {
        const sentence = sentenceSegments[index];
        if (sentenceSegments.length > 1) {
          d.setStatusText(d.t("ttsStatusGeneratingSegment")
            .replace("{current}", index + 1)
            .replace("{total}", sentenceSegments.length));
        }
        let { blob } = await synthesizeBaseVoice({
          voice: d.selectedVoice, text: sentence, speed: d.speed, notify: d.notify, t: d.t,
          onStatus: sentenceSegments.length > 1 ? undefined : d.setStatusText,
          onProgress: (value) => {
            const overall = 8 + ((index + Math.max(0, Math.min(100, value)) / 100) / sentenceSegments.length) * 82;
            d.setProgress(Math.min(90, Math.round(overall)));
          },
        });
        if (targetEmbedding) {
          d.setStatusText(sentenceSegments.length > 1
            ? d.t("ttsStatusConvertingSegment").replace("{current}", index + 1).replace("{total}", sentenceSegments.length)
            : d.t("cloneStageTwo", "第 2 步：转换为克隆音色"));
          blob = await convertVoiceBlob(blob, targetEmbedding, {
            seed: 2026 + index,
            onProgress: (event) => {
              if (sentenceSegments.length === 1 && event.phase) d.setStatusText(event.phase);
              if (Number.isFinite(event.progress)) {
                const overall = 8 + ((index + Math.max(0, Math.min(100, event.progress)) / 100) / sentenceSegments.length) * 82;
                d.setProgress(Math.min(90, Math.round(overall)));
              }
            },
          });
        }
        blob = await applyVoiceOutputGain(blob, d.volume);
        generatedItems.push({ blob, script: sentence });
      }
      d.setStatusText("ttsStatusDecodingWaveform");
      d.setProgress((current) => Math.max(current, 96));
      const commitOptions = {
        captionSegment, script: rawText, gapSeconds: 0,
        sourceKind: d.selectedVoiceProfile ? "cloned-voiceover" : "ai-voiceover",
        cloneVoiceProfileId: d.selectedVoiceProfile?.id || "",
        cloneVoiceProfileName: d.selectedVoiceProfile?.name || "",
      };
      await d.commitAudioBatch(generatedItems, `${d.selectedVoice.name} · ${d.t("ttsGenerated")}`, commitOptions);
      d.notify(generatedItems.length > 1
        ? d.t("ttsNoticeSegmentedGenerated").replace("{count}", generatedItems.length)
        : d.t("ttsNoticeGenerated"));
    } catch (error) {
      console.error(error);
      const message = error instanceof TtsInputError ? d.t(error.code)
        : /^HOJO_(?:DECODER_)?(?:SILENT|INVALID)_WAVEFORM$/.test(error?.message) ? d.t("ttsErrorSilentWaveform")
        : d.selectedVoice.engine === "piper" && isPiperSymbolError(error) ? d.t("ttsErrorUnsupportedPiperSymbols")
          : isStorageQuotaError(error) ? d.t("ttsErrorStorageQuota")
            : isModelDownloadError(error) ? d.t("ttsErrorModelDownload")
              : error instanceof Error ? error.message : d.t("ttsErrorGenerationFailed");
      d.setStatus("error"); d.setStatusText(message); d.setProgress(0); d.notify(message);
    }
  }, [d]);
}
