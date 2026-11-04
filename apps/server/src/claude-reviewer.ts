import Anthropic from '@anthropic-ai/sdk'
import { extractCompletedFindings } from './partial-json'
import type { PolicyChunk } from './policies'
import type { AiFinding, ReviewHooks, ReviewInput, ReviewOutput, Reviewer } from './reviewer'

// 要求模型輸出的 JSON 結構（Structured Outputs）
// 注意 findings 放在最前面：模型會照這個順序輸出，
// 先吐出一條一條的意見（可以邊收邊顯示），最後才下結論給風險等級和摘要
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
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
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: { type: 'string', description: '一到兩句話的預審摘要' },
  },
  required: ['findings', 'riskLevel', 'summary'],
  additionalProperties: false,
}

// system prompt：定義 AI 的角色與「不能做什麼」
// 重點是第 3、4 點：只能引用給定的條文，找不到依據就不要硬講
const SYSTEM_PROMPT = `你是企業內部的簽核預審助理，負責依據公司規範檢查申請單。

明確的規範（例如電壓門檻、金額門檻、必附文件）已經由系統的規則引擎檢查過，結果會一併提供。
你的工作是規則引擎做不到的判斷，例如：
- 申請人的說明（故障說明、報銷事由等）是否具體、足以讓審核者判斷
- 填寫內容是否前後矛盾（例如說明裡提到的狀況與欄位不符）
- 其他依規範需要人工判讀的疑慮

規則：
1. 只依據提供的規範條文判斷，不使用一般常識或外部知識補充規定。
2. 不要重複規則引擎已經列出的問題。
3. 每一項 finding 都要附上依據的條文 id，citations 只能填寫提供清單中出現的 id，絕對不能自行編造。
4. 如果某項疑慮在規範中找不到依據，不要列出；沒有問題時 findings 可以是空陣列。
5. riskLevel 只評估你自己找到的問題。
6. 你只提供預審意見，最終決定由主管做出。
7. 使用繁體中文。`

function formatPolicies(policies: readonly PolicyChunk[]) {
  return policies.map((p) => `[${p.id}] 《${p.docTitle}》第 ${p.section} 條：${p.text}`).join('\n')
}

export function createClaudeReviewer(options: { apiKey: string; model: string }): Reviewer {
  const client = new Anthropic({ apiKey: options.apiKey })

  return {
    name: options.model,
    async review(
      input: ReviewInput,
      policies: readonly PolicyChunk[],
      hooks?: ReviewHooks,
    ): Promise<ReviewOutput> {
      // 用 stream 取代 create：模型每產生一小段文字，我們就收到一次
      const stream = client.messages.stream(
        {
          model: options.model,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                `## 規範條文\n${formatPolicies(policies)}`,
                `## 申請單（${input.formTitle}）\n標題：${input.title}\n${input.details.map((d) => `${d.label}：${d.value}`).join('\n')}`,
                `## 規則引擎已檢查出的問題\n${
                  input.ruleFindings.length === 0
                    ? '（無）'
                    : input.ruleFindings.map((f) => `- [${f.citations.join(', ')}] ${f.message}`).join('\n')
                }`,
              ].join('\n\n'),
            },
          ],
          output_config: { format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
        },
        { signal: hooks?.signal },
      )

      // 每收到一段文字，就檢查「到目前為止」完整的 finding 有幾個，新的就往外送
      let emitted = 0
      stream.on('text', (_delta, snapshot) => {
        const found = extractCompletedFindings(snapshot) as AiFinding[]
        for (; emitted < found.length; emitted++) {
          hooks?.onFinding?.(found[emitted]!)
        }
      })

      const message = await stream.finalMessage()

      // 模型拒答或輸出被截斷時，內容可能不完整，一律視為失敗
      if (message.stop_reason !== 'end_turn') {
        throw new Error(`unexpected stop_reason: ${message.stop_reason}`)
      }
      const text = message.content.find((b) => b.type === 'text')
      if (!text || text.type !== 'text') throw new Error('empty response')
      return JSON.parse(text.text) as ReviewOutput
    },
  }
}
