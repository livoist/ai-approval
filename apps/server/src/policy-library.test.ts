import { beforeEach, describe, expect, it } from 'vitest'
import { COMPLETE_EXPENSE, alice, manager, mustCreate } from './fixtures'
import { CORE_POLICIES } from './policies'
import { createRequestService, type RequestService } from './request-service'
import { mockReviewer, type Reviewer } from './reviewer'
import { createStore } from './store'

// 範例 PDF「國內出差管理辦法」切出來的條文（節錄）
const TRAVEL = [
  { section: '1', text: '本辦法適用於本公司員工因公務於國內出差之申請，以及交通、住宿與膳雜費用之報支。' },
  { section: '3', text: '出差交通以大眾運輸工具為原則，搭乘高鐵以標準車廂為限。' },
  { section: '5', text: '出差地點距離公司 60 公里以上，或當日工作結束時間晚於晚上九點者，始得申請住宿。' },
  { section: '6', text: '住宿應優先選擇公司特約飯店；特約飯店客滿時得自行選擇。' },
  { section: '7', text: '出差期間每日膳雜費為新台幣 400 元；主辦單位或客戶已提供餐點者，應扣除該餐之費用。' },
]

const travelDoc = { formType: 'expense', code: 'trv', title: '國內出差管理辦法', fileName: 'travel-policy.pdf', articles: TRAVEL }

let service: RequestService

beforeEach(() => {
  service = createRequestService(createStore(), mockReviewer)
})

describe('匯入規範文件', () => {
  it('主管匯入後，這種申請單的規範多了這些條文，id 是「代碼-條號」', () => {
    const result = service.importPolicyDoc(manager, travelDoc)
    expect(result).toMatchObject({ ok: true, doc: { id: 'trv', source: 'upload', chunkCount: 5 } })

    const ids = service.listPolicies('expense').map((p) => p.id)
    expect(ids.includes('fin-2.2')).toBe(true) // 內建的還在
    expect(ids.includes('trv-3')).toBe(true)
    // 設備維修單不會看到報銷用的文件
    expect(service.listPolicies('maintenance').some((p) => p.id.startsWith('trv-'))).toBe(false)

    const docs = service.listPolicyDocs()
    expect(docs.map((d) => [d.id, d.source, d.chunkCount])).toEqual([
      ['maintenance-sop', 'builtin', 6],
      ['expense-policy', 'builtin', 9],
      ['trv', 'upload', 5],
    ])
  })

  it('只有簽核者可以匯入', () => {
    expect(service.importPolicyDoc(alice, travelDoc)).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('代碼格式不對、或跟內建規範撞名 → 不能匯入', () => {
    for (const code of ['TRV', 't', 'travel-policy', '1abc']) {
      expect(service.importPolicyDoc(manager, { ...travelDoc, code })).toMatchObject({ ok: false, reason: 'invalid_doc' })
    }
    const reserved = service.importPolicyDoc(manager, { ...travelDoc, code: 'fin' })
    expect(reserved).toMatchObject({ ok: false, fieldErrors: { code: '「fin」是內建規範使用的代碼' } })
  })

  it('同一個代碼不能用兩次', () => {
    service.importPolicyDoc(manager, travelDoc)
    expect(service.importPolicyDoc(manager, travelDoc)).toEqual({ ok: false, reason: 'code_taken' })
  })

  it('條號重複、內容空白、沒有任何條文 → 不能匯入', () => {
    const dup = [TRAVEL[0]!, { ...TRAVEL[1]!, section: '1' }]
    expect(service.importPolicyDoc(manager, { ...travelDoc, articles: dup })).toMatchObject({
      ok: false,
      fieldErrors: { articles: '條號「1」重複了' },
    })
    const blank = [{ section: '1', text: '   ' }]
    expect(service.importPolicyDoc(manager, { ...travelDoc, articles: blank })).toMatchObject({ reason: 'invalid_doc' })
    expect(service.importPolicyDoc(manager, { ...travelDoc, articles: [] })).toMatchObject({ reason: 'invalid_doc' })
    expect(service.importPolicyDoc(manager, { ...travelDoc, formType: 'travel' })).toMatchObject({
      fieldErrors: { formType: '請選擇申請類型' },
    })
  })
})

describe('預審時的檢索', () => {
  // 記下 AI 拿到了哪些條文，並且故意引用一條它沒拿到的
  function spyReviewer(cite: string) {
    const seen: string[][] = []
    const reviewer: Reviewer = {
      name: 'spy',
      async review(_input, policies) {
        seen.push(policies.map((p) => p.id))
        return { riskLevel: 'medium', summary: '', findings: [{ kind: 'risk', message: '測試', citations: [cite] }] }
      },
    }
    return { reviewer, seen }
  }

  async function submit(svc: RequestService, fields = COMPLETE_EXPENSE, title = '新竹客戶驗收高鐵票') {
    const r = mustCreate(svc, alice, fields, title, 'expense')
    svc.sendEvent(r.id, 'SUBMIT', alice)
    await svc.waitForReview(r.id)
    return svc.getLatestReview(r.id)!
  }

  it('規範不多時全部交給 AI，並記錄在預審結果上', async () => {
    const { reviewer, seen } = spyReviewer('fin-2.2')
    const review = await submit(createRequestService(createStore(), reviewer))
    expect(seen[0]).toHaveLength(9)
    expect(review.retrievedPolicyIds).toEqual(seen[0])
  })

  it('匯入文件後，只交給 AI 相關的條文；核心條文一定會給', async () => {
    const { reviewer, seen } = spyReviewer('trv-3')
    const svc = createRequestService(createStore(), reviewer)
    svc.importPolicyDoc(manager, travelDoc)
    await submit(svc)

    const given = seen[0]!
    expect(given.includes('trv-3')).toBe(true) // 高鐵 → 搭乘高鐵的規定
    expect(given.includes('trv-6')).toBe(false) // 跟住宿無關
    for (const id of CORE_POLICIES.expense) expect(given.includes(id)).toBe(true)
    expect(given.length < svc.listPolicies('expense').length).toBe(true)
  })

  it('AI 引用了沒交給它的條文 → 剔除，畫面上的引用一定是它看過的', async () => {
    const { reviewer } = spyReviewer('trv-6')
    const svc = createRequestService(createStore(), reviewer)
    svc.importPolicyDoc(manager, travelDoc)
    const review = await submit(svc)
    expect(review.findings!.at(-1)!.citations).toEqual([])
  })
})
