import { join } from "node:path";
import { configureSheetsRuntime, createSheetsView, installSheetsMenu, resolveSheetsSessionPath, setForcedWorkbookPath } from "genoffice-upstream/apps/sheets/src/main/sheets-main";
import { setSessionPathResolver } from "genoffice-upstream/apps/docs/src/main/docs-main";
export async function openDocument(path: string) {
  const exe = process.platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar";
  configureSheetsRuntime({ preloadPath: "", rendererUrl: "breadboard://sheets", rendererFile: "", sidecarPath: join(process.resourcesPath, "native", exe) });
  setSessionPathResolver(resolveSheetsSessionPath);
  setForcedWorkbookPath(path);
  const contents = createSheetsView({ includeAiHandlers: false }).webContents;
  installSheetsMenu();
  return contents;
}
