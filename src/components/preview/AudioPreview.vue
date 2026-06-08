<template>
  <div class="preview-content audio-preview" ref="playerRef"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useTauri } from '@/composables/useTauri'
import APlayer from 'aplayer'
import 'aplayer/dist/APlayer.min.css'

const props = defineProps({ entry: Object })
const store = useAppStore()
const tauri = useTauri()
const playerRef = ref(null)
let player = null

onMounted(async () => {
  try {
    const entries = store.entries.filter(
      e => e.entryType === 'file' && (e.kind === 'audio' || e.kind === 'music')
    )
    const results = await Promise.allSettled(
      entries.map(e => tauri.fileUrl(e.absolutePath))
    )
    const audio = []
    let currentIndex = 0
    for (let i = 0; i < entries.length; i++) {
      if (results[i].status === 'rejected') continue
      audio.push({ name: entries[i].name, artist: '', url: results[i].value })
      if (entries[i].path === props.entry?.path) {
        currentIndex = audio.length - 1
      }
    }
    if (!audio.length) return
    player = new APlayer({
      container: playerRef.value,
      mini: false,
      autoplay: false,
      theme: '#1264a3',
      listMaxHeight: '240px',
      audio,
      index: currentIndex,
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
