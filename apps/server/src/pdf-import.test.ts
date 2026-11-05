import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chineseNumber, extractPdfLines, InvalidPdfError, splitIntoArticles } from './pdf-import'

describe('中文數字', () => {
  it('條號用得到的範圍', () => {
    expect(chineseNumber('三')).toBe(3)
    expect(chineseNumber('十')).toBe(10)
    expect(chineseNumber('十二')).toBe(12)
    expect(chineseNumber('二十')).toBe(20)
    expect(chineseNumber('三十五')).toBe(35)
    expect(chineseNumber('12')).toBe(12)
    expect(chineseNumber('百')).toBe(null)
  })
})

describe('切條文', () => {
  it('依「第 X 條」切開，被排版換行切斷的句子接回去', () => {
    const result = splitIntoArticles([
      '國內出差管理辦法',
      '示範用規範文件',
      '第 1 條 本辦法適用於國內出差之申請，以及交通、住宿與膳',
      '雜費用之報支。',
      '第二條：出差應事先填具出差申請。',
      '第十二條 依第 1 條規定辦理。', // 句子中間提到「第 1 條」不算新的一條
    ])
    expect(result.title).toBe('國內出差管理辦法')
    expect(result.articles).toEqual([
      { section: '1', text: '本辦法適用於國內出差之申請，以及交通、住宿與膳雜費用之報支。' },
      { section: '2', text: '出差應事先填具出差申請。' },
      { section: '12', text: '依第 1 條規定辦理。' },
    ])
  })

  it('「4.2」與「一、」的寫法也認得', () => {
    expect(splitIntoArticles(['規範', '4.1 高壓設備須斷電', '4.2 須附斷電紀錄']).articles.map((a) => a.section)).toEqual(['4.1', '4.2'])
    expect(splitIntoArticles(['規範', '一、不得外流', '二、離職繳回']).articles.map((a) => a.section)).toEqual(['1', '2'])
  })

  it('英文換行時補空白，中文不補', () => {
    const { articles } = splitIntoArticles(['T', '第 1 條 Use the VPN', 'when working remotely', '第 2 條 中文', '接著'])
    expect(articles.map((a) => a.text)).toEqual(['Use the VPN when working remotely', '中文接著'])
  })

  it('同一個條號出現兩次（目錄 + 內文），留下內文', () => {
    const { articles } = splitIntoArticles(['目錄', '第 1 條 總則', '第 2 條 申請', '第 1 條 本辦法適用於全體員工。', '第 2 條 應事先申請。'])
    expect(articles).toEqual([
      { section: '1', text: '本辦法適用於全體員工。' },
      { section: '2', text: '應事先申請。' },
    ])
  })

  it('找不到條號時，依句子切成段落', () => {
    const { title, articles } = splitIntoArticles(['資訊安全須知', '員工不得將公司資料存放於私人雲端。離職時應繳回設備。'])
    expect(title).toBe('資訊安全須知')
    expect(articles).toEqual([{ section: 'p1', text: '員工不得將公司資料存放於私人雲端。離職時應繳回設備。' }])
  })
})

describe('從 PDF 取出文字', () => {
  // 前端提供下載的範例檔，同時也是這裡的測試資料：範例檔壞掉，測試就會發現
  const SAMPLE = new URL('../../web/public/samples/travel-policy.pdf', import.meta.url)

  it('範例 PDF 解析出標題與 8 條條文', async () => {
    const { lines, pages } = await extractPdfLines(new Uint8Array(readFileSync(SAMPLE)))
    expect(pages).toBe(1)
    const { title, articles } = splitIntoArticles(lines)
    expect(title).toBe('國內出差管理辦法')
    expect(articles.map((a) => a.section)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(articles[2]!.text).toContain('搭乘高鐵以標準車廂為限')
  })

  it('不是 PDF 的檔案 → InvalidPdfError', async () => {
    await expect(extractPdfLines(new TextEncoder().encode('%PDF-1.7 broken'))).rejects.toThrow(InvalidPdfError)
  })
})
