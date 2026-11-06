import { pathToRoot } from '../../util/path'
import { getFullSlug } from '../../util/path'
import { DEFAULT_READER_SETTINGS, readReaderPreferences, writeReaderPreferences, type HandwritingFont, type ReaderPreferences } from '../../util/readerSettings'

let preferences: ReaderPreferences = { settings: { ...DEFAULT_READER_SETTINGS } }
let dialog: HTMLDialogElement | undefined, preview: HandwritingFont | undefined, activeFont: FontFace | undefined
let worker: Worker | undefined, workerTimer: ReturnType<typeof setTimeout> | undefined, generation = 0, saveQueue = Promise.resolve()
let loaded = false, hosted = false, applying = 0, requestedWrite = 0, previewFace: FontFace | undefined
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('quartz-reader-settings') : undefined
const asset = (name: string) => new URL(`${pathToRoot(getFullSlug(window))}/static/handwrite/${name}`, location.href).href
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not update Quartz settings.'
const setStatus = (message: string, error = false) => {
  const status = dialog?.querySelector<HTMLElement>('[data-settings-status]')
  if (status) { status.textContent = message; status.setAttribute('role', error ? 'alert' : 'status') }
}

async function apply() {
  const version = ++applying, root = document.documentElement, settings = preferences.settings
  root.style.setProperty('--quartz-reader-size', `${settings.fontSize}px`)
  root.style.setProperty('--quartz-reader-leading', String(settings.lineHeight))
  root.toggleAttribute('data-quartz-reader-size', settings.fontSize !== 16 || settings.lineHeight !== 1.6)
  root.toggleAttribute('data-quartz-hide-graph', !settings.showGraph)
  root.removeAttribute('data-quartz-handwriting')
  if (preferences.font && settings.handwriting) {
    try {
      const font = new FontFace('QuartzHandwriting', preferences.font.bytes.slice(0))
      await font.load()
      if (version !== applying) return
      if (activeFont) document.fonts.delete(activeFont)
      document.fonts.add(font); activeFont = font
      root.setAttribute('data-quartz-handwriting', '')
    } catch { setStatus('Could not load your saved font. Re-import it or generate it again.', true) }
  } else if (activeFont) { document.fonts.delete(activeFont); activeFont = undefined }
  if (version === applying) window.dispatchEvent(new Event('resize'))
}

function syncControls() {
  if (!dialog) return
  for (const key of ['fontSize', 'lineHeight', 'showGraph', 'handwriting'] as const) {
    const input = dialog.querySelector<HTMLInputElement>(`[name="${key}"]`)!
    if (input.type === 'checkbox') input.checked = Boolean(preferences.settings[key]); else input.value = String(preferences.settings[key])
  }
  dialog.querySelector<HTMLInputElement>('[name="handwriting"]')!.disabled = !preferences.font
  dialog.querySelector<HTMLElement>('[data-font-name]')!.textContent = preferences.font ? `${preferences.font.name} · 80 characters` : 'No handwriting font yet'
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-requires-font]')) button.disabled = !preferences.font
  dialog.querySelector('output[for="quartz-text-size"]')!.textContent = `${preferences.settings.fontSize}px`
  dialog.querySelector('output[for="quartz-line-height"]')!.textContent = preferences.settings.lineHeight.toFixed(1)
}

function save(next: ReaderPreferences, message = 'Saved on this device') {
  // Serialize complete snapshots so rapid changes cannot overwrite newer settings.
  const version = ++requestedWrite
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await writeReaderPreferences(next)
    if (version === requestedWrite) { preferences = next; await apply(); syncControls(); setStatus(message); channel?.postMessage('changed') }
  }).catch(error => { if (version === requestedWrite) { setStatus(errorText(error), true); syncControls() } })
  return saveQueue
}

