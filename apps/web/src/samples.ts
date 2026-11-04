import type { FormType, FormValues } from '@ai-approval/shared'

// 測試與 demo 用的範例申請單
// 每一筆都刻意設計成會觸發不同的預審結果，方便一次看完所有情境：
// 規則引擎負責的（斷電紀錄、LOTO、廠長核准），以及 AI 負責的（說明是否具體）
export interface SampleRequest {
  formType: FormType
  label: string // 按鈕上的文字
  expect: string // 預期的預審結果，提示用
  title: string
  fields: FormValues
}

// 「N 天前」的日期：範例的日期跟著今天走，報銷期限的規則才會一直有相同的結果
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const DETAILED = '主馬達運轉時有明顯金屬摩擦異音，振動值由 2.1 升至 6.8 mm/s，自 11/3 上午開始，目前降速運轉中。'

export const SAMPLE_REQUESTS: SampleRequest[] = [
  {
    formType: 'maintenance',
    label: '高壓・資料不全',
    expect: '高風險，3 項（規則 2、AI 1）',
    title: '3 號產線高壓馬達維修',
    fields: {
      equipmentId: 'HV-0301',
      area: 'A 廠區',
      voltage: 480,
      estimatedCost: 120000,
      faultDescription: '馬達運轉異音',
      isDown: false,
    },
  },
  {
    formType: 'maintenance',
    label: '高壓・未上鎖掛牌',
    expect: '中風險，1 項（規則）',
    title: '2 號變電箱高壓斷路器更換',
    fields: {
      equipmentId: 'HV-0207',
      area: 'A 廠區',
      voltage: 4160,
      estimatedCost: 260000,
      faultDescription: '斷路器跳脫後無法復歸，現場聞到焦味，外殼局部變色，研判內部接點燒損。',
      isDown: true,
      downSince: '2026-11-03T08:30',
      lockoutBy: '電氣課 陳工程師',
      lockoutAt: '2026-11-03T09:10',
      lotoDone: false,
    },
  },
  {
    formType: 'maintenance',
    label: '高壓・資料齊全',
    expect: '低風險，0 項',
    title: '1 號空壓機主電源檢修',
    fields: {
      equipmentId: 'AC-0101',
      area: 'B 廠區',
      voltage: 480,
      estimatedCost: 85000,
      faultDescription: DETAILED,
      isDown: false,
      lockoutBy: '電氣課 林組長',
      lockoutAt: '2026-11-04T14:30',
      lotoDone: true,
    },
  },
  {
    formType: 'maintenance',
    label: '超過 50 萬',
    expect: '低風險，1 項（規則提醒需廠長核准）',
    title: '冷卻水塔風扇馬達汰換',
    fields: {
      equipmentId: 'CT-0012',
      area: 'C 廠區',
      voltage: 380,
      estimatedCost: 820000,
      faultDescription: '風扇馬達軸承磨損嚴重，已更換兩次仍持續過熱，評估需整組汰換並更新控制盤。',
      isDown: false,
    },
  },
  {
    formType: 'maintenance',
    label: '低壓・說明簡略',
    expect: '中風險，1 項（AI）',
    title: '辦公室空調異常',
    fields: {
      equipmentId: 'GN-1033',
      area: 'C 廠區',
      voltage: 220,
      estimatedCost: 15000,
      faultDescription: '空調不太冷，麻煩處理',
      isDown: false,
    },
  },
  // ===== 費用報銷 =====
  {
    formType: 'expense',
    label: '交通費・資料齊全',
    expect: '低風險，0 項',
    title: '新竹客戶驗收高鐵票',
    fields: {
      expenseType: '交通費',
      amount: 1250,
      expenseDate: daysAgo(3),
      purpose: '前往新竹科學園區客戶端進行設備驗收，台北新竹往返高鐵票',
      hasInvoice: true,
      invoiceNumber: 'AB-12345678',
    },
  },
  {
    formType: 'expense',
    label: '招待超標・事由簡略',
    expect: '中風險，2 項（規則 1、AI 1）',
    title: '客戶餐敘',
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
  },
  {
    formType: 'expense',
    label: '無發票・超過上限',
    expect: '高風險，1 項（規則）',
    title: '展場臨時搬運費',
    fields: {
      expenseType: '其他',
      amount: 1800,
      expenseDate: daysAgo(10),
      purpose: '台北南港展覽館參展，現場臨時請搬運工協助布置展位與搬運設備',
      hasInvoice: false,
      noInvoiceReason: '臨時雇用的搬運工無法開立收據',
    },
  },
  {
    formType: 'expense',
    label: '逾期・住宿超標',
    expect: '中風險，2 項（規則）',
    title: '高雄出差住宿',
    fields: {
      expenseType: '住宿費',
      amount: 9600,
      expenseDate: daysAgo(75),
      purpose: '前往高雄楠梓廠區支援產線導入，於當地住宿三晚',
      nights: 3,
      hasInvoice: true,
      invoiceNumber: 'EF-11223344',
    },
  },
]
