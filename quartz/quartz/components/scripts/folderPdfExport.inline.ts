type ExportNote = { slug: string; title: string; selected: boolean }

const pageSize = 100
const boundExports = new WeakSet<HTMLElement>()

document.addEventListener("nav", () => {
  for (const root of document.querySelectorAll<HTMLElement>(".folder-pdf-export")) {
    if (boundExports.has(root)) continue
    const open = root.querySelector<HTMLButtonElement>(".folder-pdf-open")
    const modal = root.querySelector<HTMLElement>(".folder-pdf-modal")
    const list = root.querySelector<HTMLOListElement>(".folder-pdf-list")
    const count = root.querySelector<HTMLElement>(".folder-pdf-count")
    const status = root.querySelector<HTMLElement>(".folder-pdf-status")
    const exportButton = root.querySelector<HTMLButtonElement>(".folder-pdf-export-button")
    if (!open || !modal || !list || !exportButton) continue
    boundExports.add(root)
    const controller = new AbortController()
    const { signal } = controller
    // Older published HTML can receive the new script before its next rebuild.
    // Convert its eager rows to compact data, then release those DOM nodes too.
    let notes: ExportNote[] | undefined = root.dataset.documents
      ? undefined
      : Array.from(list.querySelectorAll<HTMLElement>(".folder-pdf-item"), (item) => ({
          slug: item.dataset.slug ?? "",
          title: item.dataset.title ?? item.dataset.slug ?? "Markdown note",
          selected: item.querySelector<HTMLInputElement>("input")?.checked ?? true,
        }))
    if (notes) {
      // Keep the original list available if SPA cleanup rebinds this same root.
      root.dataset.documents = JSON.stringify(notes.map(({ slug, title }) => ({ slug, title })))
    }
    list.replaceChildren()
    let page = 0
    let dragged: ExportNote | undefined
    const exporting = () => root.dataset.exporting === "true"
    const setStatus = (text: string) => {
      if (status) status.textContent = text
    }
    const pagination = document.createElement("div")
    pagination.className = "folder-pdf-pagination"
    pagination.hidden = true
    const previous = document.createElement("button")
    previous.type = "button"
    previous.className = "folder-pdf-previous"
    previous.textContent = "Previous"
    const range = document.createElement("span")
    range.setAttribute("aria-live", "polite")
    const next = document.createElement("button")
    next.type = "button"
    next.className = "folder-pdf-next"
    next.textContent = "Next"
    pagination.append(previous, range, next)
    list.after(pagination)

    function updateCount() {
      const selected = notes?.filter((note) => note.selected).length ?? 0
      if (count) count.textContent = `${selected} of ${notes?.length ?? 0} notes selected`
      exportButton!.disabled = selected === 0 || exporting()
      previous.disabled = page === 0 || exporting()
      next.disabled = (page + 1) * pageSize >= (notes?.length ?? 0) || exporting()
    }

    function renderPage(focusSlug?: string, action?: string) {
      if (!notes) return
      page = Math.min(page, Math.max(0, Math.ceil(notes.length / pageSize) - 1))
      const start = page * pageSize
      list!.style.counterReset = `folder-pdf-order ${start}`
      list!.start = start + 1
      const fragment = document.createDocumentFragment()
      for (const [offset, note] of notes.slice(start, start + pageSize).entries()) {
        const item = document.createElement("li")
        item.className = "folder-pdf-item"
        item.dataset.index = String(start + offset)
        item.dataset.slug = note.slug
        item.draggable = !exporting()
        item.setAttribute("aria-posinset", String(start + offset + 1))
        item.setAttribute("aria-setsize", String(notes.length))
        const grip = document.createElement("span")
        grip.className = "folder-pdf-drag"
        grip.setAttribute("aria-hidden", "true")
        grip.textContent = "::"
        const label = document.createElement("label")
        label.className = "folder-pdf-note"
        const checkbox = document.createElement("input")
        checkbox.type = "checkbox"
        checkbox.className = "folder-pdf-checkbox"
        checkbox.checked = note.selected
        checkbox.disabled = exporting()
        const text = document.createElement("span")
        const title = document.createElement("strong")
        title.textContent = note.title
        const slug = document.createElement("small")
        slug.textContent = note.slug
        text.append(title, slug)
        label.append(checkbox, text)
        const actions = document.createElement("div")
        actions.className = "folder-pdf-order-actions"
        for (const direction of ["up", "down"]) {
          const button = document.createElement("button")
          button.type = "button"
          button.className = `folder-pdf-${direction}`
          button.textContent = direction === "up" ? "Up" : "Down"
          button.setAttribute("aria-label", `Move ${note.title} ${direction}`)
          button.disabled =
            exporting() ||
            (direction === "up" ? start + offset === 0 : start + offset === notes.length - 1)
          actions.append(button)
        }
        item.append(grip, label, actions)
        fragment.append(item)
      }
      list!.replaceChildren(fragment)
      pagination.hidden = notes.length <= pageSize
      range.textContent = `Notes ${notes.length ? start + 1 : 0}–${Math.min(start + pageSize, notes.length)} of ${notes.length}`
      updateCount()
      if (focusSlug) {
        const row = Array.from(list!.children).find(
          (item) => (item as HTMLElement).dataset.slug === focusSlug,
        )
        const button = row?.querySelector<HTMLButtonElement>(`.folder-pdf-${action ?? "up"}`)
        if (button && !button.disabled) button.focus()
        else row?.querySelector<HTMLInputElement>("input")?.focus()
      }
    }

    const hide = () => {
      if (exporting()) return
      modal.hidden = true
      list.replaceChildren()
      dragged = undefined
      setStatus("")
      open.focus()
    }
    open.addEventListener(
      "click",
      () => {
        if (!notes) {
          try {
            const data: unknown = JSON.parse(root.dataset.documents ?? "[]")
            if (
              !Array.isArray(data) ||
              !data.every(
                (note) => typeof note?.slug === "string" && typeof note?.title === "string",
              )
            )
              throw new Error("Invalid note list")
            notes = data.map((note) => ({ ...note, selected: true }))
          } catch {
            modal.hidden = false
            setStatus("Could not load the note list. Reload this page and try again.")
            exportButton.disabled = true
            return
          }
        }
        modal.hidden = false
        renderPage()
        root.querySelector<HTMLButtonElement>(".folder-pdf-close")?.focus()
      },
      { signal },
    )
    for (const selector of [".folder-pdf-close", ".folder-pdf-cancel"])
      root.querySelector(selector)?.addEventListener("click", hide, { signal })
    modal.addEventListener(
      "click",
      (event) => {
        if (event.target === modal) hide()
      },
      { signal },
    )
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && !modal.hidden) {
          event.preventDefault()
          hide()
        }
      },
      { signal },
    )
    previous.addEventListener(
      "click",
      () => {
        page--
        renderPage()
        list.scrollTop = 0
      },
      { signal },
    )
    next.addEventListener(
      "click",
      () => {
        page++
        renderPage()
        list.scrollTop = 0
      },
      { signal },
    )
    for (const [selector, selected] of [
      [".folder-pdf-select-all", true],
      [".folder-pdf-clear", false],
    ] as const) {
      root.querySelector(selector)?.addEventListener(
        "click",
        () => {
          if (exporting()) return
          for (const note of notes ?? []) note.selected = selected
          renderPage()
        },
        { signal },
      )
    }
    const rowFor = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(".folder-pdf-item") : null
    list.addEventListener(
      "change",
      (event) => {
        const row = rowFor(event.target)
        if (!row || !(event.target instanceof HTMLInputElement) || exporting()) return
        const note = notes?.[Number(row.dataset.index)]
        if (note) note.selected = event.target.checked
        updateCount()
      },
      { signal },
    )
    list.addEventListener(
      "click",
      (event) => {
        const row = rowFor(event.target)
        const button = event.target instanceof Element ? event.target.closest("button") : null
        if (!notes || !row || !button || exporting()) return
        const direction = button.classList.contains("folder-pdf-up")
          ? -1
          : button.classList.contains("folder-pdf-down")
            ? 1
            : 0
        const from = Number(row.dataset.index),
          to = from + direction
        if (!direction || to < 0 || to >= notes.length) return
        const [note] = notes.splice(from, 1)
        notes.splice(to, 0, note)
        page = Math.floor(to / pageSize)
        renderPage(note.slug, direction < 0 ? "up" : "down")
      },
      { signal },
    )
    list.addEventListener(
      "dragstart",
      (event) => {
        const row = rowFor(event.target)
        if (!row || exporting()) return
        dragged = notes?.[Number(row.dataset.index)]
        row.classList.add("dragging")
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move"
          event.dataTransfer.setData("text/plain", row.dataset.slug ?? "")
        }
      },
      { signal },
    )
    list.addEventListener(
      "dragover",
      (event) => {
        if (dragged) event.preventDefault()
      },
      { signal },
    )
    list.addEventListener(
      "drop",
      (event) => {
        event.preventDefault()
        const row = rowFor(event.target)
        if (!notes || !dragged || !row || exporting()) return
        const from = notes.indexOf(dragged)
        let to = Number(row.dataset.index)
        const bounds = row.getBoundingClientRect()
        if (event.clientY > bounds.top + bounds.height / 2) to++
        if (from < to) to--
        notes.splice(from, 1)
        notes.splice(to, 0, dragged)
        dragged = undefined
        renderPage()
      },
      { signal },
    )
    list.addEventListener(
      "dragend",
      () => {
        list.querySelector(".dragging")?.classList.remove("dragging")
        dragged = undefined
      },
      { signal },
    )
    exportButton.addEventListener(
      "click",
      () => {
        if (exporting()) return
        const selected = (notes ?? [])
          .filter((note) => note.selected)
          .map(({ slug, title }) => ({ slug, title }))
        if (!selected.length) return
        if (window.parent === window) {
          setStatus("Open this folder from the dashboard to export it.")
          return
        }
        const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2)
        root.dataset.requestId = requestId
        root.dataset.exporting = "true"
        setStatus("Preparing PDF...")
        renderPage()
        window.parent.postMessage(
          {
            type: "second-brain:export-folder-pdf",
            requestId,
            cluster: root.dataset.clusterSlug ?? "",
            folderSlug: root.dataset.folderSlug ?? "",
            folderTitle: root.dataset.folderTitle ?? "Folder",
            documents: selected,
          },
          "*",
        )
      },
      { signal },
    )
    window.addEventListener(
      "message",
      (event) => {
        const data = event.data
        if (
          event.source !== window.parent ||
          data?.type !== "second-brain:folder-pdf-result" ||
          !data.requestId ||
          data.requestId !== root.dataset.requestId
        )
          return
        root.dataset.exporting = "false"
        setStatus(data.ok ? "PDF downloaded." : data.error || "Could not export PDF.")
        renderPage()
      },
      { signal },
    )
    window.addCleanup(() => {
      controller.abort()
      boundExports.delete(root)
      pagination.remove()
      list.replaceChildren()
      modal.hidden = true
      delete root.dataset.exporting
      delete root.dataset.requestId
    })
  }
})
