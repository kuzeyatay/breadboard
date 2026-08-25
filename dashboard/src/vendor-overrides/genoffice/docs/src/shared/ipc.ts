import type { FaceVerticalMetrics } from '@genoffice/font-metrics'

export interface OpenFileResult {
  path: string
  name: string
  data: ArrayBuffer
  hash: string
  encrypted?: boolean
  recovered?: boolean
}

export interface OpenFileNeedsPassword {
  needsPassword: true
  path: string
  name: string
}

export type OpenDocxResult = OpenFileResult | OpenFileNeedsPassword | null
export type DecryptOpenResult =
  | { ok: true; result: OpenFileResult }
  | { ok: false; reason: 'wrong-password' | 'unsupported' | 'error'; error?: string }

export interface PickImageResult {
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif'
  name: string
}

export interface AiSettings {
  provider: string
  providers: Record<string, { apiKey: string; model: string; baseUrl?: string }>
}

/** The retained editor tools use this small structural part of GenOffice's
 * agent-core protocol; Breadboard supplies the model loop in its API route. */
export interface AgentToolCall {
  id?: string
  name: string
  input: Record<string, unknown>
}

export interface AgentToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const AI_PROVIDERS = [
  { id: 'breadboard', defaultModel: 'workspace', needsBaseUrl: false },
] as const

export interface DocsTabInfo {
  id: string
  title: string
  focused: boolean
}

export type MenuCommand =
  | 'new'
  | 'open'
  | 'open-path'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'zoom-page-width'
  | 'zoom-whole-page'
  | 'toggle-ai'
  | 'toggle-dark'
  | 'insert-table'
  | 'insert-image'
  | 'insert-page-break'
  | 'insert-link'
  | 'insert-equation'
  | 'insert-comment'
  | 'font-dialog'
  | 'paragraph-dialog'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'page-setup'
  | 'find'
  | 'print'
  | 'export-pdf'
  | 'word-count'
  | 'ai-proofread'

export type UiTheme = 'light' | 'dark' | 'system'

export interface DesktopApi {
  getLanguage(): Promise<'en'>
  onLanguageChanged(handler: (lang: 'en') => void): () => void
  getTheme(): Promise<UiTheme>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  onChromePressed(handler: () => void): () => void
  openDocx(): Promise<OpenDocxResult>
  openDocxPath(path: string): Promise<OpenDocxResult>
  openDocxDecrypt(path: string, password: string): Promise<DecryptOpenResult>
  setDocPassword(filePath: string | null, password: string | null): Promise<{ ok: boolean }>
  docPasswordIntentRevision(): Promise<number>
  discardDocPasswordIntents(throughRevision: number): Promise<{ ok: boolean }>
  consumePendingOpenDocx(): Promise<OpenDocxResult>
  consumeNewBlankDoc(): Promise<boolean>
  onOpenDocx(handler: (result: Exclude<OpenDocxResult, null>) => void): () => void
  onRenamedDocx(handler: (paths: { oldPath: string; newPath: string }) => void): () => void
  saveDocx(
    path: string,
    data: ArrayBuffer,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified'; passwordIntentPending?: boolean }>
  writeRecoveryCopy(path: string, data: ArrayBuffer): Promise<{ ok: boolean }>
  onTeardown(handler: () => void): () => void
  saveDocxAs(
    defaultName: string,
    data: ArrayBuffer,
    sourcePath?: string | null,
  ): Promise<{ ok: boolean; path?: string; error?: string; passwordIntentPending?: boolean }>
  saveDocxNew(
    defaultName: string,
    data: ArrayBuffer,
  ): Promise<{ ok: boolean; path?: string; error?: string; passwordIntentPending?: boolean }>
  getRecentFiles(): Promise<string[]>
  pickImage(): Promise<PickImageResult | null>
  fontMetrics(family: string): Promise<FaceVerticalMetrics | null>
  getAiSettings(): Promise<AiSettings>
  webSearch(
    query: string,
    maxResults?: number,
  ): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>
    answer?: string
    method: string
    error?: string
  }>
  imageSearch(
    query: string,
    maxResults?: number,
  ): Promise<{
    images: Array<{
      title: string
      imageUrl: string
      sourceUrl: string
      source: string
      width?: number
      height?: number
    }>
    method: string
    error?: string
  }>
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  print(): Promise<{ ok: boolean; error?: string }>
  exportPdf(
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  printPdfBuffer(
    pageWidthTwips: number,
    pageHeightTwips: number,
  ): Promise<{ ok: boolean; base64?: string; error?: string }>
  saveMergedPdf(
    defaultName: string,
    base64Parts: string[],
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  openNewTab(openPath?: string | null): Promise<void>
  listDocsTabs(): Promise<DocsTabInfo[]>
  focusDocsTab(id: string): Promise<void>
  onMenuCommand(handler: (command: MenuCommand, payload?: string) => void): () => void
  onCloseCheck(handler: () => void): () => void
  reportCloseCheck(state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void
  onCloseSaveRequest(handler: () => void): () => void
  reportCloseSaveResult(ok: boolean): void
  reportViewMenuState(state: { aiSidebar: boolean; darkCanvas: boolean }): void
}

export type { FaceVerticalMetrics }
