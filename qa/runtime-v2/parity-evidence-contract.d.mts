export function recordParityEvidenceReceipt(options: {
  readonly repoRoot: string;
  readonly receiptPath: string;
  readonly observationPaths: readonly string[];
  readonly executablePath: string;
  readonly packageVerifierReceiptPath: string;
  readonly inventoryPath?: string;
  readonly nowMs?: number;
}): unknown;
