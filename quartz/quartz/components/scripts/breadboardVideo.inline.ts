/**
 * Breadboard video widgets. Upgrades the markup emitted by the BreadboardVideos
 * transformer:
 *
 *   - `.bb-video--file` — swaps the browser's default `controls` for a control
 *     bar built from the garden's own tokens. The native controls stay in the
 *     HTML so a page with no JavaScript is still fully playable; they are only
 *     removed once the replacement is in the DOM.
 *   - `.bb-video--youtube` — a click-to-play facade. YouTube's player is not
 *     loaded (and sets nothing) until someone presses play.
 *
 * Every node is built with createElement / textContent; nothing from the note
 * is ever parsed as HTML.
 */

const BB_SVG_NS = "http://www.w3.org/2000/svg"

function bbEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function icon(path: string): SVGElement {
  const svg = document.createElementNS(BB_SVG_NS, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("focusable", "false")
  const shape = document.createElementNS(BB_SVG_NS, "path")
  shape.setAttribute("d", path)
  svg.appendChild(shape)
  return svg
}

const ICONS = {
  play: "M8 5.2v13.6a.7.7 0 0 0 1.06.6l11.2-6.8a.7.7 0 0 0 0-1.2L9.06 4.6A.7.7 0 0 0 8 5.2Z",
  pause: "M7 4.5h3.2v15H7v-15Zm6.8 0H17v15h-3.2v-15Z",
  replay:
    "M12 5V2.2L8.2 6 12 9.8V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z",
  volume: "M4 9.5h3.4L12 5.2v13.6L7.4 14.5H4v-5Zm11.6-1.1a5 5 0 0 1 0 7.2l1.4 1.4a7 7 0 0 0 0-10l-1.4 1.4Z",
  muted: "M4 9.5h3.4L12 5.2v13.6L7.4 14.5H4v-5Zm12.9-.3 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4L21.8 11l2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4L18.9 11l-2-1.8Z",
  expand: "M4 9V4h5v2H6v3H4Zm11-5h5v5h-2V6h-3V4ZM4 15h2v3h3v2H4v-5Zm14 0h2v5h-5v-2h3v-3Z",
  collapse: "M9 4h2v5H6V7h3V4Zm4 0h2v3h3v2h-5V4ZM6 15h5v5H9v-3H6v-2Zm9 0h5v2h-3v3h-2v-5Z",
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const paddedSecs = String(secs).padStart(2, "0")
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSecs}`
    : `${minutes}:${paddedSecs}`
}

function iconButton(className: string, label: string, path: string): HTMLButtonElement {
  const button = bbEl("button", `bb-video-btn ${className}`)
  button.type = "button"
  button.setAttribute("aria-label", label)
  button.title = label
  button.appendChild(icon(path))
  return button
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75]

// -------------------------------------------------------------- file player

function upgradeFilePlayer(figure: HTMLElement): void {
  const video = figure.querySelector("video.bb-video-media") as HTMLVideoElement | null
  const stage = figure.querySelector(".bb-video-stage") as HTMLElement | null
  if (!video || !stage) return

  const overlay = bbEl("button", "bb-video-overlay")
  overlay.type = "button"
  overlay.setAttribute("aria-label", "Play video")
  overlay.appendChild(icon(ICONS.play))

  const bar = bbEl("div", "bb-video-bar")

  const playButton = iconButton("bb-video-play-toggle", "Play", ICONS.play)

  const seek = bbEl("div", "bb-video-seek")
  const buffered = bbEl("div", "bb-video-seek-buffered")
  const played = bbEl("div", "bb-video-seek-played")
  const scrubber = document.createElement("input")
  scrubber.type = "range"
  scrubber.className = "bb-video-seek-input"
  scrubber.min = "0"
  scrubber.max = "1000"
  scrubber.value = "0"
  scrubber.step = "1"
  scrubber.setAttribute("aria-label", "Seek")
  seek.append(buffered, played, scrubber)

  const time = bbEl("span", "bb-video-time", "0:00 / 0:00")

  const muteButton = iconButton("bb-video-mute", "Mute", ICONS.volume)

  const volume = document.createElement("input")
  volume.type = "range"
  volume.className = "bb-video-volume"
  volume.min = "0"
  volume.max = "100"
  volume.step = "1"
  volume.value = String(Math.round(video.volume * 100))
  volume.setAttribute("aria-label", "Volume")

  const speedButton = bbEl("button", "bb-video-btn bb-video-speed", "1x")
  speedButton.type = "button"
  speedButton.setAttribute("aria-label", "Playback speed")
  speedButton.title = "Playback speed"

  const fullscreenButton = iconButton("bb-video-fullscreen", "Full screen", ICONS.expand)

  bar.append(playButton, seek, time, muteButton, volume, speedButton, fullscreenButton)
  stage.append(overlay, bar)
  figure.dataset.state = "idle"

  let scrubbing = false

  const syncTime = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`
    const ratio = duration > 0 ? video.currentTime / duration : 0
    played.style.width = `${ratio * 100}%`
    if (!scrubbing) scrubber.value = String(Math.round(ratio * 1000))
  }

  const syncBuffered = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration <= 0 || video.buffered.length === 0) {
      buffered.style.width = "0%"
      return
    }
    buffered.style.width = `${(video.buffered.end(video.buffered.length - 1) / duration) * 100}%`
  }

  const setIcon = (button: HTMLElement, path: string, label: string) => {
    button.textContent = ""
    button.appendChild(icon(path))
    button.setAttribute("aria-label", label)
    button.title = label
  }

  const syncPlayState = () => {
    if (video.ended) {
      figure.dataset.state = "ended"
      setIcon(playButton, ICONS.replay, "Replay")
      setIcon(overlay, ICONS.replay, "Replay video")
      return
    }
    if (video.paused) {
      figure.dataset.state = figure.dataset.started === "true" ? "paused" : "idle"
      setIcon(playButton, ICONS.play, "Play")
      setIcon(overlay, ICONS.play, "Play video")
      return
    }
    figure.dataset.state = "playing"
    setIcon(playButton, ICONS.pause, "Pause")
  }

  const syncVolume = () => {
    const muted = video.muted || video.volume === 0
    setIcon(muteButton, muted ? ICONS.muted : ICONS.volume, muted ? "Unmute" : "Mute")
    volume.value = String(Math.round((muted ? 0 : video.volume) * 100))
  }

  const toggle = () => {
    if (video.paused || video.ended) {
      figure.dataset.started = "true"
      void video.play().catch(() => {
        // Autoplay policies or a missing file: leave the poster state as-is.
      })
    } else {
      video.pause()
    }
  }

  overlay.addEventListener("click", toggle)
  playButton.addEventListener("click", toggle)
  video.addEventListener("click", toggle)

  video.addEventListener("play", syncPlayState)
  video.addEventListener("pause", syncPlayState)
  video.addEventListener("ended", syncPlayState)
  video.addEventListener("timeupdate", syncTime)
  video.addEventListener("progress", syncBuffered)
  video.addEventListener("loadedmetadata", () => {
    syncTime()
    syncBuffered()
  })
  video.addEventListener("volumechange", syncVolume)
  video.addEventListener("error", () => {
    figure.dataset.state = "error"
    if (!figure.querySelector(".bb-video-error")) {
      stage.appendChild(bbEl("p", "bb-video-error", "This video could not be played."))
    }
  })

  const seekToRatio = (ratio: number) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration <= 0) return
    video.currentTime = Math.min(Math.max(ratio, 0), 1) * duration
  }

  scrubber.addEventListener("input", () => {
    scrubbing = true
    const ratio = Number(scrubber.value) / 1000
    played.style.width = `${ratio * 100}%`
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    time.textContent = `${formatTime(ratio * duration)} / ${formatTime(duration)}`
  })
  scrubber.addEventListener("change", () => {
    seekToRatio(Number(scrubber.value) / 1000)
    scrubbing = false
  })

  muteButton.addEventListener("click", () => {
    video.muted = !video.muted
    if (!video.muted && video.volume === 0) video.volume = 0.5
  })
  volume.addEventListener("input", () => {
    video.volume = Number(volume.value) / 100
    video.muted = video.volume === 0
  })

  let speedIndex = 0
  speedButton.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length
    video.playbackRate = SPEEDS[speedIndex]
    speedButton.textContent = `${SPEEDS[speedIndex]}x`
  })

  fullscreenButton.addEventListener("click", () => {
    if (document.fullscreenElement === figure) {
      void document.exitFullscreen().catch(() => {})
    } else {
      // Full-screening the figure (not the video) keeps the custom bar visible.
      void figure.requestFullscreen?.().catch(() => {})
    }
  })
  document.addEventListener("fullscreenchange", () => {
    const active = document.fullscreenElement === figure
    figure.classList.toggle("bb-video--fullscreen", active)
    setIcon(
      fullscreenButton,
      active ? ICONS.collapse : ICONS.expand,
      active ? "Exit full screen" : "Full screen",
    )
  })

  // Keyboard shortcuts apply while focus is inside the widget, so they never
  // steal Space or the arrow keys from the page.
  figure.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null
    if (target === scrubber || target === volume) return
    switch (event.key) {
      case " ":
      case "k":
        event.preventDefault()
        toggle()
        break
      case "ArrowLeft":
        event.preventDefault()
        video.currentTime = Math.max(0, video.currentTime - 5)
        break
      case "ArrowRight":
        event.preventDefault()
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
        break
      case "m":
        event.preventDefault()
        video.muted = !video.muted
        break
      case "f":
        event.preventDefault()
        fullscreenButton.click()
        break
      default:
        break
    }
  })

  syncPlayState()
  syncVolume()
  syncTime()
  syncBuffered()

  // Last: only once the replacement is wired up does the native UI go away, so
  // a failure anywhere above leaves a playable video rather than a dead frame.
  video.removeAttribute("controls")
  video.controls = false
}

