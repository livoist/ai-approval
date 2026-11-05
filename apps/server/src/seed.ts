import type { FormType, FormValues, RequestEvent } from '@ai-approval/shared'
import { createRequestService, type CurrentUser } from './request-service'
import { mockReviewer, type AiFinding, type Reviewer } from './reviewer'
import type { Store } from './store'

// 示範資料：公開 demo 一打開就有各種狀態的申請單，不用自己從頭建
// 走的是跟真正使用者一樣的流程（建立 → 送出 → 預審 → 簽核），所以歷史紀錄也是完整的
// 用模擬審查員產生：不花 API 費用，結果也固定
//
// 為了讓「AI 準確度」儀表板有東西看，另外放了過去兩週已經結案的單：
// - ageDays：這張單是幾天前送出的（service 的時鐘撥回那一天）
// - ai：指定 AI 這次要說什麼。模擬審查員只會判斷「說明太短」，引用的條文太單調，
//   真的接 Claude 時意見會多樣得多，這裡先用寫好的意見模擬
// - feedback：主管對第幾條 AI 意見（只算 AI 的，從 0 開始）給了什麼評價

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
  ageDays: number
  submit: boolean // 送出並等 AI 預審跑完
  ai?: AiFinding[]
  feedback?: { ai: number; verdict: 'correct' | 'incorrect'; note: string }[]
  then?: { by: CurrentUser; event: RequestEvent }[] // 預審完之後，簽核者依序要做的事
}

const DAY_MS = 24 * 60 * 60 * 1000
const risk = (message: string, cite: string): AiFinding => ({ kind: 'risk', message, citations: [cite] })
const approve = [{ by: manager, event: 'APPROVE' as const }]
const ok = { verdict: 'correct' as const, note: '' }
const wrong = (note: string) => ({ verdict: 'incorrect' as const, note })

