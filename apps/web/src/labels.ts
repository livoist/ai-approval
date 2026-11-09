import type { AuditAction, RequestStatus } from '@ai-approval/shared'

// Record<聯集型別, string>：如果 shared 新增了狀態或事件卻忘了補中文，TypeScript 會直接報錯
export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: '草稿',
  reviewing: 'AI 預審中',
  pending_approval: '待直屬主管簽核',
  pending_final_approval: '待部門主管核准',
  needs_info: '待補件',
  approved: '已核准',
  rejected: '已退回',
  withdrawn: '已撤回',
}

export const EVENT_LABEL: Record<AuditAction, string> = {
  CREATE: '建立',
  UPDATE: '修改內容',
  SUBMIT: '送出',
  AI_REVIEW_DONE: 'AI 預審完成',
  AI_REVIEW_FAILED: 'AI 預審失敗',
  APPROVE: '核准',
  REJECT: '退回',
  REQUEST_INFO: '要求補件',
  RESUBMIT: '補件重送',
  WITHDRAW: '撤回',
}

export const ERROR_LABEL: Record<string, string> = {
  forbidden: '你沒有權限執行這個動作',
  invalid_transition: '這張申請單目前的狀態不能執行這個動作',
  not_found: '找不到這張申請單',
  note_required: '標記為有誤時，請說明錯在哪裡',
  invalid_fields: '有欄位填寫不正確，請檢查標示紅字的地方',
  invalid_pdf: '這個檔案不是有效的 PDF',
  no_text: '這份 PDF 裡沒有可以讀取的文字，可能是掃描檔，請先轉成文字型 PDF',
  file_too_large: '檔案太大了，請上傳 5 MB 以內的 PDF',
  invalid_doc: '有欄位填寫不正確，請檢查標示紅字的地方',
  code_taken: '這個代碼已經有文件在用了，請換一個',
  too_many_docs: '規範文件已達上限，無法再匯入',
  invalid_guideline: '請寫下準則內容（300 字以內）',
  already_adopted: '這筆評價已經採用為審查準則了',
  eval_running: '已經有一次評估在執行中，請稍候',
  no_reviewer: '伺服器沒有設定審查員，無法執行評估',
}
