// Use the browser's modal top layer so the reader's containers cannot clip the
// enlarged image, and keyboard focus stays inside the viewer.
document.addEventListener("nav", () => {
  let closeViewer: (() => void) | undefined
  const cleanups: (() => void)[] = []

  for (const image of document.querySelectorAll<HTMLImageElement>("article.popover-hint img")) {
    if (image.closest('button, [role="button"], [contenteditable="true"]')) continue

    // A plain linked image already has a keyboard-focusable trigger. Mixed
    // text/image links keep their text navigation and each image's identity.
    const link = image.closest("a")
    const trigger: HTMLElement =
      link && !link.textContent?.trim() && link.querySelectorAll("img").length === 1 ? link : image
    const label = image.alt.trim() || image.title.trim() || "Image"
    const attributes = ["tabindex", "role", "aria-label", "aria-haspopup"]
    const previousAttributes = attributes.map((name) => trigger.getAttribute(name))
    const hadViewerClass = image.classList.contains("quartz-image-zoom")
    image.classList.add("quartz-image-zoom")
    if (trigger === image) {
      trigger.tabIndex = 0
      trigger.setAttribute("role", "button")
    }
    trigger.setAttribute("aria-label", `Enlarge image: ${label}`)
    trigger.setAttribute("aria-haspopup", "dialog")

    const open = () => {
      const source = image.currentSrc || image.src
      if (!source) return
      closeViewer?.()

      const dialog = document.createElement("dialog")
      dialog.className = "quartz-image-viewer"
      dialog.setAttribute("aria-label", label)

      const closeButton = document.createElement("button")
      closeButton.type = "button"
      closeButton.className = "quartz-image-viewer-close"
      closeButton.setAttribute("aria-label", "Close image viewer")
      closeButton.textContent = "×"

      const preview = document.createElement("img")
      preview.className = "quartz-image-viewer-image"
      preview.alt = image.alt
      preview.decoding = "async"
      preview.referrerPolicy = image.referrerPolicy
      const sizePreview = () => {
        const width = preview.naturalWidth || image.naturalWidth
        const height = preview.naturalHeight || image.naturalHeight
        if (width && height) preview.style.setProperty("--image-aspect", String(width / height))
      }
      preview.addEventListener("load", sizePreview)
      preview.src = source
      sizePreview()

      const caption = document.createElement("p")
      caption.className = "quartz-image-viewer-caption"
      caption.textContent =
        image.closest("figure")?.querySelector("figcaption")?.textContent?.trim() ||
        image.title.trim() ||
        image.alt.trim()
      caption.hidden = !caption.textContent
      dialog.append(closeButton, preview, caption)
      document.body.append(dialog)

      const previousOverflow = document.documentElement.style.overflow
      const dismiss = () => {
        if (closeViewer !== dismiss) return
        closeViewer = undefined
        dialog.close()
        dialog.remove()
        document.documentElement.style.overflow = previousOverflow
        if (trigger.isConnected) trigger.focus({ preventScroll: true })
      }
      closeViewer = dismiss
      closeButton.addEventListener("click", dismiss)
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault()
        dismiss()
      })
      // Only a press starting and ending on the backdrop dismisses the viewer.
      let pressedBackdrop = false
      dialog.addEventListener("pointerdown", (event) => {
        pressedBackdrop = event.target === dialog
      })
      dialog.addEventListener("click", (event) => {
        if (pressedBackdrop && event.target === dialog) dismiss()
      })
      dialog.showModal()
      document.documentElement.style.overflow = "hidden"
      closeButton.focus({ preventScroll: true })
    }

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return
      // Stop the SPA router from following an image's wrapping link.
      event.preventDefault()
      event.stopPropagation()
      open()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.repeat) return
      event.preventDefault()
      event.stopPropagation()
      open()
    }
    trigger.addEventListener("click", onClick)
    trigger.addEventListener("keydown", onKeyDown)
    cleanups.push(() => {
      trigger.removeEventListener("click", onClick)
      trigger.removeEventListener("keydown", onKeyDown)
      if (!hadViewerClass) image.classList.remove("quartz-image-zoom")
      attributes.forEach((name, index) => {
        const previous = previousAttributes[index]
        if (previous === null) trigger.removeAttribute(name)
        else trigger.setAttribute(name, previous)
      })
    })
  }

  // Canonical article updates and SPA navigation use the same cleanup contract.
  window.addCleanup(() => {
    closeViewer?.()
    for (const cleanup of cleanups) cleanup()
  })
})
