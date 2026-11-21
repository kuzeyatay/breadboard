// Electron's packaged-app resources folder: wasm and the xlsx sidecar sit beside the host bundles.
import { join } from "node:path";
(process as { resourcesPath?: string }).resourcesPath = process.env.GENOFFICE_RESOURCES || join(__dirname, "resources");
