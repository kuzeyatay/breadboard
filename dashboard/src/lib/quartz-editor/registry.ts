/** Quartz objects keep their authored source; runtimes are scoped to the node view. */
export const embedRegistry = [
  { kind: 'whiteboard', match: /^```penecho\b/, label: 'Whiteboard', interact: 'Edit whiteboard', flushBeforeDetach: true },
  { kind: 'interactive', match: /^```(?:breadboard-(?:generated-|detached-)?visual|artifact)\b/, label: 'Interactive artifact', interact: 'Interact' },
  { kind: 'mermaid', match: /^```mermaid\b/, label: 'Diagram', interact: 'Interact' },
  { kind: 'math', match: /^\${1,2}/, label: 'Equation' },
  { kind: 'media', match: /^!\[.*(?:youtube|youtu\.be|\.(?:mp4|webm|mov|m4v|ogv|mp3|wav|ogg|pdf)(?:[)|?#]|$))/i, label: 'Media', interact: 'Interact' },
  { kind: 'image', match: /^(?:<img\b|!\[\[[^\]]+\.(?:png|jpe?g|webp|gif|svg)(?:\||\]\])|!\[[^\[])/i, label: 'Image' },
  { kind: 'transclusion', match: /^!\[\[/, label: 'Referenced note', interact: 'Interact' },
  { kind: 'source', match: /[\s\S]*/, label: 'Source', interact: 'Interact' },
] as const;
export const embedAdapter = (raw: string) => embedRegistry.find(adapter => adapter.match.test(raw))!;
export const serializeEmbed = (attrs: { raw: string; uploadId?: string }) => attrs.uploadId ? '' : attrs.raw;
export function disposeObject(root: Node) { document.dispatchEvent(new CustomEvent('bb:dispose-object', { detail: { root } })); }
export function hydrateObject(root: Node) { document.dispatchEvent(new CustomEvent('bb:hydrate-objects', { detail: { root } })); }
