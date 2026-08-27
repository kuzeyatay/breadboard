#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { importParityEvidence } from "./parity-evidence-contract.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");

try {
  const values = process.argv.slice(2);
  let receiptArgument = null;
  let checkOnly = false;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--check-only") {
      checkOnly = true;
    } else if (argument.startsWith("--receipt=")) {
      receiptArgument = argument.slice("--receipt=".length);
    } else if (argument === "--receipt") {
      receiptArgument = values[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`Unknown Runtime V2 parity evidence option: ${argument}`);
    }
  }
  if (!receiptArgument) {
    throw new Error(
      "A sealed receipt is required. Use --receipt=<repository evidence path>; add --check-only to validate without updating feature-parity.json.",
    );
  }
  const result = importParityEvidence({
    repoRoot,
    receiptPath: path.resolve(repoRoot, receiptArgument),
    checkOnly,
  });
  process.stdout.write(
    `[runtime-v2-parity-evidence] ${checkOnly ? "VALID" : "IMPORTED"}: ${result.importedCapabilityIds.length} capability row(s); receipt=${result.receiptSha256}; inventory=${result.inventoryContractSha256}\n`,
  );
} catch (error) {
  process.stderr.write(
    `[runtime-v2-parity-evidence] FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