// ----------------------------------------------------------- youtube facade

function upgradeYouTubeFacade(figure: HTMLElement): void {
  const stage = figure.querySelector(".bb-video-stage") as HTMLElement | null
  const poster = figure.querySelector(".bb-video-poster") as HTMLImageElement | null
  const button = figure.querySelector(".bb-video-play") as HTMLButtonElement | null
  const embedSrc = figure.dataset.embedSrc
  if (!stage || !button || !embedSrc) return

  // A garden read offline still shows the widget, just without the thumbnail.
  poster?.addEventListener("error", () => figure.classList.add("bb-video--no-poster"))

  const load = () => {
    if (figure.dataset.state === "playing") return
    figure.dataset.state = "playing"
    const frame = document.createElement("iframe")
    frame.className = "bb-video-frame"
    frame.src = embedSrc
    frame.title = figure.querySelector(".bb-video-title")?.textContent ?? "YouTube video"
    frame.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
    frame.setAttribute("allowfullscreen", "")
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin")
    stage.textContent = ""
    stage.appendChild(frame)
  }

  button.addEventListener("click", load)
  poster?.addEventListener("click", load)
}

document.addEventListener("nav", () => {
  const figures = document.querySelectorAll("[data-bb-video]") as NodeListOf<HTMLElement>
  for (const figure of figures) {
    if (figure.dataset.bbVideoBound === "true") continue
    figure.dataset.bbVideoBound = "true"
    try {
      if (figure.dataset.bbVideo === "youtube") upgradeYouTubeFacade(figure)
      else upgradeFilePlayer(figure)
    } catch {
      // A failed upgrade leaves the native player in place rather than nothing.
    }
  }
})
