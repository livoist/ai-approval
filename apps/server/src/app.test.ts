import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { createRequestService } from './request-service'
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
      .send({ title: '高壓設備維修' })
      .expect(201)

    const submitted = await request(app)
      .post(`/requests/${created.body.id}/events`)
      .set(asAlice)
      .send({ event: 'SUBMIT' })
      .expect(200)

    expect(submitted.body.status).toBe('reviewing')
  })

  it('主管不能核准草稿 → 409', async () => {
    const created = await request(app).post('/requests').set(asAlice).send({ title: '維修' })
    const res = await request(app)
      .post(`/requests/${created.body.id}/events`)
      .set(asManager)
      .send({ event: 'APPROVE' })
      .expect(409)
    expect(res.body.error).toBe('invalid_transition')
  })

  it('主管不能建立申請單 → 403', async () => {
    await request(app).post('/requests').set(asManager).send({ title: '維修' }).expect(403)
  })

  it('標題必填 → 400', async () => {
    await request(app).post('/requests').set(asAlice).send({}).expect(400)
  })
})
