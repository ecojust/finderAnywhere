export function formatBytes(size) {
  if (size === null || size === undefined) return '--'
  if (size === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const value = size / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value * 1000))
}

export function basename(path) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path
}

export function typeLabel(entry) {
  if (entry.entryType === 'directory') return '文件夹'
  if (entry.kind === 'image') return '图片'
  if (entry.kind === 'text') return '文本'
  if (entry.kind === 'pdf') return 'PDF'
  if (entry.kind === 'music') return '音乐'
  if (entry.kind === 'audio') return '音频'
  if (entry.kind === 'video') return '视频'
  return '文件'
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
