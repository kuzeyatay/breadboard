import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Block } from '@genoffice/docx-engine'
import { AiComposer, AiTypingIndicator, Markdown } from '@genoffice/ui'
import type { AiSettings } from '../../shared/ipc'
import { executeTool } from './tools'

interface NumIds {
  bullet: string | null
  ordered: string | null
}

interface AiPanelProps {
  editor: Editor
  blocks: Block[]
  settings: AiSettings
  docEmpty?: boolean
  numIdFallback?: NumIds | null
  preset?: { text: string; nonce: number; autoRun?: boolean } | null
  open?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  filePath?: string | null
}

type ChatRole = 'user' | 'assistant'

interface ChatEntry {
  id: string
  role: ChatRole
  text: string
  activities?: string[]
  error?: string
}

interface AiAction {
  name: 'insert_content' | 'replace_blocks' | 'apply_commands' | 'insert_chart' | 'edit_chart'
  input: Record<string, unknown>
}

interface AiReply {
  message: string
  actions: AiAction[]
}

interface SaveResult {
  ok: boolean
  error?: string
}

const MAX_CHAT_ENTRIES = 30
const MAX_DOCUMENT_HTML = 96_000
const SAVE_EVENT = 'breadboard:genoffice-save-complete'
const WORD_ACTIONS = [
  { label: 'Proofread', prompt: 'Proofread this document and fix spelling or grammar mistakes.' },
  { label: 'Rewrite', prompt: 'Improve the writing while preserving the meaning and useful styles.' },
  { label: 'Summarize', prompt: 'Summarize this document.' },
  { label: 'Format', prompt: 'Improve the document formatting and hierarchy without changing its meaning.' },
]

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function artifactIdFromLocation(): string {
  return new URLSearchParams(window.location.search).get('artifactId')?.trim() ?? 'document'
}

function conversationIdFromLocation(): string {
  return new URLSearchParams(window.location.search).get('conversationId')?.trim() ?? ''
}

function chatStorageKey(): string {
  return `breadboard.genoffice.ai.chat.${artifactIdFromLocation()}`
}

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection
  return from === to ? '' : editor.state.doc.textBetween(from, to, ' ').trim().slice(0, 240)
}

function readStoredChat(): ChatEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(chatStorageKey()) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value
      .flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const item = entry as Partial<ChatEntry>
        if ((item.role !== 'user' && item.role !== 'assistant') || typeof item.text !== 'string') {
          return []
        }
        return [{
          id: typeof item.id === 'string' ? item.id : messageId(),
          role: item.role,
          text: item.text.slice(0, 6_000),
          activities: Array.isArray(item.activities)
            ? item.activities.filter((activity): activity is string => typeof activity === 'string').slice(0, 12)
            : undefined,
          error: typeof item.error === 'string' ? item.error.slice(0, 1_000) : undefined,
        }]
      })
      .slice(-MAX_CHAT_ENTRIES)
  } catch {
    return []
  }
}

function actionList(value: unknown): AiAction[] {
  if (!Array.isArray(value)) return []
  const names = new Set<AiAction['name']>([
    'insert_content',
    'replace_blocks',
    'apply_commands',
    'insert_chart',
    'edit_chart',
  ])
  return value.slice(0, 12).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const action = entry as Partial<AiAction>
    if (
      typeof action.name !== 'string' ||
      !names.has(action.name as AiAction['name']) ||
      !action.input ||
      typeof action.input !== 'object' ||
      Array.isArray(action.input)
    ) return []
    return [{ name: action.name as AiAction['name'], input: action.input as Record<string, unknown> }]
  })
}

