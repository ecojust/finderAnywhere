<template>
  <div class="preview-content video-preview">
    <video v-if="videoUrl" controls autoplay>
      <source :src="videoUrl" />
    </video>
    <span v-else class="hint">加载中</span>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTauri } from '@/composables/useTauri'

const props = defineProps({ entry: Object })
const tauri = useTauri()
const videoUrl = ref('')

onMounted(async () => {
  try {
    const url = await tauri.fileUrl(props.entry.absolutePath)
    videoUrl.value = url
  } catch {
    videoUrl.value = ''
  }
})
</script>
