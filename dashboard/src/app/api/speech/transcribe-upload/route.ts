import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import {
  discardRecording,
  storeUploadedRecording,
  transcribeStoredRecording,
} from "@/lib/speech/recording-transcription";
import {
  MAX_RECORDING_BYTES,
  RECORDING_FILENAME_HEADER,
  encodeRecordingEvent,
  isTranscribableRecording,
} from "@/lib/speech/recording-upload";
import { getSpeechSettings } from "@/lib/speech/settings";

/**
 * Transcribe a recording the user already has, with the same local model that
 * powers dictation.
 *
 * The file arrives as the raw request body rather than a form part so it can be
 * streamed to disk — a lecture video is not something to parse into memory. The
 * reply is a line-delimited progress stream, because a forty-minute recording
 * takes long enough that a silent spinner is indistinguishable from a hang.
 */
export async function POST(request: Request) {
  let directory: string | null = null;
  try {
    const userId = await requireUserId();
    const settings = getSpeechSettings(userId);
    if (!settings.enabled) {
      throw new RouteError(409, "Speech is turned off in Intelligence → Settings → Speech.");
    }

    const header = request.headers.get(RECORDING_FILENAME_HEADER);
    let filename = "";
    try {
      filename = decodeURIComponent(header ?? "").trim();
    } catch {
      filename = "";
    }
    if (!filename) throw new RouteError(400, "The recording arrived without a filename.");
    if (!isTranscribableRecording(filename)) {
      throw new RouteError(415, `Breadboard cannot read "${filename}" as a recording.`);
    }

    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_RECORDING_BYTES) {
      throw new RouteError(413, "That recording is larger than 2 GB.");
    }

    const workspace = await storeUploadedRecording(request.body, filename);
    directory = workspace.directory;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Parameters<typeof encodeRecordingEvent>[0]) => {
          try {
            controller.enqueue(encoder.encode(encodeRecordingEvent(event)));
          } catch {
            // The reader went away mid-transcription; request.signal ends the work.
          }
        };
        send({ stage: "preparing" });
        try {
          const text = await transcribeStoredRecording({
            workspace,
            filename,
            model: settings.transcriptionModel,
            language: settings.transcriptionLanguage || null,
            signal: request.signal,
            onEvent: send,
          });
          send({ stage: "done", text });
        } catch (error) {
          send({
            stage: "error",
            error:
              error instanceof RouteError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "That recording could not be transcribed.",
          });
        } finally {
          await discardRecording(workspace.directory);
          controller.close();
        }
      },
    });

    // Ownership of the workspace has moved into the stream above.
    directory = null;
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    if (directory) await discardRecording(directory);
    return routeErrorResponse(error);
  }
}
