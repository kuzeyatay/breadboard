export function renderQuartzDocument(input: {
  content: string; relativePath: string; contentRoot: string; allFiles: string[];
}): Promise<{ html: string; title?: string; slug: string; toc: { depth: number; text: string; slug: string }[] }>;
