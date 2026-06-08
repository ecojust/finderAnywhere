import { ref, onMounted, onUnmounted } from 'vue'

export function useIntersect(cb, options = {}) {
  const target = ref(null)
  let observer = null

  onMounted(() => {
    if (!target.value) return
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          cb(entry.target)
          observer.unobserve(entry.target)
        }
      }
    }, { rootMargin: '200px', ...options })
    observer.observe(target.value)
  })

  onUnmounted(() => {
    observer?.disconnect()
  })

  return target
}
