import { getConversationById } from "../conversations/store.ts";
import { anydocFormatForExtension } from "../anydoc/formats.ts";
import { SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_VIDEO_EXTENSIONS } from "../scriberr/paths.ts";
import { getRuntimeSessionById } from "./runtime-store.ts";
import { getActiveRuntimeRun } from "./run-store.ts";
import { downloadBrowserTerminalSource, getBrowserTerminalContext } from "./browser-terminal-context.ts";
import type { GardenSourceImportContext } from "./garden-source-import.ts";
import type { GardenAttachmentSource } from "./garden-attachment-source.ts";

/** Authority comes from the Garden capability and active conversation, never tool arguments. */
export async function resolveGardenBrowserSource(context: GardenSourceImportContext, url: string): Promise<GardenAttachmentSource> {
  const sessionId = context.runtimeSessionId;
  const assertSession = () => {
    const session = sessionId ? getRuntimeSessionById(sessionId) : null;
    const conversation = context.conversationId ? getConversationById(context.conversationId) : null;
    if (!session || !context.conversationId || session.surface === "quartz_ai" ||
      session.user_id !== context.userId || session.conversation_id !== context.conversationId || conversation?.user_id !== context.userId) {
      throw new Error("Browser imports require the linked signed-in conversation.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new Error("Browser imports require an active chat run.");
    return run;
  };
  const run = assertSession();
  const access = getBrowserTerminalContext(sessionId!);
  if (!access) throw new Error("Send this request from the Terminal beside the signed-in browser page to connect it.");
  const file = await downloadBrowserTerminalSource(access, url);
  if (assertSession().id !== run.id || getBrowserTerminalContext(sessionId!) !== access) {
    throw new Error("The linked conversation changed during download. Retry from the source tab.");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = extension === "pdf" ? "pdf" : /^(png|jpe?g|webp)$/.test(extension) ? "image"
    : SUPPORTED_AUDIO_EXTENSIONS.some(value => value === `.${extension}`) ? "audio"
    : SUPPORTED_VIDEO_EXTENSIONS.some(value => value === `.${extension}`) ? "video"
    : anydocFormatForExtension(extension) || /^(txt|md|markdown|zip|mlx)$/.test(extension) ? "document" : null;
  if (!kind) throw new Error("This download format cannot be ingested as a Garden source. Choose a document, image, audio or video file.");
  return { file, kind };
}
