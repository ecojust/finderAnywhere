<template>
  <div class="image-preview-stage" :class="{ loading: !loaded }">
    <div class="loading-bar" v-if="!loaded"><span></span></div>
    <div v-if="!imgUrl && !loaded" class="preview-loading">
      <span class="preview-spinner"></span>
      <span class="preview-loading-text">加载中…</span>
    </div>
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
import { ref, watch, onMounted } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useTauri } from '@/composables/useTauri'
import { loadThumbnail } from '@/composables/useThumbLoader'

const props = defineProps({ entry: Object })
const store = useAppStore()
const tauri = useTauri()
const imgUrl = ref('')
const loaded = ref(false)

watch(() => store.thumbCache.get(props.entry?.path), (thumb) => {
  if (thumb?.url && !imgUrl.value) {
    imgUrl.value = thumb.url
  }
})

onMounted(async () => {
  const absPath = props.entry?.absolutePath
  if (!absPath) return
  const path = props.entry.path
  const previewKey = `${path}:1400`

  const cached = store.previewUrlByPath.get(previewKey)
  if (cached) {
    imgUrl.value = cached
    return
  }

  const thumb = store.thumbCache.get(path)
  if (thumb?.url) {
    imgUrl.value = thumb.url
  } else {
    loadThumbnail(props.entry)
  }

  store.highReqCount++

  try {
    const previewUrl = await tauri.previewUrl(absPath, 1400)
    store.previewUrlByPath.set(previewKey, previewUrl)
    if (imgUrl.value !== previewUrl) {
      imgUrl.value = previewUrl
    }
  } catch (e) {
    console.error('previewUrl error:', e)
  } finally {
    store.highReqCount--
  }
})

function onLoad() {
  loaded.value = true
}

function onError(e) {
  loaded.value = true
}
</script>
