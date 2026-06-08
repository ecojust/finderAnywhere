<template>
  <aside class="preview-panel" v-if="entry">
    <div class="preview-header">
      <span class="file-title">{{ entry.name }}</span>
      <div class="preview-actions">
        <button class="icon-button" @click="openExternal" v-html="icons.external" title="新窗口打开" />
        <button class="icon-button" @click="toggleFullscreen" v-html="icons.fullscreen" title="全屏预览" />
      </div>
    </div>
    <div class="preview-body">
      <ImagePreview v-if="entry.kind === 'image'" :key="entry.path" :entry="entry" />
      <AudioPreview v-else-if="entry.kind === 'audio' || entry.kind === 'music'" :key="entry.path" :entry="entry" />
      <VideoPreview v-else-if="entry.kind === 'video'" :key="entry.path" :entry="entry" />
      <PdfPreview v-else-if="entry.kind === 'pdf'" :key="entry.path" :entry="entry" />
      <TextPreview v-else :key="entry.path" :entry="entry" />
    </div>
    <FullscreenPreview
      v-if="fullscreenOpen"
      :entry="entry"
      @close="fullscreenOpen = false"
    />
  </aside>
</template>

<script setup>
import { ref } from 'vue'
import { useTauri } from '@/composables/useTauri'
import ImagePreview from './preview/ImagePreview.vue'
import AudioPreview from './preview/AudioPreview.vue'
import VideoPreview from './preview/VideoPreview.vue'
import PdfPreview from './preview/PdfPreview.vue'
import TextPreview from './preview/TextPreview.vue'
import FullscreenPreview from './FullscreenPreview.vue'

const icons = {
  external: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
}

const props = defineProps({ entry: { type: Object, required: true } })
const tauri = useTauri()
const fullscreenOpen = ref(false)

async function openExternal() {
  try {
    await tauri.openExternal(props.entry.absolutePath)
  } catch (e) {
    console.error('open error:', e)
  }
}

function toggleFullscreen() {
  fullscreenOpen.value = !fullscreenOpen.value
}
</script>
