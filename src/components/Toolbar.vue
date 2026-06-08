<template>
  <header class="toolbar">
    <div class="nav-controls">
      <button class="icon-button" :disabled="!backStack.length" @click="goBack" v-html="icons.arrowLeft" />
      <button class="icon-button" :disabled="!forwardStack.length" @click="goForward" v-html="icons.arrowRight" />
    </div>

    <nav class="breadcrumbs" aria-label="路径">
      <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
        <span v-if="i > 0" class="crumb-separator">/</span>
        <button :class="['crumb', i === breadcrumbs.length - 1 && 'active']" @click="navigateTo(crumb.path)">{{ crumb.name }}</button>
      </template>
    </nav>

    <div class="toolbar-actions">
      <button class="choose-button" @click="chooseRoot">
        <svg viewBox="0 0 24 24"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <span id="rootName">{{ rootName || '选择目录' }}</span>
      </button>

      <div class="share-addresses" :title="shareTitle" @click="copyShareUrl">
        <span v-if="!shareUrls.length">分享地址加载中</span>
        <span v-else>{{ shareUrls[0]?.replace(/^https?:\/\//, '') }}</span>
      </div>

      <button :class="['icon-button', sharePortLocked && 'active']" @click="togglePortLock" v-html="sharePortLocked ? icons.lock : icons.unlock" />

      <div class="search-box">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input v-model="search" placeholder="搜索" />
      </div>

      <div class="segmented">
        <button :class="['icon-button', view === 'list' && 'active']" @click="setView('list')" v-html="icons.list" />
        <button :class="['icon-button', view === 'grid' && 'active']" @click="setView('grid')" v-html="icons.grid" />
      </div>

      <button class="icon-button" @click="refresh" v-html="icons.refresh" />

      <button
        :class="['icon-button', ocserverRunning && 'ocserver-active', ocserverLoading && 'loading']"
        @click="toggleOcserver"
      >
        <svg viewBox="0 0 512 512" class="oc-icon" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="currentColor"/>
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useTauri } from '@/composables/useTauri'
import { basename } from '@/composables/useFormat'

const emit = defineEmits(['navigate', 'search', 'refresh', 'refresh-share', 'toggle-ocserver'])
const store = useAppStore()
const tauri = useTauri()

const icons = {
  arrowLeft: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  list: '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
}

const breadcrumbs = computed(() => store.breadcrumbs || [])
const backStack = computed(() => store.backStack)
const forwardStack = computed(() => store.forwardStack)
const view = computed(() => store.view)
const search = computed({
  get: () => store.search,
  set: (v) => { store.search = v; emit('search') },
})
const sharePortLocked = computed(() => store.sharePortLocked)
const shareUrls = computed(() => store.shareUrls || [])
const shareTitle = computed(() => store.shareTitle || '')
const rootName = computed(() => store.root ? basename(store.root) : '')
const ocserverRunning = computed(() => store.ocserverRunning)
const ocserverLoading = computed(() => store.ocserverLoading)

function goBack() {
  if (!store.backStack.length) return
  const prev = store.backStack.pop()
  store.forwardStack.push(store.currentPath)
  emit('navigate', prev, false)
}

function goForward() {
  if (!store.forwardStack.length) return
  const next = store.forwardStack.pop()
  store.backStack.push(store.currentPath)
  emit('navigate', next, false)
}

function navigateTo(path) {
  if (path !== store.currentPath) {
    store.backStack.push(store.currentPath)
    store.forwardStack = []
  }
  emit('navigate', path || '', true)
}

async function chooseRoot() {
  const selected = await tauri.chooseRoot()
  if (!selected) return
  store.root = selected
  localStorage.setItem('finder-anywhere-root', selected)
  store.backStack = []
  store.forwardStack = []
  emit('navigate', '', false)
}

async function togglePortLock() {
  if (store.sharePortLocked) {
    await tauri.setSharePortConfig(store.savedSharePort || null, false)
    store.savedSharePort = null
    store.sharePortLocked = false
  } else if (store.currentSharePort) {
    await tauri.setSharePortConfig(store.currentSharePort, true)
    store.savedSharePort = store.currentSharePort
    store.sharePortLocked = true
  }
  emit('refresh-share')
}

function setView(v) {
  store.view = v
  localStorage.setItem('finder-anywhere-view', v)
}

async function copyShareUrl(e) {
  const text = shareUrls.value[0]
  if (text) {
    try { await navigator.clipboard.writeText(text) } catch {}
  }
}

function refresh() {
  emit('refresh')
}

function toggleOcserver() {
  emit('toggle-ocserver')
}
</script>
