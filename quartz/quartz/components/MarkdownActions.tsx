import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const MarkdownActions: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const slug = fileData.slug
  if (!slug || slug === "index" || slug.endsWith("/index") || slug.startsWith("tags/")) return null
  const dashboardBaseUrl = (
    process.env.DASHBOARD_URL ??
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    ""
  ).replace(/\/+$/, "")

  return (
    <div
      class={classNames(displayClass, "markdown-actions")}
      data-dashboard-url={dashboardBaseUrl}
      data-note-slug={slug}
    >
      <button class="markdown-action-button markdown-edit-button" type="button">
        Edit markdown
      </button>
      <button class="markdown-action-button markdown-delete-button danger" type="button">
        Delete
      </button>
      <span class="markdown-action-status" aria-live="polite" />

      <div class="markdown-editor-modal" hidden>
        <div class="markdown-editor-panel">
          <div class="markdown-editor-header">
            <div>
              <p class="markdown-editor-kicker">Markdown</p>
              <h2>Edit note</h2>
            </div>
            <button class="markdown-editor-close" type="button" aria-label="Close editor">
              Close
            </button>
          </div>
          <textarea class="markdown-editor-textarea" spellcheck={false} />
          <input
            class="markdown-editor-image-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
          />
          <div class="markdown-editor-footer">
            <div class="markdown-editor-insert-tools">
              <button class="markdown-editor-image" type="button">Add images</button>
              <label class="markdown-editor-placement-label">
                Place
                <select class="markdown-editor-placement">
                  <option value="cursor">Cursor</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
            </div>
            <div class="markdown-editor-footer-actions">
              <button class="markdown-editor-cancel" type="button">
                Cancel
              </button>
              <button class="markdown-editor-save" type="button">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

MarkdownActions.css = `
.markdown-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0.45rem 0 0.65rem 0;
  min-height: 1.75rem;
}

.markdown-action-button,
.markdown-editor-close,
.markdown-editor-image,
.markdown-editor-cancel,
.markdown-editor-save {
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 88%, transparent);
  color: var(--secondary);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  padding: 0.45rem 0.65rem;
}

.markdown-action-button:hover,
.markdown-editor-close:hover,
.markdown-editor-image:hover,
.markdown-editor-cancel:hover {
  color: var(--tertiary);
  border-color: var(--secondary);
}

.markdown-editor-image:disabled {
  cursor: wait;
  opacity: 0.62;
}

.markdown-action-button.danger {
  color: #dc2626;
}

.markdown-action-button.danger:hover {
  border-color: #dc2626;
  background: color-mix(in srgb, #dc2626 9%, transparent);
}

.markdown-action-status {
  color: var(--gray);
  font-size: 0.82rem;
}

.markdown-editor-modal[hidden] {
  display: none;
}

.markdown-editor-modal {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(4px);
}

.markdown-editor-panel {
  display: flex;
  flex-direction: column;
  width: min(58rem, calc(100vw - 2rem));
  height: min(42rem, calc(100vh - 2rem));
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: var(--light);
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.markdown-editor-header,
.markdown-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--lightgray);
}

.markdown-editor-footer {
  border-top: 1px solid var(--lightgray);
  border-bottom: 0;
  justify-content: space-between;
}

.markdown-editor-kicker {
  margin: 0 0 0.15rem 0;
  color: var(--secondary);
  font-size: 0.78rem;
}

.markdown-editor-header h2 {
  margin: 0;
  color: var(--dark);
  font-size: 1rem;
}

.markdown-editor-textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  resize: none;
  border: 0;
  border-radius: 0;
  outline: none;
  padding: 1rem;
  background: color-mix(in srgb, var(--light) 72%, var(--lightgray));
  color: var(--dark);
  font-family: var(--codeFont);
  font-size: 0.85rem;
  line-height: 1.55;
}

.markdown-editor-save {
  background: var(--dark);
  border-color: var(--dark);
  color: var(--light);
}

.markdown-editor-save:hover {
  opacity: 0.86;
}

.markdown-editor-insert-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.markdown-editor-placement-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--secondary);
  font-size: 0.85rem;
}

.markdown-editor-placement {
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 88%, transparent);
  color: var(--dark);
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.45rem;
}

.markdown-editor-footer-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
`

MarkdownActions.afterDOMLoaded = `
document.addEventListener("nav", () => {
  for (const actions of document.querySelectorAll(".markdown-actions")) {
    if (actions.dataset.bound === "true") continue
    actions.dataset.bound = "true"

    const slug = actions.dataset.noteSlug
    const edit = actions.querySelector(".markdown-edit-button")
    const remove = actions.querySelector(".markdown-delete-button")
    const status = actions.querySelector(".markdown-action-status")
    const modal = actions.querySelector(".markdown-editor-modal")
    const textarea = actions.querySelector(".markdown-editor-textarea")
    const imageInput = actions.querySelector(".markdown-editor-image-input")
    const addImage = actions.querySelector(".markdown-editor-image")
    const close = actions.querySelector(".markdown-editor-close")
    const cancel = actions.querySelector(".markdown-editor-cancel")
    const save = actions.querySelector(".markdown-editor-save")

    const setStatus = (message) => {
      if (status) status.textContent = message
    }
    const resolveDashboardBaseUrl = (fallback) => {
      const trimmed = (fallback || "").replace(/\\/+$/, "")
      if (trimmed && !/^https?:\\/\\/(?:localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)(?::\\d+)?$/i.test(trimmed)) {
        return trimmed
      }
      try {
        if (document.referrer) {
          const ref = new URL(document.referrer)
          if (!/^garden\\./i.test(ref.hostname)) {
            return ref.origin.replace(/\\/+$/, "")
          }
        }
      } catch {}
      try {
        const current = new URL(window.location.href)
        if (/^garden\\./i.test(current.hostname)) {
          return current.origin.replace("//garden.", "//")
        }
        return current.origin.replace(/\\/+$/, "")
      } catch {}
      return trimmed
    }

    const dashboardBaseUrl = resolveDashboardBaseUrl(actions.dataset.dashboardUrl)
    const clusterSlugFromNoteSlug = (value) => {
      let decoded = value || ""
      try {
        decoded = decodeURIComponent(decoded)
      } catch {
        decoded = value || ""
      }
      const segments = decoded.split("/").map((segment) => segment.trim()).filter(Boolean)
      if (segments[0] === "garden" && segments[1]) return segments[1]
      return segments[0] || ""
    }
    const documentApiUrl = () => {
      const clusterSlug = clusterSlugFromNoteSlug(slug)
      if (!clusterSlug) return ""
      return dashboardBaseUrl + "/api/documents/" + encodeURIComponent(slug || "") + "?clusterSlug=" + encodeURIComponent(clusterSlug)
    }
    const navigateToCluster = () => {
      const clusterSlug = clusterSlugFromNoteSlug(slug)
      if (!clusterSlug) return
      window.location.href = "/" + encodeURIComponent(clusterSlug) + "/?refresh=" + Date.now()
    }
    const postToParent = (message) => {
      if (window.parent !== window) window.parent?.postMessage(message, "*")
    }
    const requireDashboardFrame = () => {
      if (window.parent !== window) return false
      setStatus("Open this note from the dashboard to edit or delete")
      return true
    }
    const deleteDirectly = async () => {
      const url = documentApiUrl()
      if (!url) throw new Error("Could not resolve note path")
      const response = await fetch(url, { method: "DELETE" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) {
        throw new Error(body.error || "Could not delete")
      }
      return body
    }

    const showModal = (content) => {
      if (!modal || !textarea) return
      textarea.value = content || ""
      modal.hidden = false
      textarea.focus()
    }

    const hideModal = () => {
      if (modal) modal.hidden = true
    }

    edit?.addEventListener("click", () => {
      if (requireDashboardFrame()) return
      setStatus("Opening...")
      window.parent?.postMessage({
        type: "second-brain:get-markdown",
        slug,
      }, "*")
    })

    remove?.addEventListener("click", () => {
      const ok = window.confirm("Delete this markdown file from the garden?")
      if (!ok) return
      setStatus("Deleting...")
      deleteDirectly()
        .then(() => {
          setStatus("Deleted")
          window.setTimeout(navigateToCluster, 500)
        })
        .catch((error) => {
          postToParent({
            type: "second-brain:delete-markdown",
            slug,
          })
          if (window.parent === window) {
            setStatus(error?.message || "Could not delete")
          } else {
            setStatus("Deleting through dashboard...")
          }
        })
    })

    save?.addEventListener("click", () => {
      if (requireDashboardFrame()) return
      if (!textarea) return
      setStatus("Saving...")
      window.parent?.postMessage({
        type: "second-brain:save-markdown",
        slug,
        content: textarea.value,
      }, "*")
    })

    addImage?.addEventListener("click", () => {
      if (requireDashboardFrame()) return
      if (addImage?.disabled) return
      imageInput?.click()
    })

    imageInput?.addEventListener("change", () => {
      const files = Array.from(imageInput.files || [])
      imageInput.value = ""
      if (files.length === 0) return

      if (files.length > 20) {
        setStatus("Add 20 images or fewer")
        return
      }

      const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"]
      const invalid = files.find((file) => !allowedTypes.includes(file.type))
      if (invalid) {
        setStatus("Use PNG, JPEG, WEBP, or GIF")
        return
      }

      const tooLarge = files.find((file) => file.size > 10 * 1024 * 1024)
      if (tooLarge) {
        setStatus("Each image must be 10 MB or smaller")
        return
      }

      const readImage = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.addEventListener("load", () => {
            if (typeof reader.result === "string") {
              resolve({
                fileName: file.name,
                mimeType: file.type,
                dataUrl: reader.result,
              })
            } else {
              reject(new Error("Could not read image"))
            }
          })
          reader.addEventListener("error", () => reject(new Error("Could not read image")))
          reader.readAsDataURL(file)
        })

      setStatus(files.length === 1 ? "Adding image..." : "Adding images...")
      if (addImage) addImage.disabled = true
      Promise.all(files.map(readImage))
        .then((images) => {
          window.parent?.postMessage({
            type: "second-brain:upload-markdown-images",
            slug,
            images,
          }, "*")
        })
        .catch(() => {
          setStatus("Could not read image")
          if (addImage) addImage.disabled = false
        })
    })

    close?.addEventListener("click", hideModal)
    cancel?.addEventListener("click", hideModal)
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) hideModal()
    })
  }
})

window.addEventListener("message", (event) => {
  const data = event.data
  if (!data || typeof data.type !== "string") return
  if (!data.type.startsWith("second-brain:markdown-")) return

  const actions = document.querySelector('.markdown-actions[data-note-slug="' + CSS.escape(data.slug || "") + '"]')
  if (!actions) return

  const status = actions.querySelector(".markdown-action-status")
  const modal = actions.querySelector(".markdown-editor-modal")
  const textarea = actions.querySelector(".markdown-editor-textarea")
  const placement = actions.querySelector(".markdown-editor-placement")
  const addImage = actions.querySelector(".markdown-editor-image")
  const setStatus = (message) => {
    if (status) status.textContent = message
  }
  const insertSnippet = (snippet) => {
    if (!textarea) return
    const mode = placement?.value || "cursor"
    if (mode === "top") {
      const rest = textarea.value.replace(/^\\s+/, "")
      textarea.value = snippet + (rest ? "\\n\\n" + rest : "")
      textarea.focus()
      textarea.setSelectionRange(snippet.length, snippet.length)
      return
    }
    if (mode === "bottom") {
      const before = textarea.value.replace(/\\s+$/, "")
      const prefix = before ? before + "\\n\\n" : ""
      textarea.value = prefix + snippet
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      return
    }
    const start = textarea.selectionStart ?? textarea.value.length
    const end = textarea.selectionEnd ?? start
    const before = textarea.value.slice(0, start)
    const after = textarea.value.slice(end)
    const prefix = before && !before.endsWith("\\n") ? "\\n\\n" : ""
    const suffix = after && !after.startsWith("\\n") ? "\\n\\n" : ""
    textarea.value = before + prefix + snippet + suffix + after
    const nextCursor = (before + prefix + snippet).length
    textarea.focus()
    textarea.setSelectionRange(nextCursor, nextCursor)
  }

  if (data.type === "second-brain:markdown-content-result") {
    if (data.ok && typeof data.content === "string") {
      if (textarea) textarea.value = data.content
      if (modal) modal.hidden = false
      textarea?.focus()
      setStatus("")
    } else {
      setStatus(data.error || "Could not open")
    }
  }

  if (data.type === "second-brain:markdown-save-result") {
    setStatus(data.ok ? "Saved" : data.error || "Could not save")
    if (data.ok && modal) modal.hidden = true
    window.setTimeout(() => { setStatus("") }, 1800)
  }

  if (data.type === "second-brain:markdown-image-result") {
    if (addImage) addImage.disabled = false
    if (data.ok && typeof data.markdown === "string" && data.markdown) {
      const snippetCount = typeof data.count === "number" ? data.count : 1
      insertSnippet(data.markdown)
      setStatus(snippetCount === 1 ? "Image inserted in editor. Click Save to publish." : "Images inserted in editor. Click Save to publish.")
    } else {
      setStatus(data.error || "Could not add image")
      window.setTimeout(() => { setStatus("") }, 3000)
    }
  }

  if (data.type === "second-brain:markdown-delete-result") {
    setStatus(data.ok ? "Deleted" : data.error || "Could not delete")
  }
})
`

export default (() => MarkdownActions) satisfies QuartzComponentConstructor
