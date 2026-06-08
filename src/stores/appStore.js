import { reactive } from 'vue'

const state = reactive({
  root: '',
  currentPath: '',
  entries: [],
  selectedPath: '',
  search: '',
  view: localStorage.getItem('finder-anywhere-view') || 'list',
  sharePortLocked: false,
  savedSharePort: null,
  currentSharePort: null,
  entryByPath: new Map(),
  resourceUrlByPath: new Map(),
  previewUrlByPath: new Map(),
  backStack: [],
  forwardStack: [],
  ocserverRunning: false,
  ocserverLoading: false,
  ocserverUrl: '',
  ocserverVersion: '',
  ocserverModels: [],
  fullscreenOpen: false,
  thumbCache: new Map(),
})

export function useAppStore() {
  return state
}
