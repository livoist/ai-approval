import type { Finding, FormType, FormValues } from '@ai-approval/shared'
import type { PolicyChunk } from './policies'

// AI 產生的意見：跟 Finding 一樣，只是還沒標上來源（由 service 補上 source: 'ai'）
// AI 不會產生 notice（流程提醒），那是規則引擎的工作
export type AiFinding = Omit<Finding, 'source'> & { kind: 'missing' | 'risk' | 'ok' }

export interface ReviewOutput {
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  findings: AiFinding[]
  // 實際是誰審的：有使用上限的審查員改用備援時，會在這裡註明原因
  usedReviewer?: string
}

export interface ReviewInput {
  formType: FormType
  formTitle: string // 例如「費用報銷申請」，讓 AI 知道它在審哪一種單
  title: string
  values: FormValues // 原始填寫內容（給程式判斷用）
  details: { label: string; value: string }[] // 轉成人看得懂的「標籤：值」（給 AI 讀）
  narrative: string // 申請人自己寫的說明（故障說明、報銷事由……），AI 主要判斷這段寫得夠不夠具體
  ruleFindings: Finding[] // 規則引擎已經查到的問題，AI 不用再重複
  // 審查準則：主管針對過去誤判寫下、經採用的補充說明，只包含這次交給 AI 的條文的準則
  guidelines: { id: string; policyId: string; text: string }[]
  // 輸入防護移除了幾段疑似指令的文字：讓 AI 知道申請內容被動過，判斷時更保守
  removedInjections: number
}

// 審查過程中的「掛勾」：
// - onFinding：每審出一條意見就呼叫一次，讓畫面可以即時顯示（串流的關鍵）
// - signal：外面可以喊停，例如逾時了就中止請求，不要白白等下去
export interface ReviewHooks {
  onFinding?: (finding: AiFinding) => void
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
export function validateFinding<T extends { citations: string[] }>(
  finding: T,
  policies: readonly PolicyChunk[],
): T {
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

// 假的審查員在每種申請單上「說明太簡略」時要引用的條文（核心條文，每次都會交給 AI）
const VAGUE_NARRATIVE: Record<FormType, { cite: string; message: string }> = {
  maintenance: {
    cite: 'sop-3.2',
    message: '故障說明過於簡略，維修人員可能難以事先判斷故障原因與所需零件。',
  },
  expense: {
    cite: 'fin-2.2',
    message: '報銷事由過於籠統，無法判斷這筆費用與業務的關聯。',
  },
}

// 說明少於幾個字就判定「太簡略」
// 刻意設得偏嚴：「冷凍庫升溫至零下12度，昨晚起」這種短但具體的說明也會被挑剔，
// 模擬真實 AI 常見的毛病（對一般案件要求過多），評估集與主管評價才有東西可以抓
const VAGUE_THRESHOLD = 20
// 收到這條規範的審查準則之後，放寬成這個長度
const VAGUE_THRESHOLD_WITH_GUIDELINE = 10

// 假的審查員：模擬 AI 負責的「模糊判斷」，結果固定、免費、不用網路
// 硬性規則已經由規則引擎處理，這裡只示範 AI 會做的那種判斷：申請人的說明夠不夠具體
// delayMs 模擬 AI 思考的時間，讓沒有 API key 也看得到「一條一條長出來」的串流效果
//
// 審查準則：模擬審查員看不懂文字，只要有針對那條規範的準則，就放寬判斷標準
// 這是為了在沒有 API key 時也能展示「主管回饋 → 準則 → AI 改善 → 評估驗證」整個閉環；
// 真正讀懂準則內容的是 Claude，效果要用 Claude 跑評估集才算數
export function createMockReviewer(options: { delayMs: number }): Reviewer {
  return {
    name: 'mock',
    async review(input, _policies, hooks) {
      const findings: AiFinding[] = []
      await sleep(options.delayMs, hooks?.signal)
      const vague = VAGUE_NARRATIVE[input.formType]
      const relaxed = input.guidelines.some((g) => g.policyId === vague.cite)
      const threshold = relaxed ? VAGUE_THRESHOLD_WITH_GUIDELINE : VAGUE_THRESHOLD
      if (input.narrative.trim().length < threshold) {
        const finding: AiFinding = { kind: 'risk', message: vague.message, citations: [vague.cite] }
        findings.push(finding)
        hooks?.onFinding?.(finding)
      }
      await sleep(options.delayMs, hooks?.signal)

      const total = input.ruleFindings.length + findings.length
      return {
        riskLevel: findings.length > 0 ? 'medium' : 'low',
        summary: total === 0 ? '申請內容符合規範。' : `共 ${total} 項需注意事項，請主管確認。`,
        findings,
      }
    },
  }
}

// 測試用：不等待，結果立刻出來
export const mockReviewer = createMockReviewer({ delayMs: 0 })
