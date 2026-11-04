import { beforeEach, describe, expect, it } from 'vitest'
import { createRequestService, type CurrentUser, type RequestService } from './request-service'
import { createStore } from './store'

const alice: CurrentUser = { id: 'alice', role: 'applicant' }
const bob: CurrentUser = { id: 'bob', role: 'applicant' }
const manager: CurrentUser = { id: 'manager', role: 'approver' }
const system: CurrentUser = { id: 'system', role: 'system' }

let service: RequestService

// 每個測試都用全新的 store，互不影響
beforeEach(() => {
  service = createRequestService(createStore())
})

describe('request service', () => {
  it('建立的申請單是草稿，並留下一筆紀錄', () => {
    const r = service.createRequest(alice, { title: '設備維修', description: '' })
    expect(r.status).toBe('draft')
    expect(r.applicantId).toBe('alice')
    expect(service.getHistory(r.id)).toHaveLength(1)
  })

  it('完整流程會依序留下每一筆紀錄', () => {
    const r = service.createRequest(alice, { title: '設備維修', description: '' })
    service.sendEvent(r.id, 'SUBMIT', alice)
    service.sendEvent(r.id, 'AI_REVIEW_DONE', system)
    const result = service.sendEvent(r.id, 'APPROVE', manager)

    expect(result).toMatchObject({ ok: true, request: { status: 'approved' } })
    expect(service.getHistory(r.id).map((e) => e.event)).toEqual([
      'CREATE',
      'SUBMIT',
      'AI_REVIEW_DONE',
      'APPROVE',
    ])
  })

  it('申請人不能動別人的單', () => {
    const r = service.createRequest(alice, { title: '設備維修', description: '' })
    expect(service.sendEvent(r.id, 'SUBMIT', bob)).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('非法操作不會改變狀態，也不會留下紀錄', () => {
    const r = service.createRequest(alice, { title: '設備維修', description: '' })
    expect(service.sendEvent(r.id, 'APPROVE', manager)).toEqual({
      ok: false,
      reason: 'invalid_transition',
    })
    expect(service.getRequest(r.id)?.status).toBe('draft')
    expect(service.getHistory(r.id)).toHaveLength(1)
  })

  it('補件重送後版本號 +1', () => {
    const r = service.createRequest(alice, { title: '設備維修', description: '' })
    service.sendEvent(r.id, 'SUBMIT', alice)
    service.sendEvent(r.id, 'AI_REVIEW_DONE', system)
    service.sendEvent(r.id, 'REQUEST_INFO', manager)
    service.sendEvent(r.id, 'RESUBMIT', alice)
    expect(service.getRequest(r.id)?.version).toBe(2)
  })

  it('找不到的單回傳 not_found', () => {
    expect(service.sendEvent('nope', 'SUBMIT', alice)).toEqual({ ok: false, reason: 'not_found' })
  })
})
