import type { FormDef } from '../form'
import { filled, money, num, type Rule } from '../rules'

// ===== 設備維修申請單 =====
// 注意「高壓作業」區塊的欄位都不是必填：
// 表單只擋「格式錯誤」，規範要求的東西沒填，交給規則引擎標記出來
// 這樣申請人緊急時還是可以先送出，主管會在預審結果裡清楚看到缺了什麼
export const MAINTENANCE_FORM: FormDef = {
  id: 'maintenance',
  title: '設備維修申請',
  sections: [
    {
      title: '設備資訊',
      fields: [
        {
          key: 'equipmentId',
          label: '設備編號',
          type: 'text',
          required: true,
          placeholder: 'HV-0207',
          pattern: '^[A-Z]{2}-\\d{4}$',
          patternHint: '格式為兩個大寫英文字母、一個連字號、四位數字，例如 HV-0207',
        },
        {
          key: 'area',
          label: '所在廠區',
          type: 'select',
          required: true,
          options: ['A 廠區', 'B 廠區', 'C 廠區'],
        },
        { key: 'voltage', label: '額定電壓', type: 'number', unit: 'V', required: true, min: 0 },
        { key: 'estimatedCost', label: '預估費用', type: 'number', unit: '元', required: true, min: 0 },
      ],
    },
    {
      title: '故障狀況',
      fields: [
        {
          key: 'faultDescription',
          label: '故障說明',
          type: 'textarea',
          required: true,
          minLength: 5,
          placeholder: '發生什麼現象、什麼時候開始、目前影響範圍……',
        },
        { key: 'isDown', label: '設備已停機', type: 'boolean' },
        {
          key: 'downSince',
          label: '停機起始時間',
          type: 'datetime',
          required: true,
          showIf: { field: 'isDown', equals: true },
        },
      ],
    },
    {
      title: '高壓作業安全',
      description: '額定電壓 480V 以上的設備須填寫',
      showIf: { field: 'voltage', gte: 480 },
      fields: [
        { key: 'lockoutBy', label: '斷電執行人員', type: 'text', placeholder: '例如：電氣課 陳工程師' },
        { key: 'lockoutAt', label: '斷電完成時間', type: 'datetime' },
        { key: 'lotoDone', label: '作業區域已實施上鎖掛牌（LOTO）', type: 'boolean' },
      ],
    },
  ],
}

const HIGH_VOLTAGE = 480
const PLANT_MANAGER_THRESHOLD = 500_000
const isHighVoltage = (v: Record<string, unknown>) => (num(v.voltage) ?? 0) >= HIGH_VOLTAGE

export const MAINTENANCE_RULES: Rule[] = [
  {
    id: 'high-voltage-lockout-record',
    cites: ['sop-4.2'],
    check: (v) =>
      isHighVoltage(v) && !(filled(v.lockoutBy) && filled(v.lockoutAt))
        ? {
            kind: 'missing',
            message: `額定電壓 ${v.voltage}V，須附斷電確認紀錄（執行人員與時間），未附者不得核准。`,
          }
        : null,
  },
  {
    id: 'high-voltage-loto',
    cites: ['sop-4.3'],
    check: (v) =>
      isHighVoltage(v) && v.lotoDone !== true
        ? { kind: 'risk', message: '高壓設備維修，尚未確認實施上鎖掛牌（LOTO）程序。' }
        : null,
  },
  {
    id: 'plant-manager-approval',
    cites: ['sop-5.1'],
    escalatesToPlantManager: true,
    check: (v) => {
      const cost = num(v.estimatedCost)
      return cost !== null && cost > PLANT_MANAGER_THRESHOLD
        ? { kind: 'notice', message: `預估費用 ${money(cost)}，超過 50 萬元，須另經部門主管核准。` }
        : null
    },
  },
]
