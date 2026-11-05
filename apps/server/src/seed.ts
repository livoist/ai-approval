import type { FormType, FormValues, RequestEvent } from '@ai-approval/shared'
import { createRequestService, type CurrentUser } from './request-service'
import { mockReviewer } from './reviewer'
import type { Store } from './store'

// 示範資料：公開 demo 一打開就有各種狀態的申請單，不用自己從頭建
// 走的是跟真正使用者一樣的流程（建立 → 送出 → 預審 → 簽核），所以歷史紀錄也是完整的
// 用模擬審查員產生：不花 API 費用，結果也固定

const alice: CurrentUser = { id: 'alice', role: 'applicant' }
const bob: CurrentUser = { id: 'bob', role: 'applicant' }
const manager: CurrentUser = { id: 'manager', role: 'approver' }
const director: CurrentUser = { id: 'director', role: 'plant_manager' }

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

interface Seed {
  applicant: CurrentUser
  formType: FormType
  title: string
  fields: FormValues
  submit: boolean // 送出並等 AI 預審跑完
  then?: { by: CurrentUser; event: RequestEvent }[] // 預審完之後，簽核者依序要做的事
  feedback?: { index: number; verdict: 'correct' | 'incorrect'; note: string }
}

const SEEDS: Seed[] = [
  {
    applicant: alice,
    formType: 'maintenance',
    title: '3 號產線高壓馬達維修',
    fields: {
      equipmentId: 'HV-0301',
      area: 'A 廠區',
      voltage: 480,
      estimatedCost: 120000,
      faultDescription: '馬達運轉異音',
      isDown: false,
      lotoDone: false,
    },
    submit: true, // → 待簽核，高風險
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '客戶餐敘',
    fields: {
      expenseType: '業務招待費',
      amount: 12000,
      expenseDate: daysAgo(5),
      purpose: '客戶聚餐討論',
      guestCompany: '台灣精密股份有限公司',
      guestCount: 2,
      staffCount: 2,
      hasInvoice: true,
      invoiceNumber: 'CD-87654321',
    },
    submit: true, // → 待簽核，中風險
  },
  {
    applicant: alice,
    formType: 'expense',
    title: '高雄出差住宿',
    fields: {
      expenseType: '住宿費',
      amount: 9600,
      expenseDate: daysAgo(75),
      purpose: '前往高雄楠梓廠區支援產線導入，於當地住宿三晚',
      nights: 3,
      hasInvoice: true,
      invoiceNumber: 'EF-11223344',
    },
    submit: true,
    then: [{ by: manager, event: 'REQUEST_INFO' }], // → 待補件
  },
  {
    applicant: bob,
    formType: 'maintenance',
    title: '冷卻水塔風扇馬達汰換',
    fields: {
      equipmentId: 'CT-0012',
      area: 'C 廠區',
      voltage: 380,
      estimatedCost: 820000,
      faultDescription: '風扇馬達軸承磨損嚴重，已更換兩次仍持續過熱，評估需整組汰換並更新控制盤。',
      isDown: false,
    },
    submit: true,
    // 超過 50 萬：主管核准後送到廠長，停在「待廠長核准」
    then: [{ by: manager, event: 'APPROVE' }],
  },
  {
    applicant: alice,
    formType: 'maintenance',
    title: '辦公室空調異常',
    fields: {
      equipmentId: 'GN-1033',
      area: 'C 廠區',
      voltage: 220,
      estimatedCost: 15000,
      faultDescription: '空調不太冷，麻煩處理',
      isDown: false,
    },
    submit: true,
    // 主管覺得 AI 這條太嚴格：示範「評價 AI」的結果
    feedback: { index: 0, verdict: 'incorrect', note: '辦公室空調屬一般報修，說明程度已足夠' },
    then: [{ by: manager, event: 'APPROVE' }],
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '展場臨時搬運費',
    fields: {
      expenseType: '其他',
      amount: 1800,
      expenseDate: daysAgo(10),
      purpose: '台北南港展覽館參展，現場臨時請搬運工協助布置展位與搬運設備',
      hasInvoice: false,
      noInvoiceReason: '臨時雇用的搬運工無法開立收據',
    },
    submit: true,
    then: [{ by: manager, event: 'REJECT' }], // → 已退回（無憑證超過上限）
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '年度客戶答謝餐會',
    fields: {
      expenseType: '業務招待費',
      amount: 48000,
      expenseDate: daysAgo(7),
      purpose: '年度主要客戶答謝餐會，邀請十二家合作廠商代表，於台北國際會議中心宴會廳舉辦',
      guestCompany: '主要合作廠商（共 12 家）',
      guestCount: 24,
      staffCount: 6,
      hasInvoice: true,
      invoiceNumber: 'GH-55667788',
    },
    submit: true,
    // 超過 3 萬：主管與廠長兩關都簽完 → 已核准
    then: [
      { by: manager, event: 'APPROVE' },
      { by: director, event: 'APPROVE' },
    ],
  },
  {
    applicant: alice,
    formType: 'expense',
    title: '新竹客戶驗收高鐵票',
    fields: {
      expenseType: '交通費',
      amount: 1250,
      expenseDate: daysAgo(2),
      purpose: '前往新竹科學園區客戶端進行設備驗收，台北新竹往返高鐵票',
      hasInvoice: true,
      invoiceNumber: 'AB-12345678',
    },
    submit: false, // → 草稿
  },
]

// 資料庫是空的才放；回傳放了幾張
export async function seedDemoData(store: Store): Promise<number> {
  if (store.listRequests().length > 0) return 0

  const service = createRequestService(store, mockReviewer)

  for (const seed of SEEDS) {
    const created = service.createRequest(seed.applicant, {
      formType: seed.formType,
      title: seed.title,
      fields: seed.fields,
    })
    // 示範資料寫錯就直接讓伺服器啟動失敗：寧可馬上發現，也不要 demo 時才看到少了一張
    if (!created.ok) throw new Error(`seed「${seed.title}」建立失敗：${JSON.stringify(created)}`)
    const id = created.request.id

    if (!seed.submit) continue
    service.sendEvent(id, 'SUBMIT', seed.applicant)
    await service.waitForReview(id)

    if (seed.feedback) {
      const review = service.getLatestReview(id)
      if (review) service.giveFeedback(id, review.id, seed.feedback.index, manager, seed.feedback)
    }
    for (const { by, event } of seed.then ?? []) {
      const result = service.sendEvent(id, event, by)
      if (!result.ok) throw new Error(`seed「${seed.title}」的 ${event} 失敗：${result.reason}`)
    }
  }

  return SEEDS.length
}
