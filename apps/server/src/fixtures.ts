// 測試用的共用資料
import type { FormValues } from '@ai-approval/shared'
import type { CurrentUser, RequestService } from './request-service'

export const alice: CurrentUser = { id: 'alice', role: 'applicant' }
export const bob: CurrentUser = { id: 'bob', role: 'applicant' }
export const manager: CurrentUser = { id: 'manager', role: 'approver' }
export const system: CurrentUser = { id: 'system', role: 'system' }

// 低壓、資料完整、說明具體 → 規則與 AI 都沒有意見
export const COMPLETE_LOW_VOLTAGE: FormValues = {
  equipmentId: 'AC-0101',
  area: 'B 廠區',
  voltage: 220,
  estimatedCost: 30000,
  faultDescription: '空調壓縮機啟動約十分鐘後自動跳停，重新啟動後仍反覆發生。',
  isDown: false,
}

// 高壓、沒有斷電紀錄與 LOTO、說明太簡略
// → 規則 2 條（sop-4.2 缺漏、sop-4.3 風險）+ AI 1 條（sop-3.2 說明簡略）= 3 條，高風險
export const INCOMPLETE_HIGH_VOLTAGE: FormValues = {
  equipmentId: 'HV-0301',
  area: 'A 廠區',
  voltage: 480,
  estimatedCost: 120000,
  faultDescription: '馬達運轉異音',
  isDown: false,
}

// 建立申請單，失敗就直接讓測試報錯（測試裡大多只關心建立之後的事）
export function mustCreate(
  service: RequestService,
  user: CurrentUser,
  fields: FormValues = COMPLETE_LOW_VOLTAGE,
  title = '設備維修',
) {
  const result = service.createRequest(user, { title, fields })
  if (!result.ok) throw new Error(`createRequest failed: ${JSON.stringify(result)}`)
  return result.request
}
