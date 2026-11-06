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
    const search = modal?.querySelector<HTMLInputElement>(".folder-pdf-search-input")
    const searchCount = modal?.querySelector<HTMLElement>(".folder-pdf-search-count")
    const selectAll = modal?.querySelector<HTMLButtonElement>(".folder-pdf-select-all")
    const clear = modal?.querySelector<HTMLButtonElement>(".folder-pdf-clear")
    const status = root.querySelector<HTMLElement>(".folder-pdf-status")
    const exportButton = root.querySelector<HTMLButtonElement>(".folder-pdf-export-button")
    if (!open || !modal || !list || !exportButton) continue
    boundExports.add(root)
    // The reading column uses container-type. A fixed descendant is positioned
    // against that (potentially book-length) column, not the viewport. Keep the
    // dialog at body level while it is open so it cannot open below the screen.
    const modalHome = document.createComment("folder PDF dialog")
    modal.before(modalHome)
    const show = () => {
      document.body.appendChild(modal)
      modal.hidden = false
    }
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
    let matching: number[] = []
    let dragged: ExportNote | undefined
    let moveAnchor: { slug: string; top: number; scrollTop: number } | undefined
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

    const matchingIndexes = () => {
      const query = search?.value.trim().toLocaleLowerCase() ?? ""
      const indexes: number[] = []
      for (const [index, note] of (notes ?? []).entries()) {
        if (
          !query ||
          note.title.toLocaleLowerCase().includes(query) ||
          note.slug.toLocaleLowerCase().includes(query)
        )
          indexes.push(index)
      }
      return indexes
    }

    function updateCount() {
      const selected = notes?.filter((note) => note.selected).length ?? 0
      if (count) count.textContent = `${selected} of ${notes?.length ?? 0} notes selected`
      if (searchCount)
        searchCount.textContent = search?.value.trim()
          ? `${matching.length} ${matching.length === 1 ? "match" : "matches"}`
          : ""
      if (selectAll) {
        selectAll.textContent = search?.value.trim() ? "Select matches" : "Select all"
        selectAll.disabled = matching.length === 0 || exporting()
      }
      if (clear) {
        clear.textContent = search?.value.trim() ? "Clear matches" : "Clear"
        clear.disabled = matching.length === 0 || exporting()
      }
      if (search) search.disabled = exporting()
      exportButton!.disabled = selected === 0 || exporting()
      previous.disabled = page === 0 || exporting()
      next.disabled = (page + 1) * pageSize >= matching.length || exporting()
    }

    const resetListPosition = () => {
      moveAnchor = undefined
      list.style.removeProperty("height")
      list.style.removeProperty("padding-top")
      list.style.removeProperty("padding-bottom")
      list.scrollTop = 0
    }

    function renderPage(focusSlug?: string, action?: string, anchorTop?: number) {
      if (!notes) return
      matching = matchingIndexes()
      if (anchorTop !== undefined) {
        // Retain the viewport even for short lists and the last partial page.
        list!.style.height = `${list!.getBoundingClientRect().height}px`
        list!.style.removeProperty("padding-top")
        list!.style.removeProperty("padding-bottom")
      }
      page = Math.min(page, Math.max(0, Math.ceil(matching.length / pageSize) - 1))
      const start = page * pageSize
      list!.style.counterReset = `folder-pdf-order ${start}`
      list!.start = start + 1
      const fragment = document.createDocumentFragment()
      for (const [offset, index] of matching.slice(start, start + pageSize).entries()) {
        const note = notes[index]
        const item = document.createElement("li")
        item.className = "folder-pdf-item"
        item.dataset.index = String(index)
        item.dataset.matchIndex = String(start + offset)
        item.dataset.slug = note.slug
        item.draggable = !exporting()
        item.setAttribute("aria-posinset", String(start + offset + 1))
        item.setAttribute("aria-setsize", String(matching.length))
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
            (direction === "up" ? start + offset === 0 : start + offset === matching.length - 1)
          actions.append(button)
        }
        item.append(grip, label, actions)
        fragment.append(item)
      }
      if (matching.length === 0) {
        const empty = document.createElement("li")
        empty.className = "folder-pdf-empty"
        empty.textContent = "No notes match your search."
        fragment.append(empty)
      }
      list!.replaceChildren(fragment)
      pagination.hidden = matching.length <= pageSize
      range.textContent = `Notes ${matching.length ? start + 1 : 0}–${Math.min(start + pageSize, matching.length)} of ${matching.length}`
      updateCount()
      if (focusSlug) {
        const row = Array.from(list!.children).find(
          (item) => (item as HTMLElement).dataset.slug === focusSlug,
        )
        const button = row?.querySelector<HTMLButtonElement>(`.folder-pdf-${action ?? "up"}`)
        if (button && anchorTop !== undefined) {
          const desiredScroll = list!.scrollTop + button.getBoundingClientRect().top - anchorTop
          const style = getComputedStyle(list!)
          // scrollHeight includes unused viewport space on a short page. Use
          // the actual last row so added padding can make that page scroll too.
          const contentBottom =
            list!.lastElementChild!.getBoundingClientRect().bottom -
            list!.getBoundingClientRect().top +
            list!.scrollTop +
            parseFloat(style.paddingBottom)
          const maxScroll = contentBottom - list!.clientHeight
          // At either edge, add only the space needed to keep the same arrow
          // under the pointer. It also lets a note cross a pagination boundary.
          if (desiredScroll < 0) {
            list!.style.paddingTop = `${parseFloat(style.paddingTop) - desiredScroll}px`
          } else if (desiredScroll > maxScroll) {
            list!.style.paddingBottom = `${parseFloat(style.paddingBottom) + desiredScroll - maxScroll}px`
          }
          list!.scrollTop += button.getBoundingClientRect().top - anchorTop
        }
        if (button && !button.disabled) button.focus({ preventScroll: true })
        else row?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true })
      }
    }

    const hide = () => {
      if (exporting()) return
      modal.hidden = true
      modalHome.after(modal)
      list.replaceChildren()
      resetListPosition()
      if (search) search.value = ""
      page = 0
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
            show()
            setStatus("Could not load the note list. Reload this page and try again.")
            exportButton.disabled = true
            return
          }
        }
        show()
        renderPage()
        ;(search ?? modal.querySelector<HTMLButtonElement>(".folder-pdf-close"))?.focus()
      },
      { signal },
    )
    for (const selector of [".folder-pdf-close", ".folder-pdf-cancel"])
      modal.querySelector(selector)?.addEventListener("click", hide, { signal })
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
    search?.addEventListener(
      "input",
      () => {
        page = 0
        resetListPosition()
        renderPage()
      },
      { signal },
    )
    previous.addEventListener(
      "click",
      () => {
        page--
        resetListPosition()
        renderPage()
      },
      { signal },
    )
    next.addEventListener(
      "click",
      () => {
        page++
        resetListPosition()
        renderPage()
      },
      { signal },
    )
    for (const [selector, selected] of [
      [".folder-pdf-select-all", true],
      [".folder-pdf-clear", false],
    ] as const) {
      modal.querySelector(selector)?.addEventListener(
        "click",
        () => {
          if (exporting()) return
          for (const index of matching) notes![index].selected = selected
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
        const from = Number(row.dataset.index)
        const toMatch = Number(row.dataset.matchIndex) + direction
        const to = matching[toMatch]
        if (!direction || to === undefined) return
        const note = notes[from]
        ;[notes[from], notes[to]] = [notes[to], notes[from]]
        page = Math.floor(toMatch / pageSize)
        const buttonTop = button.getBoundingClientRect().top
        // scrollTop rounds to physical pixels. Reuse the original anchor for
        // consecutive clicks so that rounding cannot accumulate into drift.
        const anchorTop =
          moveAnchor?.slug === note.slug &&
          moveAnchor.scrollTop === list.scrollTop &&
          Math.abs(moveAnchor.top - buttonTop) < 2
            ? moveAnchor.top
            : buttonTop
        renderPage(note.slug, direction < 0 ? "up" : "down", anchorTop)
        moveAnchor = { slug: note.slug, top: anchorTop, scrollTop: list.scrollTop }
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
        const ordered = matching.map((index) => notes![index])
        const from = ordered.indexOf(dragged)
        let to = Number(row.dataset.matchIndex)
        const bounds = row.getBoundingClientRect()
        if (event.clientY > bounds.top + bounds.height / 2) to++
        if (from < to) to--
        ordered.splice(from, 1)
        ordered.splice(to, 0, dragged)
        matching.forEach((index, offset) => {
          notes![index] = ordered[offset]
        })
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
        setStatus(
          data.ok
            ? data.message || "PDF download started. Check your browser's downloads."
            : data.error || "Could not export PDF.",
        )
        renderPage()
      },
      { signal },
    )
    window.addCleanup(() => {
      controller.abort()
      boundExports.delete(root)
      pagination.remove()
      list.replaceChildren()
      resetListPosition()
      modal.hidden = true
      modalHome.replaceWith(modal)
      delete root.dataset.exporting
      delete root.dataset.requestId
    })
  }
})
