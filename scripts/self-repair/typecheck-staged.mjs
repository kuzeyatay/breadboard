// Compile the pending checkpoint without mutating a concurrently built tree.
import fs from "node:fs";
import path from "node:path";
import ts from "../../desktop/node_modules/typescript/lib/typescript.js";
const root = process.cwd(), stage = path.join(root, ".tmp/self-repair-staging");
const staged = file => {
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || relative.startsWith(".tmp")) return file;
  const candidate = path.join(stage, relative);
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : file;
};
let failed = false;
for (const project of ["desktop/tsconfig.json", "dashboard/.tmp-task-recovery-tsconfig.json"]) {
  const file = path.resolve(project), config = ts.readConfigFile(file, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(file), { noEmit: true, incremental: false });
  if (project.startsWith("dashboard/")) parsed.fileNames.push(path.join(root, "dashboard/src/lib/source-repair/service.ts"));
  const host = ts.createCompilerHost(parsed.options);
  host.readFile = file => ts.sys.readFile(staged(file));
  host.fileExists = file => ts.sys.fileExists(staged(file));
  host.directoryExists = directory => ts.sys.directoryExists(directory) || ts.sys.directoryExists(path.join(stage, path.relative(root, directory)));
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) { failed = true; console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => "\n" })); }
  else console.log(`${project}: passed`);
}
process.exitCode = failed ? 1 : 0;
