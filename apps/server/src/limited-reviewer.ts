import type { Reviewer } from './reviewer'

// 有使用上限的審查員：公開 demo 用
//
// 公開網址誰都能打開，如果每次預審都呼叫 Claude，有人一直按就會產生費用
// 所以每天最多呼叫 dailyLimit 次，超過就改用模擬審查員；Claude 出錯時也一樣改用模擬審查員
// 對 demo 來說，「一定有結果」比「一定是真的 AI」重要
//
// 它本身也實作 Reviewer 介面，所以 service 完全不知道背後多了這一層（裝飾器模式）
export interface LimitedReviewer extends Reviewer {
  usage(): { used: number; limit: number }
}

export function createLimitedReviewer(
  primary: Reviewer,
  fallback: Reviewer,
  options: { dailyLimit: number; now?: () => Date },
): LimitedReviewer {
  const now = options.now ?? (() => new Date())
  // 用台灣時間決定「今天」：伺服器在國外時，UTC 的午夜是台灣早上八點
  const today = () => now().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

  let day = today()
  let used = 0

  // 換日就重新計算
  function roll() {
    const d = today()
    if (d !== day) {
      day = d
      used = 0
    }
  }

  return {
    name: primary.name,

    usage() {
      roll()
      return { used, limit: options.dailyLimit }
    },

    async review(input, policies, hooks) {
      roll()

      // 不把 signal 傳給備援：主要審查員逾時之後，備援要能正常跑完，而不是跟著被中止
      const runFallback = async (reason: string) => ({
        ...(await fallback.review(input, policies, { onFinding: hooks?.onFinding })),
        usedReviewer: `${fallback.name}（${reason}）`,
      })

      if (used >= options.dailyLimit) return runFallback('今日 AI 額度已用完')

      used++
      try {
        return await primary.review(input, policies, hooks)
      } catch {
        return runFallback('AI 暫時無法使用')
      }
    },
  }
}
