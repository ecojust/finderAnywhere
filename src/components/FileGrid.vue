<template>
  <div class="grid-view" ref="gridRef" @scroll="onScroll">
    <button
      v-for="entry in filtered"
      :key="entry.path"
      :class="['grid-item', { selected: entry.path === store.selectedPath }]"
      :data-path="entry.path"
      @click="selectEntry(entry)"
    >
      <span class="thumb">
        <template v-if="entry.kind === 'image'">
          <img v-if="thumbUrl(entry)" :src="thumbUrl(entry)" :alt="entry.name" loading="lazy" decoding="async" />
          <span v-else-if="thumbLoading(entry)" class="async-thumb loading" v-html="icons.image" />
          <span v-else class="async-thumb" v-html="icons.image" />
        </template>
        <span v-else class="file-icon" v-html="thumbIcon(entry)" />
      </span>
      <span class="grid-caption">
        <span class="file-name">{{ entry.name }}</span>
        <span class="item-subtitle">{{ entry.entryType === 'directory' ? `${entry.children ?? 0} 项` : formatBytes(entry.size) }}</span>
      </span>
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useEventBus } from '@/composables/useEventBus'
import { formatBytes } from '@/composables/useFormat'
import { loadThumbnail } from '@/composables/useThumbLoader'

const store = useAppStore()
const bus = useEventBus()
const gridRef = ref(null)

const icons = {
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M7.5 16h9"/><path d="M8 12h8"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 9 4-2v10l-4-2z"/></svg>',
}

const filtered = computed(() => {
  const kw = store.search.trim().toLowerCase()
  if (!kw) return store.entries
  return store.entries.filter(e => e.name.toLowerCase().includes(kw))
})

function thumbUrl(entry) {
  return store.thumbCache.get(entry.path)?.url
}

function thumbLoading(entry) {
  return store.thumbCache.get(entry.path)?.loading
}

function thumbIcon(entry) {
  if (entry.entryType === 'directory') return `<span class="folder-badge">${icons.folder}</span>`
  const k = entry.kind === 'music' ? 'audio' : icons[entry.kind] ? entry.kind : 'file'
  return `<span class="file-icon">${icons[k]}</span>`
}

function loadVisibleThumbs() {
  const el = gridRef.value
  if (!el) return
  const items = el.querySelectorAll('.grid-item')
  const rect = el.getBoundingClientRect()
  for (const item of items) {
    const itemRect = item.getBoundingClientRect()
    if (itemRect.top < rect.bottom + 200 && itemRect.bottom > rect.top - 200) {
      const path = item.getAttribute('data-path')
      if (path) loadThumbnail(store.entryByPath.get(path))
    }
  }
}

function selectEntry(entry) {
  if (entry.entryType === 'directory') {
    store.backStack.push(store.currentPath)
    store.forwardStack = []
    bus.emit('navigate-dir', entry.path)
    return
  }
  store.selectedPath = entry.path
  bus.emit('preview-entry', entry)
}

function onScroll() {
  loadVisibleThumbs()
}

onMounted(() => {
  nextTick(loadVisibleThumbs)
})
</script>
