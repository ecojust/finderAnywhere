<template>
  <div class="fullscreen-overlay" @click.self="$emit('close')">
    <div class="fullscreen-header">
      <h3>{{ entry.name }}</h3>
      <button class="icon-button" @click="$emit('close')" v-html="icons.close" />
    </div>
    <div class="fullscreen-body">
      <ImagePreview v-if="entry.kind === 'image'" :entry="entry" />
      <VideoPreview v-else-if="entry.kind === 'video'" :entry="entry" />
    </div>
  </div>
</template>

<script setup>
import ImagePreview from './preview/ImagePreview.vue'
import VideoPreview from './preview/VideoPreview.vue'

defineProps({ entry: Object })
defineEmits(['close'])

const icons = {
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
}
</script>
