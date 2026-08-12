export type PublicWorkflowTemplate = {
  id: number;
  name: string;
  description: string;
  author: string;
  authorVerified: boolean;
  totalViews: number;
  createdAt: string | null;
  nodeNames: string[];
};

export type SafeTemplateWorkflow = {
  id: number;
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

export function isFreeTemplateListing(value: unknown): boolean {
  const item = record(value);
  return Boolean(
    item &&
      finiteNumber(item.price, -1) === 0 &&
      (item.purchaseUrl === null || item.purchaseUrl === undefined || item.purchaseUrl === ""),
  );
}

export function normalizeTemplateSearchPayload(value: unknown): {
  total: number;
  workflows: PublicWorkflowTemplate[];
} {
  const root = record(value);
  const rawWorkflows = Array.isArray(root?.workflows) ? root.workflows : [];
  const workflows = rawWorkflows.flatMap((raw) => {
    const item = record(raw);
    if (!item || !isFreeTemplateListing(item)) return [];
    const id = finiteNumber(item.id, -1);
    const name = cleanText(item.name, 160);
    if (!Number.isInteger(id) || id <= 0 || !name) return [];
    const user = record(item.user);
    const rawNodes = Array.isArray(item.nodes) ? item.nodes : [];
    const nodeNames = [...new Set(
      rawNodes
        .map((node) => cleanText(record(node)?.displayName, 60))
        .filter(Boolean),
    )].slice(0, 6);
    return [{
      id,
      name,
      description: cleanText(item.description, 360),
      author: cleanText(user?.name, 80) || "n8n community",
      authorVerified: user?.verified === true,
      totalViews: Math.max(0, finiteNumber(item.totalViews)),
      createdAt: cleanText(item.createdAt, 40) || null,
      nodeNames,
    }];
  });
  return {
    total: Math.max(workflows.length, finiteNumber(root?.totalWorkflows, workflows.length)),
    workflows,
  };
}

export function templateDetailIdentity(value: unknown): { id: number; name: string } {
  const root = record(value);
  const workflow = record(root?.workflow);
  const id = finiteNumber(workflow?.id, -1);
  const name = cleanText(workflow?.name, 160);
  if (!Number.isInteger(id) || id <= 0 || !name) {
    throw new Error("The n8n template metadata is invalid.");
  }
  return { id, name };
}

function withoutCredentials(node: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...node };
  delete safe.credentials;
  return safe;
}

export function validateTemplateWorkflow(value: unknown, expectedId: number): SafeTemplateWorkflow {
  const root = record(value);
  const id = finiteNumber(root?.id, -1);
  const name = cleanText(root?.name, 128);
  const workflow = record(root?.workflow);
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : null;
  const connections = record(workflow?.connections);
  if (id !== expectedId || !name || !nodes || !connections) {
    throw new Error("The n8n template workflow is invalid.");
  }
  if (nodes.length > 500) throw new Error("This template is too large to import safely.");
  const safeNodes = nodes.map((rawNode) => {
    const node = record(rawNode);
    const nodeName = cleanText(node?.name, 160);
    const nodeType = cleanText(node?.type, 200);
    if (!node || !nodeName || !nodeType) {
      throw new Error("The n8n template contains an invalid node.");
    }
    return withoutCredentials(node);
  });
  const settings = record(workflow?.settings) ?? {};
  return { id, name, nodes: safeNodes, connections, settings };
}
