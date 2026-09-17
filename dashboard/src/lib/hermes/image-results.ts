// Shared by the gallery and Markdown's per-answer image budget.
export const MAX_IMAGE_RESULTS = 5;

export interface ImageResultItem {
  title: string;
  image: string;
  thumb: string;
  page: string;
  site: string;
  w?: number;
  h?: number;
}

export function imageResultUrl(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value) || !/^https?:\/\//i.test(value)) return "";
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? value : "";
  } catch {
    return "";
  }
}

export function imageResultKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

export function parseImageResults(code: string, seen = new Set<string>()): { query: string; items: ImageResultItem[] } | null {
  try {
    const record = JSON.parse(code.trim());
    if (!record || typeof record !== "object" || !Array.isArray(record.items)) return null;
    const items: ImageResultItem[] = [];
    for (const raw of record.items) {
      if (seen.size >= MAX_IMAGE_RESULTS) break;
      if (!raw || typeof raw !== "object") continue;
      const image = imageResultUrl(raw.image) || imageResultUrl(raw.thumb);
      if (!image) continue;
      const key = imageResultKey(image);
      if (seen.has(key)) continue;
      seen.add(key);
      const dimension = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.max(1, Math.round(value)) : undefined;
      const w = dimension(raw.w);
      const h = dimension(raw.h);
      items.push({
        title: typeof raw.title === "string" ? raw.title : "",
        image, thumb: imageResultUrl(raw.thumb), page: imageResultUrl(raw.page),
        site: typeof raw.site === "string" ? raw.site : "",
        ...(w && h ? { w, h } : {}),
      });
      if (items.length === MAX_IMAGE_RESULTS) break;
    }
    return items.length ? { query: typeof record.query === "string" ? record.query : "", items } : null;
  } catch {
    // An unfinished streaming block is not a gallery yet.
    return null;
  }
}

interface MarkdownNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MarkdownNode[];
}

/** Several tool calls/fences still share one five-image budget per answer. */
export function remarkLimitImageResults() {
  return (tree: MarkdownNode) => {
    const seen = new Set<string>();
    const visit = (node: MarkdownNode) => {
      if (node.type === "code" && node.lang?.toLowerCase() === "image-results") {
        const parsed = parseImageResults(node.value ?? "", seen);
        node.value = JSON.stringify(parsed ?? { query: "", items: [] });
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
