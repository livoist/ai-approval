import { describe, expect, it } from 'vitest'
import { availableEvents, isFinal, transition } from './request-machine'

describe('transition', () => {
  it('申請人可以送出草稿，進入 AI 預審', () => {
    expect(transition('draft', 'SUBMIT', 'applicant')).toEqual({ ok: true, next: 'reviewing' })
  })

  it('完整的正常流程：送出 → 預審 → 核准', () => {
    let status = transition('draft', 'SUBMIT', 'applicant')
    expect(status).toEqual({ ok: true, next: 'reviewing' })

    status = transition('reviewing', 'AI_REVIEW_DONE', 'system')
    expect(status).toEqual({ ok: true, next: 'pending_approval' })

    status = transition('pending_approval', 'APPROVE', 'approver')
    expect(status).toEqual({ ok: true, next: 'approved' })
  })

  it('補件流程：要求補件 → 重送 → 再次預審', () => {
    expect(transition('pending_approval', 'REQUEST_INFO', 'approver')).toEqual({
      ok: true,
      next: 'needs_info',
    })
    expect(transition('needs_info', 'RESUBMIT', 'applicant')).toEqual({
      ok: true,
      next: 'reviewing',
    })
  })

  it('申請人不能核准自己的單', () => {
    expect(transition('pending_approval', 'APPROVE', 'applicant')).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('已核准的單不能再被退回', () => {
    expect(transition('approved', 'REJECT', 'approver')).toEqual({
      ok: false,
      reason: 'invalid_transition',
    })
  })

  it('AI 預審失敗時退回草稿，讓申請人重送', () => {
    expect(transition('reviewing', 'AI_REVIEW_FAILED', 'system')).toEqual({
      ok: true,
      next: 'draft',
    })
  })
})

describe('availableEvents', () => {
  it('主管在待簽核狀態可以核准、退回、要求補件', () => {
    expect(availableEvents('pending_approval', 'approver')).toEqual([
      'APPROVE',
      'REJECT',
      'REQUEST_INFO',
    ])
  })

  it('申請人在待簽核狀態什麼都不能做', () => {
    expect(availableEvents('pending_approval', 'applicant')).toEqual([])
  })
})

describe('isFinal', () => {
  it('核准與退回是終點', () => {
    expect(isFinal('approved')).toBe(true)
    expect(isFinal('rejected')).toBe(true)
    expect(isFinal('draft')).toBe(false)
  })
})
