import type { RequestEvent, RequestStatus } from '@ai-approval/shared'

// Record<聯集型別, string>：如果 shared 新增了狀態或事件卻忘了補中文，TypeScript 會直接報錯
export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: '草稿',
  reviewing: 'AI 預審中',
  pending_approval: '待簽核',
  needs_info: '待補件',
  approved: '已核准',
  rejected: '已退回',
  withdrawn: '已撤回',
}

export const EVENT_LABEL: Record<RequestEvent | 'CREATE', string> = {
  CREATE: '建立',
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
}
