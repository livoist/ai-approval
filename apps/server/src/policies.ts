import { getFormKind, type FormType } from '@ai-approval/shared'

// 模擬的公司規範文件（自行撰寫，非任何真實公司文件）
// 每一段就是一個「引用單位」：AI 只能引用這裡的 id，不能自己編條文
export interface PolicyChunk {
  id: string
  docId: string // 屬於哪一份規範文件；每種申請單依據自己的那一份
  docTitle: string
  section: string
  text: string
}

const MAINTENANCE = { docId: 'maintenance-sop', docTitle: '設備維修作業規範' }
const EXPENSE = { docId: 'expense-policy', docTitle: '費用報銷作業辦法' }

export const POLICY_CHUNKS: readonly PolicyChunk[] = [
  {
    id: 'sop-3.1',
    ...MAINTENANCE,
    section: '3.1',
    text: '維修申請須載明設備名稱、設備編號與所在廠區，以利維修人員確認作業位置。',
  },
  {
    id: 'sop-3.2',
    ...MAINTENANCE,
    section: '3.2',
    text: '維修申請須說明故障現象與發生時間；如已造成停機，須註明停機起始時間。',
  },
  {
    id: 'sop-4.1',
    ...MAINTENANCE,
    section: '4.1',
    text: '電壓 480V 以上之高壓設備，維修前須由合格電氣人員執行斷電作業。',
  },
  {
    id: 'sop-4.2',
    ...MAINTENANCE,
    section: '4.2',
    text: '高壓設備維修申請須附上斷電確認紀錄（含執行人員與時間），未附者不得核准。',
  },
  {
    id: 'sop-4.3',
    ...MAINTENANCE,
    section: '4.3',
    text: '涉及高壓設備之維修，須於作業區域實施上鎖掛牌（LOTO）程序。',
  },
  {
    id: 'sop-5.1',
    ...MAINTENANCE,
    section: '5.1',
    text: '預估維修費用超過新台幣 50 萬元者，須另經廠長核准。',
  },
  {
    id: 'fin-2.1',
    ...EXPENSE,
    section: '2.1',
    text: '員工應於費用發生後 60 日內提出報銷申請，逾期者原則上不予受理。',
  },
  {
    id: 'fin-2.2',
    ...EXPENSE,
    section: '2.2',
    text: '報銷事由應具體說明該筆費用與公司業務之關聯，包括業務目的、地點與相關對象。',
  },
  {
    id: 'fin-3.1',
    ...EXPENSE,
    section: '3.1',
    text: '報銷應檢附統一發票或收據正本，發票抬頭與統一編號須為本公司。',
  },
  {
    id: 'fin-3.2',
    ...EXPENSE,
    section: '3.2',
    text: '因故無法取得憑證者，應於申請時具體說明原因，並由申請人簽名負責。',
  },
  {
    id: 'fin-3.3',
    ...EXPENSE,
    section: '3.3',
    text: '無憑證之報銷，單筆金額以新台幣 1,000 元為上限。',
  },
  {
    id: 'fin-4.2',
    ...EXPENSE,
    section: '4.2',
    text: '國內出差住宿費，每晚以新台幣 3,000 元為上限，超過部分由員工自行負擔。',
  },
  {
    id: 'fin-5.1',
    ...EXPENSE,
    section: '5.1',
    text: '業務招待費每人平均以新台幣 2,000 元為上限（含本公司人員）。',
  },
  {
    id: 'fin-5.2',
    ...EXPENSE,
    section: '5.2',
    text: '業務招待費應載明招待對象之公司名稱與人數，未載明者不予核銷。',
  },
]

export function findChunk(id: string) {
  return POLICY_CHUNKS.find((c) => c.id === id)
}

// 這種申請單依據的規範條文：AI 預審只會看到這些，前端的規範面板也只顯示這些
export function policiesFor(type: FormType): PolicyChunk[] {
  const { policyDocId } = getFormKind(type)
  return POLICY_CHUNKS.filter((c) => c.docId === policyDocId)
}
