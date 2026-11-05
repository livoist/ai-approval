// 申請單的所有可能狀態
// 用字串聯集（union）而不是 enum：序列化成 JSON 時不用轉換，前後端直接共用
export type RequestStatus =
  | 'draft' // 草稿：申請人還在填
  | 'reviewing' // AI 預審中
  | 'pending_approval' // 等待主管簽核
  | 'pending_final_approval' // 主管已核准，等待廠長核准（金額超過門檻時才會有這一關）
  | 'needs_info' // 主管要求補件
  | 'approved' // 已核准（終點）
  | 'rejected' // 已退回（終點）
  | 'withdrawn' // 已撤回（終點）

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
  | 'WITHDRAW' // 申請人撤回

// 不屬於狀態轉換、但要留下紀錄的動作
// 例如修改申請內容：狀態不會變，但「誰在什麼時候改了」一定要查得到
export type AuditAction = RequestEvent | 'CREATE' | 'UPDATE'
// 誰在觸發事件；'system' 代表後端自己（例如 AI 預審跑完）
// plant_manager 是第二層簽核：只有規則判斷需要時，申請單才會送到他手上
export type ActorRole = 'applicant' | 'approver' | 'plant_manager' | 'system'