async function readCurrentDocument(editor: Editor, numIds: NumIds) {
  const contextResult = await executeTool(
    editor,
    { name: 'get_document_context', input: {} },
    numIds,
  )
  if (contextResult.isError) throw new Error(contextResult.output)
  const blockCount = editor.state.doc.childCount
  if (blockCount === 0) {
    return { context: contextResult.output, html: '', truncated: false }
  }

  let html = ''
  let offset = 0
  let truncated = false
  for (let page = 0; page < 5 && html.length < MAX_DOCUMENT_HTML; page += 1) {
    const readResult = await executeTool(
      editor,
      {
        name: 'read_blocks',
        input: { startBlockIndex: 0, endBlockIndex: blockCount - 1, offset },
      },
      numIds,
    )
    if (readResult.isError) throw new Error(readResult.output)
    const nextOffset = /offset=(\d+) to continue/.exec(readResult.output)?.[1]
    const content = readResult.output
      .replace(/\n…\(truncated:[\s\S]*$/, '')
      .replace(/\n\(end of range:[\s\S]*$/, '')
    html += content
    if (!nextOffset) {
      truncated = false
      break
    }
    offset = Number(nextOffset)
    truncated = true
  }
  if (html.length > MAX_DOCUMENT_HTML) {
    html = html.slice(0, MAX_DOCUMENT_HTML)
    truncated = true
  }
  return { context: contextResult.output, html, truncated }
}

async function askBread(
  prompt: string,
  history: readonly ChatEntry[],
  documentContext: string,
  documentHtml: string,
  documentTruncated: boolean,
  signal: AbortSignal,
): Promise<AiReply> {
  const artifactId = artifactIdFromLocation()
  const conversationId = conversationIdFromLocation()
  const endpoint = `/api/hermes/artifacts/${encodeURIComponent(artifactId)}/genoffice/ai?${new URLSearchParams({ conversationId })}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      history: history.slice(-12).map((entry) => ({ role: entry.role, text: entry.text })),
      documentContext,
      documentHtml,
      documentTruncated,
    }),
    signal,
  })
  const payload = await response.json().catch(() => null) as {
    message?: unknown
    actions?: unknown
    error?: unknown
  } | null
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Bread could not respond (${response.status}).`)
  }
  const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
  const actions = actionList(payload?.actions)
  if (!message && actions.length === 0) throw new Error('Bread returned an empty reply.')
  return { message, actions }
}

function saveCurrentDocument(signal: AbortSignal): Promise<SaveResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: SaveResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      window.removeEventListener(SAVE_EVENT, saved)
      signal.removeEventListener('abort', aborted)
      resolve(result)
    }
    const saved = (event: Event) => {
      const detail = (event as CustomEvent<SaveResult>).detail
      finish(detail?.ok ? { ok: true } : { ok: false, error: detail?.error || 'The document could not be saved.' })
    }
    const aborted = () => finish({ ok: false, error: 'Saving was interrupted.' })
    const timeout = window.setTimeout(
      () => finish({ ok: false, error: 'The edit is in the document, but automatic saving timed out. Use File > Save.' }),
      30_000,
    )
    window.addEventListener(SAVE_EVENT, saved)
    signal.addEventListener('abort', aborted, { once: true })
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
  })
}

