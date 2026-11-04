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
