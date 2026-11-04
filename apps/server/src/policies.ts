// 模擬的公司規範文件（自行撰寫，非任何真實公司文件）
// 每一段就是一個「引用單位」：AI 只能引用這裡的 id，不能自己編條文
export interface PolicyChunk {
  id: string
  docTitle: string
  section: string
  text: string
}

const DOC = '設備維修作業規範'

export const POLICY_CHUNKS: readonly PolicyChunk[] = [
  {
    id: 'sop-3.1',
    docTitle: DOC,
    section: '3.1',
    text: '維修申請須載明設備名稱、設備編號與所在廠區，以利維修人員確認作業位置。',
  },
  {
    id: 'sop-3.2',
    docTitle: DOC,
    section: '3.2',
    text: '維修申請須說明故障現象與發生時間；如已造成停機，須註明停機起始時間。',
  },
  {
    id: 'sop-4.1',
    docTitle: DOC,
    section: '4.1',
    text: '電壓 480V 以上之高壓設備，維修前須由合格電氣人員執行斷電作業。',
  },
  {
    id: 'sop-4.2',
    docTitle: DOC,
    section: '4.2',
    text: '高壓設備維修申請須附上斷電確認紀錄（含執行人員與時間），未附者不得核准。',
  },
  {
    id: 'sop-4.3',
    docTitle: DOC,
    section: '4.3',
    text: '涉及高壓設備之維修，須於作業區域實施上鎖掛牌（LOTO）程序。',
  },
  {
    id: 'sop-5.1',
    docTitle: DOC,
    section: '5.1',
    text: '預估維修費用超過新台幣 50 萬元者，須另經廠長核准。',
  },
]

export function findChunk(id: string) {
  return POLICY_CHUNKS.find((c) => c.id === id)
}
