interface QaRecoveryStateAuthority {
  readonly repoRoot: string;
  readonly runtimeRoot: string;
  readonly runRoot: string;
  readonly dataDir: string;
  readonly runId: string;
}

export function injectUnresolvablePersonaSelection(
  options: QaRecoveryStateAuthority & {
    readonly capabilityId: string;
    readonly expectedSelectionIdentity: string;
  },
): Readonly<{
  rowId: number;
  conversationPublicId: string;
  faultSelectionIdentity: string;
}>;

export function readInjectedPersonaSelection(
  options: QaRecoveryStateAuthority & {
    readonly rowId: number;
    readonly conversationPublicId: string;
  },
): string | null;