function cancelGeneration() {
  generation++; worker?.terminate(); worker = undefined; clearTimeout(workerTimer)
  if (dialog) {
    dialog.querySelector<HTMLProgressElement>('progress')!.hidden = true
    dialog.querySelector<HTMLButtonElement>('[data-cancel-generation]')!.hidden = true
    for (const input of dialog.querySelectorAll<HTMLInputElement>('input[type=file]')) input.disabled = false
  }
}

async function showPreview(font: HandwritingFont) {
  const version = generation
  const face = new FontFace('QuartzHandwritingPreview', font.bytes.slice(0))
  await face.load()
  if (version !== generation || !dialog?.open) return
  if (previewFace) document.fonts.delete(previewFace)
  document.fonts.add(face); previewFace = face; preview = font
  const previewElement = dialog!.querySelector<HTMLElement>('[data-font-preview]')!
  previewElement.hidden = false
  previewElement.scrollIntoView({ block: 'nearest' })
  setStatus('Your font is ready. Check the letters below, then use it on your pages.')
}

async function generate(file: File, importFont = false) {
  cancelGeneration(); const current = generation
  preview = undefined; dialog!.querySelector<HTMLElement>('[data-font-preview]')!.hidden = true
  if (file.size > (importFont ? 2_000_000 : 12 * 1024 * 1024)) { setStatus(importFont ? 'Font files must be under 2 MB.' : 'Scans must be under 12 MB.', true); return }
  if (!importFont && !['image/jpeg', 'image/png'].includes(file.type)) { setStatus('Use a JPG or PNG scan of the template.', true); return }
  for (const input of dialog!.querySelectorAll<HTMLInputElement>('input[type=file]')) input.disabled = true
  const progress = dialog!.querySelector<HTMLProgressElement>('progress')!
  progress.hidden = false; progress.removeAttribute('value')
  dialog!.querySelector<HTMLButtonElement>('[data-cancel-generation]')!.hidden = false
  setStatus(importFont ? 'Checking your font…' : 'Reading your handwriting…')
  try {
    worker = new Worker(asset('worker.js'))
    worker.onerror = () => { if (current === generation) { cancelGeneration(); setStatus('Could not load handwriting processing. Check the connection and try again.', true) } }
    worker.onmessage = async event => {
      if (current !== generation) return
      if (typeof event.data.progress === 'number') { progress.value = event.data.progress; setStatus(`Creating your font… ${event.data.progress}%`); return }
      cancelGeneration()
      if (event.data.error) { setStatus(event.data.error, true); return }
      try { await showPreview({ id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0,80) || 'My handwriting', bytes: event.data.font }) }
      catch (error) { setStatus(errorText(error), true) }
    }
    workerTimer = setTimeout(() => { if (current === generation) { cancelGeneration(); setStatus('This scan took too long to process. Try a smaller, clearer scan.', true) } }, 60_000)
    if (importFont) { const font = await file.arrayBuffer(); if (current === generation) worker!.postMessage({ font }, [font]) }
    else worker.postMessage({ file })
  } catch (error) { cancelGeneration(); setStatus(errorText(error), true) }
}

