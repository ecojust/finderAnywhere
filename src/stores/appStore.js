import { reactive } from "vue";

const state = reactive({
  root: "",
  currentPath: "",
  entries: [],
  selectedPath: "",
  search: "",
  view: localStorage.getItem("oFinder-view") || "list",
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
  ocserverUrl: "",
  ocserverVersion: "",
  ocserverModels: [],
  fullscreenOpen: false,
  thumbCache: new Map(),
  highReqCount: 0,
  toastMessage: "",
  toastVisible: false,
});

let toastTimer = null;

export function showToast(msg) {
  state.toastMessage = msg;
  state.toastVisible = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toastVisible = false;
  }, 2000);
}

export function useAppStore() {
  return state;
}
