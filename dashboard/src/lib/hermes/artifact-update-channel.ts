import type { PresentedArtifact } from "./artifact-types.ts";

export const ARTIFACT_UPDATE_CHANNEL = "breadboard:artifact-updates:v1";
export const ARTIFACT_UPDATED_MESSAGE = "breadboard:artifact-updated";

interface ArtifactUpdateMessage {
  type: typeof ARTIFACT_UPDATED_MESSAGE;
  artifact: PresentedArtifact;
}

function isArtifactUpdateMessage(value: unknown): value is ArtifactUpdateMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ArtifactUpdateMessage>;
  return message.type === ARTIFACT_UPDATED_MESSAGE &&
    Boolean(message.artifact) &&
    typeof message.artifact?.id === "string" &&
    typeof message.artifact?.version === "number";
}

/** Tell every same-origin Breadboard window that an artifact has a new version. */
export function broadcastArtifactUpdate(artifact: PresentedArtifact): void {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(ARTIFACT_UPDATE_CHANNEL);
    channel.postMessage({ type: ARTIFACT_UPDATED_MESSAGE, artifact } satisfies ArtifactUpdateMessage);
    channel.close();
  }

  // Browser popups retain an opener; Electron creates an independent hardened
  // BrowserWindow and relies on BroadcastChannel. Supporting both also covers
  // older browser engines without BroadcastChannel.
  try {
    window.opener?.postMessage(
      { type: ARTIFACT_UPDATED_MESSAGE, artifact } satisfies ArtifactUpdateMessage,
      window.location.origin,
    );
  } catch {
    // The save already succeeded. A parent refresh will still discover it.
  }
}

export function subscribeToArtifactUpdates(
  listener: (artifact: PresentedArtifact) => void,
): () => void {
  const channel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(ARTIFACT_UPDATE_CHANNEL)
    : null;
  const receiveChannel = (event: MessageEvent<unknown>) => {
    if (isArtifactUpdateMessage(event.data)) listener(event.data.artifact);
  };
  const receiveWindow = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin || !isArtifactUpdateMessage(event.data)) return;
    listener(event.data.artifact);
  };

  channel?.addEventListener("message", receiveChannel);
  window.addEventListener("message", receiveWindow);
  return () => {
    channel?.removeEventListener("message", receiveChannel);
    channel?.close();
    window.removeEventListener("message", receiveWindow);
  };
}
