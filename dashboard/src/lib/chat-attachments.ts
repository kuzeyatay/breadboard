import {
  isModelAttachmentFormat,
  isModelBlobId,
  MAX_MODEL_ATTACHMENT_BYTES,
  MODEL_ATTACHMENT_ACCEPT,
  modelAttachmentFormat,
  normalizeModelAttachmentSummary,
  type ModelAttachmentFormat,
  type ModelAttachmentSummary,
} from './model-attachments.ts';
import {
  isDocumentAttachmentFormat,
  isDocumentBlobId,
  normalizeDocumentSummary,
  DOCUMENT_ATTACHMENT_ACCEPT,
  DOCUMENT_FILENAME_HEADER,
  MAX_DOCUMENT_ATTACHMENT_BYTES,
  documentAttachmentFormat,
  type DocumentAttachmentFormat,
  type DocumentAttachmentSummary,
} from './document-attachments.ts';
import {
  formatVideoSize,
  isVideoAttachmentFormat,
  isVideoBlobId,
  MAX_VIDEO_ATTACHMENT_BYTES,
  VIDEO_ATTACHMENT_ACCEPT,
  VIDEO_FILENAME_HEADER,
  videoAttachmentFormat,
  type VideoAttachmentFormat,
} from './video-attachments.ts';
import {
  AUDIO_ATTACHMENT_ACCEPT,
  AUDIO_FILENAME_HEADER,
  audioAttachmentFormat,
  isAudioAttachmentFormat,
  isAudioBlobId,
  MAX_AUDIO_ATTACHMENT_BYTES,
  type AudioAttachmentFormat,
} from './audio-attachments.ts';

/**
 * Audio is in the common list rather than the Terminal's, unlike video: nothing
 * about analysing a song needs a workspace. The analyzer is handed the stored
 * file server-side, so a track can be dropped into any chat that has one.
 */
export const CHAT_ATTACHMENT_ACCEPT =
  `.pdf,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,.json,.docx,.pptx,.xlsx,.odt,.ods,.odp,.zip,${MODEL_ATTACHMENT_ACCEPT},${AUDIO_ATTACHMENT_ACCEPT}`;

/**
 * The Terminal accepts one thing the other chats do not: a video. Reading one
 * means the Watch skill, and Watch needs the Terminal's workspace to run in — so
 * offering a video anywhere else would be offering a file nothing could open.
 */
export const TERMINAL_ATTACHMENT_ACCEPT =
  `${CHAT_ATTACHMENT_ACCEPT},${VIDEO_ATTACHMENT_ACCEPT}`;

export type ChatAttachment =
  | { type: 'text'; text: string; name: string; sizeBytes?: number }
  | { type: 'image'; dataUrl: string; name: string; sizeBytes?: number }
  | {
      /**
       * A stored video. Like a mesh it keeps a blob id rather than its bytes,
       * but for a different reason: a video is far too large to inline and
       * there is no text in it to extract. What reads it is the Watch skill,
       * server-side, from the file this points at.
       */
      type: 'video';
      name: string;
      blobId: string;
      format: VideoAttachmentFormat;
      sizeBytes?: number;
    }
  | {
      /**
       * A stored song. Like a video it keeps a blob id rather than its bytes,
       * and for the same reason: what is worth knowing about it — key, tempo,
       * loudness, where the sections change — is in the waveform, and only the
       * audio analyzer can read that. Unlike a video it is welcome in any chat,
       * because the analyzer is handed the stored file rather than a path
       * inside a workspace.
       */
      type: 'audio';
      name: string;
      blobId: string;
      format: AudioAttachmentFormat;
      sizeBytes?: number;
    }
  | {
      type: 'model';
      name: string;
      /** Identifies the stored bytes; see conversations/model-blob-store.ts. */
      blobId: string;
      format: ModelAttachmentFormat;
      sizeBytes?: number;
      summary?: ModelAttachmentSummary;
      /**
       * A mesh derived from `blobId` for formats the browser cannot open — a
       * STEP file tessellated to glTF by the local CAD service. The original is
       * still what downloads; this is only what draws.
       */
      previewBlobId?: string;
      previewFormat?: ModelAttachmentFormat;
    }
  | {
      /**
       * A stored document, and the third attachment kind whose bytes are the
       * point — the one it took longest to admit.
       *
       * Unlike a video or a mesh it carries *both*: `blobId` points at the
       * original file, and `text` is what was read out of it. Both, because
       * each alone is a different failure. Text alone is what Breadboard had,
       * and it is why no agent could mark up an agreement — the words were
       * there and the document was gone. Bytes alone would mean every model
       * wanting to answer a question about the file has to open it first.
       */
      type: 'document';
      name: string;
      /** Identifies the stored bytes; see conversations/document-blob-store.ts. */
      blobId: string;
      format: DocumentAttachmentFormat;
      sizeBytes?: number;
      /** The structured reading: tables as tables, equations as LaTeX. */
      text: string;
      /** What is in the file besides prose, so a model is told rather than left to guess. */
      summary?: DocumentAttachmentSummary;
      /** Figures lifted out of the file, by sidecar name, in document order. */
      figures?: string[];
    };