// 過去兩週已經結案的單：AI 說了什麼、主管怎麼評價
// 刻意讓 sop-3.2（故障說明）最常被標記有誤：AI 對一般報修要求過嚴，這就是儀表板要找出來的東西
const HISTORY: Seed[] = [
  {
    applicant: alice,
    formType: 'maintenance',
    title: '包裝機輸送帶異音',
    ageDays: 13,
    fields: {
      equipmentId: 'PK-0204',
      area: 'B 廠區',
      voltage: 220,
      estimatedCost: 18000,
      faultDescription: '輸送帶運轉時有間歇性異音，約每十分鐘出現一次，已持續兩天。',
      isDown: false,
    },
    submit: true,
    ai: [risk('未說明異音發生的具體位置，維修人員可能需要到現場重新確認。', 'sop-3.2')],
    feedback: [{ ai: 0, ...wrong('已說明頻率與持續時間，足以安排派工') }],
    then: approve,
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '台中客戶拜訪計程車資',
    ageDays: 12,
    fields: {
      expenseType: '交通費',
      amount: 850,
      expenseDate: daysAgo(14),
      purpose: '拜訪台中客戶討論下季訂單，高鐵站至客戶工廠往返計程車',
      hasInvoice: true,
      invoiceNumber: 'JK-20481357',
    },
    submit: true,
    ai: [risk('事由未註明拜訪的客戶名稱，無法確認相關對象。', 'fin-2.2')],
    feedback: [{ ai: 0, ...ok }],
    then: approve,
  },
  {
    applicant: alice,
    formType: 'maintenance',
    title: '空壓機出口壓力不足',
    ageDays: 11,
    fields: {
      equipmentId: 'AC-0102',
      area: 'B 廠區',
      voltage: 380,
      estimatedCost: 42000,
      faultDescription: '空壓機出口壓力由 7 bar 降到 5.5 bar，產線氣動工具出力不足。',
      isDown: false,
    },
    submit: true,
    ai: [risk('未說明壓力下降是從什麼時候開始的。', 'sop-3.2')],
    feedback: [{ ai: 0, ...ok }],
    then: approve,
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '台南出差住宿',
    ageDays: 10,
    fields: {
      expenseType: '住宿費',
      amount: 5400,
      expenseDate: daysAgo(12),
      purpose: '支援台南廠設備移機作業，於當地住宿兩晚',
      nights: 2,
      hasInvoice: true,
      invoiceNumber: 'LM-30571946',
    },
    submit: true,
    ai: [risk('住宿單價接近每晚上限，建議確認是否為公司合約飯店。', 'fin-4.2')],
    feedback: [{ ai: 0, ...wrong('每晚 2,700 元未超過上限，規範也沒有要求合約飯店') }],
    then: approve,
  },
  {
    applicant: alice,
    formType: 'maintenance',
    title: '冷凍庫溫度異常',
    ageDays: 9,
    fields: {
      equipmentId: 'FZ-0031',
      area: 'C 廠區',
      voltage: 220,
      estimatedCost: 30000,
      faultDescription: '冷凍庫溫度從零下 18 度升到零下 12 度，自昨晚開始，庫存已先移出。',
      isDown: false,
    },
    submit: true,
    ai: [risk('建議補充溫度變化的完整紀錄，以利判斷故障原因。', 'sop-3.2')],
    feedback: [{ ai: 0, ...wrong('已有起始時間與溫度數值，要求完整紀錄過嚴') }],
    then: approve,
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '供應商技術交流餐敘',
    ageDays: 8,
    fields: {
      expenseType: '業務招待費',
      amount: 3600,
      expenseDate: daysAgo(10),
      purpose: '與供應商工程師討論新型號零件規格，會後於附近餐廳用餐',
      guestCompany: '宏昇精密工業',
      guestCount: 2,
      staffCount: 1,
      hasInvoice: true,
      invoiceNumber: 'NP-48203716',
    },
    submit: true,
    ai: [risk('未說明本次技術交流與哪一個專案相關。', 'fin-2.2')],
    feedback: [{ ai: 0, ...ok }],
    then: approve,
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '會議室投影機購置',
    ageDays: 7,
    fields: {
      expenseType: '辦公用品',
      amount: 18000,
      expenseDate: daysAgo(9),
      purpose: '會議室投影機故障無法修復，購置新投影機一台供部門會議使用',
      hasInvoice: true,
      invoiceNumber: 'QR-59302817',
    },
    submit: true,
    ai: [
      risk('未說明舊投影機是否已辦理報廢。', 'fin-2.2'),
      risk('請確認發票抬頭與統一編號為本公司。', 'fin-3.1'),
    ],
    feedback: [
      { ai: 0, ...wrong('報銷辦法沒有要求說明報廢，那是資產管理的流程') },
      { ai: 1, ...ok },
    ],
    then: approve,
  },
  {
    applicant: alice,
    formType: 'maintenance',
    title: '貨梯門感應器故障',
    ageDays: 6,
    fields: {
      equipmentId: 'EL-0002',
      area: 'A 廠區',
      voltage: 220,
      estimatedCost: 25000,
      faultDescription: '貨梯門感應器偶爾失效，關門時未偵測到障礙物，有夾傷風險。',
      isDown: false,
    },
    submit: true,
    ai: [risk('未說明故障發生的頻率與時間。', 'sop-3.2')],
    feedback: [{ ai: 0, ...wrong('安全問題已經說明清楚，應該優先處理而不是要求補資料') }],
    then: approve,
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '產線安全教育訓練講師費',
    ageDays: 5,
    fields: {
      expenseType: '其他',
      amount: 8000,
      expenseDate: daysAgo(7),
      purpose: '邀請外部講師進行產線安全教育訓練，共三小時，參加人數 40 人',
      hasInvoice: true,
      invoiceNumber: 'ST-61728394',
    },
    submit: true,
    ai: [risk('講師費屬勞務報酬，請確認附上的憑證是否為講師開立的收據。', 'fin-3.1')],
    feedback: [{ ai: 0, ...ok }],
    then: approve,
  },
  {
    applicant: alice,
    formType: 'maintenance',
    title: '高壓配電盤定期檢修',
    ageDays: 4,
    fields: {
      equipmentId: 'HV-0110',
      area: 'A 廠區',
      voltage: 4160,
      estimatedCost: 150000,
      faultDescription: '年度定期檢修，配電盤內部清潔、端子鎖固與絕緣電阻量測，預計停電四小時。',
      isDown: false,
      lockoutBy: '電氣課 陳工程師',
      lockoutAt: daysAgo(5) + 'T08:00',
      lotoDone: true,
    },
    submit: true,
    ai: [risk('未註明執行斷電的人員是否具備合格電氣人員資格。', 'sop-4.1')],
    feedback: [{ ai: 0, ...ok }],
    then: approve,
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '桃園機場接送客戶',
    ageDays: 3,
    fields: {
      expenseType: '交通費',
      amount: 2200,
      expenseDate: daysAgo(4),
      purpose: '接送日本客戶自桃園機場至新竹廠區參訪產線',
      hasInvoice: true,
      invoiceNumber: 'UV-72839405',
    },
    submit: true,
    ai: [risk('事由未說明客戶的公司名稱。', 'fin-2.2')],
    feedback: [{ ai: 0, ...ok }],
    then: approve,
  },
  {
    applicant: alice,
    formType: 'maintenance',
    title: '射出機加熱段異常',
    ageDays: 2,
    fields: {
      equipmentId: 'IM-0507',
      area: 'C 廠區',
      voltage: 380,
      estimatedCost: 36000,
      faultDescription: '第三段加熱器溫度上不去，成品有縮水現象。',
      isDown: false,
    },
    submit: true,
    ai: [risk('未說明故障從什麼時候開始，以及目前的溫度數值。', 'sop-3.2')],
    feedback: [{ ai: 0, ...ok }],
    then: approve,
  },
]



