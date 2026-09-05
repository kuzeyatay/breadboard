export interface ClickySnapshot {
  displayId: string;
  width: number;
  height: number;
  dataUrl: string;
}

export interface ClickyMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClickyPoint { displayId: string; x: number; y: number }

export function parseClickyRequest(value: unknown): {
  messages: ClickyMessage[];
  snapshots: ClickySnapshot[];
} {
  if (!value || typeof value !== "object") throw new Error("A question is required.");
  const { messages, snapshots } = value as Record<string, unknown>;
  if (!Array.isArray(messages) || !messages.length || messages.length > 16
    || !messages.every((message) => message && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string" && message.content.trim() && message.content.length <= 8000)
    || messages.at(-1).role !== "user") throw new Error("Send a question of at most 8,000 characters.");
  if (!Array.isArray(snapshots) || snapshots.length > 4
    || !snapshots.every((snapshot) => snapshot && typeof snapshot.displayId === "string"
      && /^-?\d{1,20}$/.test(snapshot.displayId)
      && Number.isInteger(snapshot.width) && snapshot.width > 0 && snapshot.width <= 1600
      && Number.isInteger(snapshot.height) && snapshot.height > 0 && snapshot.height <= 1600
      && typeof snapshot.dataUrl === "string" && snapshot.dataUrl.length < 2_000_000
      && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(snapshot.dataUrl))) {
    throw new Error("Clicky could not read the screen snapshots. Take another snapshot and try again.");
  }
  return {
    messages: messages.map(({ role, content }) => ({ role, content })),
    snapshots: snapshots.map(({ displayId, width, height, dataUrl }) => ({ displayId, width, height, dataUrl })),
  };
}

export function parseClickyReply(reply: string, snapshots: readonly ClickySnapshot[]): {
  text: string;
  point: ClickyPoint | null;
} {
  let point: ClickyPoint | null = null;
  const text = reply.replace(/\[POINT:([^\]]*)\]/g, (_tag, coordinates: string) => {
    const match = /^(-?\d{1,20}):(\d{1,4}):(\d{1,4})$/.exec(coordinates);
    if (!point && match && snapshots.some((snapshot) => snapshot.displayId === match[1])) {
      const x = Number(match[2]);
      const y = Number(match[3]);
      if (x <= 1000 && y <= 1000) point = { displayId: match[1], x, y };
    }
    return "";
  }).trim();
  return { text, point };
}
