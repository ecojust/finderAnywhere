<template>
  <div class="preview-content pdf-preview" ref="pdfRef"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useTauri } from '@/composables/useTauri'

const props = defineProps({ entry: Object })
const tauri = useTauri()
const pdfRef = ref(null)
let cancel = null

onMounted(async () => {
  try {
    const url = await tauri.fileUrl(props.entry.absolutePath)

    const resp = await fetch(url)
    const blob = await resp.blob()
    const data = new Uint8Array(await blob.arrayBuffer())

    const { default: pdfjsLib } = await import('pdfjs-dist/build/pdf')
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

    const loadingTask = pdfjsLib.getDocument({ data })
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1.2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    pdfRef.value.appendChild(canvas)

    const renderTask = page.render({ canvasContext: ctx, viewport })
    cancel = () => renderTask.cancel()
    await renderTask.promise
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') {
      console.error('pdf error:', e)
    }
  }
})

onUnmounted(() => {
  cancel?.()
})
</script>
