import express, { type NextFunction, type Request, type Response } from 'express'
import {
  FORM_TYPES,
  getFormKind,
  isApproverRole,
  isFormType,
  type FormValues,
  type RequestEvent,
} from '@ai-approval/shared'
import { InvalidPdfError, extractPdfLines, splitIntoArticles } from './pdf-import'
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

const IMPORT_STATUS_CODE = {
  forbidden: 403,
  code_taken: 409, // 這個代碼已經有文件在用
  too_many_docs: 409,
} as const

const TUNING_STATUS_CODE = {
  forbidden: 403,
  not_found: 404,
  already_adopted: 409, // 這筆主管評價已經採用成準則了
  eval_running: 409, // 已經有一次評估在跑
  no_reviewer: 503, // 伺服器沒有設定審查員，沒辦法評估
} as const

// 只有簽核者可以看的資料：放在路由前面當作守門員
function requireApprover(req: Request, res: Response, next: NextFunction) {
  if (!isApproverRole(req.user!.role)) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  next()
}

// 上傳的 PDF 大小上限：規範文件通常幾百 KB，5 MB 很寬鬆了
const MAX_PDF_SIZE = '5mb'

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
  // 匯入規範文件時，一次會送上百條條文，預設的 100kb 不夠
  app.use(express.json({ limit: '2mb' }))

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

  // AI 準確度統計：只有簽核者可以看
  app.get('/stats/ai', (req, res) => {
    const result = service.getAiStats(req.user!)
    if (!result.ok) {
      res.status(STATUS_CODE[result.reason]).json({ error: result.reason })
      return
    }
    res.json(result.stats)
  })

  // ===== AI 調校：審查準則與評估集（只有簽核者可以用）=====
  app.get('/guidelines', requireApprover, (_req, res) => {
    res.json(service.listGuidelines())
  })

  app.post('/guidelines', (req, res) => {
    const result = service.createGuideline(req.user!, req.body ?? {})
    if (!result.ok) {
      if (result.reason === 'invalid_guideline') {
        res.status(400).json({ error: result.reason, fieldErrors: result.fieldErrors })
        return
      }
      res.status(TUNING_STATUS_CODE[result.reason]).json({ error: result.reason })
      return
    }
    res.status(201).json(result.guideline)
  })

  app.post('/guidelines/:id/retire', (req, res) => {
    const result = service.retireGuideline(req.user!, req.params.id)
    if (!result.ok) {
      res.status(TUNING_STATUS_CODE[result.reason]).json({ error: result.reason })
      return
    }
    res.json({ ok: true })
  })

  app.get('/evals', requireApprover, (_req, res) => {
    res.json(service.listEvalRuns())
  })

  // 進度要寫在 /evals/:id 前面：不然「progress」會被當成某一次評估的 id
  app.get('/evals/progress', requireApprover, (_req, res) => {
    res.json(service.getEvalProgress())
  })

  // 中間夾了 requireApprover，Express 的型別推不出 :id，所以明確標註
  app.get('/evals/:id', requireApprover, (req: Request<{ id: string }>, res: Response) => {
    const run = service.getEvalRun(req.params.id)
    if (!run) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.json(run)
  })

  // 跑一次評估：用 Claude 時要等十幾秒到一分鐘，跑完才回應
  app.post('/evals', async (req, res) => {
    const result = await service.startEval(req.user!)
    if (!result.ok) {
      res.status(TUNING_STATUS_CODE[result.reason]).json({ error: result.reason })
      return
    }
    res.status(201).json(result.run)
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
    res.json(service.listPolicies(isFormType(formType) ? formType : undefined))
  })

  // ===== 規範文件 =====
  app.get('/policy-docs', (_req, res) => {
    res.json(service.listPolicyDocs())
  })

  // 第一步：上傳 PDF，回傳切好的條文「草稿」，還不會存起來
  // 直接收 PDF 的原始位元組（Content-Type: application/pdf），不用 multipart，也不用另外裝套件
  app.post('/policy-docs/preview', express.raw({ type: 'application/pdf', limit: MAX_PDF_SIZE }), async (req, res) => {
    if (!isApproverRole(req.user!.role)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    const data = req.body
    // 先看檔頭：PDF 一定以 %PDF- 開頭，不是的話就不用交給解析器了
    if (!Buffer.isBuffer(data) || data.subarray(0, 5).toString('latin1') !== '%PDF-') {
      res.status(400).json({ error: 'invalid_pdf' })
      return
    }
    try {
      const { lines, pages } = await extractPdfLines(new Uint8Array(data))
      // 掃描檔只有圖片、沒有文字，要先 OCR，這裡不處理
      if (lines.length === 0) {
        res.status(422).json({ error: 'no_text' })
        return
      }
      res.json({ ...splitIntoArticles(lines), pages })
    } catch (err) {
      if (err instanceof InvalidPdfError) {
        res.status(400).json({ error: 'invalid_pdf' })
        return
      }
      throw err
    }
  })

  // 第二步：主管確認、修改過的條文，正式存進規範庫
  app.post('/policy-docs', (req, res) => {
    const result = service.importPolicyDoc(req.user!, req.body ?? {})
    if (!result.ok) {
      if (result.reason === 'invalid_doc') {
        res.status(400).json({ error: 'invalid_doc', fieldErrors: result.fieldErrors })
        return
      }
      res.status(IMPORT_STATUS_CODE[result.reason]).json({ error: result.reason })
      return
    }
    res.status(201).json(result.doc)
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

  // 錯誤處理：檔案太大時 express.raw 會丟出 413，轉成跟其他 API 一樣的 JSON 格式
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'file_too_large' })
      return
    }
    next(err)
  })

  return app
}
