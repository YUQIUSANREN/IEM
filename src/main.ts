import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { bootTheme } from './ui/theme'
import { bootLayout } from './ui/layout'

bootTheme()
bootLayout()

/** 禁止 Ctrl+滚轮 / 触控板捏合把整页缩放，桌面 WebView 也会走到这里。 */
function disablePageZoom(): void {
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) event.preventDefault()
    },
    { passive: false },
  )
  window.addEventListener('gesturestart', (event) => event.preventDefault())
  window.addEventListener('gesturechange', (event) => event.preventDefault())
}

disablePageZoom()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.config.errorHandler = (error, _instance, info) => {
  console.error(error, info)
  const root = document.getElementById('app')
  if (!root || root.childElementCount > 0) return
  root.textContent = `页面渲染失败：${error instanceof Error ? error.message : String(error)}`
}
window.addEventListener('error', (event) => {
  console.error(event.error ?? event.message)
})
app.mount('#app')
