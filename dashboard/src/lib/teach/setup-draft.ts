// The unsaved setup for teaching a workflow.
//
// A name and objective can take a few minutes to word. They belong to this
// browser until Start teaching commits them to a real session, so navigating to
// another page must not erase them. Recording data is deliberately absent: the
// event log, screenshots and narration remain in the server-owned session.

const STORAGE_KEY = "breadboard:teach-workflow-setup-draft:v1";
const MAX_NAME_LENGTH = 500;
const MAX_OBJECTIVE_LENGTH = 8_000;
const MAX_DEVICE_ID_LENGTH = 1_000;
const MAX_WORKFLOW_ID_LENGTH = 500;

export interface TeachSetupDraft {
  name: string;
  objective: string;
  microphoneId: string;
  reteachWorkflowId: string | null;
  reteachName?: string;
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, maximum);
}

/** Return the open setup draft, treating blocked or malformed storage as empty. */
export function readTeachSetupDraft(storage: Pick<Storage, "getItem">): TeachSetupDraft | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const name = boundedString(value.name, MAX_NAME_LENGTH);
    const objective = boundedString(value.objective, MAX_OBJECTIVE_LENGTH);
    const microphoneId = boundedString(value.microphoneId, MAX_DEVICE_ID_LENGTH);
    const reteachWorkflowId =
      value.reteachWorkflowId === null
        ? null
        : boundedString(value.reteachWorkflowId, MAX_WORKFLOW_ID_LENGTH);
    if (name === null || objective === null || microphoneId === null || reteachWorkflowId === null && value.reteachWorkflowId !== null) {
      return null;
    }
    const reteachName = boundedString(value.reteachName, MAX_NAME_LENGTH);
    return {
      name,
      objective,
      microphoneId,
      reteachWorkflowId,
      ...(reteachName !== null ? { reteachName } : {}),
    };
  } catch {
    return null;
  }
}

/** Keep the setup locally. Storage failure never interrupts what is on screen. */
export function writeTeachSetupDraft(
  storage: Pick<Storage, "setItem">,
  draft: TeachSetupDraft,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // A disabled or full browser store costs persistence, not the live draft.
  }
}

/** Explicit cancellation or a successful start consumes the setup draft. */
export function clearTeachSetupDraft(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // The store may be blocked; there is nothing else to clear locally.
  }
}
