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
        <div
          class="markdown-editor-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="markdown-editor-dialog-title"
        >
          <div class="markdown-editor-header">
            <div>
              <p class="markdown-editor-kicker">Markdown</p>
              <h2 id="markdown-editor-dialog-title">Edit note</h2>
            </div>
          </div>
          <div class="markdown-editor-fields">
            <label class="markdown-editor-field">
              <span>Title</span>
              <input class="markdown-editor-title" type="text" placeholder="Note title" />
            </label>
            <label class="markdown-editor-field">
              <span>Tags</span>
              <div class="markdown-editor-tags-box">
                <input
                  class="markdown-editor-tags"
                  type="text"
                  placeholder="#hashtag #separated #tags"
                />
              </div>
            </label>
          </div>
          <textarea class="markdown-editor-textarea" spellcheck={false} />
          <input
            class="markdown-editor-image-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
          />
          {/* Kept in step with MARKDOWN_VIDEO_EXTENSIONS in the dashboard's
              garden-video-embed module: only containers a browser can play. */}
          <input
            class="markdown-editor-video-input"
            type="file"
            accept=".mp4,.m4v,.webm,.ogv,.mov"
            hidden
          />
          <div class="markdown-editor-youtube-row" hidden>
            <input
              class="markdown-editor-youtube-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              aria-label="YouTube URL"
            />
            <button class="markdown-editor-youtube-insert" type="button">
              Insert
            </button>
            <button class="markdown-editor-youtube-cancel" type="button">
              Cancel
            </button>
          </div>
          <div class="markdown-editor-footer">
            <div class="markdown-editor-insert-tools">
              <button class="markdown-editor-image" type="button">
                Add images
              </button>
              <button class="markdown-editor-whiteboard" type="button">
                Add whiteboard
              </button>
              <button class="markdown-editor-video" type="button">
                Add video
              </button>
              <button class="markdown-editor-youtube" type="button">
                YouTube
              </button>
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
              {/* The page's own status line sits behind the modal, so progress
                  and errors raised while editing need somewhere visible. */}
              <span class="markdown-editor-status" aria-live="polite" />
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
.markdown-editor-image,
.markdown-editor-video,
.markdown-editor-whiteboard,
.markdown-editor-youtube,
.markdown-editor-youtube-insert,
.markdown-editor-youtube-cancel,
.markdown-editor-cancel,
.markdown-editor-save {
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 88%, transparent);
  color: var(--secondary);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1;
  padding: 0.45rem 0.65rem;
}

.markdown-action-button:hover,
.markdown-editor-image:hover,
.markdown-editor-video:hover,
.markdown-editor-whiteboard:hover,
.markdown-editor-youtube:hover,
.markdown-editor-youtube-insert:hover,
.markdown-editor-youtube-cancel:hover,
.markdown-editor-cancel:hover {
  color: var(--tertiary);
  border-color: var(--secondary);
}

.markdown-editor-image:disabled,
.markdown-editor-video:disabled,
.markdown-editor-youtube-insert:disabled {
  cursor: wait;
  opacity: 0.62;
}

.markdown-editor-youtube-row[hidden] {
  display: none;
}

.markdown-editor-youtube-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1rem;
  border-top: 1px solid var(--lightgray);
}

.markdown-editor-youtube-url {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 88%, transparent);
  color: var(--dark);
  font: inherit;
  font-size: 0.88rem;
  padding: 0.45rem 0.6rem;
}

.markdown-editor-youtube-url:focus {
  outline: none;
  border-color: var(--secondary);
}

.markdown-editor-status {
  color: var(--gray);
  font-size: 0.82rem;
  margin-right: 0.35rem;
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
}

body:has(.markdown-editor-modal:not([hidden])) .breadboard-ai-toggle {
  display: none;
}

.markdown-editor-panel {
  display: flex;
  flex-direction: column;
  width: min(80rem, calc(100vw - 3rem));
  height: min(52rem, calc(100vh - 3rem));
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: var(--light);
  box-shadow: none;
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
  font-weight: 600;
}

.markdown-editor-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--lightgray);
}

.markdown-editor-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  width: 100%;
  min-width: 0;
}

