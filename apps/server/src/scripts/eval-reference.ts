import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClaudeReviewer } from '../claude-reviewer'
import { runEval } from '../evals'
import { policiesFor } from '../policies'
import { createRetrievalFromEnv } from '../retrieval-config'
import type { EvalRun, Guideline } from '../store'

// 產生「Claude 參考評估」：用真的 Claude 跑一次評估集，結果存成 eval-reference.json 一起提交
//
// 公開 demo 的評估集用模擬審查員（不消耗 AI 額度），但模擬審查員的分數不代表 AI 的實力
// 所以另外存一份真實的結果，畫面上固定顯示；要更新時在本機執行：pnpm eval:reference
// 規範只用內建的（不含主管另外匯入的），每次產生的條件才會一樣

try {
  process.loadEnvFile()
} catch {}

const env = process.env
if (!env.ANTHROPIC_API_KEY) {
  console.error('需要 ANTHROPIC_API_KEY：參考評估一定要用真的 Claude 跑（請寫在 apps/server/.env）')
  process.exit(1)
}

// 參考評估套用的準則：比照主管會寫的理由，針對評估集裡「簡短但具體」的案例
// 寫在這裡而不是讀資料庫：每個人本機的資料不同，參考結果要能重現
const now = new Date()
const guideline = (policyId: string, text: string): Guideline => ({
  id: `reference-${policyId}`,
  policyId,
  text,
  sourceFeedbackId: null,
  createdBy: 'reference',
  createdAt: now.toISOString(),
  retiredAt: null,
  retiredBy: null,
})
const REFERENCE_GUIDELINES = [
  guideline('sop-3.2', '故障說明只要寫出具體的現象（例如數值、頻率）與發生時間就算具體，不要求長篇描述。'),
  guideline('fin-2.2', '報銷事由只要寫出目的、地點與對象就算具體，簡短的寫法也可以接受。'),
]

const reviewer = createClaudeReviewer({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5' })
const { retriever } = createRetrievalFromEnv(env)

console.log(`用 ${reviewer.name} 跑評估集（檢索：${retriever.name}）…`)
const report = await runEval({
  reviewer,
  policiesFor,
  guidelines: REFERENCE_GUIDELINES,
  now,
  retriever,
  onProgress: (done, total) => process.stdout.write(`\r${done} / ${total}`),
})
process.stdout.write('\n')

const run: EvalRun = {
  id: 'reference',
  reviewer: reviewer.name,
  guidelineIds: report.guidelines.map((g) => g.id),
  createdBy: 'reference',
  createdAt: now.toISOString(),
  report,
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../eval-reference.json')
writeFileSync(out, JSON.stringify(run, null, 2) + '\n')

const s = (v: typeof report.baseline) => `${v.summary.passed} / ${v.summary.total} 通過，誤報 ${v.summary.falseAlarms} 條`
console.log(`不套用準則：${s(report.baseline)}`)
console.log(`套用準則：${s(report.withGuidelines)}`)
console.log(`已寫入 ${out}，記得一起提交`)
