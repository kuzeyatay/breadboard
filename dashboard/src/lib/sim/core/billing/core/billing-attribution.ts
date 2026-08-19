// Breadboard stand-in for sim's lib/billing/core/billing-attribution.ts (simstudioai/sim,
// Apache-2.0). Sim resolves who pays for a run against Postgres subscription rows.
// Breadboard has no billing plane, so only the snapshot's shape survives: the executor
// carries the field through metadata untouched and never resolves one.

export interface BillingEntity {
  readonly type: "user" | "organization";
  readonly id: string;
}

export interface BillingPeriodSnapshot {
  readonly start: string | null;
  readonly end: string | null;
}

export interface PayerSubscriptionSnapshot {
  readonly plan?: string;
  readonly enterpriseWorkflowExecutionTimeoutSeconds?: number;
}

export interface BillingAttributionSnapshot {
  readonly actorUserId: string;
  readonly workspaceId: string;
  readonly organizationId: string | null;
  readonly billedAccountUserId: string;
  readonly billingEntity: Readonly<BillingEntity>;
  readonly billingPeriod: Readonly<BillingPeriodSnapshot>;
  readonly payerSubscription: Readonly<PayerSubscriptionSnapshot> | null;
}
