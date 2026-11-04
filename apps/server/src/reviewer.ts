import type { PolicyChunk } from './policies'

// AI 預審的輸出格式：不論背後是 Claude 還是假的審查員，都要回傳這個形狀
export interface ReviewFinding {
  kind: 'missing' | 'risk' | 'ok'
  message: string
  citations: string[] // PolicyChunk 的 id
}

export interface ReviewOutput {
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  findings: ReviewFinding[]
}

export interface ReviewInput {
  title: string
  description: string
}

// 審查員介面：service 只依賴這個介面，不知道背後是誰
// 這叫「依賴反轉」：要換成別家模型、或測試時換成假的，service 一行都不用改
export interface Reviewer {
  readonly name: string
  review(input: ReviewInput, policies: readonly PolicyChunk[]): Promise<ReviewOutput>
}

// 引用驗證：AI 回傳的條文 id 一定要真的存在
// 模型偶爾會「幻覺」出不存在的條文，這一關確保畫面上的每個引用都點得開
export function validateCitations(output: ReviewOutput, policies: readonly PolicyChunk[]) {
  const known = new Set(policies.map((p) => p.id))
  return {
    ...output,
    findings: output.findings.map((f) => ({
      ...f,
      citations: f.citations.filter((id) => known.has(id)),
    })),
  }
}

// 假的審查員：用簡單的關鍵字規則，結果固定、免費、不用網路
// 用途：寫測試、沒有 API key 時開發、demo 時的備援
export const mockReviewer: Reviewer = {
  name: 'mock',
  async review(input) {
    const text = `${input.title}\n${input.description}`
    const isHighVoltage = /高壓|480V/i.test(text)
    const findings: ReviewFinding[] = []

    if (!/編號/.test(text)) {
      findings.push({ kind: 'missing', message: '未載明設備編號。', citations: ['sop-3.1'] })
    }
    if (isHighVoltage && !/斷電/.test(text)) {
      findings.push({
        kind: 'missing',
        message: '高壓設備維修未附斷電確認紀錄，依規範不得核准。',
        citations: ['sop-4.2'],
      })
    }
    if (isHighVoltage && !/上鎖|LOTO/i.test(text)) {
      findings.push({ kind: 'risk', message: '未提及上鎖掛牌程序。', citations: ['sop-4.3'] })
    }

    const missing = findings.filter((f) => f.kind === 'missing').length
    const riskLevel = isHighVoltage && missing > 0 ? 'high' : findings.length > 0 ? 'medium' : 'low'
    return {
      riskLevel,
      summary: findings.length === 0 ? '申請內容符合規範。' : `發現 ${findings.length} 項需注意事項。`,
      findings,
    }
  },
}