/**
 * The safe, serializable attachment shape retained with a chat message.
 * Extracted text is deliberately not copied into transcript metadata; the
 * filename is enough for non-image files, while images keep their data URL so
 * pasted screenshots remain viewable after the composer is cleared or the
 * conversation is reopened.
 *
 * A 3D model and a video each keep a blob id rather than their bytes: both are
 * far too large to live in message metadata, so the file itself is stored and
 * the message points at it.
 *
 * A document now does the same, and that is a change from what the paragraph
 * above used to say. The old rule was that a document had been read at send
 * time so there was nothing left worth keeping — true of the words, false of
 * the file. Keeping the pointer is what lets an agent mark up the original
 * later, and what lets a regenerated turn run against the same documents
 * instead of against their names.
 *
 * `sizeBytes` is the size of the file the user actually picked, recorded so the
 * Uploads list can report it for files whose contents were never retained.
 */
export type ChatMessageAttachment =
  | { type: 'file'; name: string; sizeBytes?: number }
  | { type: 'image'; dataUrl: string; name: string; sizeBytes?: number }
  | {
      type: 'video';
      name: string;
      blobId: string;
      format: VideoAttachmentFormat;
      sizeBytes?: number;
    }
  | {
      type: 'audio';
      name: string;
      blobId: string;
      format: AudioAttachmentFormat;
      sizeBytes?: number;
    }
  | {
      type: 'model';
      name: string;
      blobId: string;
      format: ModelAttachmentFormat;
      sizeBytes?: number;
      summary?: ModelAttachmentSummary;
      previewBlobId?: string;
      previewFormat?: ModelAttachmentFormat;
    }
  | {
      type: 'document';
      name: string;
      blobId: string;
      format: DocumentAttachmentFormat;
      sizeBytes?: number;
      summary?: DocumentAttachmentSummary;
      figures?: string[];
    };

/**
 * Where an attached file opens, for the ones that open anywhere.
 *
 * Every stored document does. A PDF gets the same reader the garden opens a
 * source PDF in; everything else gets that reader's shape around the structural
 * reading, because a .docx has no pages to render outside Word. Nothing else
 * opens anywhere: a plain text file's contents were never kept, only its name.
 *
 * The name travels in the query string because the blob store never kept one —
 * on disk the file is its id and its format and nothing else — and the page
 * treats it as a name to show, never as a path.
 */
export function chatAttachmentHref(
  attachment: ChatMessageAttachment | undefined,
): string {
  if (!attachment || attachment.type !== 'document') return '';
  const viewer = attachment.format === 'pdf' ? 'pdf' : 'document';
  return `/attachments/${encodeURIComponent(attachment.blobId)}/${viewer}?name=${encodeURIComponent(
    attachment.name,
  )}`;
}

/**
 * The word an ordinal reference to this attachment would use. Documents count
 * by format because that is how people point at them — "the second pdf" means
 * the second .pdf, not the second document of whatever format.
 */
function attachmentOrdinalLabel(attachment: ChatAttachment): string {
  switch (attachment.type) {
    case 'document':
      return attachment.format;
    case 'text':
      return 'text file';
    case 'model':
      return '3D model';
    default:
      return attachment.type;
  }
}

