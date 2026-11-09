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

  it('申請人可以撤回待簽核的單', () => {
    expect(transition('pending_approval', 'WITHDRAW', 'applicant')).toEqual({
      ok: true,
      next: 'withdrawn',
    })
  })

  it('申請人可以撤回被要求補件的單', () => {
    expect(transition('needs_info', 'WITHDRAW', 'applicant')).toEqual({
      ok: true,
      next: 'withdrawn',
    })
  })

  it('主管不能替申請人撤回', () => {
    expect(transition('pending_approval', 'WITHDRAW', 'approver')).toEqual({
      ok: false,
      reason: 'forbidden',
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

  it('申請人在待簽核狀態只能撤回', () => {
    expect(availableEvents('pending_approval', 'applicant')).toEqual(['WITHDRAW'])
  })

  it('申請人在補件狀態可以重送或撤回', () => {
    expect(availableEvents('needs_info', 'applicant')).toEqual(['RESUBMIT', 'WITHDRAW'])
  })
})

describe('isFinal', () => {
  it('核准、退回、撤回都是終點', () => {
    expect(isFinal('approved')).toBe(true)
    expect(isFinal('rejected')).toBe(true)
    expect(isFinal('withdrawn')).toBe(true)
    expect(isFinal('draft')).toBe(false)
  })
})
describe('第二層簽核：守衛條件', () => {
  const needs = { needsPlantManager: true }
  const noNeed = { needsPlantManager: false }

  it('不需要部門主管：主管核准就結案', () => {
    expect(transition('pending_approval', 'APPROVE', 'approver', noNeed)).toEqual({ ok: true, next: 'approved' })
  })

  it('需要部門主管：直屬主管核准後送到部門主管', () => {
    expect(transition('pending_approval', 'APPROVE', 'approver', needs)).toEqual({
      ok: true,
      next: 'pending_final_approval',
    })
  })

  it('部門主管可以核准、退回、要求補件；主管不能代簽', () => {
    expect(availableEvents('pending_final_approval', 'plant_manager')).toEqual(['APPROVE', 'REJECT', 'REQUEST_INFO'])
    expect(transition('pending_final_approval', 'APPROVE', 'approver')).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('部門主管不能跳過主管', () => {
    expect(transition('pending_approval', 'APPROVE', 'plant_manager', needs)).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('同一個事件有兩條規則，按鈕只出現一次', () => {
    expect(availableEvents('pending_approval', 'approver', needs)).toEqual(['APPROVE', 'REJECT', 'REQUEST_INFO'])
  })

  it('等部門主管時，申請人一樣可以撤回', () => {
    expect(transition('pending_final_approval', 'WITHDRAW', 'applicant')).toEqual({ ok: true, next: 'withdrawn' })
  })
})
