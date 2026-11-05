import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

// 錄 README 用的 demo 影片與截圖：pnpm demo:record
// 照著 demo 腳本操作一遍，每一步在畫面下方顯示字幕，看的人不用聽解說也懂在做什麼
// 輸出：docs/demo.webm（影片）、docs/screenshots/*.png（截圖）

const DOCS = fileURLToPath(new URL('../../docs/', import.meta.url))
const SAMPLE_PDF = fileURLToPath(new URL('../../apps/web/public/samples/travel-policy.pdf', import.meta.url))

// 每次載入頁面都先準備好字幕框；換頁之後要再呼叫一次 say() 把字放回去
const CAPTION_SCRIPT = () => {
  ;(window as unknown as { __caption: (t: string) => void }).__caption = (text: string) => {
    let el = document.getElementById('__caption')
    if (!el) {
      el = document.createElement('div')
      el.id = '__caption'
      el.style.cssText =
        // 寬度跟著字走、最多 90% 畫面寬：字幕盡量維持一行，不會在最後一個字斷行
        'position:fixed;left:0;right:0;bottom:28px;margin:0 auto;width:max-content;max-width:90vw;z-index:9999;' +
        'padding:12px 22px;border-radius:12px;background:rgba(17,24,39,.88);color:#fff;' +
        'font:500 20px/1.5 system-ui,"PingFang TC","Noto Sans TC",sans-serif;text-align:center;pointer-events:none'
      document.body.appendChild(el)
    }
    el.textContent = text
  }
}

let current = ''
async function say(page: Page, text: string, ms = 1800) {
  current = text
  await page.evaluate((t) => (window as unknown as { __caption: (t: string) => void }).__caption(t), text)
  await page.waitForTimeout(ms)
}
// 換頁之後字幕會消失，補回去
const resay = (page: Page) => page.evaluate((t) => (window as unknown as { __caption: (t: string) => void }).__caption(t), current)

async function switchUser(page: Page, id: string) {
  await page.getByLabel('目前身分').selectOption(id)
  await page.waitForTimeout(600)
}

const status = (page: Page) => page.getByTestId('status')
// README 的截圖不要字幕：字幕是給影片用的，放在截圖上只會擋住內容
async function shot(page: Page, name: string) {
  const caption = page.locator('#__caption')
  await caption.evaluate((el) => (el.style.visibility = 'hidden'))
  await page.screenshot({ path: `${DOCS}screenshots/${name}.png` })
  await caption.evaluate((el) => (el.style.visibility = 'visible'))
}

// 捲到某個區塊，讓它出現在畫面中間（預審意見在頁面下半部，不捲的話影片裡看不到）
const scrollTo = (page: Page, locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))

test('錄製 demo', async ({ page }) => {
  mkdirSync(`${DOCS}screenshots`, { recursive: true })
  await page.addInitScript(CAPTION_SCRIPT)
  // 錄影時不要出現試玩導覽卡片，畫面比較乾淨
  await page.addInitScript(() => localStorage.setItem('demo-guide-closed', '1'))

  // 1. 申請人送出一張資料不全的高壓維修單
  await page.goto('/')
  await switchUser(page, 'alice')
  await say(page, '申請人送出一張高壓設備維修單，故意漏填斷電紀錄與上鎖掛牌')
  await page.getByRole('button', { name: '高壓・資料不全' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '建立草稿' }).click()
  await expect(status(page)).toHaveText('草稿')
  await resay(page)
  await page.getByRole('button', { name: '送出', exact: true }).click()

  // 2. 串流預審：一送出就捲到預審區塊，才看得到意見一條一條長出來
  await say(page, '明確的規範交給規則判斷，模糊的判斷交給 AI，意見一條一條出現', 0)
  await scrollTo(page, page.getByRole('heading', { name: 'AI 預審', exact: true }))
  await expect(status(page)).toHaveText('待主管簽核', { timeout: 15_000 })
  await page.waitForTimeout(1500)

  // 3. 點引用
  await say(page, '每條意見都附條文依據，點一下，右邊的規範原文就會高亮', 600)
  await page.getByRole('button', { name: 'sop-4.2' }).first().click()
  await page.waitForTimeout(1500)
  await shot(page, 'review')
  await page.waitForTimeout(500)

  // 4. 主管：評價 AI、核准
  await switchUser(page, 'manager')
  await say(page, '切換成主管：AI 的意見可以標記有誤並寫下理由，最後由人決定', 600)
  const ai = page.locator('[data-testid="finding"][data-source="ai"]')
  await ai.getByRole('button', { name: '有誤' }).click()
  await ai.getByPlaceholder(/AI 錯在哪裡/).pressSequentially('一般報修，說明已足夠判斷', { delay: 40 })
  await ai.getByRole('button', { name: '送出' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '要求補件' }).click()
  await expect(status(page)).toHaveText('待補件')
  await page.waitForTimeout(1200)

  // 5. 兩層簽核：示範資料裡已經有一張停在「待廠長核准」的單
  await page.goto('/')
  await switchUser(page, 'director')
  await say(page, '超過金額門檻的單，主管核准後還要廠長核准；路線由規範自動決定')
  await page.getByRole('link', { name: /冷卻水塔風扇馬達汰換/ }).first().click()
  await resay(page)
  await page.waitForTimeout(1500)
  await shot(page, 'approval-route')
  await page.getByRole('button', { name: '核准' }).click()
  await expect(status(page)).toHaveText('已核准')
  await page.waitForTimeout(1500)

  // 6. AI 準確度
  await page.getByRole('link', { name: 'AI 準確度' }).click()
  await say(page, '主管的評價累積成指標：AI 哪一條規範最常判斷錯，下一步就改哪裡', 2500)
  await shot(page, 'insights')

  // 7. 匯入規範 PDF
  await page.getByRole('link', { name: '規範文件' }).click()
  await say(page, '匯入規範 PDF：自動切成條文，主管確認後才存進規範庫', 800)
  await page.getByLabel('用於哪一種申請單').selectOption('expense')
  await page.getByLabel('PDF 檔案').setInputFiles(SAMPLE_PDF)
  await page.getByRole('button', { name: '解析條文' }).click()
  await expect(page.getByTestId('article-row')).toHaveCount(8)
  await page.getByLabel('代碼').pressSequentially('trv', { delay: 80 })
  await page.waitForTimeout(800)
  await shot(page, 'import')
  await page.getByRole('button', { name: '儲存 8 條' }).click()
  await expect(page.getByTestId('import-success')).toBeVisible()
  await say(page, '之後預審時，只把跟這張單相關的條文交給 AI', 2500)

  // 存影片：要先關掉頁面，影片才會寫完
  await page.close()
  await page.video()!.saveAs(`${DOCS}demo.webm`)
})