const SEEDS: Seed[] = [
  ...HISTORY,
  {
    applicant: alice,
    formType: 'maintenance',
    title: '3 號產線高壓馬達維修',
    ageDays: 1,
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
    ageDays: 2,
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
    ageDays: 3,
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
    ageDays: 2,
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
    ageDays: 4,
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
    feedback: [{ ai: 0, verdict: 'incorrect', note: '辦公室空調屬一般報修，說明程度已足夠' }],
    then: [{ by: manager, event: 'APPROVE' }],
  },
  {
    applicant: bob,
    formType: 'expense',
    title: '展場臨時搬運費',
    ageDays: 5,
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
    ageDays: 6,
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
    ageDays: 0,
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

// 照著 seed 指定的 AI 意見回答；沒指定的交給模擬審查員
function createSeedReviewer(): Reviewer {
  const scripted = new Map(SEEDS.filter((s) => s.ai).map((s) => [s.title, s.ai!]))
  return {
    name: mockReviewer.name,
    async review(input, policies, hooks) {
      const findings = scripted.get(input.title)
      if (!findings) return mockReviewer.review(input, policies, hooks)
      findings.forEach((f) => hooks?.onFinding?.(f))
      return {
        riskLevel: findings.some((f) => f.kind === 'missing') ? 'high' : findings.length > 0 ? 'medium' : 'low',
        summary: `共 ${input.ruleFindings.length + findings.length} 項需注意事項，請主管確認。`,
        findings,
      }
    },
  }
}

// 資料庫是空的才放；回傳放了幾張
export async function seedDemoData(store: Store): Promise<number> {
  if (store.listRequests().length > 0) return 0

  // 可以撥動的時鐘：每張單從「ageDays 天前的早上」開始，之後每個動作往後幾個小時
  const base = Date.now()
  let clock = base
  const service = createRequestService(store, createSeedReviewer(), { now: () => new Date(clock) })
  const later = (hours: number) => {
    clock = Math.min(clock + hours * 60 * 60 * 1000, base) // 不會超過真正的現在
  }

  for (const seed of SEEDS) {
    clock = base - seed.ageDays * DAY_MS - 8 * 60 * 60 * 1000
    const created = service.createRequest(seed.applicant, {
      formType: seed.formType,
      title: seed.title,
      fields: seed.fields,
    })
    // 示範資料寫錯就直接讓伺服器啟動失敗：寧可馬上發現，也不要 demo 時才看到少了一張
    if (!created.ok) throw new Error(`seed「${seed.title}」建立失敗：${JSON.stringify(created)}`)
    const id = created.request.id

    if (!seed.submit) continue
    later(0.5)
    service.sendEvent(id, 'SUBMIT', seed.applicant)
    await service.waitForReview(id)

    const review = service.getLatestReview(id)
    // 第幾條 AI 意見 → 在合併後的意見清單裡是第幾條（規則的排在前面）
    const aiIndexes = (review?.findings ?? []).flatMap((f, i) => (f.source === 'ai' ? [i] : []))
    for (const fb of seed.feedback ?? []) {
      later(2)
      const index = aiIndexes[fb.ai]
      const result = review && index !== undefined && service.giveFeedback(id, review.id, index, manager, fb)
      if (!result || !result.ok) throw new Error(`seed「${seed.title}」的第 ${fb.ai} 條 AI 意見評價失敗`)
    }
    for (const { by, event } of seed.then ?? []) {
      later(3)
      const result = service.sendEvent(id, event, by)
      if (!result.ok) throw new Error(`seed「${seed.title}」的 ${event} 失敗：${result.reason}`)
    }
  }

  return SEEDS.length
}
