import { readFileSync } from 'node:fs'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { COMPLETE_LOW_VOLTAGE, INCOMPLETE_HIGH_VOLTAGE } from './fixtures'
import { createRequestService } from './request-service'
import { mockReviewer } from './reviewer'
import { createStore } from './store'

const asAlice = { 'x-user-id': 'alice', 'x-user-role': 'applicant' }
const asManager = { 'x-user-id': 'manager', 'x-user-role': 'approver' }

let app: ReturnType<typeof createApp>

beforeEach(() => {
  app = createApp(createRequestService(createStore()))
})

// supertest 不用真的開 port，直接把請求送進 Express app
describe('HTTP API', () => {
  it('沒帶身分 → 401', async () => {
    await request(app).get('/requests').expect(401)
  })

  it('不能宣稱自己是 system → 401', async () => {
    await request(app).get('/requests').set({ 'x-user-id': 'x', 'x-user-role': 'system' }).expect(401)
  })

  it('建立並送出申請單', async () => {
    const created = await request(app)
      .post('/requests')
      .set(asAlice)
      .send({ formType: 'maintenance', title: '高壓設備維修', fields: INCOMPLETE_HIGH_VOLTAGE })
      .expect(201)

    const submitted = await request(app)
      .post(`/requests/${created.body.id}/events`)
      .set(asAlice)
      .send({ event: 'SUBMIT' })
      .expect(200)

    expect(submitted.body.status).toBe('reviewing')
  })

  it('主管不能核准草稿 → 409', async () => {
    const created = await request(app).post('/requests').set(asAlice).send({ formType: 'maintenance', title: '維修', fields: COMPLETE_LOW_VOLTAGE })
    const res = await request(app)
      .post(`/requests/${created.body.id}/events`)
      .set(asManager)
      .send({ event: 'APPROVE' })
      .expect(409)
    expect(res.body.error).toBe('invalid_transition')
  })

  it('主管不能建立申請單 → 403', async () => {
    await request(app).post('/requests').set(asManager).send({ formType: 'maintenance', title: '維修', fields: COMPLETE_LOW_VOLTAGE }).expect(403)
  })

  it('標題必填 → 400', async () => {
    await request(app).post('/requests').set(asAlice).send({}).expect(400)
  })

  it('欄位格式錯誤 → 400，並回傳每個欄位的錯誤', async () => {
    const res = await request(app)
      .post('/requests')
      .set(asAlice)
      .send({ formType: 'maintenance', title: '維修', fields: { ...COMPLETE_LOW_VOLTAGE, equipmentId: 'abc' } })
      .expect(400)
    expect(res.body.error).toBe('invalid_fields')
    expect(Object.keys(res.body.fieldErrors)).toEqual(['equipmentId'])
  })

  it('修改草稿 → 200；別人的單 → 403', async () => {
    const created = await request(app)
      .post('/requests')
      .set(asAlice)
      .send({ formType: 'maintenance', title: '維修', fields: COMPLETE_LOW_VOLTAGE })
    const body = { title: '改過的標題', fields: COMPLETE_LOW_VOLTAGE }
    await request(app).put(`/requests/${created.body.id}`).set(asAlice).send(body).expect(200)
    await request(app)
      .put(`/requests/${created.body.id}`)
      .set({ 'x-user-id': 'bob', 'x-user-role': 'applicant' })
      .send(body)
      .expect(403)
  })
})

describe('評價 AI 意見 API', () => {
  // 建一張已經預審完的單，回傳評價 API 的網址
  async function reviewedRequest() {
    const service = createRequestService(createStore(), mockReviewer)
    const app = createApp(service)
    const created = await request(app).post('/requests').set(asAlice).send({ formType: 'maintenance', title: '高壓設備維修', fields: INCOMPLETE_HIGH_VOLTAGE })
    await request(app).post(`/requests/${created.body.id}/events`).set(asAlice).send({ event: 'SUBMIT' })
    await service.waitForReview(created.body.id)
    const detail = await request(app).get(`/requests/${created.body.id}`).set(asManager)
    return { app, url: `/requests/${created.body.id}/reviews/${detail.body.review.id}/findings/0/feedback` }
  }

  it('主管評價 → 201', async () => {
    const { app, url } = await reviewedRequest()
    await request(app).post(url).set(asManager).send({ verdict: 'correct' }).expect(201)
  })

  it('申請人評價 → 403', async () => {
    const { app, url } = await reviewedRequest()
    await request(app).post(url).set(asAlice).send({ verdict: 'correct' }).expect(403)
  })

  it('有誤但沒寫理由 → 400', async () => {
    const { app, url } = await reviewedRequest()
    const res = await request(app).post(url).set(asManager).send({ verdict: 'incorrect' }).expect(400)
    expect(res.body.error).toBe('note_required')
  })

  it('verdict 不合法 → 400', async () => {
    const { app, url } = await reviewedRequest()
    await request(app).post(url).set(asManager).send({ verdict: 'maybe' }).expect(400)
  })
})

