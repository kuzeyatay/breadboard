const PROCESS_BOUNDARY_PATTERNS = Object.freeze([
  Object.freeze({
    id: "node-child-process",
    pattern: /(?:from\s*["'](?:node:)?child_process["']|require\(\s*["'](?:node:)?child_process["']\s*\)|import\(\s*["'](?:node:)?child_process["']\s*\))/u,
  }),
  Object.freeze({ id: "bun-spawn", pattern: /\bBun\s*\.\s*spawn(?:Sync)?\s*\(/u }),
  Object.freeze({ id: "deno-command", pattern: /\bnew\s+Deno\s*\.\s*Command\s*\(/u }),
  Object.freeze({
    id: "node-worker-thread",
    pattern: /(?:from\s*["']node:worker_threads["']|require\(\s*["']node:worker_threads["']\s*\)|import\(\s*["']node:worker_threads["']\s*\))/u,
  }),
  Object.freeze({
    id: "python-subprocess",
    pattern:
      /(?:^|\n)\s*(?:import\s+subprocess\b|from\s+subprocess\s+import\b)|\bsubprocess\s*\.\s*(?:Popen|run|call|check_call|check_output)\s*\(/u,
  }),
  Object.freeze({
    id: "python-process",
    pattern:
      /(?:^|\n)\s*(?:import\s+multiprocessing\b|from\s+multiprocessing\s+import\b|from\s+concurrent\.futures\s+import\s+[^\n]*\bProcessPoolExecutor\b)|\b(?:os\s*\.\s*(?:system|popen|spawn\w*|posix_spawn\w*|fork)|multiprocessing\s*\.\s*(?:Process|Pool)|ProcessPoolExecutor)\s*\(/u,
  }),
  Object.freeze({
    id: "rust-process-command",
    pattern:
      /\b(?:std|tokio)\s*::\s*process\s*::\s*Command\b|(?:^|\n)\s*use\s+(?:std|tokio)\s*::\s*process(?:\s*::\s*Command|\s*::\s*\{[^\n}]*\bCommand\b)/u,
  }),
  Object.freeze({
    id: "go-process-command",
    pattern: /["']os\/exec["']|\bexec\s*\.\s*(?:Command|CommandContext)\s*\(/u,
  }),
]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeRepositoryPath(value) {
  if (typeof value !== "string") return "";
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function processBoundaryKinds(source) {
  if (typeof source !== "string") return Object.freeze([]);
  return Object.freeze(
    PROCESS_BOUNDARY_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
      ({ id }) => id,
    ),
  );
}

function sourceReferenceMatchesFile(reference, filePath) {
  const normalized = normalizeRepositoryPath(reference);
  if (normalized === filePath || normalized.startsWith(`${filePath}:`)) return true;
  if (normalized.endsWith("/**")) {
    const directory = normalized.slice(0, -3).replace(/\/$/u, "");
    return directory.length > 0 && filePath.startsWith(`${directory}/`);
  }
  if (normalized.endsWith("/")) {
    const directory = normalized.replace(/\/+$/u, "");
    return directory.length > 0 && filePath.startsWith(`${directory}/`);
  }
  return false;
}

/**
 * Prove that every production source file capable of creating a process or a
 * worker thread is represented by at least one execution-inventory row.
 *
 * This does not claim that a mapped path is migrated. It prevents an omitted
 * path from being invisible to the migration and leaves ownership/cutover
 * truth to the corresponding inventory entry and parity gates.
 */
export function validateProcessSources({ files, inventory }) {
  if (!Array.isArray(files)) {
    throw new TypeError("Runtime V2 process-source files are invalid.");
  }
  if (!record(inventory) || !Array.isArray(inventory.entries)) {
    throw new TypeError("Runtime V2 execution inventory is invalid.");
  }

  const errors = [];
  const rows = [];
  const seenFiles = new Set();

  for (const file of files) {
    if (!record(file)) {
      errors.push("Process-source discovery returned a non-object row.");
      continue;
    }
    const filePath = normalizeRepositoryPath(file.path);
    if (!filePath || typeof file.source !== "string") {
      errors.push("Process-source discovery returned an invalid file row.");
      continue;
    }
    if (seenFiles.has(filePath)) {
      errors.push(`Process-source discovery duplicated ${filePath}.`);
      continue;
    }
    seenFiles.add(filePath);

    const boundaryKinds = processBoundaryKinds(file.source);
    if (boundaryKinds.length === 0) continue;

    const mappedEntries = inventory.entries
      .filter((entry) =>
        record(entry) &&
        typeof entry.runtime_id === "string" &&
        Array.isArray(entry.sources) &&
        entry.sources.some((source) => sourceReferenceMatchesFile(source, filePath)),
      );
    const runtimeIds = [...new Set(mappedEntries.map((entry) => entry.runtime_id))].sort();

    if (runtimeIds.length === 0) {
      errors.push(
        `${filePath}: process boundary (${boundaryKinds.join(", ")}) has no execution-inventory row.`,
      );
    } else {
      for (const entry of mappedEntries) {
        if (!record(entry.flags) || entry.flags.spawns_descendants !== true) {
          errors.push(
            `${filePath}: ${entry.runtime_id} maps a process boundary but flags.spawns_descendants is not true.`,
          );
        }
      }
    }
    rows.push(
      Object.freeze({
        filePath,
        boundaryKinds,
        runtimeIds: Object.freeze(runtimeIds),
        mapped: runtimeIds.length > 0,
      }),
    );
  }

  rows.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    rows: Object.freeze(rows),
    counts: Object.freeze({
      discoveredFiles: seenFiles.size,
      processBoundaryFiles: rows.length,
      mappedFiles: rows.filter((row) => row.mapped).length,
      unmappedFiles: rows.filter((row) => !row.mapped).length,
    }),
  });
}
