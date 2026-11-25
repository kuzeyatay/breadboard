import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { fileError, fileJson, gardenFileContext, readFileJson } from "@/lib/garden-files/server.ts";
import { GardenFileError } from "@/lib/garden-files/store.ts";
import { gardenOfficeTarget, officeEditorApp, openOfficeSession } from "@/lib/office/editor-sessions.ts";
import { selectedModelForUser } from "@/lib/selected-model";

export const dynamic = "force-dynamic";

/** Open a Garden file in its GenOffice editor (Sheets, Slides, PDF or Markdown). */
export async function POST(request: Request) {
  try {
    const body = await readFileJson(request);
    if (typeof body.gardenId !== "string" || typeof body.fileId !== "string") throw new GardenFileError(400, "office_file_missing", "Choose a file to open.");
    // Editing writes versions, so it needs the same access as saving.
    const { store, scope } = await gardenFileContext(body.gardenId, true);
    const file = store.get(scope, body.fileId);
    if (file.kind !== "file" || !officeEditorApp(file.name)) throw new GardenFileError(415, "office_editor_unsupported", "This file type has no Office editor.");
    const session = await openOfficeSession({
      userId: scope.userId!, target: gardenOfficeTarget(store, scope, file),
      theme: body.theme === "dark" ? "dark" : "light",
      ai: { baseUrl: resolveChatmockBaseUrl(request).baseURL, model: selectedModelForUser(scope.userId) },
    });
    return fileJson({ session: session.id, app: session.app, url: `/genoffice/${session.app}/index.html?session=${encodeURIComponent(session.id)}` }, 201);
  } catch (error) {
    if (error instanceof GardenFileError || (error as { status?: number }).status) return fileError(error);
    return fileJson({ error: error instanceof Error ? error.message : "The editor could not start." }, 503);
  }
}
