<template>
  <div class="preview-content audio-preview" ref="playerRef"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useTauri } from '@/composables/useTauri'
import APlayer from 'aplayer'
import 'aplayer/dist/APlayer.min.css'

const props = defineProps({ entry: Object })
const tauri = useTauri()
const playerRef = ref(null)
let player = null

onMounted(async () => {
  try {
    const url = await tauri.fileUrl(props.entry.absolutePath)
    player = new APlayer({
      container: playerRef.value,
      mini: false,
      autoplay: false,
      theme: '#409EFF',
      audio: [{
        name: props.entry.name,
        artist: '',
        url,
        cover: 'placeholder.jpg',
      }],
    })
  } catch (e) {
    console.error('audio error:', e)
  }
})

onUnmounted(() => {
  if (player) {
    player.destroy()
    player = null
  }
})
</script>
