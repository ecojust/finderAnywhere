<template>
  <div class="preview-content text-preview">
    <pre v-if="content" v-html="highlighted"></pre>
    <span v-else class="hint">加载中</span>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTauri } from '@/composables/useTauri'
import { escapeHtml } from '@/composables/useFormat'

const props = defineProps({ entry: Object })
const tauri = useTauri()
const content = ref('')

const highlighted = computed(() => {
  if (!content.value) return ''
  const html = escapeHtml(content.value)
  // syntax highlighting for code
  if (/\.(js|ts|vue|jsx|tsx|css|less|scss|html|json|xml|py|rb|go|rs|java|c|cpp|h|hpp|sh|bash|yaml|yml|md)$/i.test(props.entry.name)) {
    return html.replace(/(\/\/.*$|#.*$|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:function|const|let|var|return|if|else|for|while|import|export|from|class|extends|async|await|new|this|typeof|instanceof)\b)|(\b\d+\.?\d*\b))/gm,
      (m, comment, str, kw, num) => {
        if (comment) return `<span class="hl-comment">${comment}</span>`
        if (str) return `<span class="hl-string">${str}</span>`
        if (kw) return `<span class="hl-keyword">${kw}</span>`
        if (num) return `<span class="hl-number">${num}</span>`
        return m
      }
    )
  }
  return html
})

onMounted(async () => {
  try {
    const url = await tauri.fileUrl(props.entry.absolutePath)
    const resp = await fetch(url)
    content.value = await resp.text()
  } catch {
    content.value = '无法读取文件内容'
  }
})
</script>
