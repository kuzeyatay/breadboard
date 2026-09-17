// HunyuanOCR-1.5 official task prompts, copied verbatim from the upstream
// repository (Tencent-Hunyuan/HunyuanOCR, inference/utils/tasks.py).
//
// Upstream is explicit that these strings are fixed per task type and that the
// client must not expose a free-form prompt, because hand-edited instructions
// measurably degrade the model. Breadboard only ever selects a task; it never
// rewrites the wording.

export const VLM_OCR_TASKS = [
  "doc_parse",
  "structured_parse",
  "layout_parse",
  "chart_parse",
  "formula",
  "table",
] as const;

export type VlmOcrTask = (typeof VLM_OCR_TASKS)[number];

/** Verbatim upstream prompts. Do not reword. */
export const VLM_OCR_TASK_PROMPTS: Record<VlmOcrTask, string> = {
  // 端到端文档解析 — body to markdown, tables to HTML, formulas to LaTeX,
  // headers/footers dropped, reading order preserved.
  doc_parse:
    "提取文档图片中正文的所有信息用markdown格式表示，其中页眉、页脚部分忽略，表格用html格式表达，文档中公式用latex格式表示，按照阅读顺序组织进行解析。",
  // 结构化解析 — non-document scenes (ancient text, signage, photos).
  structured_parse: "提取图中的文字。",
  // 版式分析 + 解析 — same as doc_parse but keeps headers/footers and emits
  // layout information alongside the text.
  layout_parse:
    "提取文档图片中所有内容用markdown格式表示，表格用html格式表达，文档中公式用latex格式表示，请按照阅读顺序组织进行全文解析，并输出版式分析信息。",
  // 图表解析 — flowcharts as Mermaid, other charts as Markdown.
  chart_parse:
    "解析图中的图表，对于流程图使用Mermaid格式表示，其他图表使用Markdown格式表示。",
  // 公式解析
  formula: "识别图片中的公式，用LaTeX格式表示。",
  // 表格解析
  table: "把图中的表格解析为HTML。",
};

/** English gloss shown in the UI and in progress messages. */
export const VLM_OCR_TASK_LABELS: Record<VlmOcrTask, string> = {
  doc_parse: "Document parsing (body → Markdown, tables, formulas)",
  structured_parse: "Plain text extraction (photos, signage, non-documents)",
  layout_parse: "Document parsing with layout analysis",
  chart_parse: "Chart parsing (flowcharts → Mermaid)",
  formula: "Formula recognition (→ LaTeX)",
  table: "Table parsing (→ HTML)",
};

/**
 * Upstream `spotting_json`, verbatim. Not a user-selectable task: the text
 * layer writer runs it after a parse to learn where each recognized line sits
 * on the page. The reply is a JSON array of `{ "box": [xmin, ymin, xmax, ymax],
 * "text": "..." }` with coordinates normalized to [0, 1000].
 */
export const VLM_OCR_SPOTTING_PROMPT =
  "检测并识别图中所有的文字行，请按从上到下、从左到右的阅读顺序进行识别。 " +
  "输出格式为 JSON 数组，每个元素必须包含：" +
  '"box": [xmin, ymin, xmax, ymax]（坐标需归一化到 [0, 1000] 范围内）；' +
  '"text": "识别出的文字内容"。 ' +
  "注意：请直接输出 JSON 数组，不要包含任何多余的描述性文字。";

export const DEFAULT_VLM_OCR_TASK: VlmOcrTask = "doc_parse";

export function isVlmOcrTask(value: unknown): value is VlmOcrTask {
  return (
    typeof value === "string" &&
    (VLM_OCR_TASKS as readonly string[]).includes(value)
  );
}

export function vlmOcrPrompt(task: VlmOcrTask = DEFAULT_VLM_OCR_TASK): string {
  return VLM_OCR_TASK_PROMPTS[task] ?? VLM_OCR_TASK_PROMPTS[DEFAULT_VLM_OCR_TASK];
}
