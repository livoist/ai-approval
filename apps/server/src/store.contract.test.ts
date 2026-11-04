import { describe, expect, it } from 'vitest'
import { createSqliteStore } from './sqlite-store'
import { createStore, type AiReview, type ApprovalRequest, type AuditEvent, type Store } from './store'

// 合約測試（contract test）：同一組測試，對兩種實作各跑一次
// 只要兩邊都通過，就代表它們「行為一致」，service 換哪一個都不會出事
const implementations: [string, () => Store][] = [
  ['記憶體', () => createStore()],
  ['SQLite', () => createSqliteStore(':memory:')],
]

const request: ApprovalRequest = {
  id: 'r1',
  formType: 'maintenance',
  title: '高壓設備維修',
  fields: { equipmentId: 'HV-0301', voltage: 480, isDown: false, downSince: null },
  applicantId: 'alice',
  status: 'draft',
  version: 1,
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
}

const audit = (id: string, to: AuditEvent['to']): AuditEvent => ({
  id,
  requestId: 'r1',
  actor: { id: 'alice', role: 'applicant' },
  event: 'SUBMIT',
  from: 'draft',
  to,
  at: '2026-11-04T00:00:01.000Z',
})

for (const [name, create] of implementations) {
  describe(`${name} store`, () => {
    it('存進去什麼，讀出來就是什麼', () => {
      const store = create()
      store.saveRequest(request)
      expect(store.getRequest('r1')).toEqual(request)
      expect(store.getRequest('nope')).toBe(undefined)
    })

    it('再存一次同一張單是更新，不是新增', () => {
      const store = create()
      store.saveRequest(request)
      store.saveRequest({ ...request, status: 'reviewing', version: 2 })
      expect(store.listRequests()).toHaveLength(1)
      expect(store.getRequest('r1')).toMatchObject({ status: 'reviewing', version: 2 })
    })

    it('審計紀錄依寫入順序讀出，且 from 可以是 null', () => {
      const store = create()
      store.saveRequest(request)
      const created: AuditEvent = { ...audit('a1', 'draft'), event: 'CREATE', from: null }
      store.appendAudit(created)
      store.appendAudit(audit('a2', 'reviewing'))
      expect(store.listAudit('r1')).toEqual([created, audit('a2', 'reviewing')])
    })

    it('預審結果的 findings 與選填欄位都能還原', () => {
      const store = create()
      store.saveRequest(request)
      const done: AiReview = {
        id: 'v1',
        requestId: 'r1',
        requestVersion: 1,
        status: 'done',
        riskLevel: 'high',
        summary: '發現 1 項',
        findings: [{ kind: 'missing', message: '未附斷電紀錄', citations: ['sop-4.2'], source: 'rule' }],
        reviewer: 'mock',
        createdAt: '2026-11-04T00:00:02.000Z',
      }
      const failed: AiReview = {
        id: 'v2',
        requestId: 'r1',
        requestVersion: 1,
        status: 'failed',
        error: 'timeout',
        reviewer: 'mock',
        createdAt: '2026-11-04T00:00:03.000Z',
      }
      store.appendReview(done)
      store.appendReview(failed)
      expect(store.listReviews('r1')).toEqual([done, failed])
    })

    it('評價依寫入順序讀出，只回傳該次預審的', () => {
      const store = create()
      store.saveRequest(request)
      const review = (id: string): AiReview => ({
        id,
        requestId: 'r1',
        requestVersion: 1,
        status: 'done',
        reviewer: 'mock',
        createdAt: '2026-11-04T00:00:02.000Z',
      })
      store.appendReview(review('v1'))
      store.appendReview(review('v2'))

      const fb = (id: string, reviewId: string, verdict: 'correct' | 'incorrect') => ({
        id,
        reviewId,
        findingIndex: 0,
        verdict,
        note: verdict === 'incorrect' ? '規範沒有這條要求' : '',
        actorId: 'manager',
        createdAt: '2026-11-04T00:00:04.000Z',
      })
      store.appendFeedback(fb('f1', 'v1', 'incorrect'))
      store.appendFeedback(fb('f2', 'v2', 'correct'))
      store.appendFeedback(fb('f3', 'v1', 'correct'))

      expect(store.listFeedback('v1')).toEqual([fb('f1', 'v1', 'incorrect'), fb('f3', 'v1', 'correct')])
    })
  })
}

describe('SQLite 專屬', () => {
  it('關掉再打開，資料還在', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'ai-approval-'))
    const path = join(dir, 'test.db')

    createSqliteStore(path).saveRequest(request)
    expect(createSqliteStore(path).getRequest('r1')).toEqual(request)

    rmSync(dir, { recursive: true, force: true })
  })
})