/**
 * The order of one message's attachments, spelled out for the model.
 *
 * "The third screenshot" or "the second pdf" is only resolvable when the model
 * knows which file sat in which position: inlined texts and attached images
 * carry names, but nothing else says which came first, and images often reach
 * the model as bare pixels. Returns null below two attachments, where every
 * reference is already unambiguous.
 */
export function attachmentOrderManifest(
  attachments: readonly ChatAttachment[] | undefined,
): string | null {
  const list = attachments ?? [];
  if (list.length < 2) return null;
  const totals = new Map<string, number>();
  for (const attachment of list) {
    const label = attachmentOrdinalLabel(attachment);
    totals.set(label, (totals.get(label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const lines = list.map((attachment, index) => {
    const label = attachmentOrdinalLabel(attachment);
    const ordinal = (seen.get(label) ?? 0) + 1;
    seen.set(label, ordinal);
    const total = totals.get(label) ?? ordinal;
    const place = total > 1 ? `${label} ${ordinal} of ${total}` : label;
    return `${index + 1}. ${JSON.stringify(attachment.name)} — ${place}`;
  });
  return [
    `<breadboard_attachment_order count="${list.length}">`,
    'The user attached these files to this message, in this order:',
    ...lines,
    'When the user refers to an attachment by position — "the second image", "the third screenshot", "the first pdf" — count within that kind, in the order above. Attached images reach you in this same order.',
    '</breadboard_attachment_order>',
  ].join('\n');
}

const CHAT_IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function safeAttachmentName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240);
  return name || null;
}

function safeAttachmentSize(value: unknown): number | undefined {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? Math.round(size) : undefined;
}

/**
 * The derived-mesh pointer, kept only when both halves of it are valid. A
 * preview that names a blob but not its format cannot be loaded, so half of one
 * is dropped rather than stored as a viewer that will fail.
 */
function safeModelPreview(
  blobId: unknown,
  format: unknown,
): { previewBlobId: string; previewFormat: ModelAttachmentFormat } | Record<string, never> {
  return isModelBlobId(blobId) && isModelAttachmentFormat(format)
    ? { previewBlobId: blobId, previewFormat: format }
    : {};
}

export function chatMessageAttachments(
  attachments: readonly ChatAttachment[] | undefined,
): ChatMessageAttachment[] {
  return (attachments ?? []).flatMap<ChatMessageAttachment>((attachment) => {
    const name = safeAttachmentName(attachment.name);
    if (!name) return [];
    const sizeBytes = safeAttachmentSize(attachment.sizeBytes);
    const size = sizeBytes === undefined ? {} : { sizeBytes };
    if (attachment.type === 'image' && CHAT_IMAGE_DATA_URL.test(attachment.dataUrl)) {
      return [{ type: 'image' as const, name, dataUrl: attachment.dataUrl, ...size }];
    }
    if (
      attachment.type === 'video' &&
      isVideoBlobId(attachment.blobId) &&
      isVideoAttachmentFormat(attachment.format)
    ) {
      return [
        {
          type: 'video' as const,
          name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...size,
        },
      ];
    }
    if (
      attachment.type === 'audio' &&
      isAudioBlobId(attachment.blobId) &&
      isAudioAttachmentFormat(attachment.format)
    ) {
      return [
        {
          type: 'audio' as const,
          name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...size,
        },
      ];
    }
    if (
      attachment.type === 'model' &&
      isModelBlobId(attachment.blobId) &&
      isModelAttachmentFormat(attachment.format)
    ) {
      const summary = normalizeModelAttachmentSummary(attachment.summary);
      return [
        {
          type: 'model' as const,
          name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...size,
          ...(summary ? { summary } : {}),
          ...safeModelPreview(attachment.previewBlobId, attachment.previewFormat),
        },
      ];
    }
    if (
      attachment.type === 'document' &&
      isDocumentBlobId(attachment.blobId) &&
      isDocumentAttachmentFormat(attachment.format)
    ) {
      const summary = normalizeDocumentSummary(attachment.summary);
      return [
        {
          type: 'document' as const,
          name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...size,
          ...(summary ? { summary } : {}),
          ...(attachment.figures?.length ? { figures: safeFigureNames(attachment.figures) } : {}),
        },
      ];
    }
    return [{ type: 'file' as const, name, ...size }];
  });
}

/**
 * Sidecar figure names, validated rather than trusted. These end up in a URL
 * and, for an agent run, in a filename, so a name that is not one of ours is
 * dropped instead of carried.
 */
function safeFigureNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && /^figure-\d{1,4}\.[a-z0-9]{1,5}$/i.test(entry),
    )
    .slice(0, 200);
}

