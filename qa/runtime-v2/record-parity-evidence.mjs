#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordParityEvidenceReceipt } from "./parity-evidence-contract.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");

function optionValue(values, index, name) {
  const argument = values[index];
  if (argument === name) return { value: values[index + 1] ?? null, consumed: 1 };
  if (argument.startsWith(`${name}=`)) return { value: argument.slice(name.length + 1), consumed: 0 };
  return null;
}

try {
  const values = process.argv.slice(2);
  let output = null;
  let executable = null;
  let packageReceipt = null;
  const observations = [];
  for (let index = 0; index < values.length; index += 1) {
    const outputOption = optionValue(values, index, "--output");
    const executableOption = optionValue(values, index, "--executable");
    const observationOption = optionValue(values, index, "--observation");
    const packageReceiptOption = optionValue(values, index, "--package-receipt");
    if (outputOption) {
      output = outputOption.value;
      index += outputOption.consumed;
    } else if (executableOption) {
      executable = executableOption.value;
      index += executableOption.consumed;
    } else if (observationOption) {
      if (observationOption.value) observations.push(observationOption.value);
      index += observationOption.consumed;
    } else if (packageReceiptOption) {
      packageReceipt = packageReceiptOption.value;
      index += packageReceiptOption.consumed;
    } else {
      throw new Error(`Unknown Runtime V2 parity recording option: ${values[index]}`);
    }
  }
  if (!output || !executable || !packageReceipt || observations.length === 0) {
    throw new Error(
      "Runner-emitted observations, a verified package-closure receipt, an output receipt, and the measured executable are required. " +
      "Use --observation=<path> repeatedly, --package-receipt=<path>, --output=<path>, and --executable=<absolute Breadboard.exe>.",
    );
  }
  const result = recordParityEvidenceReceipt({
    repoRoot,
    receiptPath: output,
    observationPaths: observations,
    executablePath: executable,
    packageVerifierReceiptPath: packageReceipt,
  });
  process.stdout.write(
    `[runtime-v2-parity-evidence] RECORDED: ${result.receipt.rows.length} capability row(s); receipt=${result.reference.sha256}\n`,
  );
} catch (error) {
  process.stderr.write(
    `[runtime-v2-parity-evidence] FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
