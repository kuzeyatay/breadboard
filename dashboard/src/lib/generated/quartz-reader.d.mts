export function renderQuartzDocument(input: {
  content: string; relativePath: string; contentRoot: string; allFiles: string[];
}): Promise<{ html: string; contentMetaHtml: string; title?: string; slug: string; toc: { depth: number; text: string; slug: string }[] }>;
export function renderQuartzFolder(input: {
  relativePath: string; contentRoot: string; title: string;
  files: { relativePath: string; content: string }[];
}): Promise<{ kind: 'folder'; html: string; contentMetaHtml: string; folderActionsHtml: string; breadcrumbsHtml: string;
  title: string; slug: string; index: Record<string, unknown>; toc: [] }>;