/**
 * Rebuilds attachments that can safely be reused for a regenerated turn.
 *
 * A plain text file still cannot be: its contents were never kept, only its
 * name. Everything whose bytes are stored can be — images by their data URL,
 * models and videos by their blob, and now documents by theirs. That last one
 * is why a retried turn used to run against nothing: the agent was handed a
 * list of filenames and no documents, and answered anyway.
 *
 * A reused document comes back with an empty `text`, because the transcript
 * never held it. The server fills it in from the stored file — see
 * `resolveDocumentAttachments` — which keeps this function synchronous and puts
 * the read where the bytes already are.
 */
export function reusableChatAttachments(
  attachments: readonly ChatMessageAttachment[] | undefined,
): ChatAttachment[] {
  return (attachments ?? []).flatMap<ChatAttachment>((attachment) => {
    if (attachment.type === 'image' && CHAT_IMAGE_DATA_URL.test(attachment.dataUrl)) {
      return [{ type: 'image' as const, name: attachment.name, dataUrl: attachment.dataUrl }];
    }
    if (attachment.type === 'video') {
      return [
        {
          type: 'video' as const,
          name: attachment.name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...(attachment.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
        },
      ];
    }
    if (attachment.type === 'audio') {
      return [
        {
          type: 'audio' as const,
          name: attachment.name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...(attachment.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
        },
      ];
    }
    if (attachment.type === 'model') {
      return [
        {
          type: 'model' as const,
          name: attachment.name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...(attachment.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
          ...(attachment.summary ? { summary: attachment.summary } : {}),
          ...safeModelPreview(attachment.previewBlobId, attachment.previewFormat),
        },
      ];
    }
    if (attachment.type === 'document') {
      return [
        {
          type: 'document' as const,
          name: attachment.name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...(attachment.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
          ...(attachment.summary ? { summary: attachment.summary } : {}),
          ...(attachment.figures?.length ? { figures: attachment.figures } : {}),
          // Re-read server-side from the blob this points at.
          text: '',
        },
      ];
    }
    return [];
  });
}

export function normalizeChatMessageAttachments(
  value: unknown,
): ChatMessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap<ChatMessageAttachment>((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const name = safeAttachmentName(record.name);
    if (!name) return [];
    const sizeBytes = safeAttachmentSize(record.sizeBytes);
    const size = sizeBytes === undefined ? {} : { sizeBytes };
    if (
      record.type === 'image' &&
      typeof record.dataUrl === 'string' &&
      CHAT_IMAGE_DATA_URL.test(record.dataUrl)
    ) {
      return [{ type: 'image' as const, name, dataUrl: record.dataUrl, ...size }];
    }
    if (
      record.type === 'video' &&
      isVideoBlobId(record.blobId) &&
      isVideoAttachmentFormat(record.format)
    ) {
      return [
        {
          type: 'video' as const,
          name,
          blobId: record.blobId,
          format: record.format,
          ...size,
        },
      ];
    }
    if (
      record.type === 'audio' &&
      isAudioBlobId(record.blobId) &&
      isAudioAttachmentFormat(record.format)
    ) {
      return [
        {
          type: 'audio' as const,
          name,
          blobId: record.blobId,
          format: record.format,
          ...size,
        },
      ];
    }
    if (
      record.type === 'model' &&
      isModelBlobId(record.blobId) &&
      isModelAttachmentFormat(record.format)
    ) {
      const summary = normalizeModelAttachmentSummary(record.summary);
      return [
        {
          type: 'model' as const,
          name,
          blobId: record.blobId,
          format: record.format,
          ...size,
          ...(summary ? { summary } : {}),
          ...safeModelPreview(record.previewBlobId, record.previewFormat),
        },
      ];
    }
    if (
      record.type === 'document' &&
      isDocumentBlobId(record.blobId) &&
      isDocumentAttachmentFormat(record.format)
    ) {
      const summary = normalizeDocumentSummary(record.summary);
      return [
        {
          type: 'document' as const,
          name,
          blobId: record.blobId,
          format: record.format,
          ...size,
          ...(summary ? { summary } : {}),
          ...(Array.isArray(record.figures) && record.figures.length
            ? { figures: safeFigureNames(record.figures) }
            : {}),
        },
      ];
    }
    if (record.type === 'file') return [{ type: 'file' as const, name, ...size }];
    return [];
  });
}

const CLIPBOARD_IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

type ClipboardFileItem = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

type ClipboardFileData = {
  items: ArrayLike<ClipboardFileItem>;
  files: ArrayLike<File>;
};

function normalizeClipboardImageName(file: File, index: number): File {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'webp') {
    return file;
  }

  const inferredExtension = CLIPBOARD_IMAGE_EXTENSIONS.get(file.type.toLowerCase());
  if (!inferredExtension) return file;

  return new File([file], `pasted-image-${index + 1}.${inferredExtension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/**
 * Reads image files from a browser paste event. Some browsers expose pasted
 * screenshots through `items`, while others only populate `files`, so support
 * both representations without adding the same image twice.
 */
export function imageFilesFromClipboard(clipboardData: ClipboardFileData): File[] {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const file = item.getAsFile();
      const mimeType = (item.type || file?.type || '').toLowerCase();
      if (!file || !mimeType.startsWith('image/')) return null;
      return file.type
        ? file
        : new File([file], file.name, {
            type: mimeType,
            lastModified: file.lastModified,
          });
    })
    .filter((file): file is File => Boolean(file));
  const files = itemFiles.length > 0
    ? itemFiles
    : Array.from(clipboardData.files).filter((file) =>
        file.type.toLowerCase().startsWith('image/'),
      );

  return files.map(normalizeClipboardImageName);
}

const CLIENT_TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'xml',
  'html',
  'js',
  'ts',
  'py',
  'java',
  'c',
  'cpp',
  'css',
  'yaml',
  'yml',
  'toml',
  'ini',
  'sql',
  'sh',
]);

type ExtractionResponse = {
  error?: unknown;
  warning?: unknown;
  type?: unknown;
  dataUrl?: unknown;
  text?: unknown;
};

type ModelUploadResponse = {
  error?: unknown;
  blobId?: unknown;
  format?: unknown;
  sizeBytes?: unknown;
  summary?: unknown;
  previewBlobId?: unknown;
  previewFormat?: unknown;
};

type VideoUploadResponse = {
  error?: unknown;
  blobId?: unknown;
  format?: unknown;
  sizeBytes?: unknown;
};

/**
 * How long a picked file gets to produce its bytes.
 *
 * A file on OneDrive, iCloud or Google Drive may be a placeholder: the picker
 * hands over a real-looking File, and the first read blocks while the provider
 * downloads it. When that sync is wedged the read never returns and never
 * fails, so the attachment just hangs with no way to tell what is waiting on
 * what. A deadline turns that into a sentence the user can act on.
 */
const FILE_READ_TIMEOUT_MS = 45_000;

function isCloudPlaceholderError(error: unknown): boolean {
  // Chromium raises NotReadableError when the OS cannot materialise the file.
  return error instanceof DOMException && error.name === 'NotReadableError';
}

const CLOUD_PLACEHOLDER_MESSAGE =
  'the file could not be read from disk. If it is stored in OneDrive or another ' +
  'cloud folder, it may not be downloaded yet — open it once in File Explorer, or ' +
  'right-click it and choose "Always keep on this device", then attach it again';

/**
 * Read a picked file into memory, or say why not.
 *
 * The bytes are pulled here rather than handed to `fetch` as a stream so that a
 * file which never materialises fails at a point where the reason is still
 * known. Streaming it would move the same stall inside the request, where it
 * looks like the server hanging.
 */
async function readFileBytes(file: File): Promise<Blob> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      file.arrayBuffer().then((buffer) => new Blob([buffer], { type: file.type })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${CLOUD_PLACEHOLDER_MESSAGE} (timed out after 45 seconds)`)),
          FILE_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (isCloudPlaceholderError(error)) throw new Error(CLOUD_PLACEHOLDER_MESSAGE);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stores a 3D file and returns the pointer the message will carry.
 *
 * The bytes go up whole rather than through `/api/extract-text`, which would
 * decode a mesh as mojibake and attach that as the file's "contents".
 *
 * Exported for the Garden workspace, which has its own attachment loop.
 */
export async function attachModelFile(
  file: File,
  format: ModelAttachmentFormat,
): Promise<ChatAttachment> {
  if (file.size > MAX_MODEL_ATTACHMENT_BYTES) {
    throw new Error(
      `3D files must be under ${Math.floor(MAX_MODEL_ATTACHMENT_BYTES / (1024 * 1024))} MB`,
    );
  }
  const formData = new FormData();
  formData.append('file', await readFileBytes(file), file.name);
  formData.append('format', format);
  const response = await fetch('/api/chat-attachments/models', {
    method: 'POST',
    body: formData,
  });
  const data = (await response.json().catch(() => ({}))) as ModelUploadResponse;
  if (!response.ok || data.error) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'The 3D file could not be stored',
    );
  }
  if (!isModelBlobId(data.blobId) || !isModelAttachmentFormat(data.format)) {
    throw new Error('The 3D file could not be stored');
  }
  const summary = normalizeModelAttachmentSummary(data.summary);
  // A format the browser cannot open is converted on the way in; the derived
  // mesh is what the viewer draws, while the original stays downloadable.
  const preview =
    isModelBlobId(data.previewBlobId) && isModelAttachmentFormat(data.previewFormat)
      ? { previewBlobId: data.previewBlobId, previewFormat: data.previewFormat }
      : {};
  return {
    type: 'model',
    name: file.name,
    blobId: data.blobId,
    format: data.format,
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : file.size,
    ...(summary ? { summary } : {}),
    ...preview,
  };
}

