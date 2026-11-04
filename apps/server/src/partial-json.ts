// 從「還沒收完」的 JSON 文字中，取出 findings 陣列裡已經完整的物件
//
// 為什麼需要這個？模型是一個字一個字吐出 JSON 的，收到一半時長這樣：
//   {"findings":[{"kind":"missing","message":"未載明設備編號","citations":["sop-3.1"]},{"kind":"ri
// 這時候 JSON.parse 整段一定會失敗，但第一個 finding 其實已經完整了，可以先顯示
//
// 做法：從 "findings":[ 開始逐字掃描，用大括號的「深度」判斷一個物件何時結束
// 要特別小心字串內容：message 裡如果出現 { } 或 \"，不能被當成結構
export function extractCompletedFindings(partial: string): unknown[] {
  const key = partial.indexOf('"findings"')
  if (key === -1) return []
  const arrayStart = partial.indexOf('[', key)
  if (arrayStart === -1) return []

  const results: unknown[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let objectStart = -1

  for (let i = arrayStart + 1; i < partial.length; i++) {
    const ch = partial[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      if (depth === 0) objectStart = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && objectStart !== -1) {
        try {
          results.push(JSON.parse(partial.slice(objectStart, i + 1)))
        } catch {
          // 理論上不會發生；萬一真的壞掉就跳過這一個
        }
        objectStart = -1
      }
    } else if (ch === ']' && depth === 0) {
      break // findings 陣列結束
    }
  }

  return results
}
