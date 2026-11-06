import { parseEditorMarkdown } from '../../util/editorMarkdown'
import { mathAnnotationText } from '../../util/mathAnnotation'

/** Older running dashboards render HTML-only KaTeX without copy metadata. */
export function restoreMathSources(root: HTMLElement, origin: string, restored: () => void): () => void {
  if (window.parent === window || !root.querySelector('.katex:not([data-bb-math-source])')) return () => {}
  const slug = document.querySelector<HTMLElement>('.markdown-actions')?.dataset.noteSlug
  if (!slug) return () => {}
  const sessionId = crypto.randomUUID(), requestId = crypto.randomUUID()
  const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive) }
  const receive = (event: MessageEvent) => {
    const data = event.data
    if (event.source !== window.parent || event.origin !== origin || data?.type !== 'second-brain:document-editor-result' ||
        data.sessionId !== sessionId || data.requestId !== requestId || data.slug !== slug) return
    cleanup()
    if (!data.ok || typeof data.body !== 'string' || !root.isConnected || root.dataset.documentEditor === 'true') return
    const sources: string[] = []
    const walk = (node: { type: string; value?: string; lang?: string | null; children?: any[] }) => {
      if (node.type === 'math' || node.type === 'inlineMath' || node.type === 'code' && node.lang === 'math') {
        sources.push(mathAnnotationText(node.value ?? '', node.type !== 'inlineMath'))
      }
      node.children?.forEach(walk)
    }
    walk(parseEditorMarkdown(data.body))
    const equations = Array.from(root.querySelectorAll<HTMLElement>('.katex,.katex-error'))
    // A transclusion or an outdated publication may have a different equation
    // list. Never attach another equation's source just to make copy work.
    if (equations.length !== sources.length) return
    equations.forEach((node, index) => { node.dataset.bbMathSource = sources[index] })
    restored()
  }
  const timer = window.setTimeout(cleanup, 10_000)
  window.addEventListener('message', receive)
  window.parent.postMessage({ type: 'second-brain:document-editor', action: 'get', slug, sessionId, requestId, payload: {} }, origin)
  return cleanup
}
