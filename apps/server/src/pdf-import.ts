import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// 規範文件匯入：PDF → 一行一行的文字 → 一條一條的條文
//
// 分成兩步，而且第二步不碰 PDF：
// 1. extractPdfLines：從 PDF 取出文字。這一步依賴 pdfjs，只能用真的 PDF 測
// 2. splitIntoArticles：把文字切成條文。純字串處理，用各種寫法的文字就能測得很完整
// 切出來的結果只是「建議」，主管在畫面上確認、修改之後才會存進規範庫

// pdfjs 的中文字型對照表（cMaps）跟標準字型放在套件裡，要告訴它去哪裡找
// 沒有 cMaps 的話，很多中文 PDF 抽出來會是亂碼或空白
const PDFJS_DIR = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

export class InvalidPdfError extends Error {}

// 安全：PDF 是使用者上傳的，不能信任
// - 只抽文字、不渲染畫面，碰到的 pdfjs 功能越少越好
// - pdfjs 要保持更新：舊版曾有惡意字型可以執行程式碼的漏洞（CVE-2024-4367）
// - 檔案大小在 API 那一層就限制住了
export async function extractPdfLines(data: Uint8Array): Promise<{ lines: string[]; pages: number }> {
  const task = getDocument({
    data,
    cMapUrl: join(PDFJS_DIR, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(PDFJS_DIR, 'standard_fonts') + '/',
    useSystemFonts: false,
    verbosity: 0, // 只記錯誤：壞掉的 PDF 會讓 pdfjs 印一堆警告到伺服器的 log
  })
  let pdf
  try {
    pdf = await task.promise
  } catch (err) {
    await task.destroy()
    throw new InvalidPdfError(err instanceof Error ? err.message : String(err))
  }

  const lines: string[] = []
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()

      // PDF 裡沒有「行」的概念，只有一塊一塊放在座標上的文字
      // 同一個 y 座標（容許一點誤差）的文字就是同一行；hasEOL 表示這塊文字後面換行
      let current = ''
      let lastY: number | null = null
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5] as number
        if (lastY !== null && Math.abs(y - lastY) > 2 && current.trim()) {
          lines.push(current)
          current = ''
        }
        current += item.str
        lastY = y
        if (item.hasEOL) {
          lines.push(current)
          current = ''
          lastY = null
        }
      }
      if (current.trim()) lines.push(current)
      page.cleanup()
    }
    return { lines: lines.map(normalizeLine).filter((l) => l !== ''), pages: pdf.numPages }
  } finally {
    await task.destroy()
  }
}

// 全形數字轉半形、全形空白與連續空白合併
function normalizeLine(line: string) {
  return line
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, ' ')
    .trim()
}

// ===== 切條文 =====

export interface ArticleDraft {
  section: string // 條號，例如「3」「4.2」
  text: string
}

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

// 中文數字轉阿拉伯數字（規範的條號用得到的範圍：1～99）
export function chineseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? CN_DIGIT[m[1]]! : 1) * 10 + (m[2] ? CN_DIGIT[m[2]]! : 0)
  if (s.length === 1 && s in CN_DIGIT) return CN_DIGIT[s]!
  return null
}

// 條號的三種常見寫法：「第 3 條」「第十二條」、「3.2」「4.2.1」、「一、」
// 只認行首的：句子中間提到「依第 5 條規定」不算新的一條
const HEADINGS: { re: RegExp; section: (m: RegExpMatchArray) => string | null }[] = [
  {
    re: /^第\s*([0-9一二三四五六七八九十兩零〇]+)\s*條[\s:：、.]*(.*)$/,
    section: (m) => chineseNumber(m[1]!)?.toString() ?? null,
  },
  { re: /^(\d+(?:\.\d+)+)[\s、.:：]*(.*)$/, section: (m) => m[1]! },
  { re: /^([一二三四五六七八九十]+)、\s*(.*)$/, section: (m) => chineseNumber(m[1]!)?.toString() ?? null },
]

function matchHeading(line: string) {
  for (const h of HEADINGS) {
    const m = line.match(h.re)
    const section = m && h.section(m)
    if (m && section) return { section, rest: m[2] ?? '' }
  }
  return null
}

// PDF 的換行是排版造成的，不是語意：中文直接接起來，英文單字之間補一個空白
function joinWrapped(a: string, b: string) {
  if (!a) return b
  return /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b
}

const MAX_CHUNK = 300

// 找不到條號時的備案：依句號切成一段一段，每段不超過 MAX_CHUNK 字
function splitBySentence(text: string): ArticleDraft[] {
  const sentences = text.match(/[^。！？]+[。！？]?/g) ?? []
  const chunks: string[] = []
  let current = ''
  for (const s of sentences) {
    if (current && current.length + s.length > MAX_CHUNK) {
      chunks.push(current)
      current = ''
    }
    current += s
  }
  if (current.trim()) chunks.push(current)
  return chunks.map((text, i) => ({ section: `p${i + 1}`, text: text.trim() }))
}

export function splitIntoArticles(lines: string[]): { title: string; articles: ArticleDraft[] } {
  const preamble: string[] = []
  const articles: ArticleDraft[] = []

  for (const line of lines) {
    const heading = matchHeading(line)
    if (heading) {
      articles.push({ section: heading.section, text: heading.rest })
    } else if (articles.length > 0) {
      const last = articles[articles.length - 1]!
      last.text = joinWrapped(last.text, line)
    } else {
      preamble.push(line)
    }
  }

  // 標題：第一條之前的第一行（通常就是文件名稱）
  const title = preamble[0] ?? ''

  // 條號太少，多半是這份文件不是用條號寫的，改成依句子切
  if (articles.length < 2) {
    return { title, articles: splitBySentence(lines.slice(title ? 1 : 0).reduce(joinWrapped, '')) }
  }

  // 同一個條號出現兩次（例如目錄跟內文都有），留後面那個，前面通常是目錄
  const bySection = new Map<string, ArticleDraft>()
  for (const a of articles) if (a.text.trim()) bySection.set(a.section, { section: a.section, text: a.text.trim() })
  return { title, articles: [...bySection.values()] }
}
