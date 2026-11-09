import { FORM_TYPES, getFormKind, isFormType, type FormType } from '@ai-approval/shared'
import type { Store, StoredPolicyChunk, StoredPolicyDoc } from './store'

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
    text: '預估維修費用超過新台幣 50 萬元者，須另經部門主管核准。',
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
  {
    id: 'fin-6.1',
    ...EXPENSE,
    section: '6.1',
    text: '單筆報銷金額超過新台幣 3 萬元者，經直屬主管核准後，須另經部門主管核准。',
  },
]

// 核心條文：每次預審都交給 AI，不經過檢索
// AI 最主要的工作是判斷申請人的說明夠不夠具體，依據就是這幾條；
// 檢索是用申請內容去找條文，說明寫得越簡略越找不到它們，所以不能交給檢索決定
export const CORE_POLICIES: Record<FormType, readonly string[]> = {
  maintenance: ['sop-3.2'],
  expense: ['fin-2.2'],
}

export function findChunk(id: string) {
  return POLICY_CHUNKS.find((c) => c.id === id)
}

// 這種申請單依據的規範條文：AI 預審只會看到這些，前端的規範面板也只顯示這些
export function policiesFor(type: FormType): PolicyChunk[] {
  const { policyDocId } = getFormKind(type)
  return POLICY_CHUNKS.filter((c) => c.docId === policyDocId)
}

// ===== 規範庫：內建的規範 + 主管匯入的規範 =====
// 內建的寫在程式裡（規則引擎引用它們，不能被改掉）；匯入的存在資料庫
// 對外只有一個入口，預審、規範面板、統計都從這裡拿，不用管條文是哪裡來的

export interface PolicyDocSummary {
  id: string
  formType: FormType
  title: string
  source: 'builtin' | 'upload'
  fileName: string | null
  createdBy: string | null
  createdAt: string | null
  chunkCount: number
}

export interface PolicyImportInput {
  formType: unknown
  code: unknown
  title: unknown
  fileName: unknown
  articles: unknown
}

export type PolicyImportResult =
  | { ok: true; doc: PolicyDocSummary }
  | { ok: false; reason: 'invalid_doc'; fieldErrors: Record<string, string> }
  | { ok: false; reason: 'code_taken' | 'too_many_docs' }

// 公開 demo 誰都能上傳，設個上限，資料不會被灌爆
export const MAX_IMPORTED_DOCS = 20
const MAX_ARTICLES = 200
const MAX_ARTICLE_LENGTH = 2000

// 內建條文 id 的前綴（sop、fin）不能拿來當代碼，不然 id 會撞在一起
const RESERVED_CODES = new Set(POLICY_CHUNKS.map((c) => c.id.split('-')[0]!))

export function createPolicyLibrary(store: Store) {
  function imported(): (PolicyChunk & { formType: string })[] {
    const docs = new Map(store.listPolicyDocs().map((d) => [d.id, d]))
    return store.listPolicyChunks().flatMap((c) => {
      const doc = docs.get(c.docId)
      return doc ? [{ id: c.id, docId: c.docId, docTitle: doc.title, section: c.section, text: c.text, formType: doc.formType }] : []
    })
  }

  // 這種申請單可以依據的所有條文：內建的在前、匯入的依匯入順序接在後面
  function forFormType(type: FormType): PolicyChunk[] {
    return [...policiesFor(type), ...imported().filter((c) => c.formType === type).map(({ formType: _, ...c }) => c)]
  }

  function all(): PolicyChunk[] {
    return [...POLICY_CHUNKS, ...imported().map(({ formType: _, ...c }) => c)]
  }

  function listDocs(): PolicyDocSummary[] {
    const builtin = FORM_TYPES.map((type): PolicyDocSummary => {
      const chunks = policiesFor(type)
      return {
        id: getFormKind(type).policyDocId,
        formType: type,
        title: chunks[0]?.docTitle ?? '',
        source: 'builtin',
        fileName: null,
        createdBy: null,
        createdAt: null,
        chunkCount: chunks.length,
      }
    })
    const counts = new Map<string, number>()
    for (const c of store.listPolicyChunks()) counts.set(c.docId, (counts.get(c.docId) ?? 0) + 1)
    const uploaded = store.listPolicyDocs().map((d) => toSummary(d, counts.get(d.id) ?? 0))
    return [...builtin, ...uploaded]
  }

  // 匯入：PDF 解析出來的只是草稿，主管確認、修改過的內容才走到這裡
  // 這裡是最後一道關卡，前端送什麼都要重新檢查
  function importDoc(input: PolicyImportInput, actorId: string, now: Date): PolicyImportResult {
    const errors: Record<string, string> = {}

    if (!isFormType(input.formType)) errors.formType = '請選擇申請類型'

    const code = typeof input.code === 'string' ? input.code.trim() : ''
    if (!/^[a-z][a-z0-9]{1,7}$/.test(code)) errors.code = '代碼為 2～8 個小寫英文字母或數字，並以英文字母開頭'
    else if (RESERVED_CODES.has(code)) errors.code = `「${code}」是內建規範使用的代碼`

    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (title === '' || title.length > 100) errors.title = '請填寫文件名稱（100 字以內）'

    const raw = Array.isArray(input.articles) ? input.articles : []
    const articles = raw.map((a) => ({
      section: typeof a?.section === 'string' ? a.section.trim() : '',
      text: typeof a?.text === 'string' ? a.text.trim() : '',
    }))
    if (articles.length === 0 || articles.length > MAX_ARTICLES) {
      errors.articles = `條文數量須為 1～${MAX_ARTICLES} 條`
    } else {
      const sections = new Set<string>()
      for (const a of articles) {
        if (!/^[A-Za-z0-9.]{1,12}$/.test(a.section)) errors.articles = `條號「${a.section}」只能是英文字母、數字與小數點`
        else if (sections.has(a.section)) errors.articles = `條號「${a.section}」重複了`
        else if (a.text === '' || a.text.length > MAX_ARTICLE_LENGTH) errors.articles = `第 ${a.section} 條的內容須為 1～${MAX_ARTICLE_LENGTH} 字`
        if (errors.articles) break
        sections.add(a.section)
      }
    }

    if (Object.keys(errors).length > 0) return { ok: false, reason: 'invalid_doc', fieldErrors: errors }

    const docs = store.listPolicyDocs()
    if (docs.some((d) => d.id === code)) return { ok: false, reason: 'code_taken' }
    if (docs.length >= MAX_IMPORTED_DOCS) return { ok: false, reason: 'too_many_docs' }

    const doc: StoredPolicyDoc = {
      id: code,
      formType: input.formType as FormType,
      title,
      fileName: typeof input.fileName === 'string' && input.fileName.trim() ? input.fileName.trim().slice(0, 200) : null,
      createdBy: actorId,
      createdAt: now.toISOString(),
    }
    const chunks: StoredPolicyChunk[] = articles.map((a) => ({
      id: `${code}-${a.section}`,
      docId: code,
      section: a.section,
      text: a.text,
    }))
    store.appendPolicyDoc(doc, chunks)
    return { ok: true, doc: toSummary(doc, chunks.length) }
  }

  return { forFormType, all, listDocs, importDoc }
}

function toSummary(d: StoredPolicyDoc, chunkCount: number): PolicyDocSummary {
  return {
    id: d.id,
    formType: d.formType as FormType,
    title: d.title,
    source: 'upload',
    fileName: d.fileName,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    chunkCount,
  }
}

export type PolicyLibrary = ReturnType<typeof createPolicyLibrary>
