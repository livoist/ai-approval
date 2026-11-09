import { createApp } from 'vue'
import App from './App.vue'
import { notifyError } from './notify'
import { router } from './router'
import './style.css'

const app = createApp(App)

// 全域的保險：沒有被 catch 的錯誤也要讓使用者知道，不然只會覺得「按了沒反應」
// 細節留在 console 給開發者看；使用者看到的是 notifyError 轉好的一句話
app.config.errorHandler = (err) => {
  console.error(err)
  notifyError(err)
}
window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason)
  notifyError(event.reason)
})

app.use(router).mount('#app')
