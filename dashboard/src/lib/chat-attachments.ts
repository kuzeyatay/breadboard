export const CHAT_ATTACHMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,.json,.docx,.pptx,.xlsx,.zip';

export type ChatAttachment =
  | { type: 'text'; text: string; name: string }
  | { type: 'image'; dataUrl: string; name: string };

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

export async function extractChatAttachments(files: readonly File[]): Promise<{
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
      if (CLIENT_TEXT_EXTENSIONS.has(extension)) {
        attachments.push({ type: 'text', text: await file.text(), name: file.name });
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
        attachments.push({ type: 'image', dataUrl: data.dataUrl, name: file.name });
      } else if (typeof data.text === 'string') {
        attachments.push({ type: 'text', text: data.text, name: file.name });
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
