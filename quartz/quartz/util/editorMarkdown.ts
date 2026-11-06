import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"

// Authoring parses the original source, never Quartz's transformed HTML.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
export function parseEditorMarkdown(source: string) { return parser.parse(source) }
