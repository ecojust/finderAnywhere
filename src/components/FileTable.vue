<template>
  <div class="file-table virtual-table">
    <div class="file-head">
      <span>名称</span>
      <span>修改时间</span>
      <span>大小</span>
      <span>类型</span>
    </div>
    <div class="virtual-scroll" ref="scrollRef" @scroll="onScroll">
      <div class="virtual-spacer" :style="{ height: `${filtered.length * ROW_H}px` }">
        <div class="virtual-window" :style="{ transform: `translateY(${start * ROW_H}px)` }">
          <button
            v-for="entry in visible"
            :key="entry.path"
            :class="['file-row', { selected: entry.path === store.selectedPath }]"
            @click="selectEntry(entry)"
          >
            <span class="file-primary">
              <span v-if="entry.entryType === 'directory'" class="folder-badge" v-html="icons.folder" />
              <template v-else-if="entry.kind === 'image'">
                <img v-if="getThumb(entry)?.url" :src="getThumb(entry).url" class="list-thumb" :alt="entry.name" loading="lazy" decoding="async" />
                <span v-else-if="getThumb(entry)?.loading" class="file-icon list-thumb-loading" v-html="icons.image" />
                <span v-else class="file-icon" v-html="icons.image" />
              </template>
              <span v-else class="file-icon" v-html="fileIcon(entry)" />
              <span class="file-name">{{ entry.name }}</span>
            </span>
            <span class="file-cell">{{ formatDate(entry.modifiedAt) }}</span>
            <span class="file-cell">{{ entry.entryType === 'directory' ? `${entry.children ?? 0} 项` : formatBytes(entry.size) }}</span>
            <span class="file-cell">{{ typeLabel(entry) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useEventBus } from '@/composables/useEventBus'
import { formatBytes, formatDate, typeLabel } from '@/composables/useFormat'

const store = useAppStore()
const bus = useEventBus()
const ROW_H = 42
const BUFFER = 12
const scrollRef = ref(null)
const start = ref(0)
const end = ref(0)

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

const visible = computed(() => filtered.value.slice(start.value, end.value))

function getThumb(entry) {
  return store.thumbCache.get(entry.path) || {}
}

function recalc() {
  const el = scrollRef.value
  if (!el) {
    nextTick(recalc)
    return
  }
  const scrollTop = el.scrollTop
  const vh = el.clientHeight || 480
  start.value = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER)
  end.value = Math.min(filtered.value.length, Math.ceil((scrollTop + vh) / ROW_H) + BUFFER)
}

function onScroll(e) {
  const el = e.currentTarget
  const scrollTop = el.scrollTop
  const vh = el.clientHeight || 480
  start.value = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER)
  end.value = Math.min(filtered.value.length, Math.ceil((scrollTop + vh) / ROW_H) + BUFFER)
}

watch(filtered, () => {
  if (scrollRef.value) scrollRef.value.scrollTop = 0
  recalc()
})

watch(() => store.entries.length, () => recalc())

onMounted(recalc)

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

function fileIcon(entry) {
  const k = entry.kind === 'music' ? 'audio' : icons[entry.kind] ? entry.kind : 'file'
  return icons[k]
}
</script>
