// Editor-local copies of sim's serialized editor-state shape (the contract the
// canvas persists through PUT /api/workflows/[id] { state }). Kept structural
// so the canvas compiles independently of the engine's vendored types.

export type SubBlockValue = string | number | boolean | string[][] | unknown[] | Record<string, unknown> | null;

export type SubBlockState = {
  id: string;
  type: string;
  value: SubBlockValue;
};

export type BlockState = {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  subBlocks: Record<string, SubBlockState>;
  outputs: Record<string, unknown>;
  enabled: boolean;
  horizontalHandles?: boolean;
  errorEnabled?: boolean;
  height?: number;
  advancedMode?: boolean;
  triggerMode?: boolean;
  data?: Record<string, unknown>;
  locked?: boolean;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
};

/** The state JSON stored on a workflow row (sim's editor-state shape). */
export type WorkflowStateJson = {
  blocks: Record<string, BlockState>;
  edges: WorkflowEdge[];
  loops?: Record<string, unknown>;
  parallels?: Record<string, unknown>;
};

export type WorkflowRunLog = {
  blockId?: string;
  blockName?: string;
  blockType?: string;
  success?: boolean;
  status?: string;
  output?: unknown;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  endedAt?: string;
};

export function emptyWorkflowState(): WorkflowStateJson {
  return { blocks: {}, edges: [], loops: {}, parallels: {} };
}
