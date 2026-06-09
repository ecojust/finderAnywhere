<template>
  <div class="app-shell">
    <Toolbar
      @navigate="openPath"
      @search="onSearch"
      @refresh="handleRefresh"
      @refresh-share="loadShareInfo"
      @toggle-ocserver="handleOcserver"
    />
    <main class="workspace">
      <section class="browser-panel">
        <div class="browser-header">
          <div>
            <h1>
              {{ folderTitle
              }}<span v-if="store.highReqCount > 0" class="flowing-dot"
                ><span></span><span></span><span></span
              ></span>
            </h1>
            <p>{{ folderMeta }}</p>
          </div>
        </div>
        <div
          class="content-area"
          :class="{ 'virtual-content': view === 'list' }"
        >
          <FileTable v-if="view === 'list'" />
          <FileGrid v-else />
        </div>
      </section>
      <PreviewPanel v-if="selectedEntry" :entry="selectedEntry" />
    </main>
    <OcserverDialog v-if="showOcDialog" @close="showOcDialog = false" />
    <transition name="toast">
      <div v-if="store.toastVisible" class="toast">
        {{ store.toastMessage }}
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useTauri } from "@/composables/useTauri";
import { useEventBus } from "@/composables/useEventBus";
import { clearThumbQueue } from "@/composables/useThumbLoader";
import Toolbar from "@/components/Toolbar.vue";
import FileTable from "@/components/FileTable.vue";
import FileGrid from "@/components/FileGrid.vue";
import PreviewPanel from "@/components/PreviewPanel.vue";
import OcserverDialog from "@/components/OcserverDialog.vue";

const store = useAppStore();
const tauri = useTauri();
const bus = useEventBus();
const showOcDialog = ref(false);
const selectedEntry = ref(null);
const folderTitle = ref("首页");
const folderMeta = ref("");
const view = computed(() => store.view);

async function openPath(path, pushHistory = true) {
  const normalized = path || "";
  if (pushHistory && normalized !== store.currentPath) {
    store.backStack.push(store.currentPath);
    store.forwardStack = [];
  }
  store.currentPath = normalized;
  store.selectedPath = "";
  selectedEntry.value = null;
  store.resourceUrlByPath.clear();
  store.previewUrlByPath.clear();
  clearThumbQueue();

  try {
    const data = await tauri.listDirectory(
      store.root || null,
      normalized || null,
    );
    store.root = data.root;
    store.entries = data.entries;
    store.entryByPath = new Map(data.entries.map((e) => [e.path, e]));
    store.breadcrumbs = data.breadcrumbs;
    folderTitle.value = data.name;
    folderMeta.value = `${data.entries.length} 项`;
  } catch (e) {
    folderTitle.value = "错误";
    folderMeta.value = String(e);
    store.entries = [];
  }
}

function onSearch() {
  const keyword = store.search.trim().toLowerCase();
  const entries = keyword
    ? store.entries.filter((e) => e.name.toLowerCase().includes(keyword))
    : store.entries;
  folderMeta.value = `${entries.length} 项`;
}

async function handleRefresh() {
  await openPath(store.currentPath, false);
  await loadShareInfo();
}

async function loadShareInfo() {
  try {
    const config = await tauri.appConfig();
    store.sharePortLocked = config.sharePortLocked;
    if (config.sharePortLocked && config.sharePort) {
      store.savedSharePort = config.sharePort;
    }
    const lockedPort = config.sharePortLocked ? config.sharePort : null;
    const info = await tauri.shareInfo(store.root || null, lockedPort);
    store.root = info.root;
    store.currentSharePort = info.port;
    if (!config.sharePortLocked) {
      store.savedSharePort = info.port;
    }
    const urls = info.lanUrls?.length ? info.lanUrls : [info.localUrl];
    store.shareUrls = urls;
    store.shareTitle = `局域网分享地址：${urls.join("  ")}`;
  } catch (e) {
    store.shareUrls = [];
    store.shareTitle = String(e);
    store.currentSharePort = null;
  }
}

async function handleOcserver() {
  if (store.ocserverLoading) return;
  if (store.ocserverRunning) {
    showOcDialog.value = true;
    return;
  }
  const rootPath = localStorage.getItem("oFinder-root") || store.root || "";
  if (!rootPath) return;

  store.ocserverLoading = true;
  try {
    const url = await tauri.startOcserver(rootPath);
    store.ocserverRunning = true;
    store.ocserverUrl = url;
    const [version, models] = await Promise.all([
      tauri.ocserverVersion().catch(() => ""),
      tauri.ocserverModels().catch(() => []),
    ]);
    store.ocserverVersion = version;
    store.ocserverModels = Array.isArray(models) ? models : [];
    showOcDialog.value = true;
  } catch (e) {
    store.ocserverRunning = false;
    store.ocserverUrl = "";
    console.error("opencode 启动失败:", e);
  }
  store.ocserverLoading = false;
}

function handleNavigateDir(path) {
  openPath(path, false);
}

function handlePreviewEntry(entry) {
  selectedEntry.value = entry;
  store.selectedPath = entry.path;
}

onMounted(async () => {
  bus.on("navigate-dir", handleNavigateDir);
  bus.on("preview-entry", handlePreviewEntry);
  store.root = localStorage.getItem("oFinder-root") || "";
  await openPath("", false);
  await loadShareInfo();
});
</script>
