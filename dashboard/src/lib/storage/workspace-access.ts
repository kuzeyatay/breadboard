import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { prepareWorkspaceInputs, restoreWorkspaceInputs } from "./workspace-storage.ts";

/** Called before handing a directory to a native runtime, never by chat lists. */
export const prepareStoredWorkspace = (directory: string) => prepareWorkspaceInputs(db,dashboardDataDir(),directory);

/** Internal tool requests and editable-attachment staging already run inside a
 * live turn. This also covers a tool retry after a dashboard process restart. */
export const restoreStoredWorkspace = (directory: string) => restoreWorkspaceInputs(db,dashboardDataDir(),directory);
