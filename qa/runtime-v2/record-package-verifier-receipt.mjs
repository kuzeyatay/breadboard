import path from "node:path";

import { recordPackageVerifierReceipt } from "./package-verifier-receipt.mjs";

function usage() {
  return [
    "Usage:",
    "  node qa/runtime-v2/record-package-verifier-receipt.mjs \\",
    "    --executable=<absolute-path-to-win-unpacked/Breadboard.exe> \\",
    "    --output=<.qa-results/.../package-verifier-receipt.json> [--run-id=<id>] [--repo=<path>]",
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {};
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    const [, name, value] = match;
    if (!new Set(["repo", "executable", "output", "receipt", "run-id"]).has(name)) {
      throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    }
    if (Object.hasOwn(parsed, name)) throw new Error(`Duplicate --${name} argument.`);
    parsed[name] = value;
  }
  if (parsed.output && parsed.receipt) {
    throw new Error("Use only --output; --receipt is a deprecated alias and cannot be combined with it.");
  }
  if (!parsed.executable || !(parsed.output ?? parsed.receipt)) throw new Error(usage());
  return parsed;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.repo ?? process.cwd());
  const result = recordPackageVerifierReceipt({
    repoRoot,
    executablePath: path.resolve(args.executable),
    receiptPath: args.output ?? args.receipt,
    ...(args["run-id"] ? { runId: args["run-id"] } : {}),
  });
  process.stdout.write(`${JSON.stringify(result.binding, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
