import { useAppStore } from '@/stores/appStore'
import { useTauri } from '@/composables/useTauri'

const MAX_CONCURRENT = 5
let queue = []
let inFlight = 0
let tauri = null

function getTauri() {
  if (!tauri) tauri = useTauri()
  return tauri
}

function processQueue() {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const { absPath, key } = queue.shift()
    inFlight++
    getTauri().previewUrl(absPath, 420)
      .then(url => {
        const store = useAppStore()
        if (store.thumbCache.get(key)?.loading !== false) {
          store.thumbCache.set(key, { loading: false, url })
        }
      })
      .catch(() => {
        const store = useAppStore()
        if (store.thumbCache.get(key)?.loading !== false) {
          store.thumbCache.set(key, { loading: false, url: '' })
        }
      })
      .finally(() => {
        inFlight--
        processQueue()
      })
  }
}

export function loadThumbnail(entry) {
  const store = useAppStore()
  if (!entry || entry.entryType !== 'file' || entry.kind !== 'image') return
  const key = entry.path
  if (store.thumbCache.has(key)) return
  store.thumbCache.set(key, { loading: true, url: '' })
  queue.push({ absPath: entry.absolutePath, key })
  processQueue()
}

export function loadThumbnails(entries) {
  const store = useAppStore()
  for (const entry of entries) {
    if (!entry || entry.entryType !== 'file' || entry.kind !== 'image') continue
    const key = entry.path
    if (store.thumbCache.has(key)) continue
    store.thumbCache.set(key, { loading: true, url: '' })
    queue.push({ absPath: entry.absolutePath, key })
  }
  processQueue()
}

export function clearThumbQueue() {
  queue = []
}