function exportFont() {
  if (!preferences.font) return
  const url = URL.createObjectURL(new Blob([preferences.font.bytes], { type: 'font/otf' }))
  const link = document.createElement('a'); link.href = url; link.download = 'my-handwriting.otf'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function createDialog() {
  dialog = document.createElement('dialog'); dialog.className = 'quartz-settings-dialog'; dialog.setAttribute('aria-labelledby', 'quartz-settings-title')
  // All markup is static. User filenames are only assigned through textContent.
  dialog.innerHTML = `<form method="dialog" class="quartz-settings-heading"><div><h2 id="quartz-settings-title">Page settings</h2><p>Make your garden comfortable to read.</p></div><button aria-label="Close settings" title="Close settings">×</button></form>
    <section aria-labelledby="quartz-reading-heading"><h3 id="quartz-reading-heading">Reading</h3>
      <div class="quartz-settings-row"><label for="quartz-text-size">Text size</label><output for="quartz-text-size">16px</output></div><input id="quartz-text-size" name="fontSize" type="range" min="14" max="26" step="1" value="16">
      <div class="quartz-settings-row"><label for="quartz-line-height">Line spacing</label><output for="quartz-line-height">1.6</output></div><input id="quartz-line-height" name="lineHeight" type="range" min="1.3" max="2.2" step=".1" value="1.6">
      <label class="quartz-settings-row"><span>Show knowledge graphs</span><input name="showGraph" type="checkbox" role="switch" checked></label>
    </section>
    <section aria-labelledby="quartz-handwriting-heading"><div class="quartz-settings-row"><h3 id="quartz-handwriting-heading">Your handwriting</h3><label><span class="quartz-sr-only">Use my handwriting</span><input name="handwriting" type="checkbox" role="switch" disabled></label></div>
      <p data-font-name>No handwriting font yet</p>
      <ol><li><a data-template download="handwrite-template.pdf">Download the Handwrite template</a> and print it.</li><li>Write each indicated character in its box with dark ink. Keep all 80 borders visible.</li><li>Scan the whole sheet upright as a JPG or PNG, up to 12 MB. Avoid shadows and tilted photos.</li></ol>
      <label class="quartz-upload-label">Upload handwriting scan<input data-scan type="file" accept="image/jpeg,image/png"></label>
      <div class="quartz-settings-row quartz-font-actions"><label>Import saved font<input data-font-import type="file" accept=".otf,.ttf,font/otf,font/ttf"></label><button type="button" data-export-font data-requires-font disabled>Export font</button><button type="button" data-remove-font data-requires-font disabled>Remove font</button></div>
      <progress max="100" aria-label="Handwriting processing" hidden></progress><button type="button" data-cancel-generation hidden>Cancel processing</button>
      <div data-font-preview hidden><p class="quartz-handwriting-preview">The quick brown fox jumps over the lazy dog.<br>0123456789 · Aa Bb Cc Gg Jj Pp Qq Yy</p><p class="quartz-glyph-preview">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 . , ; : ! ? &quot; ' - + = / % &amp; ( ) [ ]</p><button type="button" data-use-font>Use this handwriting</button></div>
      <p class="quartz-settings-muted">Processed and saved on this device. Your scan never leaves this browser. Export your font to back it up or use it on another device. Math and code keep their own fonts.</p>
      <p class="quartz-settings-credit">Based on <a href="https://github.com/yashlamba/handwrite" target="_blank" rel="noopener noreferrer">Handwrite</a>.</p>
    </section><div class="quartz-settings-footer"><button type="button" data-reset-settings>Reset reading settings</button><p data-settings-status role="status" aria-live="polite"></p></div>`
  dialog.querySelector<HTMLAnchorElement>('[data-template]')!.href = asset('template.pdf')
  for (const key of ['fontSize', 'lineHeight', 'showGraph', 'handwriting'] as const) {
    const input = dialog.querySelector<HTMLInputElement>(`[name="${key}"]`)!
    input.addEventListener('input', () => {
      const value = input.type === 'checkbox' ? input.checked : Number(input.value)
      // Update in-memory settings immediately so queued changes keep every field.
      preferences = { ...preferences, settings: { ...preferences.settings, [key]: value } }
      void apply(); syncControls(); void save(preferences)
    })
  }
  for (const [selector, isFont] of [['[data-scan]', false], ['[data-font-import]', true]] as const) {
    const input = dialog.querySelector<HTMLInputElement>(selector)!
    input.onchange = () => { const file = input.files?.[0]; input.value = ''; if (file) void generate(file, isFont) }
  }
  dialog.querySelector<HTMLButtonElement>('[data-cancel-generation]')!.onclick = () => { cancelGeneration(); setStatus('Processing cancelled. Your current font is unchanged.') }
  dialog.querySelector<HTMLButtonElement>('[data-use-font]')!.onclick = async () => {
    if (!preview) return
    const font = preview
    await save({ settings: { ...preferences.settings, handwriting: true }, font }, 'Your handwriting is now on these pages.')
    if (preview?.id === font.id && preferences.font?.id === font.id) { preview = undefined; dialog!.querySelector<HTMLElement>('[data-font-preview]')!.hidden = true }
  }
  dialog.querySelector<HTMLButtonElement>('[data-export-font]')!.onclick = exportFont
  dialog.querySelector<HTMLButtonElement>('[data-remove-font]')!.onclick = () => { void save({ settings: { ...preferences.settings, handwriting: false } }, 'Handwriting removed from this device.') }
  dialog.querySelector<HTMLButtonElement>('[data-reset-settings]')!.onclick = () => { void save({ ...preferences, settings: { ...DEFAULT_READER_SETTINGS } }) }
  dialog.addEventListener('close', () => { cancelGeneration(); preview = undefined; if (previewFace) document.fonts.delete(previewFace); previewFace = undefined; dialog!.querySelector<HTMLElement>('[data-font-preview]')!.hidden = true })
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog!.close() } }, true)
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog!.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog!.close() } })
  document.body.append(dialog); syncControls()
}