.markdown-editor-field > span {
  color: var(--secondary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.markdown-editor-title {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 88%, transparent);
  color: var(--dark);
  font: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 0.65rem;
}

.markdown-editor-title:focus {
  outline: none;
  border-color: var(--secondary);
}

.markdown-editor-tags-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 88%, transparent);
  padding: 0.3rem 0.5rem;
  cursor: text;
}

.markdown-editor-tags-box:focus-within {
  border-color: var(--secondary);
}

.markdown-editor-tags {
  flex: 1 1 8rem;
  min-width: 6rem;
  border: 0;
  background: transparent;
  color: var(--dark);
  font: inherit;
  font-size: 0.9rem;
  padding: 0.25rem 0.15rem;
}

.markdown-editor-tags:focus {
  outline: none;
}

.markdown-editor-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid color-mix(in srgb, var(--secondary) 40%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--secondary) 12%, transparent);
  color: var(--secondary);
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1;
  padding: 0.3rem 0.55rem;
  white-space: nowrap;
}

.markdown-editor-tag button {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
  opacity: 0.6;
}

.markdown-editor-tag button:hover {
  opacity: 1;
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
// Persist the open editor + draft so it survives the live-reload triggered by
// saving an image asset, and is restored when you return to the same note.
var SB_EDITOR_DRAFT_KEY = "second-brain:md-editor-draft"
function sbReadEditorDraft() {
  try { return JSON.parse(sessionStorage.getItem(SB_EDITOR_DRAFT_KEY) || "null") } catch (e) { return null }
}
function sbWriteEditorDraft(draftSlug, draft) {
  var value = draft && typeof draft === "object" ? draft : { body: draft }
  try {
    sessionStorage.setItem(SB_EDITOR_DRAFT_KEY, JSON.stringify({
      slug: draftSlug,
      title: value.title || "",
      tags: value.tags || "",
      body: value.body || "",
    }))
  } catch (e) {}
}
function sbClearEditorDraft() {
  try { sessionStorage.removeItem(SB_EDITOR_DRAFT_KEY) } catch (e) {}
}
function sbReportEditorState(open) {
  if (window.parent === window) return
  window.parent?.postMessage({
    type: "second-brain:markdown-editor-state",
    open: Boolean(open),
  }, "*")
}
function sbParseTags(value) {
  return String(value || "").split(/[#,]/).map(function (tag) { return tag.trim() }).filter(Boolean)
}
function sbFormatTags(tags) {
  return (Array.isArray(tags) ? tags : []).map(function (tag) { return "#" + tag }).join(" ")
}
// Put a block into the note at the chosen place: the cursor, the top, or the
// bottom. Shared by everything the editor can insert.
function sbInsertSnippet(textarea, placement, snippet) {
  if (!textarea) return
  var mode = placement && placement.value ? placement.value : "cursor"
  if (mode === "top") {
    var rest = textarea.value.replace(/^\\s+/, "")
    textarea.value = snippet + (rest ? "\\n\\n" + rest : "")
    textarea.focus()
    textarea.setSelectionRange(snippet.length, snippet.length)
    return
  }
  if (mode === "bottom") {
    var head = textarea.value.replace(/\\s+$/, "")
    textarea.value = (head ? head + "\\n\\n" : "") + snippet
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    return
  }
  var start = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart
  var end = textarea.selectionEnd == null ? start : textarea.selectionEnd
  var before = textarea.value.slice(0, start)
  var after = textarea.value.slice(end)
  var prefix = before && !before.endsWith("\\n") ? "\\n\\n" : ""
  var suffix = after && !after.startsWith("\\n") ? "\\n\\n" : ""
  textarea.value = before + prefix + snippet + suffix + after
  var nextCursor = (before + prefix + snippet).length
  textarea.focus()
  textarea.setSelectionRange(nextCursor, nextCursor)
}
// A whiteboard block is a reference, not content: the id names one board in the
// canvas server, which is what lets the board keep its drawing and its position
// between visits. It has to match the id shape that server accepts.
function sbWhiteboardSnippet() {
  var random = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : ""
  while (random.length < 16) random += Math.random().toString(36).slice(2)
  var id = Date.now() + "-" + random.slice(0, 16)
  return "\`\`\`penecho\\nid: " + id + "\\ntitle: Whiteboard\\nheight: 520\\n\`\`\`"
}
// Chip-style tag input: finished tags (space/comma/Enter) render as bubbles
// ahead of the text input; Backspace on an empty input removes the last one.
function sbCreateTagField(box, input) {
  var tags = []
  var notifyInput = function () {
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  var render = function () {
    box.querySelectorAll(".markdown-editor-tag").forEach(function (chip) { chip.remove() })
    tags.forEach(function (tag) {
      var chip = document.createElement("span")
      chip.className = "markdown-editor-tag"
      chip.appendChild(document.createTextNode("#" + tag))
      var remove = document.createElement("button")
      remove.type = "button"
      remove.setAttribute("aria-label", "Remove tag " + tag)
      remove.textContent = "\\u00d7"
      remove.addEventListener("click", function (event) {
        event.preventDefault()
        tags = tags.filter(function (t) { return t !== tag })
        render()
        notifyInput()
      })
      chip.appendChild(remove)
      box.insertBefore(chip, input)
    })
  }
  var commit = function () {
    var pieces = sbParseTags(input.value)
    pieces.forEach(function (tag) {
      if (tags.indexOf(tag) === -1) tags.push(tag)
    })
    input.value = ""
    render()
  }
  input.addEventListener("keydown", function (event) {
    if (event.key === " " || event.key === "," || event.key === "Enter") {
      event.preventDefault()
      if (input.value.trim()) {
        commit()
        notifyInput()
      }
    } else if (event.key === "Backspace" && input.value === "" && tags.length > 0) {
      event.preventDefault()
      tags.pop()
      render()
      notifyInput()
    }
  })
  input.addEventListener("blur", function () {
    if (input.value.trim()) {
      commit()
      notifyInput()
    }
  })
  box.addEventListener("click", function (event) {
    if (event.target === box) input.focus()
  })
  var field = {
    getTags: function () { return tags.concat(sbParseTags(input.value)) },
    getValue: function () { return sbFormatTags(field.getTags()) },
    setValue: function (value) {
      tags = []
      var pieces = Array.isArray(value) ? value : sbParseTags(value)
      pieces.forEach(function (tag) {
        tag = String(tag).trim()
        if (tag && tags.indexOf(tag) === -1) tags.push(tag)
      })
      input.value = ""
      render()
    },
  }
  input._sbTagField = field
  return field
}
document.addEventListener("nav", () => {
  sbReportEditorState(false)
  for (const actions of document.querySelectorAll(".markdown-actions")) {
    if (actions.dataset.bound === "true") continue
    actions.dataset.bound = "true"

    const slug = actions.dataset.noteSlug
    const edit = actions.querySelector(".markdown-edit-button")
    const remove = actions.querySelector(".markdown-delete-button")
    const status = actions.querySelector(".markdown-action-status")
    const modal = actions.querySelector(".markdown-editor-modal")
    const textarea = actions.querySelector(".markdown-editor-textarea")
    const titleInput = actions.querySelector(".markdown-editor-title")
    const tagsInput = actions.querySelector(".markdown-editor-tags")
    const tagsBox = actions.querySelector(".markdown-editor-tags-box")
    const tagField = tagsInput && tagsBox ? sbCreateTagField(tagsBox, tagsInput) : null
    const imageInput = actions.querySelector(".markdown-editor-image-input")
    const addImage = actions.querySelector(".markdown-editor-image")
    const videoInput = actions.querySelector(".markdown-editor-video-input")
    const addVideo = actions.querySelector(".markdown-editor-video")
    const addWhiteboard = actions.querySelector(".markdown-editor-whiteboard")
    const placementSelect = actions.querySelector(".markdown-editor-placement")
    const youtubeToggle = actions.querySelector(".markdown-editor-youtube")
    const youtubeRow = actions.querySelector(".markdown-editor-youtube-row")
    const youtubeUrl = actions.querySelector(".markdown-editor-youtube-url")
    const youtubeInsert = actions.querySelector(".markdown-editor-youtube-insert")
    const youtubeCancel = actions.querySelector(".markdown-editor-youtube-cancel")
    const editorStatus = actions.querySelector(".markdown-editor-status")
    const cancel = actions.querySelector(".markdown-editor-cancel")
    const save = actions.querySelector(".markdown-editor-save")

    // The modal covers the page, so anything said while editing has to appear
    // in both places to be seen at all.
    const setStatus = (message) => {
      if (status) status.textContent = message
      if (editorStatus) editorStatus.textContent = message
    }
    const editorDraft = () => ({
      title: titleInput ? titleInput.value : "",
      tags: tagField ? tagField.getValue() : tagsInput ? tagsInput.value : "",
      body: textarea ? textarea.value : "",
    })
    const saveDraft = () => sbWriteEditorDraft(slug, editorDraft())
    const resolveDashboardBaseUrl = (fallback) => {
      const trimmed = (fallback || "").replace(/\\/+$/, "")
      if (trimmed && !/^https?:\\/\\/(?:localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)(?::\\d+)?$/i.test(trimmed)) {
        return trimmed
      }
      try {
        if (trimmed) {
          const fallbackUrl = new URL(trimmed)
          if (/^(localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)$/i.test(fallbackUrl.hostname)) {
            return fallbackUrl.protocol + "//" + fallbackUrl.hostname + ":3000"
          }
        }
      } catch {}
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
        if (/^(localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)$/i.test(current.hostname) || current.port === "8081") {
          return current.protocol + "//" + current.hostname + ":3000"
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

    const showModal = (draft) => {
      if (!modal || !textarea) return
      const value = draft || {}
      if (titleInput) titleInput.value = value.title || ""
      if (tagField) tagField.setValue(value.tags || "")
      else if (tagsInput) tagsInput.value = value.tags || ""
      textarea.value = value.body || ""
      modal.hidden = false
      sbReportEditorState(true)
      textarea.focus()
      saveDraft()
    }

    const hideModal = () => {
      if (modal) modal.hidden = true
      sbReportEditorState(false)
    }
    const closeEditor = () => {
      sbClearEditorDraft()
      hideModal()
    }

    // Track edits so a live-reload or navigation never loses in-progress work.
    if (textarea) textarea.addEventListener("input", saveDraft)
    if (titleInput) titleInput.addEventListener("input", saveDraft)
    if (tagsInput) tagsInput.addEventListener("input", saveDraft)

    // Reopen the editor with the saved draft after a reload / when returning here.
    const restoredDraft = sbReadEditorDraft()
    if (restoredDraft && restoredDraft.slug === slug && modal && textarea) {
      if (titleInput) titleInput.value = restoredDraft.title || ""
      if (tagField) tagField.setValue(restoredDraft.tags || "")
      else if (tagsInput) tagsInput.value = restoredDraft.tags || ""
      textarea.value = restoredDraft.body || ""
      modal.hidden = false
      sbReportEditorState(true)
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
      if (titleInput && !titleInput.value.trim()) {
        setStatus("Title cannot be empty")
        titleInput.focus()
        return
      }
      setStatus("Saving...")
      window.parent?.postMessage({
        type: "second-brain:save-markdown",
        slug,
        title: titleInput ? titleInput.value : "",
        tags: tagField ? tagField.getTags() : tagsInput ? sbParseTags(tagsInput.value) : [],
        body: textarea.value,
      }, "*")
    })

    addImage?.addEventListener("click", () => {
      if (requireDashboardFrame()) return
      if (addImage?.disabled) return
      imageInput?.click()
    })

    // A whiteboard needs no upload and no round trip: the block is written
    // straight into the draft, and the board it names is created the first time
    // anything is drawn on it.
    addWhiteboard?.addEventListener("click", () => {
      if (!textarea) return
      sbInsertSnippet(textarea, placementSelect, sbWhiteboardSnippet())
      saveDraft()
      setStatus("Whiteboard added. Click Save to publish.")
    })

    const allowedImageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"]
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

    const uploadImages = (files) => {
      if (!files || files.length === 0) return
      if (files.length > 20) {
        setStatus("Add 20 images or fewer")
        return
      }
      const invalid = files.find((file) => !allowedImageTypes.includes(file.type))
      if (invalid) {
        setStatus("Use PNG, JPEG, WEBP, or GIF")
        return
      }
      const tooLarge = files.find((file) => file.size > 10 * 1024 * 1024)
      if (tooLarge) {
        setStatus("Each image must be 10 MB or smaller")
        return
      }

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
    }

    imageInput?.addEventListener("change", () => {
      const files = Array.from(imageInput.files || [])
      imageInput.value = ""
      uploadImages(files)
    })

    // Videos: the File itself is handed to the dashboard frame, which streams it
    // to the server. Nothing is read into memory here, so the size of the clip
    // does not matter to this page.
    const allowedVideoExtensions = [".mp4", ".m4v", ".webm", ".ogv", ".mov"]
    const maxVideoBytes = 256 * 1024 * 1024

    addVideo?.addEventListener("click", () => {
      if (requireDashboardFrame()) return
      if (addVideo.disabled) return
      videoInput?.click()
    })

    videoInput?.addEventListener("change", () => {
      const file = (videoInput.files || [])[0]
      videoInput.value = ""
      if (!file) return
      const name = String(file.name || "").toLowerCase()
      if (!allowedVideoExtensions.some((ext) => name.endsWith(ext))) {
        setStatus("Use " + allowedVideoExtensions.join(" "))
        return
      }
      if (file.size <= 0) {
        setStatus("That video file is empty")
        return
      }
      if (file.size > maxVideoBytes) {
        setStatus("Videos must be 256 MB or smaller")
        return
      }
      setStatus("Uploading video... 0%")
      if (addVideo) addVideo.disabled = true
      window.parent?.postMessage({
        type: "second-brain:upload-markdown-video",
        slug,
        file,
      }, "*")
    })

    const closeYouTubeRow = () => {
      if (youtubeRow) youtubeRow.hidden = true
      if (youtubeUrl) youtubeUrl.value = ""
    }

    youtubeToggle?.addEventListener("click", () => {
      if (requireDashboardFrame()) return
      if (!youtubeRow) return
      youtubeRow.hidden = !youtubeRow.hidden
      if (!youtubeRow.hidden) youtubeUrl?.focus()
    })

    const submitYouTube = () => {
      if (requireDashboardFrame()) return
      const url = youtubeUrl ? youtubeUrl.value.trim() : ""
      if (!url) {
        setStatus("Enter a YouTube URL")
        return
      }
      setStatus("Adding video...")
      if (youtubeInsert) youtubeInsert.disabled = true
      window.parent?.postMessage({
        type: "second-brain:add-markdown-youtube",
        slug,
        url,
      }, "*")
    }

    youtubeInsert?.addEventListener("click", submitYouTube)
    youtubeUrl?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        submitYouTube()
      }
    })
    youtubeCancel?.addEventListener("click", closeYouTubeRow)

    // Paste a screenshot or copied image straight into the note (Ctrl/Cmd+V).
    textarea?.addEventListener("paste", (event) => {
      const items = Array.from((event.clipboardData && event.clipboardData.items) || [])
      const imageItems = items.filter(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      )
      if (imageItems.length === 0) return
      event.preventDefault()
      if (requireDashboardFrame()) return

      const files = imageItems
        .map((item, index) => {
          const file = item.getAsFile()
          if (!file) return null
          if (file.name && file.name !== "image.png") return file
          // Pasted screenshots usually have no useful name; give them a unique one.
          const ext = (item.type.split("/")[1] || "png").replace("jpeg", "jpg")
          const suffix = imageItems.length > 1 ? "-" + (index + 1) : ""
          return new File([file], "pasted-" + Date.now() + suffix + "." + ext, {
            type: item.type,
          })
        })
        .filter(Boolean)
      uploadImages(files)
    })

    const dismissEditor = () => {
      closeYouTubeRow()
      closeEditor()
    }

    cancel?.addEventListener("click", dismissEditor)
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
  const titleInput = actions.querySelector(".markdown-editor-title")
  const tagsInput = actions.querySelector(".markdown-editor-tags")
  const tagField = tagsInput ? tagsInput._sbTagField : null
  const placement = actions.querySelector(".markdown-editor-placement")
  const addImage = actions.querySelector(".markdown-editor-image")
  const addVideo = actions.querySelector(".markdown-editor-video")
  const youtubeRow = actions.querySelector(".markdown-editor-youtube-row")
  const youtubeUrl = actions.querySelector(".markdown-editor-youtube-url")
  const youtubeInsert = actions.querySelector(".markdown-editor-youtube-insert")
  const editorStatus = actions.querySelector(".markdown-editor-status")
  const currentDraft = () => ({
    title: titleInput ? titleInput.value : "",
    tags: tagField ? tagField.getValue() : tagsInput ? tagsInput.value : "",
    body: textarea ? textarea.value : "",
  })
  const setStatus = (message) => {
    if (status) status.textContent = message
    if (editorStatus) editorStatus.textContent = message
  }
  const insertSnippet = (snippet) => sbInsertSnippet(textarea, placement, snippet)

  if (data.type === "second-brain:markdown-content-result") {
    if (data.ok && (typeof data.body === "string" || typeof data.content === "string")) {
      const nextBody = typeof data.body === "string" ? data.body : data.content
      if (titleInput) titleInput.value = typeof data.title === "string" ? data.title : ""
      const nextTags = Array.isArray(data.tags)
        ? data.tags
        : typeof data.tags === "string" ? data.tags : ""
      if (tagField) tagField.setValue(nextTags)
      else if (tagsInput) tagsInput.value = sbFormatTags(sbParseTags(nextTags))
      if (textarea) textarea.value = nextBody
      if (modal) modal.hidden = false
      sbReportEditorState(true)
      textarea?.focus()
      sbWriteEditorDraft(data.slug, currentDraft())
      setStatus("")
    } else {
      setStatus(data.error || "Could not open")
    }
  }

  if (data.type === "second-brain:markdown-save-result") {
    setStatus(data.ok ? "Saved" : data.error || "Could not save")
    if (data.ok) {
      sbClearEditorDraft()
      if (modal) modal.hidden = true
      sbReportEditorState(false)
    }
    window.setTimeout(() => { setStatus("") }, 1800)
  }

  if (data.type === "second-brain:markdown-image-result") {
    if (addImage) addImage.disabled = false
    if (data.ok && typeof data.markdown === "string" && data.markdown) {
      const snippetCount = typeof data.count === "number" ? data.count : 1
      insertSnippet(data.markdown)
      if (textarea) sbWriteEditorDraft(data.slug, currentDraft())
      setStatus(snippetCount === 1 ? "Image inserted in editor. Click Save to publish." : "Images inserted in editor. Click Save to publish.")
    } else {
      setStatus(data.error || "Could not add image")
      window.setTimeout(() => { setStatus("") }, 3000)
    }
  }

  if (data.type === "second-brain:markdown-video-progress") {
    const percent = typeof data.percent === "number" ? data.percent : 0
    // 100% of the bytes sent still means the server is finishing the write.
    setStatus(percent >= 100 ? "Finishing upload..." : "Uploading video... " + percent + "%")
  }

  if (data.type === "second-brain:markdown-video-result") {
    if (addVideo) addVideo.disabled = false
    if (youtubeInsert) youtubeInsert.disabled = false
    if (data.ok && typeof data.markdown === "string" && data.markdown) {
      insertSnippet(data.markdown)
      if (textarea) sbWriteEditorDraft(data.slug, currentDraft())
      if (youtubeRow) youtubeRow.hidden = true
      if (youtubeUrl) youtubeUrl.value = ""
      setStatus("Video inserted in editor. Click Save to publish.")
    } else {
      setStatus(data.error || "Could not add video")
      window.setTimeout(() => { setStatus("") }, 3000)
    }
  }

  if (data.type === "second-brain:markdown-delete-result") {
    setStatus(data.ok ? "Deleted" : data.error || "Could not delete")
  }
})
`

export default (() => MarkdownActions) satisfies QuartzComponentConstructor
