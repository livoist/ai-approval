import express, { type NextFunction, type Request, type Response } from 'express'
import {
  FORM_TYPES,
  getFormKind,
  isFormType,
  type FormValues,
  type RequestEvent,
} from '@ai-approval/shared'
import { POLICY_CHUNKS, policiesFor } from './policies'
import type { CurrentUser, RequestService } from './request-service'

// 擴充 Express 的 Request 型別，讓 req.user 有型別提示
declare global {
  namespace Express {
    interface Request {
      user?: CurrentUser
    }
  }
}

// 業務錯誤 → HTTP 狀態碼，集中在一個地方對照
const STATUS_CODE = {
  not_found: 404, // 找不到這張單
  forbidden: 403, // 有這個動作，但你沒權限
  invalid_transition: 409, // 這張單目前的狀態不能做這件事（Conflict）
  unknown_form_type: 400, // 沒有這種申請單
} as const

const FEEDBACK_STATUS_CODE = {
  not_found: 404,
  forbidden: 403,
  note_required: 400, // 輸入不完整
} as const

// 從 request body 取出表單資料；型別不對就當成空的，交給 service 的驗證去擋
function readFormInput(body: unknown): { formType: unknown; title: string; fields: FormValues } {
  const b = (body ?? {}) as { formType?: unknown; title?: unknown; fields?: unknown }
  return {
    formType: b.formType,
    title: typeof b.title === 'string' ? b.title : '',
    fields: b.fields && typeof b.fields === 'object' ? (b.fields as FormValues) : {},
  }
}

// 建立、修改失敗時的統一回應：欄位錯誤要把每個欄位的訊息一起回傳，前端才能顯示在對應的欄位下
function sendFormError(
  res: Response,
  result: { reason: 'invalid_fields'; fieldErrors: Record<string, string> } | { reason: keyof typeof STATUS_CODE },
) {
  if (result.reason === 'invalid_fields') {
    res.status(400).json({ error: 'invalid_fields', fieldErrors: result.fieldErrors })
    return
  }
  res.status(STATUS_CODE[result.reason]).json({ error: result.reason })
}

// 前端只能「申請」或「簽核」，絕對不能宣稱自己是 system
const CLIENT_ROLES = ['applicant', 'approver', 'plant_manager'] as const

// 暫時的假登入：從 header 讀使用者身分，方便開發與 demo
// 正式系統會改成 JWT 或 session，但後面的程式碼都不用改
function fakeAuth(req: Request, res: Response, next: NextFunction) {
  const id = req.header('x-user-id')
  const role = req.header('x-user-role')
  if (!id || !CLIENT_ROLES.includes(role as (typeof CLIENT_ROLES)[number])) {
    res.status(401).json({ error: 'unauthenticated' })
    return
  }
  req.user = { id, role: role as CurrentUser['role'] }
  next()
}

// 不需要登入就能看的系統資訊：前端用來決定要不要顯示「示範環境」提示
export interface AppMeta {
  demo: boolean
  ai: { reviewer: string; used: number; limit: number } | null
}

export function createApp(service: RequestService, options: { meta?: () => AppMeta } = {}) {
  const app = express()
  app.use(express.json())

  // 這兩個放在 fakeAuth 前面，不用帶身分也能呼叫
  // health：部署平台用它確認服務活著
  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })
  app.get('/meta', (_req, res) => {
    res.json(options.meta?.() ?? { demo: false, ai: null })
  })

  app.use(fakeAuth)

  // 列出所有申請單
  app.get('/requests', (_req, res) => {
    res.json(service.listSummaries())
  })

  // 建立新申請單（草稿）：只有申請人可以
  // 欄位怎麼驗證由 shared 的表單定義決定，這裡只負責把結果轉成 HTTP 回應
  app.post('/requests', (req, res) => {
    const result = service.createRequest(req.user!, readFormInput(req.body))
    if (!result.ok) {
      sendFormError(res, result)
      return
    }
    res.status(201).json(result.request)
  })

  // 修改申請內容（草稿或待補件時）
  app.put('/requests/:id', (req, res) => {
    const result = service.updateRequest(req.params.id, req.user!, readFormInput(req.body))
    if (!result.ok) {
      sendFormError(res, result)
      return
    }
    res.json(result.request)
  })

  // 有哪些申請單可以建立（之後可以依部門、角色過濾）
  app.get('/forms', (_req, res) => {
    res.json(FORM_TYPES.map((type) => ({ type, title: getFormKind(type).def.title })))
  })

  // 某一種申請單的表單定義：前端照著它畫出表單
  app.get('/forms/:type', (req, res) => {
    if (!isFormType(req.params.type)) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.json(getFormKind(req.params.type).def)
  })

  // 規範條文：前端點引用時，用 id 查出原文來高亮
  // 帶 ?formType=expense 只回傳那種申請單依據的規範；不帶就全部回傳
  app.get('/policies', (req, res) => {
    const { formType } = req.query
    res.json(isFormType(formType) ? policiesFor(formType) : POLICY_CHUNKS)
  })

  // 單一申請單 + 完整歷史 + 對應目前版本的 AI 預審結果
  app.get('/requests/:id', (req, res) => {
    const request = service.getRequest(req.params.id)
    if (!request) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.json({
      ...request,
      history: service.getHistory(request.id),
      review: service.getLatestReview(request.id) ?? null,
    })
  })

  // SSE：一條不會結束的 HTTP 回應，後端有新消息就往裡面寫一段
  app.get('/requests/:id/stream', (req, res) => {
    if (!service.getRequest(req.params.id)) {
      res.status(404).json({ error: 'not_found' })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.flushHeaders()

    const unsubscribe = service.subscribe(req.params.id, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    // 心跳：每 15 秒送一行註解，避免連線因為太久沒資料被中間的設備切斷
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)

    // 使用者關掉頁面、或前端主動中斷 → 一定要清乾淨
    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  // 主管評價 AI 的某一條意見
  app.post('/requests/:id/reviews/:reviewId/findings/:index/feedback', (req, res) => {
    const index = Number(req.params.index)
    const { verdict, note } = req.body ?? {}
    if (!Number.isInteger(index) || (verdict !== 'correct' && verdict !== 'incorrect')) {
      res.status(400).json({ error: 'invalid_input' })
      return
    }
    const result = service.giveFeedback(req.params.id, req.params.reviewId, index, req.user!, {
      verdict,
      note: typeof note === 'string' ? note : '',
    })
    if (!result.ok) {
      res.status(FEEDBACK_STATUS_CODE[result.reason]).json({ error: result.reason })
      return
    }
    res.status(201).json(result.feedback)
  })

  // 對申請單送出事件：送出、核准、退回、撤回……全部走這一支 API
  app.post('/requests/:id/events', (req, res) => {
    const event = req.body?.event as RequestEvent | undefined
    if (typeof event !== 'string') {
      res.status(400).json({ error: 'event_required' })
      return
    }
    const result = service.sendEvent(req.params.id, event, req.user!)
    if (!result.ok) {
      res.status(STATUS_CODE[result.reason]).json({ error: result.reason })
      return
    }
    res.json(result.request)
  })

  return app
}
