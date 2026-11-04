import { createApp } from './app'
import { createRequestService } from './request-service'
import { createStore } from './store'

// 在這裡把各層組裝起來：store → service → app
// 測試時可以換成全新的 store，彼此不會互相干擾
const store = createStore()
const service = createRequestService(store)
const app = createApp(service)

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`)
})
