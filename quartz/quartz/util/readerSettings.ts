export type ReaderSettings = { fontSize: number; lineHeight: number; showGraph: boolean; handwriting: boolean }
export type HandwritingFont = { id: string; name: string; bytes: ArrayBuffer }
export type ReaderPreferences = { settings: ReaderSettings; font?: HandwritingFont }
export const DEFAULT_READER_SETTINGS: ReaderSettings = { fontSize: 16, lineHeight: 1.6, showGraph: true, handwriting: false }

export function normalizeReaderSettings(value: Partial<ReaderSettings> = {}): ReaderSettings {
  return {
    fontSize: Number.isFinite(value.fontSize) ? Math.max(14, Math.min(26, Math.round(value.fontSize!))) : 16,
    lineHeight: Number.isFinite(value.lineHeight) ? Math.max(1.3, Math.min(2.2, value.lineHeight!)) : 1.6,
    showGraph: typeof value.showGraph === 'boolean' ? value.showGraph : true,
    handwriting: value.handwriting === true,
  }
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('quartz-reader-settings', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('preferences')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Could not open local settings. Check that browser storage is available.'))
    request.onblocked = () => reject(new Error('Close older Quartz settings windows and try again.'))
  })
}

export async function readReaderPreferences(): Promise<ReaderPreferences> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('preferences', 'readonly').objectStore('preferences').get('reader')
      request.onsuccess = () => resolve({ ...request.result, settings: normalizeReaderSettings(request.result?.settings) })
      request.onerror = () => reject(new Error('Could not read saved Quartz settings.'))
    })
  } finally { db.close() }
}

export async function writeReaderPreferences(value: ReaderPreferences) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('preferences', 'readwrite')
      tx.objectStore('preferences').put(value, 'reader')
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error('Could not save settings on this device. Free some browser storage and retry.'))
    })
  } finally { db.close() }
}
