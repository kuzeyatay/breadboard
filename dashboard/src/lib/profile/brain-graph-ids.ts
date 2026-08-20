import crypto from "node:crypto";

const SAFE_PART = /^[a-zA-Z0-9._~-]+$/;

function secret(): string {
  return (
    process.env.BRAIN_GRAPH_ID_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "breadboard-local-brain-graph-v1"
  );
}

export function safeIdPart(value: string): string {
  const normalized = value.trim().normalize("NFKC");
  return SAFE_PART.test(normalized)
    ? normalized
    : Buffer.from(normalized, "utf8").toString("base64url");
}

export function opaqueBrainId(namespace: string, value: string | number): string {
  const digest = crypto
    .createHmac("sha256", secret())
    .update(`${namespace}\0${String(value)}`)
    .digest("base64url")
    .slice(0, 22);
  return `${namespace}_${digest}`;
}

export function organizationPublicId(organizationId: number): string {
  return opaqueBrainId("org", organizationId);
}

export function memberNodeId(username: string): string {
  return `member:${opaqueBrainId("person", username.toLocaleLowerCase())}`;
}

export function gardenNodeId(slug: string): string {
  return `garden:${safeIdPart(slug)}`;
}

export function knowledgeNodeId(gardenSlug: string, kind: string, slug: string): string {
  return `garden:${safeIdPart(gardenSlug)}:${kind}:${safeIdPart(slug)}`;
}

export function conversationNodeId(publicId: string): string {
  return `conversation:${safeIdPart(publicId)}`;
}

export function memoryNodeId(memoryId: number): string {
  return `memory:${opaqueBrainId("memory", memoryId)}`;
}

export function artifactNodeId(artifactId: string): string {
  return `artifact:${safeIdPart(artifactId)}`;
}

export function buzzRoomNodeId(publicId: string): string {
  return `buzz-room:${safeIdPart(publicId)}`;
}

export function buzzThreadNodeId(roomPublicId: string, messageId: number): string {
  return `buzz-thread:${opaqueBrainId("thread", `${roomPublicId}:${messageId}`)}`;
}

export function agentNodeId(slug: string): string {
  return `agent:${safeIdPart(slug.toLocaleLowerCase())}`;
}

export function brainEdgeId(
  source: string,
  target: string,
  relation: string,
  origin: string,
): string {
  return opaqueBrainId("edge", `${source}\0${target}\0${relation}\0${origin}`);
}
