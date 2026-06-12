<template>
  <el-dialog
    v-model="visible"
    title="opencode 对话"
    width="640px"
    top="40px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="oc-dialog">
      <!-- server info bar -->
      <div class="oc-info-bar">
        <span v-if="store.ocserverVersion" class="oc-badge">v{{ store.ocserverVersion }}</span>
        <span class="oc-badge oc-url">{{ displayUrl }}</span>
        <el-select v-model="currentModel" size="small" placeholder="选择模型" class="oc-model-select">
          <el-option
            v-for="m in store.ocserverModels"
            :key="m.name || m"
            :label="m.name || m"
            :value="m"
          />
        </el-select>
        <el-button text size="small" @click="stopServer" :disabled="store.ocserverLoading">停止</el-button>
      </div>

      <!-- chat messages -->
      <div class="oc-messages" ref="messagesRef">
        <div v-if="!messages.length" class="oc-empty">
          输入消息开始与 opencode 对话
        </div>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['oc-msg', msg.role]"
        >
          <div class="oc-msg-label">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
          <div class="oc-msg-content">{{ msg.text }}</div>
        </div>
        <div v-if="streamingText" class="oc-msg ai">
          <div class="oc-msg-label">AI</div>
          <div class="oc-msg-content oc-streaming">{{ streamingText }}</div>
        </div>
      </div>

      <!-- input area -->
      <div class="oc-input-area">
        <el-input
          v-model="inputText"
          type="textarea"
          :rows="3"
          placeholder="输入消息..."
          :disabled="sending"
          @keydown.ctrl.enter="sendMessage"
        />
        <div class="oc-input-actions">
          <span v-if="sending" class="oc-hint">正在处理...</span>
          <el-button
            type="primary"
            @click="sendMessage"
            :loading="sending"
            :disabled="!inputText.trim()"
          >
            发送
          </el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useTauri } from '@/composables/useTauri'
import Opencode from '@/service/opencode'

const emit = defineEmits(['close'])
const store = useAppStore()
const tauri = useTauri()

const visible = ref(true)
const messages = ref([])
const inputText = ref('')
const sending = ref(false)
const streamingText = ref('')
const currentModel = ref(null)
const messagesRef = ref(null)

const displayUrl = computed(() => {
  if (!store.ocserverUrl) return ''
  return store.ocserverUrl.replace(/^https?:\/\//, '')
})

function getBaseUrl() {
  return store.ocserverUrl || 'http://127.0.0.1:4096'
}

function scrollToBottom() {
  nextTick(() => {
    const el = messagesRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || sending.value) return

  if (!Opencode.sessionId) {
    try {
      await Opencode.new_session(getBaseUrl())
    } catch (e) {
      console.error('session 创建失败:', e)
      return
    }
  }

  inputText.value = ''
  messages.value.push({ role: 'user', text })
  sending.value = true
  streamingText.value = ''
  scrollToBottom()

  try {
    await Opencode.send_message(text, {
      onThinking: (t) => {
        streamingText.value = t
        scrollToBottom()
      },
      onText: (t) => {
        streamingText.value = t
        scrollToBottom()
      },
      onEvent: () => {},
    }, getBaseUrl(), currentModel.value)

    if (streamingText.value) {
      messages.value.push({ role: 'ai', text: streamingText.value })
      streamingText.value = ''
    }
  } catch (e) {
    messages.value.push({ role: 'ai', text: `错误: ${e.message}` })
  } finally {
    sending.value = false
    scrollToBottom()
  }
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

function handleClose() {
  emit('close')
}

onMounted(() => {
  if (store.ocserverModels.length) {
    currentModel.value = store.ocserverModels[0]
  }
})
</script>

<style scoped>
.oc-dialog {
  display: flex;
  flex-direction: column;
  height: 520px;
}

.oc-info-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.oc-badge {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}

.oc-url {
  font-family: monospace;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.oc-model-select {
  width: 140px;
}

.oc-messages {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.oc-empty {
  color: #9ca3af;
  text-align: center;
  margin-top: 80px;
  font-size: 14px;
}

.oc-msg {
  display: flex;
  gap: 8px;
}

.oc-msg.user {
  flex-direction: row-reverse;
}

.oc-msg-label {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}

.oc-msg.user .oc-msg-label {
  background: #409eff;
}

.oc-msg.ai .oc-msg-label {
  background: #67c23a;
}

.oc-msg-content {
  max-width: 75%;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.oc-msg.user .oc-msg-content {
  background: #ecf5ff;
  color: #303133;
}

.oc-msg.ai .oc-msg-content {
  background: #f0f9eb;
  color: #303133;
}

.oc-streaming::after {
  content: '▍';
  animation: blink 0.8s infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.oc-input-area {
  border-top: 1px solid #e5e7eb;
  padding-top: 10px;
  margin-top: 10px;
}

.oc-input-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.oc-hint {
  font-size: 12px;
  color: #909399;
}
</style>
