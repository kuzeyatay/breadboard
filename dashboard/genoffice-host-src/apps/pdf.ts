import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { app, dialog, ipcMain, Menu, type WebContents } from "electron";
import { configurePdfRuntime, createPdfView, flushPdfSave, sendPdfPrintRequest } from "genoffice-upstream/apps/pdf/src/main/pdf-main";
import { PDF_CHANNELS } from "genoffice-upstream/apps/pdf/src/shared/ipc";
import { convertPdfFileToDocxLocal } from "genoffice-upstream/apps/shell/src/main/pdf2docx-local";
import { convertPdfFileToPptxLocal } from "genoffice-upstream/apps/shell/src/main/pdf2pptx-local";
import { convertPdfFileToXlsxLocal } from "genoffice-upstream/apps/shell/src/main/pdf2xlsx-local";

const converters = {
  docx: async (path: string) => (await convertPdfFileToDocxLocal(path)).docx,
  pptx: async (path: string) => (await convertPdfFileToPptxLocal(path)).pptx,
  xlsx: async (path: string) => (await convertPdfFileToXlsxLocal(path)).xlsx,
} as const;

/** The shell's local PDF → Word/PowerPoint/Excel export; the result lands in exports/, which becomes a Garden file. */
async function convertTo(contents: WebContents, path: string, format: unknown) {
  if (typeof format !== "string" || !(format in converters)) return;
  try {
    if (!(await flushPdfSave(contents))) return;
    const bytes = await converters[format as keyof typeof converters](path);
    writeFileSync(join(app.getPath("documents"), basename(path).replace(/\.pdf$/i, "") + "." + format), bytes);
  } catch (error) {
    // ponytail: encrypted PDFs fail here; add the shell's password prompt if people need it.
    await dialog.showMessageBox({ type: "error", message: "The PDF could not be converted.", detail: error instanceof Error ? error.message : String(error) });
  }
}

export async function openDocument(path: string) {
  // Merged or generated PDFs are saved into exports/, which Breadboard files into the Garden.
  configurePdfRuntime({ preloadPath: "", rendererUrl: "breadboard://pdf", rendererFile: "", openGeneratedPath: () => true });
  const contents = createPdfView(path).webContents;
  ipcMain.handle(PDF_CHANNELS.convertOffice, (_event, format: unknown) => convertTo(contents, path, format));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "File", submenu: [
    { label: "Save", accelerator: "CmdOrCtrl+S", click: () => void flushPdfSave(contents) },
    { label: "Export as Word", click: () => void convertTo(contents, path, "docx") },
    { label: "Export as PowerPoint", click: () => void convertTo(contents, path, "pptx") },
    { label: "Export as Excel", click: () => void convertTo(contents, path, "xlsx") },
    { label: "Print", accelerator: "CmdOrCtrl+P", click: () => sendPdfPrintRequest(contents) },
  ] }]));
  return contents;
}
