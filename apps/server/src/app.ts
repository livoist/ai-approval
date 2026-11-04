import express, { type NextFunction, type Request, type Response } from 'express'
import type { RequestEvent } from '@ai-approval/shared'
import { POLICY_CHUNKS } from './policies'
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
} as const

// 前端只能「申請」或「簽核」，絕對不能宣稱自己是 system
const CLIENT_ROLES = ['applicant', 'approver'] as const

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

export function createApp(service: RequestService) {
  const app = express()
  app.use(express.json())
  app.use(fakeAuth)

  // 列出所有申請單
  app.get('/requests', (_req, res) => {
    res.json(service.listRequests())
  })

  // 建立新申請單（草稿）：只有申請人可以
  app.post('/requests', (req, res) => {
    if (req.user!.role !== 'applicant') {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    const { title, description } = req.body ?? {}
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title_required' })
      return
    }
    const request = service.createRequest(req.user!, {
      title: title.trim(),
      description: typeof description === 'string' ? description : '',
    })
    res.status(201).json(request)
  })

  // 規範條文：前端點引用時，用 id 查出原文來高亮
  app.get('/policies', (_req, res) => {
    res.json(POLICY_CHUNKS)
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
