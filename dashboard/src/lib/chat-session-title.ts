const MIN_TITLE_WORDS = 3;
const MAX_TITLE_WORDS = 5;

const LEADING_FILLER = [
  /^(?:hi|hello|hey)(?:\s+there)?\b[\s,.!?:;-]*/i,
  /^(?:please\s+)?(?:can|could|would|will|should)\s+you\s+(?:please\s+)?/i,
  /^i\s+(?:want|need|would\s+like|am\s+trying)\s+(?:you\s+)?(?:to\s+)?/i,
  /^(?:please\s+)+/i,
  /^(?:help\s+me(?:\s+(?:to|with))?|tell\s+me(?:\s+about)?|explain(?:\s+to\s+me)?|describe|show\s+me|give\s+me)\s+/i,
  /^(?:what\s+(?:is|are|was|were)|how\s+(?:do|does|did|can|could|would|should)|why\s+(?:is|are|was|were|do|does|did)|where\s+(?:is|are|can)|who\s+(?:is|are|was|were))\s+/i,
];

const OMIT_WORDS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'our',
  'please',
  'just',
  'also',
]);

const LOWERCASE_CONNECTORS = new Set([
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'to',
  'vs',
  'with',
]);

const TECHNICAL_TERMS: Readonly<Record<string, string>> = {
  ai: 'AI',
  api: 'API',
  chatgpt: 'ChatGPT',
  chatmock: 'ChatMock',
  css: 'CSS',
  html: 'HTML',
  http: 'HTTP',
  json: 'JSON',
  llm: 'LLM',
  pdf: 'PDF',
  pdfs: 'PDFs',
  snn: 'SNN',
  snns: 'SNNs',
  sql: 'SQL',
  ui: 'UI',
  url: 'URL',
  yaml: 'YAML',
};

function withoutLeadingFiller(text: string): string {
  let result = text;
  for (let pass = 0; pass < LEADING_FILLER.length + 2; pass += 1) {
    const previous = result;
    for (const pattern of LEADING_FILLER) result = result.replace(pattern, '');
    result = result.trim();
    if (result === previous) break;
  }
  return result;
}

function formatTitleWord(word: string, index: number): string {
  const lower = word.toLocaleLowerCase();
  const technical = TECHNICAL_TERMS[lower];
  if (technical) return technical;
  if (/^gpt(?:[-.]?\d[\w.-]*)?$/i.test(word)) return word.replace(/^gpt/i, 'GPT');
  if (index > 0 && LOWERCASE_CONNECTORS.has(lower)) return lower;
  if (/[A-Z]/.test(word.slice(1)) || /^\p{Lu}+$/u.test(word)) return word;
  return `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`;
}

/** Builds a stable 3–5 word title from the first user-authored chat message. */
export function chatTitleFromFirstMessage(message: string): string {
  const compact = message
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[`*_>#~\[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const meaningful = withoutLeadingFiller(compact);
  const tokens = meaningful.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? [];
  const words = tokens.filter((word) => !OMIT_WORDS.has(word.toLocaleLowerCase()));

  let selected = words.slice(0, MAX_TITLE_WORDS);
  while (
    selected.length > MIN_TITLE_WORDS &&
    LOWERCASE_CONNECTORS.has(selected.at(-1)?.toLocaleLowerCase() ?? '')
  ) {
    selected = selected.slice(0, -1);
  }

  if (selected.length === 0) return 'New Garden Chat';
  if (selected.length === 1) selected.push('Chat', 'Overview');
  if (selected.length === 2) selected.push('Overview');

  return selected.map(formatTitleWord).join(' ');
}
