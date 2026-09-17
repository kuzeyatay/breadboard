export interface ServerEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

/** Message events nest ownership; service heartbeats have no session owner. */
export function eventSessionId(event: ServerEvent): string | null {
  const properties = event.properties ?? {};
  for (const value of [properties, properties.info, properties.part]) {
    if (value && typeof value === "object" && "sessionID" in value && typeof value.sessionID === "string") {
      return value.sessionID;
    }
  }
  return null;
}

export function sessionIsIdle(event: ServerEvent): boolean {
  if (event.type === "session.idle") return true;
  const status = event.properties?.status;
  return event.type === "session.status" && !!status && typeof status === "object" && "type" in status && status.type === "idle";
}
