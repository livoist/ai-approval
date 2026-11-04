// 測試與 demo 用的範例申請單
// 每一筆都刻意設計成會觸發不同的預審結果，方便一次看完所有情境
export interface SampleRequest {
  label: string // 按鈕上的文字
  expect: string // 預期的預審結果，提示用
  title: string
  description: string
}

export const SAMPLE_REQUESTS: SampleRequest[] = [
  {
    label: '高壓・資料不全',
    expect: '高風險，3 項',
    title: '3 號產線高壓馬達維修',
    description: '3 號產線主馬達運轉時有明顯異音，振動偏大，需安排維修。',
  },
  {
    label: '高壓・未上鎖掛牌',
    expect: '中風險，1 項',
    title: '2 號變電箱高壓斷路器更換',
    description:
      '設備編號 HV-0207，位於 A 廠區二樓配電室。\n' +
      '斷路器跳脫後無法復歸，自 11/3 08:30 起停機。\n' +
      '已由電氣課陳工程師於 11/3 09:10 完成斷電，斷電確認紀錄如附件。',
  },
  {
    label: '高壓・資料齊全',
    expect: '低風險，0 項',
    title: '1 號空壓機 480V 主電源檢修',
    description:
      '設備編號 AC-0101，位於 B 廠區機房。\n' +
      '電源端子有焦痕，11/4 14:00 發現，尚未停機。\n' +
      '已由電氣課林組長於 11/4 14:30 完成斷電，並於作業區實施上鎖掛牌（LOTO）。',
  },
  {
    label: '一般設備・缺編號',
    expect: '中風險，1 項',
    title: '辦公室空調異常',
    description: 'C 棟三樓辦公室空調出風不冷，自上週起溫度偏高。',
  },
]
