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

// 審查過程中的「掛勾」：
// - onFinding：每審出一條意見就呼叫一次，讓畫面可以即時顯示（串流的關鍵）
// - signal：外面可以喊停，例如逾時了就中止請求，不要白白等下去
export interface ReviewHooks {
  onFinding?: (finding: ReviewFinding) => void
  signal?: AbortSignal
}

// 審查員介面：service 只依賴這個介面，不知道背後是誰
// 這叫「依賴反轉」：要換成別家模型、或測試時換成假的，service 一行都不用改
export interface Reviewer {
  readonly name: string
  review(input: ReviewInput, policies: readonly PolicyChunk[], hooks?: ReviewHooks): Promise<ReviewOutput>
}

// 引用驗證：AI 回傳的條文 id 一定要真的存在
// 模型偶爾會「幻覺」出不存在的條文，這一關確保畫面上的每個引用都點得開
export function validateFinding(finding: ReviewFinding, policies: readonly PolicyChunk[]) {
  const known = new Set(policies.map((p) => p.id))
  return { ...finding, citations: finding.citations.filter((id) => known.has(id)) }
}

export function validateCitations(output: ReviewOutput, policies: readonly PolicyChunk[]) {
  return { ...output, findings: output.findings.map((f) => validateFinding(f, policies)) }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve()
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason)
    })
  })

// 假的審查員：用簡單的關鍵字規則，結果固定、免費、不用網路
// delayMs 模擬 AI 思考的時間，讓沒有 API key 也看得到「一條一條長出來」的串流效果
export function createMockReviewer(options: { delayMs: number }): Reviewer {
  return {
    name: 'mock',
    async review(input, _policies, hooks) {
      const text = `${input.title}\n${input.description}`
      const isHighVoltage = /高壓|480V/i.test(text)
      const findings: ReviewFinding[] = []

      const emit = async (f: ReviewFinding) => {
        await sleep(options.delayMs, hooks?.signal)
        findings.push(f)
        hooks?.onFinding?.(f)
      }

      if (!/編號/.test(text)) {
        await emit({ kind: 'missing', message: '未載明設備編號。', citations: ['sop-3.1'] })
      }
      if (isHighVoltage && !/斷電/.test(text)) {
        await emit({
          kind: 'missing',
          message: '高壓設備維修未附斷電確認紀錄，依規範不得核准。',
          citations: ['sop-4.2'],
        })
      }
      if (isHighVoltage && !/上鎖|LOTO/i.test(text)) {
        await emit({ kind: 'risk', message: '未提及上鎖掛牌程序。', citations: ['sop-4.3'] })
      }
      await sleep(options.delayMs, hooks?.signal)

      const missing = findings.filter((f) => f.kind === 'missing').length
      const riskLevel = isHighVoltage && missing > 0 ? 'high' : findings.length > 0 ? 'medium' : 'low'
      return {
        riskLevel,
        summary: findings.length === 0 ? '申請內容符合規範。' : `發現 ${findings.length} 項需注意事項。`,
        findings,
      }
    },
  }
}

// 測試用：不等待，結果立刻出來
export const mockReviewer = createMockReviewer({ delayMs: 0 })
