<template>
  <el-dialog v-model="visible" title="opencode" width="480px" @close="$emit('close')">
    <div class="oc-dialog-content">
      <div v-if="store.ocserverVersion" class="oc-info-item">
        <span class="oc-label">版本</span>
        <span>{{ store.ocserverVersion }}</span>
      </div>
      <div class="oc-info-item">
        <span class="oc-label">服务地址</span>
        <a :href="store.ocserverUrl" target="_blank">{{ store.ocserverUrl }}</a>
        <el-button text size="small" @click="copyUrl" :icon="CopyDocument">复制</el-button>
      </div>
      <div v-if="store.ocserverModels.length" class="oc-model-section">
        <h4>可用模型</h4>
        <div class="oc-model-list">
          <el-tag
            v-for="m in store.ocserverModels"
            :key="m.name || m"
            class="oc-model-tag"
            :type="m.name === selectedModel ? 'primary' : 'info'"
            @click="selectedModel = m.name || m"
          >
            {{ m.name || m }}
          </el-tag>
        </div>
      </div>
      <div class="oc-dialog-actions">
        <el-button type="danger" @click="stopServer">停止服务</el-button>
        <el-button type="primary" @click="openUrl" :icon="Link">打开</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useTauri } from '@/composables/useTauri'
import { CopyDocument, Link } from '@element-plus/icons-vue'

const emit = defineEmits(['close'])
const store = useAppStore()
const tauri = useTauri()
const visible = ref(true)
const selectedModel = ref('')

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(store.ocserverUrl)
  } catch {}
}

async function stopServer() {
  try {
    await tauri.stopOcserver()
    store.ocserverRunning = false
    store.ocserverUrl = ''
    store.ocserverVersion = ''
    store.ocserverModels = []
  } catch (e) {
    console.error('stop error:', e)
  }
  emit('close')
}

function openUrl() {
  window.open(store.ocserverUrl, '_blank')
}
</script>
