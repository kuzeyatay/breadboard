import { configureSlidesRuntime, createSlidesView, installSlidesMenu } from "genoffice-upstream/apps/slides/src/main/slides-main";

export async function openDocument(path: string) {
  configureSlidesRuntime({ preloadPath: "breadboard", rendererDevUrl: "breadboard://slides", rendererFilePath: "" });
  const contents = createSlidesView(path).webContents;
  installSlidesMenu();
  return contents;
}
