import Database from "better-sqlite3";

import { externalRuntimePath as path } from "./external-runtime-path.ts";

/**
 * Open one explicitly authorized SQLite file without presenting its mutable
 * runtime path to Next's static file tracer. The package import remains
 * ordinary so the native better-sqlite3 closure is still packaged; only the
 * database filename crosses an opaque constructor boundary.
 */
export function openRuntimeSqliteDatabase(input: {
  readonly authorityRoot: string;
  readonly candidate: string;
  readonly filename: string;
}): Database.Database {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.filename)) {
    throw new TypeError("The Runtime SQLite filename is invalid.");
  }
  const authorityRoot = path.resolve(input.authorityRoot);
  const candidate = path.resolve(input.candidate);
  const relative = path.relative(authorityRoot, candidate);
  if (
    relative !== input.filename ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new TypeError("The Runtime SQLite path is outside its authority.");
  }
  return Reflect.construct(Database, [candidate]) as Database.Database;
}