/**
 * Stores a video and returns the pointer the message will carry.
 *
 * The file is the request body rather than a form part: a lecture recording is
 * not something to turn into a string in this tab, and `request.formData()` on
 * the other end would parse gigabytes into memory. `readFileBytes` is
 * deliberately not used for the same reason — the browser streams the File
 * straight up, so a cloud placeholder fails as a network error rather than as a
 * silent stall, which is the trade the size makes worthwhile.
 *
 * Exported for the Garden workspace, which has its own attachment loop.
 */
/**
 * A stored document read by the older extraction route.
 *
 * Only PDFs come through here. Their text is not in a structure this codebase
 * can walk — it is in a page layout, and sometimes only in the pixels of a scan
 * — and `/api/extract-text` already renders pages and falls back to
 * transcribing them with a vision model. Reimplementing that would be a
 * downgrade.
 */
async function extractDocumentText(file: File): Promise<{ text: string; warning: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('isHandwriting', 'false');
  const response = await fetch('/api/extract-text', { method: 'POST', body: formData });
  const data = (await response.json().catch(() => ({}))) as ExtractionResponse;
  if (!response.ok || data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Extraction failed');
  }
  return {
    text: typeof data.text === 'string' ? data.text : '',
    warning: typeof data.warning === 'string' ? data.warning.trim() : '',
  };
}

