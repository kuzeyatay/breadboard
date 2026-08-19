// Path shim: the executor's vendored imports resolve guardrails under `core/`, but the
// PII entity catalog was vendored at @/lib/sim/guardrails alongside the validators that
// use it. Re-export rather than duplicate the catalog.

export * from "@/lib/sim/guardrails/pii-entities";