describe('AI 準確度 API', () => {
  it('主管 → 200；申請人 → 403', async () => {
    const app = createApp(createRequestService(createStore(), mockReviewer))
    const res = await request(app).get('/stats/ai').set(asManager).expect(200)
    expect(res.body.totals.reviews).toBe(0)
    await request(app).get('/stats/ai').set(asAlice).expect(403)
  })
})

describe('規範文件 API', () => {
  const SAMPLE = readFileSync(new URL('../../web/public/samples/travel-policy.pdf', import.meta.url))
  const newApp = () => createApp(createRequestService(createStore(), mockReviewer))

  it('上傳 PDF → 回傳切好的條文草稿，還沒存起來', async () => {
    const app = newApp()
    const res = await request(app)
      .post('/policy-docs/preview')
      .set(asManager)
      .set('content-type', 'application/pdf')
      .send(SAMPLE)
      .expect(200)
    expect(res.body.title).toBe('國內出差管理辦法')
    expect(res.body.articles).toHaveLength(8)
    // 預覽不會存：規範文件清單只有內建的兩份
    const docs = await request(app).get('/policy-docs').set(asManager).expect(200)
    expect(docs.body).toHaveLength(2)
  })

  it('不是 PDF → 400；申請人 → 403', async () => {
    const app = newApp()
    const res = await request(app)
      .post('/policy-docs/preview')
      .set(asManager)
      .set('content-type', 'application/pdf')
      .send(Buffer.from('hello'))
      .expect(400)
    expect(res.body.error).toBe('invalid_pdf')
    await request(app).post('/policy-docs/preview').set(asAlice).set('content-type', 'application/pdf').send(SAMPLE).expect(403)
  })

  it('確認後儲存 → 201，這種申請單的規範多了這些條文；同一個代碼再存一次 → 409', async () => {
    const app = newApp()
    const body = {
      formType: 'expense',
      code: 'trv',
      title: '國內出差管理辦法',
      fileName: 'travel-policy.pdf',
      articles: [{ section: '3', text: '搭乘高鐵以標準車廂為限。' }],
    }
    await request(app).post('/policy-docs').set(asManager).send(body).expect(201)
    const policies = await request(app).get('/policies?formType=expense').set(asAlice).expect(200)
    expect(policies.body.some((p: { id: string }) => p.id === 'trv-3')).toBe(true)
    const again = await request(app).post('/policy-docs').set(asManager).send(body).expect(409)
    expect(again.body.error).toBe('code_taken')
  })

  it('欄位錯誤 → 400，並回傳每個欄位的錯誤', async () => {
    const res = await request(newApp()).post('/policy-docs').set(asManager).send({ formType: 'expense', code: 'X', title: '', articles: [] }).expect(400)
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(['articles', 'code', 'title'])
  })
})

describe('AI 調校 API', () => {
  const newApp = () => createApp(createRequestService(createStore(), mockReviewer))

  it('採用準則 → 201；同一筆評價再採用 → 409；欄位錯誤 → 400', async () => {
    const app = newApp()
    const body = { policyId: 'sop-3.2', text: '有現象與時間就夠了', feedbackId: 'fb-1' }
    const created = await request(app).post('/guidelines').set(asManager).send(body).expect(201)
    expect(created.body.policyId).toBe('sop-3.2')
    await request(app).post('/guidelines').set(asManager).send(body).expect(409)
    const bad = await request(app).post('/guidelines').set(asManager).send({ policyId: 'nope', text: '' }).expect(400)
    expect(Object.keys(bad.body.fieldErrors).sort()).toEqual(['policyId', 'text'])

    await request(app).post(`/guidelines/${created.body.id}/retire`).set(asManager).expect(200)
    const list = await request(app).get('/guidelines').set(asManager).expect(200)
    expect(list.body[0].retiredBy).toBe('manager')
  })

  it('執行評估 → 201，紀錄查得到；申請人 → 403', async () => {
    const app = newApp()
    await request(app).post('/evals').set(asAlice).expect(403)
    await request(app).get('/evals').set(asAlice).expect(403)

    const run = await request(app).post('/evals').set(asManager).expect(201)
    expect(run.body.report.baseline.summary.total).toBe(10)
    const list = await request(app).get('/evals').set(asManager).expect(200)
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([run.body.id])
    await request(app).get(`/evals/${run.body.id}`).set(asManager).expect(200)
    await request(app).get('/evals/nope').set(asManager).expect(404)
  })
})