export function AiPanel({
  editor,
  docEmpty = false,
  numIdFallback,
  preset,
  open = true,
  onExpand,
  onCollapse,
}: AiPanelProps) {
  const [input, setInput] = useState('')
  const [chat, setChat] = useState<ChatEntry[]>(readStoredChat)
  const [busy, setBusy] = useState(false)
  const [selectionPreview, setSelectionPreview] = useState(() => selectedText(editor))
  const controllerRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const lastPresetNonceRef = useRef<number | null>(null)
  const numIds = useMemo<NumIds>(
    () => numIdFallback ?? { bullet: null, ordered: null },
    [numIdFallback],
  )

  useEffect(() => {
    localStorage.setItem(chatStorageKey(), JSON.stringify(chat.slice(-MAX_CHAT_ENTRIES)))
    const frame = window.requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chat, busy])

  useEffect(() => {
    const update = () => setSelectionPreview(selectedText(editor))
    editor.on('selectionUpdate', update)
    return () => {
      editor.off('selectionUpdate', update)
    }
  }, [editor])

  const runPrompt = useCallback(async (rawPrompt: string) => {
    const prompt = rawPrompt.trim()
    if (!prompt || busy) return
    const userEntry: ChatEntry = { id: messageId(), role: 'user', text: prompt }
    const priorChat = chat
    setChat((current) => [...current, userEntry].slice(-MAX_CHAT_ENTRIES))
    setInput('')
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const currentDocument = await readCurrentDocument(editor, numIds)
      const reply = await askBread(
        prompt,
        priorChat,
        currentDocument.context,
        currentDocument.html,
        currentDocument.truncated,
        controller.signal,
      )
      const activities: string[] = []
      const failures: string[] = []
      let mutated = false
      for (const action of reply.actions) {
        if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError')
        const result = await executeTool(editor, action, numIds, undefined, controller.signal)
        activities.push(result.summary)
        if (result.isError) {
          failures.push(result.output)
          break
        }
        mutated ||= result.mutated
      }

      if (mutated && failures.length === 0) {
        const saved = await saveCurrentDocument(controller.signal)
        if (saved.ok) activities.push('Saved as a new artifact version')
        else failures.push(saved.error || 'The edited document could not be saved.')
      }

      const status = failures.length > 0
        ? `\n\nI could not finish cleanly: ${failures.join(' ')}`
        : mutated
          ? '\n\nThe changes are applied and saved in this document.'
          : ''
      setChat((current) => [...current, {
        id: messageId(),
        role: 'assistant' as const,
        text: `${reply.message}${status}`.trim(),
        activities,
        error: failures.length > 0 ? failures.join(' ') : undefined,
      }].slice(-MAX_CHAT_ENTRIES))
    } catch (error) {
      const stopped = error instanceof DOMException && error.name === 'AbortError'
      setChat((current) => [...current, {
        id: messageId(),
        role: 'assistant' as const,
        text: stopped ? 'Stopped.' : 'I could not complete that request.',
        error: stopped ? undefined : error instanceof Error ? error.message : String(error),
      }].slice(-MAX_CHAT_ENTRIES))
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setBusy(false)
    }
  }, [busy, chat, editor, numIds])

  useEffect(() => {
    if (!preset?.text || lastPresetNonceRef.current === preset.nonce) return
    lastPresetNonceRef.current = preset.nonce
    const update = window.setTimeout(() => {
      if (preset.autoRun) void runPrompt(preset.text)
      else setInput(preset.text)
    }, 0)
    return () => window.clearTimeout(update)
  }, [preset, runPrompt])

  if (!open) {
    return (
      <button className="ai-rail" aria-label="Open Bread AI" onClick={onExpand}>
        <span aria-hidden="true">AI</span>
      </button>
    )
  }

  return (
    <aside className="ai-panel" style={{ width: '100%' }} aria-label="Bread document chat">
      <div
        className="ai-panel-header-actions"
        style={{ position: 'absolute', top: 8, right: 9, zIndex: 2 }}
      >
        {chat.length > 0 ? (
          <button
            className="ai-header-btn"
            aria-label="Start a new document chat"
            title="New chat"
            disabled={busy}
            onClick={() => setChat([])}
          >
            <span aria-hidden="true">＋</span>
          </button>
        ) : null}
        {onCollapse ? (
          <button
            className="ai-header-btn bread-ai-panel-collapse"
            aria-label="Collapse AI panel"
            title="Collapse"
            onClick={onCollapse}
          >
            <span aria-hidden="true">‹</span>
          </button>
        ) : null}
      </div>

      <div className="bread-ai-word-actions" aria-label="Word document actions">
        <span className="bread-ai-document-scope"><span aria-hidden="true">●</span> Word document</span>
        {WORD_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={busy}
            onClick={() => setInput(action.prompt)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div ref={logRef} className="ai-chat" aria-live="polite">
        {chat.length === 0 ? (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">
              {docEmpty ? 'Create this Word document with Bread' : 'Edit this Word document with Bread'}
            </div>
            <div className="ai-chat-empty-body">
              Ask questions or request edits here. The conversation and document stay in this editor.
            </div>
          </div>
        ) : null}
        {chat.map((entry) => (
          <div key={entry.id} className={`ai-msg ai-msg-${entry.role}`}>
            {entry.role === 'assistant' ? <Markdown text={entry.text} /> : entry.text}
            {entry.activities && entry.activities.length > 0 ? (
              <div className="ai-work-group" style={{ gap: 6 }}>
                {entry.activities.map((activity, index) => (
                  <span key={`${activity}-${index}`} className="ai-applied-tag">{activity}</span>
                ))}
              </div>
            ) : null}
            {entry.error ? <div className="ai-msg-error">{entry.error}</div> : null}
          </div>
        ))}
        {busy ? (
          <div className="ai-msg ai-msg-assistant ai-msg-streaming">
            <span className="ai-typing-row">
              <AiTypingIndicator label="Bread is working in this document" />
            </span>
          </div>
        ) : null}
      </div>

      <div className="ai-composer">
        {selectionPreview ? (
          <div className="bread-ai-selection-context">
            <span aria-hidden="true">↳</span>
            <div>
              <strong>Selected text</strong>
              <p>{selectionPreview}</p>
            </div>
          </div>
        ) : null}
        <AiComposer
          value={input}
          busy={busy}
          placeholder={selectionPreview ? 'Ask Bread to edit the selection…' : 'Ask Bread to write, rewrite, or format…'}
          hintIdle="Enter to send · Shift+Enter for a new line"
          hintBusy="Bread is working…"
          hintIdleTitle="Send inside this document editor"
          sendLabel="Send"
          stopLabel="Stop"
          ariaLabel="Message Bread about this document"
          onChange={setInput}
          onSend={() => void runPrompt(input)}
          onStop={() => controllerRef.current?.abort()}
        />
      </div>
    </aside>
  )
}
