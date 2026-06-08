<template>
  <div class="image-preview-stage" :class="{ loading: !loaded }">
    <div class="loading-bar" v-if="!loaded"><span></span></div>
    <img
      v-if="imgUrl"
      :src="imgUrl"
      class="preview-image"
      :alt="entry.name"
      decoding="async"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useTauri } from '@/composables/useTauri'

const props = defineProps({ entry: Object })
const store = useAppStore()
const tauri = useTauri()
const imgUrl = ref('')
const loaded = ref(false)

onMounted(async () => {
  const absPath = props.entry?.absolutePath
  if (!absPath) return
  const path = props.entry.path

  // Show thumbnail first (already cached from grid/list)
  const thumb = store.thumbCache.get(path)
  if (thumb?.url) {
    imgUrl.value = thumb.url
  }

  // Load original image in background, replace when ready
  try {
    const fullUrl = await tauri.fileUrl(absPath)
    imgUrl.value = fullUrl
  } catch (e) {
    console.error('fileUrl error:', e)
  }

  // Pre-cache 1400px preview silently for next visit
  const previewKey = `${path}:1400`
  if (!store.previewUrlByPath.has(previewKey)) {
    tauri.previewUrl(absPath, 1400)
      .then(url => store.previewUrlByPath.set(previewKey, url))
      .catch(() => {})
  }
})

function onLoad() {
  loaded.value = true
}

function onError(e) {
  console.error('img error:', e)
  loaded.value = true
}
</script>