async function openSettings() {
  if (!dialog?.isConnected) createDialog()
  if (!dialog!.open) dialog!.showModal()
  if (!loaded) await load()
  syncControls()
}

async function load() {
  try { preferences = await readReaderPreferences(); loaded = true; await apply(); syncControls() }
  catch (error) { setStatus(errorText(error), true) }
}

function bind() {
  const search = document.querySelector('.sidebar.left .search')
  const controls = search?.closest('.flex-component') ?? search?.parentElement
  // Embedded readers already have Page settings in the Garden toolbar. Do not
  // add a second control while waiting for that toolbar's host handshake.
  if (window.parent !== window) document.querySelectorAll('.quartz-settings-button').forEach(button => button.remove())
  if (window.parent === window && controls && !controls.querySelector('.quartz-settings-button')) {
    controls.classList.add('quartz-reader-controls')
    const button = document.createElement('button'); button.className = 'quartz-settings-button'; button.type = 'button'; button.title = 'Page settings'; button.setAttribute('aria-label', 'Page settings'); button.setAttribute('aria-haspopup', 'dialog'); button.hidden = hosted
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9.5 3-.6 2-1.6.9-2-.5-2.5 4.3 1.4 1.5v1.8l-1.4 1.5 2.5 4.3 2-.5 1.6.9.6 2h5l.6-2 1.6-.9 2 .5 2.5-4.3-1.4-1.5v-1.8l1.4-1.5-2.5-4.3-2 .5-1.6-.9-.6-2z"/><circle cx="12" cy="12" r="3"/></svg>'
    button.onclick = () => void openSettings(); controls.append(button)
  }
  if (!loaded) void load()
  else void apply()
  if (window.parent !== window) {
    try {
      const origin = new URL(window.location.ancestorOrigins?.[0] || document.referrer).origin
      window.parent.postMessage({ type: 'breadboard:quartz-settings-available' }, origin)
    } catch { /* Standalone pages have no host. */ }
  }
}

window.addEventListener('message', event => {
  if (window.parent === window || event.source !== window.parent) return
  let parentOrigin: string
  try { parentOrigin = new URL(window.location.ancestorOrigins?.[0] || document.referrer).origin } catch { return }
  if (event.origin !== parentOrigin) return
  if (event.data?.type === 'breadboard:quartz-settings-host') {
    hosted = true
    document.querySelectorAll<HTMLButtonElement>('.quartz-settings-button').forEach(button => { button.hidden = true })
    window.parent.postMessage({ type: 'breadboard:quartz-settings-ready' }, parentOrigin)
  } else if (event.data?.type === 'breadboard:quartz-settings-open') { void openSettings() }
})
channel?.addEventListener('message', () => { void saveQueue.then(load) })
document.addEventListener('nav', bind)
if (document.readyState !== 'loading') bind()
else document.addEventListener('DOMContentLoaded', bind, { once: true })
