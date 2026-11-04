import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import type { PolicyChunk } from './policies'
import type { ReviewInput, ReviewOutput, Reviewer } from './reviewer'

// 要求模型輸出的 JSON 結構（Structured Outputs）
// API 會保證回傳符合這個 schema，不用自己 parse 半天還擔心格式壞掉
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: { type: 'string', description: '一到兩句話的預審摘要' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['missing', 'risk', 'ok'] },
          message: { type: 'string' },
          citations: {
            type: 'array',
            items: { type: 'string' },
            description: '依據的規範條文 id，例如 sop-4.2',
          },
        },
        required: ['kind', 'message', 'citations'],
        additionalProperties: false,
      },
    },
  },
  required: ['riskLevel', 'summary', 'findings'],
  additionalProperties: false,
} as const

// system prompt：定義 AI 的角色與「不能做什麼」
// 重點是第 3、4 點：只能引用給定的條文，找不到依據就不要硬講
const SYSTEM_PROMPT = `你是企業內部的簽核預審助理，負責依據公司規範檢查申請單。

規則：
1. 只依據提供的規範條文判斷，不使用一般常識或外部知識補充規定。
2. 每一項 finding 都要附上依據的條文 id。
3. citations 只能填寫提供清單中出現的 id，絕對不能自行編造。
4. 如果某項疑慮在規範中找不到依據，不要列出。
5. 你只提供預審意見，最終決定由主管做出。
6. 使用繁體中文。`

function formatPolicies(policies: readonly PolicyChunk[]) {
  return policies.map((p) => `[${p.id}] 《${p.docTitle}》第 ${p.section} 條：${p.text}`).join('\n')
}

export function createClaudeReviewer(options: { apiKey: string; model: string }): Reviewer {
  const client = new Anthropic({ apiKey: options.apiKey })

  return {
    name: options.model,
    async review(input: ReviewInput, policies: readonly PolicyChunk[]): Promise<ReviewOutput> {
      const response = await client.messages.parse({
        model: options.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `## 規範條文\n${formatPolicies(policies)}\n\n## 申請單\n標題：${input.title}\n內容：${input.description || '（未填寫）'}`,
          },
        ],
        output_config: { format: jsonSchemaOutputFormat(REVIEW_SCHEMA) },
      })

      // 模型拒答或輸出被截斷時，內容可能不完整，一律視為失敗
      if (response.stop_reason !== 'end_turn' || !response.parsed_output) {
        throw new Error(`unexpected stop_reason: ${response.stop_reason}`)
      }
      return response.parsed_output as ReviewOutput
    },
  }
}
