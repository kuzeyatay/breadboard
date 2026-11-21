import { Menu } from "electron";
import { configureMarkdownRuntime, createMarkdownView, requestMarkdownSave, sendMarkdownExportRequest, sendMarkdownPrintRequest } from "genoffice-upstream/apps/markdown/src/main/markdown-main";

export async function openDocument(path: string) {
  configureMarkdownRuntime({ preloadPath: "", rendererUrl: "breadboard://markdown", rendererFile: "" });
  const contents = createMarkdownView(path).webContents;
  // The GenOffice shell owns the Markdown menu; these are its file commands.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "File", submenu: [
    { label: "Save", accelerator: "CmdOrCtrl+S", click: () => void requestMarkdownSave(contents, "save") },
    { label: "Save a Copy", accelerator: "CmdOrCtrl+Shift+S", click: () => void requestMarkdownSave(contents, "saveAs") },
    { label: "Export Word", click: () => sendMarkdownExportRequest(contents, "docx") },
    { label: "Print", accelerator: "CmdOrCtrl+P", click: () => sendMarkdownPrintRequest(contents) },
  ] }]));
  return contents;
}
