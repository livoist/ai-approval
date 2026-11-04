// 申請單的所有可能狀態
// 用字串聯集（union）而不是 enum：序列化成 JSON 時不用轉換，前後端直接共用
export type RequestStatus =
  | 'draft' // 草稿：申請人還在填
  | 'reviewing' // AI 預審中
  | 'pending_approval' // 等待主管簽核
  | 'needs_info' // 主管要求補件
  | 'approved' // 已核准（終點）
  | 'rejected' // 已退回（終點）

// 會讓狀態改變的「事件」
// 狀態機的核心觀念：狀態不是被直接「設定」的，而是由事件「推動」的
export type RequestEvent =
  | 'SUBMIT' // 申請人送出
  | 'AI_REVIEW_DONE' // AI 預審完成
  | 'AI_REVIEW_FAILED' // AI 預審失敗（逾時、格式錯誤等）
  | 'APPROVE' // 主管核准
  | 'REJECT' // 主管退回
  | 'REQUEST_INFO' // 主管要求補件
  | 'RESUBMIT' // 申請人補件後重送

// 誰在觸發事件；'system' 代表後端自己（例如 AI 預審跑完）
export type ActorRole = 'applicant' | 'approver' | 'system'
