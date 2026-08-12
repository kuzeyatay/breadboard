// Gadgets: small, self-contained apps the agent writes on request, which the
// user can keep, reopen, edit, and run.
//
// The shape is taken from Cloudflare OS (packages/workshop-shared/src/gatekeeper.ts
// and docs/blueprints.md in the vendored clone). What is NOT taken is the
// runtime: a Cloudflare gadget executes in a Dynamic Worker Facet, which is a
// proprietary Workers primitive with no local equivalent. A Breadboard gadget
// runs in the `sandbox="allow-scripts"` iframe the interactive visualizer
// already uses, and reaches the outside world only through the host bridge in
// `gadget-runtime.ts`.
//
// The idea worth porting is the *authorization* model, and it is reproduced
// faithfully:
//
//   - Every read a gadget performs is an **observation**, authorized before any
//     data is returned, and recorded.
//   - Every write is an **action**, which is NOT performed when it is requested.
//     It is described, simulated, queued, and applied only after the user
//     approves — which may be seconds or days later.
//   - Because the queue simulates, the gadget keeps running against state that
//     already reflects its pending writes, so it can stack dependent work
//     instead of stalling on each confirmation.
//
// That last property is the whole point, and it is what the existing inline
// approve/reject gate (see `authorizeTerminalCommand`) cannot do: that one
// blocks the turn on a modal and resumes with the approved command.

/** Semantic version of the gadget package format written into every manifest. */
export const GADGET_SCHEMA_VERSION = 1;
export const GADGET_RUNTIME_VERSION = "1.0.0";
export const GADGET_MAX_REPAIR_ATTEMPTS = 3;

/** Hard caps. A gadget is a small app, not an application server. */
export const GADGET_MAX_FILE_BYTES = 400_000;
export const GADGET_MAX_TOTAL_BYTES = 1_000_000;
export const GADGET_MAX_BINDINGS = 12;
/** Beyond this the queue is not reviewable, so the bridge refuses new actions. */
export const GADGET_MAX_PENDING_ACTIONS = 50;

// ---------------------------------------------------------------------------
// Bindings — what a gadget is allowed to reach
// ---------------------------------------------------------------------------

/**
 * The capability families a gadget may bind. Deliberately far narrower than
 * Cloudflare's vendor list: each entry is something Breadboard already owns and
 * can therefore both simulate and apply. A gadget cannot bind anything else,
 * and a binding grants nothing on its own — every call through it is still
 * authorized per-operation.
 */
export const GADGET_BINDING_KINDS = [
  /** Private per-gadget key/value state. The only binding that is not shared. */
  "storage",
  /** Read and create Breadboard artifacts. */
  "artifact",
  /** Send a message to the owner's own linked WhatsApp/Telegram. */
  "messaging",
  /** Read and write the user's durable agent memory. */
  "memory",
] as const;
// Garden is deliberately absent. Every Garden read in Breadboard goes through
// `executeGardenTool`, which authorizes against a per-turn capability token; a
// gadget outlives the turn that made it and holds no such token. Adding it means
// minting a gadget-scoped token first, which is its own decision.
export type GadgetBindingKind = (typeof GADGET_BINDING_KINDS)[number];

/**
 * One named connection a gadget declares. `name` is the stable key its code
 * calls through (`host.garden.search(...)` binds to name "garden"), which is why
 * it must not encode the specific resource — the same gadget may be pointed at a
 * different Garden later. This mirrors `suggestedBindingName` upstream.
 */
export interface GadgetBinding {
  name: string;
  kind: GadgetBindingKind;
  /** Why the gadget needs it, shown to the user before the gadget first runs. */
  purpose: string;
  /**
   * Whether this binding may be used for writes at all. A read-only binding's
   * action methods are absent from the bridge, so a gadget that only reads
   * cannot later be talked into writing by its own generated code.
   */
  writable: boolean;
}

// ---------------------------------------------------------------------------
// The package — what "a gadget" actually is
// ---------------------------------------------------------------------------