/** What the composer should say about a document it could not read fully. */
function documentWarnings(attachment: ChatAttachment): string[] {
  if (attachment.type !== 'document') return [];
  if (attachment.text.trim()) return [];
  return ['no readable text was found, but the file itself was kept and can still be worked on.'];
}

interface DocumentUploadResponse {
  blobId?: unknown;
  format?: unknown;
  sizeBytes?: unknown;
  text?: unknown;
  summary?: unknown;
  figures?: unknown;
  error?: unknown;
  message?: unknown;
}

/**
 * Store a document and read it, in one request.
 *
 * This replaces the old path for these four formats, which posted the file to
 * `/api/extract-text`, kept the string that came back and let the browser drop
 * the file. Nothing downstream could rewrite an agreement because by the time
 * anything downstream ran there was no agreement left — only a description of
 * one. The bytes now stay, and the reading that comes back is structural rather
 * than flattened.
 *
 * A PDF is stored the same way but read by the older route, which already
 * renders pages and can transcribe a scan with a vision model.
 */
export async function attachDocumentFile(
  file: File,
  format: DocumentAttachmentFormat,
): Promise<ChatAttachment> {
  if (file.size > MAX_DOCUMENT_ATTACHMENT_BYTES) {
    throw new Error(
      `Documents must be under ${Math.floor(MAX_DOCUMENT_ATTACHMENT_BYTES / (1024 * 1024))} MB`,
    );
  }
  const response = await fetch('/api/chat-attachments/documents', {
    method: 'POST',
    headers: {
      [DOCUMENT_FILENAME_HEADER]: encodeURIComponent(file.name),
      'Content-Type': 'application/octet-stream',
    },
    body: file,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const data = (await response.json().catch(() => ({}))) as DocumentUploadResponse;
  if (!response.ok || data.error) {
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : 'The document could not be stored',
    );
  }
  if (
    !isDocumentBlobId(data.blobId) ||
    !isDocumentAttachmentFormat(data.format) ||
    data.format !== format
  ) {
    throw new Error('The document could not be stored');
  }
  const summary = normalizeDocumentSummary(data.summary);
  return {
    type: 'document',
    name: file.name,
    blobId: data.blobId,
    format: data.format,
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : file.size,
    text: typeof data.text === 'string' ? data.text : '',
    ...(summary ? { summary } : {}),
    ...(Array.isArray(data.figures) && data.figures.length
      ? { figures: safeFigureNames(data.figures) }
      : {}),
  };
}

interface AudioUploadResponse {
  error?: unknown;
  blobId?: unknown;
  format?: unknown;
  sizeBytes?: unknown;
}

/**
 * Stores a song and returns the pointer the message will carry.
 *
 * Streamed like a video rather than read into a string first: a lossless album
 * track is hundreds of megabytes, and there is no text in it to extract anyway.
 * What reads it is the audio analyzer, server-side, from the file this points
 * at.
 *
 * Exported for the Garden workspace, which has its own attachment loop.
 */
export async function attachAudioFile(
  file: File,
  format: AudioAttachmentFormat,
): Promise<ChatAttachment> {
  if (file.size > MAX_AUDIO_ATTACHMENT_BYTES) {
    throw new Error(
      `Audio files must be under ${Math.floor(MAX_AUDIO_ATTACHMENT_BYTES / (1024 * 1024))} MB`,
    );
  }
  const response = await fetch('/api/chat-attachments/audio', {
    method: 'POST',
    headers: {
      [AUDIO_FILENAME_HEADER]: encodeURIComponent(file.name),
      'Content-Type': 'application/octet-stream',
    },
    body: file,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const data = (await response.json().catch(() => ({}))) as AudioUploadResponse;
  if (!response.ok || data.error) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'The audio file could not be stored',
    );
  }
  if (
    !isAudioBlobId(data.blobId) ||
    !isAudioAttachmentFormat(data.format) ||
    data.format !== format
  ) {
    throw new Error('The audio file could not be stored');
  }
  return {
    type: 'audio',
    name: file.name,
    blobId: data.blobId,
    format: data.format,
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : file.size,
  };
}

export async function attachVideoFile(
  file: File,
  format: VideoAttachmentFormat,
): Promise<ChatAttachment> {
  if (file.size > MAX_VIDEO_ATTACHMENT_BYTES) {
    throw new Error(
      `Videos must be under ${Math.floor(MAX_VIDEO_ATTACHMENT_BYTES / (1024 * 1024 * 1024))} GB`,
    );
  }
  const response = await fetch('/api/chat-attachments/videos', {
    method: 'POST',
    headers: {
      [VIDEO_FILENAME_HEADER]: encodeURIComponent(file.name),
      'Content-Type': 'application/octet-stream',
    },
    body: file,
    // Required by the fetch spec for a streaming request body, and harmless for
    // the Blob body browsers without it will send instead.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const data = (await response.json().catch(() => ({}))) as VideoUploadResponse;
  if (!response.ok || data.error) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'The video could not be stored',
    );
  }
  if (
    !isVideoBlobId(data.blobId) ||
    !isVideoAttachmentFormat(data.format) ||
    data.format !== format
  ) {
    throw new Error('The video could not be stored');
  }
  return {
    type: 'video',
    name: file.name,
    blobId: data.blobId,
    format: data.format,
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : file.size,
  };
}

export async function extractChatAttachments(
  files: readonly File[],
  options: {
    allowVideo?: boolean;
    /** Progress for the one attachment kind whose upload can take minutes. */
    onStatus?: (message: string) => void;
  } = {},
): Promise<{
  attachments: ChatAttachment[];
  errors: string[];
  warnings: string[];
}> {
  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      // A mesh is checked and stored whole; there is no text in it to extract.
      const modelFormat = modelAttachmentFormat(file.name);
      if (modelFormat) {
        attachments.push(await attachModelFile(file, modelFormat));
        continue;
      }

      // Neither is a video, and its two evidence streams — what is said and what
      // is shown — only exist once ffmpeg has been at it. Stored whole; the turn
      // hands it to the Watch skill. Only where Watch can run: elsewhere it falls
      // through to extraction, which says plainly that it cannot read the file.
      const videoFormat = options.allowVideo ? videoAttachmentFormat(file.name) : null;
      if (videoFormat) {
        // A lecture recording can take minutes to upload. A spinner alone at
        // that length is indistinguishable from a hang.
        options.onStatus?.(
          `Uploading ${file.name}${
            file.size ? ` (${formatVideoSize(file.size)})` : ""
          }…`,
        );
        attachments.push(await attachVideoFile(file, videoFormat));
        options.onStatus?.("");
        continue;
      }

      // A song, stored whole for the same reason a video is: its content is a
      // waveform. Before the extraction fallback, which is where an mp3 used to
      // land — decoded as text, refused as unreadable, and the file dropped.
      const audioFormat = audioAttachmentFormat(file.name);
      if (audioFormat) {
        options.onStatus?.(
          `Uploading ${file.name}${file.size ? ` (${formatVideoSize(file.size)})` : ''}…`,
        );
        attachments.push(await attachAudioFile(file, audioFormat));
        options.onStatus?.('');
        continue;
      }

      // A document is stored whole and read structurally. This runs before the
      // extraction fallback below, which is the path that used to read these
      // four formats and throw the file away.
      const documentFormat = documentAttachmentFormat(file.name);
      if (documentFormat) {
        options.onStatus?.(`Reading ${file.name}…`);
        const stored = await attachDocumentFile(file, documentFormat);
        // A PDF is stored here but read by the extraction route, which handles
        // scans a structural reader cannot.
        if (stored.type === 'document' && !stored.text) {
          const extracted = await extractDocumentText(file);
          if (extracted.warning) warnings.push(`${file.name}: ${extracted.warning}`);
          stored.text = extracted.text;
        }
        if (stored.type === 'document') {
          for (const warning of documentWarnings(stored)) {
            warnings.push(`${file.name}: ${warning}`);
          }
        }
        attachments.push(stored);
        options.onStatus?.('');
        continue;
      }

      if (CLIENT_TEXT_EXTENSIONS.has(extension)) {
        attachments.push({
          type: 'text',
          text: await file.text(),
          name: file.name,
          sizeBytes: file.size,
        });
        continue;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('isHandwriting', 'false');
      const response = await fetch('/api/extract-text', { method: 'POST', body: formData });
      const data = (await response.json().catch(() => ({}))) as ExtractionResponse;
      const responseError = typeof data.error === 'string' ? data.error : 'Extraction failed';
      if (!response.ok || data.error) throw new Error(responseError);

      if (typeof data.warning === 'string' && data.warning.trim()) {
        warnings.push(`${file.name}: ${data.warning.trim()}`);
      }
      if (data.type === 'image' && typeof data.dataUrl === 'string') {
        attachments.push({
          type: 'image',
          dataUrl: data.dataUrl,
          name: file.name,
          sizeBytes: file.size,
        });
      } else if (typeof data.text === 'string') {
        attachments.push({ type: 'text', text: data.text, name: file.name, sizeBytes: file.size });
      } else {
        throw new Error('The document did not contain readable content');
      }
    } catch (error) {
      errors.push(
        error instanceof Error ? `${file.name}: ${error.message}` : `Could not read ${file.name}`,
      );
    }
  }

  return { attachments, errors, warnings };
}
