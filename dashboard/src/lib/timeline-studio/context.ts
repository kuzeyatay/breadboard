/** Import-free: the per-turn registry names the Video Studio connection without loading its server code. */
export const VIDEO_STUDIO_CONNECTION = "video-studio";

export interface VideoStudioSource { artifactId: string; conversationId: string; title: string }

/** A Spaces video: exports become new versions of this Garden file (or create it on the first export). */
export interface SpacesVideo { gardenId: string; fileId: string | null; title: string }

interface StudioPresence { lastSeen: number; source: VideoStudioSource | null; garden: SpacesVideo | null }
// Which users have the Video Studio page open right now, and what it was opened on.
const presence: Map<number, StudioPresence> = ((globalThis as { __breadboardVideoStudioPresence?: Map<number, StudioPresence> })
  .__breadboardVideoStudioPresence ??= new Map());

export function markStudioSeen(userId: number, source?: VideoStudioSource | null, garden?: SpacesVideo | null) {
  const current = presence.get(userId);
  // A file created by the first export is kept even though the page still polls without its id.
  const keep = garden && current?.garden?.gardenId === garden.gardenId && !garden.fileId ? current.garden.fileId : null;
  presence.set(userId, {
    lastSeen: Date.now(),
    source: source === undefined ? current?.source ?? null : source,
    garden: garden === undefined ? current?.garden ?? null : garden && { ...garden, fileId: garden.fileId ?? keep },
  });
}
export function studioClosed(userId: number) { presence.delete(userId); }
/** The page long-polls every 25 s, so 45 s without one means nobody has it open. */
export function studioPresence(userId: number): StudioPresence | null {
  const entry = presence.get(userId);
  return entry && Date.now() - entry.lastSeen < 45_000 ? entry : null;
}

const c = JSON.stringify(VIDEO_STUDIO_CONNECTION);

export function videoStudioContext(userId: number): string {
  const open = studioPresence(userId);
  return [
    `# video_studio`,
    `Breadboard's Video Studio (Video in Spaces) is a full multi-track video editor (Timeline Studio): main visuals, picture-in-picture overlays, captions, voiceover, music, stickers, transitions, ratio and fit, markers, local AI voiceover and transcription, and export. It is Breadboard's single video capability: when the user gives source material (a chat video, an uploaded clip, a video artifact) and asks for edits, edit it here. Bread drives the open editor through mcp_call connection=${c}. Call tool="__breadboard_list_tools" args={} first for the exact tools and schemas.`,
    `Workflow: breadboard_import_media {artifactId} (or {blobId} for a video attached to the chat) puts media into the editor's My assets; timeline_project_inspect gives the stateToken; timeline_assets_inspect gives assetIds; timeline_edit_preview {stateToken, operations, summary} then timeline_edit_apply {previewId}; timeline_media_sample checks frames; timeline_export_prepare then timeline_export_start then poll timeline_export_inspect until succeeded. A finished export is saved automatically: as a new version of the Spaces video open in the studio, else of the video artifact it was opened on, else as a new video artifact in this chat.`,
    `Cutting: visual.split "at" is seconds into THAT clip, not timeline time. To remove timeline seconds a-b from one clip starting at 0, in one preview: visual.split {clipId, at:a, rightClipId:"mid"}, visual.split {clipId:"mid", at:b-a, rightClipId:"tail"}, visual.delete {clipId:"mid"}. Add captions in that same preview after the cuts (captions that cross a split are rejected).`,
    `New footage the editor cannot make itself comes from Breadboard's other video tools, which feed this editor: video_render with the /video skill (2D motion graphics, titles, explainers) or the /film skill (3D, cinematic), and image generation for stills. Render the piece, then breadboard_import_media with the artifact id it returned and place it on the timeline. Longer generated productions (/agents:hyperframes, /agents:openmontage, /agents:vimax, /agents:vox-director, /agents:money-printer, /agents:shorts) also end in video artifacts that import the same way.`,
    open
      ? `The user has Video Studio open right now${open.garden ? `, on the Spaces video ${JSON.stringify(open.garden.title)}` : open.source ? `, opened on the video artifact ${JSON.stringify(open.source.title)} (${open.source.artifactId})` : ""}: "this video/clip/timeline" means the project open there.`
      : `Video Studio is not open right now, so its editing tools will fail with video_studio_closed. Ask the user to open it (Spaces, then Video, or "Open in Video Studio" on a video) and continue there.`,
  ].join("\n");
}