export interface GadgetManifest {
  schemaVersion: typeof GADGET_SCHEMA_VERSION;
  artifactType: "gadget";
  title: string;
  /** One line, shown on the artifact card. */
  description: string;
  /** What the gadget is for, in the user's terms. Shown above the sandbox. */
  purpose: string;
  bindings: GadgetBinding[];
  entry: "index.html";
  runtime: { id: "breadboard-gadget"; version: string };
}

/**
 * A gadget's complete source. Stored as the artifact source exactly like a
 * hardware blueprint or a CAD manifest, so reopening a gadget never calls the
 * model again and editing one is a diff against real files rather than a
 * regeneration.
 */
export interface GadgetPackage {
  schemaVersion: typeof GADGET_SCHEMA_VERSION;
  manifest: GadgetManifest;
  files: {
    "index.html": string;
    "styles.css": string;
    "main.js": string;
  };
  /** Stated plainly so the user can judge the gadget without reading its code. */
  assumptions: string[];
  limitations: string[];
}

export interface GadgetValidation {
  valid: boolean;
  checkedAt: string;
  sourceBytes: number;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Observations — reads
// ---------------------------------------------------------------------------

/**
 * Port of upstream `ObservationDescription`. A read is authorized *before* its
 * data reaches the gadget, and the record of it is what makes a later "what has
 * this thing been looking at" answerable.
 */
export interface GadgetObservationDescription {
  /** One line, for the audit list. */
  title: string;
  /** Complete description in Markdown, including anything relevant to judging it. */
  description: string;
  binding: string;
  operation: string;
}

// ---------------------------------------------------------------------------
// Actions — writes
// ---------------------------------------------------------------------------

/**
 * A stable machine tag plus its display label, travelling together. Policy keys
 * on `tag`; `label` is the only part shown. Upstream `ActionKind`.
 */
export interface GadgetActionKind {
  tag: string;
  label: string;
}

/**
 * Port of upstream `ActionDescription`: everything needed to decide whether an
 * action should happen, render it for review, and log it.
 */
export interface GadgetActionDescription {
  title: string;
  /** Markdown. Must contain every detail relevant to approving. */
  description: string;
  binding: string;
  operation: string;
  actionKind: GadgetActionKind;
  /** Whether this action can be undone after it has been applied. */
  implementsRevert: boolean;
  /**
   * Author's verdict that this specific action is safe to apply without review,
   * IF the user has separately opted in to auto-approving its kind. Absent means
   * never auto-approvable, whatever rules exist. Both gates must pass.
   */
  autoApprovable?: boolean;
  /**
   * Set when the effects of this action are NOT simulated, so a gadget that kept
   * running would read a world where its own write did not happen. Upstream sets
   * this to tell the harness to suspend the turn. Breadboard simulates every
   * action it accepts, so this stays unset — it exists to keep the contract
   * honest if a future binding cannot simulate.
   */
  awaitDecision?: boolean;
}

/**
 * The predicted result of an action, computed *before* the user decides, and the
 * reason this is an improvement over approving a raw call. The user reads what
 * would change; the gadget reads `simulatedResult` and keeps going.
 */
export interface GadgetActionSimulation {
  /** Whether the simulation itself succeeded. A failed one blocks queueing. */
  ok: boolean;
  /** Markdown shown in the approval card: what the world looks like afterward. */
  outcome: string;
  /** Field-level before/after, when the binding can express one. */
  changes: Array<{ field: string; before: string | null; after: string | null }>;
  /**
   * The value handed back to the gadget in place of the real return, so its next
   * statement can run. It must be shaped like the real result.
   */
  simulatedResult: unknown;
  /** Why the simulation could not be produced, when `ok` is false. */
  error?: string;
}

export const GADGET_ACTION_STATUSES = [
  "pending",
  "approved",
  "applied",
  "rejected",
  "failed",
  "reverted",
] as const;
export type GadgetActionStatus = (typeof GADGET_ACTION_STATUSES)[number];

export interface GadgetAction {
  id: string;
  gadgetArtifactId: string;
  /** Sequential per gadget, assigned on submit. Upstream's integer action id. */
  sequence: number;
  status: GadgetActionStatus;
  description: GadgetActionDescription;
  simulation: GadgetActionSimulation;
  /** Set once applied — the real result, which may differ from the simulation. */
  appliedResult: unknown | null;
  error: { code: string; message: string } | null;
  /** True when policy applied this without asking, via a matching opt-in rule. */
  autoApplied: boolean;
  submittedAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
  revertedAt: string | null;
}

export interface GadgetObservation {
  id: string;
  gadgetArtifactId: string;
  sequence: number;
  description: GadgetObservationDescription;
  observedAt: string;
}

/**
 * A user's standing opt-in to auto-apply one kind of action from one gadget.
 * Keyed on `actionKind.tag`, matching upstream. The per-action `autoApprovable`
 * verdict is still the binding gate at apply time, so a rule can never widen
 * what the binding itself considers safe.
 */
export interface GadgetAutoApprovalRule {
  gadgetArtifactId: string;
  actionKindTag: string;
  actionKindLabel: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// The queue interface
// ---------------------------------------------------------------------------

/**
 * Port of upstream `ApprovalQueue`. The asymmetry is the design:
 *
 *   - `authorizeObservation` is synchronous and throws to deny. A read either
 *     happens now or not at all.
 *   - `submitAction` returns immediately with a simulation. The write itself
 *     happens whenever the user gets to it.
 */
export interface GadgetApprovalQueue {
  authorizeObservation(description: GadgetObservationDescription): Promise<void>;
  submitAction(input: {
    description: GadgetActionDescription;
    /** The real arguments, replayed verbatim when the action is applied. */
    payload: unknown;
  }): Promise<{ action: GadgetAction; simulatedResult: unknown }>;
}

/**
 * What a binding must implement to be reachable from a gadget. `simulate` and
 * `apply` are separate on purpose: `simulate` must not touch the world, and
 * `apply` runs against the same payload much later, so neither may depend on
 * state held between them.
 */
export interface GadgetBindingHandler {
  kind: GadgetBindingKind;
  /** Read operations, keyed by the name the gadget calls. */
  observations: Record<
    string,
    (input: {
      payload: unknown;
      context: GadgetBindingContext;
    }) => Promise<{ description: GadgetObservationDescription; result: unknown }>
  >;
  /** Write operations. Each must be able to describe, simulate, and apply. */
  actions: Record<
    string,
    {
      describe(input: {
        payload: unknown;
        context: GadgetBindingContext;
      }): GadgetActionDescription;
      simulate(input: {
        payload: unknown;
        context: GadgetBindingContext;
      }): Promise<GadgetActionSimulation>;
      apply(input: {
        payload: unknown;
        context: GadgetBindingContext;
      }): Promise<unknown>;
      /** Absent when the action cannot be undone; `implementsRevert` must agree. */
      revert?(input: {
        payload: unknown;
        appliedResult: unknown;
        context: GadgetBindingContext;
      }): Promise<{ message?: string; canRetry?: boolean }>;
    }
  >;
}

/**
 * Everything a binding handler is allowed to know about its caller.
 *
 * The session and run ids are the gadget's *own* — the ones from the turn that
 * built it, not from whoever is looking at it now. An action applied a week
 * later still has to be attributable, and "the run that created this gadget" is
 * the only honest answer available at that point.
 */
export interface GadgetBindingContext {
  userId: number;
  gadgetArtifactId: string;
  conversationId: number;
  conversationPublicId: string;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runtimeSessionId: number;
  hermesSessionId: string;
  runId: string;
  binding: GadgetBinding;
}

/** Bridge message names, shared by the host route and the in-sandbox client. */
export const GADGET_BRIDGE_OBSERVE = "gadget:observe";
export const GADGET_BRIDGE_ACT = "gadget:act";
