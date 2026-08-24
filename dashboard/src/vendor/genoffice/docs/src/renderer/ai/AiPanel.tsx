import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Block } from '@genoffice/docx-engine'
import type { AiSettings } from '../../shared/ipc'

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

/**
 * GenOffice's native AI panel normally talks to its Electron preload. In
 * Breadboard the owning conversation is the AI authority, so the same dock
 * hands an edit instruction to the parent artifact viewer instead.
 */
export function AiPanel({ editor, preset, open = true, onExpand, onCollapse }: AiPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (preset?.text) setPrompt(preset.text)
  }, [preset])

  if (!open) {
    return (
      <button className="ai-rail" aria-label="Open Breadboard AI" onClick={onExpand}>
        <span aria-hidden="true">AI</span>
      </button>
    )
  }

  const submit = () => {
    const instruction = prompt.trim()
    if (!instruction) return
    const { from, to } = editor.state.selection
    const selection = from === to ? '' : editor.state.doc.textBetween(from, to, '\n').trim()
    window.parent.postMessage(
      {
        type: 'breadboard:genoffice-ai-request',
        prompt: selection
          ? `${instruction}\n\nApply this to the selected document text:\n${selection}`
          : instruction,
      },
      window.location.origin,
    )
    setSent(true)
  }

  return (
    <aside className="ai-panel" style={{ width: '100%' }}>
      <div className="ai-panel-header">
        <span className="ai-panel-title">Breadboard AI</span>
        {onCollapse ? (
          <button className="ai-header-btn" aria-label="Collapse AI panel" onClick={onCollapse}>
            &gt;
          </button>
        ) : null}
      </div>
      <div className="ai-chat">
        <div className="ai-chat-empty">
          <div className="ai-chat-empty-title">Edit with your conversation</div>
          <div className="ai-chat-empty-body">
            Describe the change. Breadboard will send it to the chat that owns this artifact and
            preserve the result as a new document version.
          </div>
          {sent ? <div className="ai-chat-empty-body">Sent to Breadboard.</div> : null}
        </div>
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border, #d7d2c8)' }}>
        <textarea
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value)
            setSent(false)
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit()
          }}
          placeholder="Ask AI to revise this document..."
          aria-label="Ask Breadboard AI to edit this document"
          style={{
            boxSizing: 'border-box',
            width: '100%',
            minHeight: 88,
            resize: 'vertical',
            border: '1px solid #cbc5b9',
            borderRadius: 8,
            padding: 10,
            background: '#fffdf8',
            color: '#2f312d',
            font: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!prompt.trim()}
          style={{
            width: '100%',
            marginTop: 8,
            border: 0,
            borderRadius: 8,
            padding: '9px 12px',
            background: '#53695d',
            color: '#fffdf8',
            cursor: prompt.trim() ? 'pointer' : 'default',
            opacity: prompt.trim() ? 1 : 0.55,
          }}
        >
          Send to conversation
        </button>
      </div>
    </aside>
  )
}
