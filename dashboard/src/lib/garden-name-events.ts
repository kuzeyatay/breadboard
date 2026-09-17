const GARDEN_NAME_EVENT = "breadboard:garden-name-changed";

interface GardenNameChange {
  slug: string;
  name: string;
}

function isGardenNameChange(value: unknown): value is GardenNameChange {
  if (!value || typeof value !== "object") return false;
  const change = value as Partial<GardenNameChange>;
  return typeof change.slug === "string" && Boolean(change.slug) &&
    typeof change.name === "string" && Boolean(change.name.trim());
}

/** Publish only after a rename has been saved successfully. */
export function announceGardenNameChange(slug: string, name: string): void {
  const change = { slug, name: name.trim() };
  if (!isGardenNameChange(change)) return;
  window.dispatchEvent(new CustomEvent(GARDEN_NAME_EVENT, { detail: change }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(GARDEN_NAME_EVENT);
    channel.postMessage(change);
    channel.close();
  }
}

export function subscribeToGardenNameChanges(listener: (change: GardenNameChange) => void): () => void {
  const receive = (value: unknown) => {
    if (isGardenNameChange(value)) listener(value);
  };
  const onLocalChange = (event: Event) => receive((event as CustomEvent<unknown>).detail);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(GARDEN_NAME_EVENT) : null;
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
  window.addEventListener(GARDEN_NAME_EVENT, onLocalChange);
  return () => {
    window.removeEventListener(GARDEN_NAME_EVENT, onLocalChange);
    channel?.close();
  };
}
