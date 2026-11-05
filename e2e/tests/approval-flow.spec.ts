import { expect, test, type Page } from '@playwright/test'

// E2E 測試：用真的瀏覽器、真的前後端，照使用者的操作方式跑一遍
// 單元測試確認「每個零件」是對的，E2E 確認「零件組起來」也是對的

type UserId = 'alice' | 'bob' | 'manager' | 'director'

async function switchUser(page: Page, id: UserId) {
  await page.getByLabel('目前身分').selectOption(id)
}

const status = (page: Page) => page.getByTestId('status')
const findings = (page: Page, source?: 'rule' | 'ai') =>
  page.locator(source ? `[data-testid="finding"][data-source="${source}"]` : '[data-testid="finding"]')

// 用範例資料建立一張申請單並送出，等 AI 預審跑完
async function createAndSubmit(page: Page, sample: string) {
  await page.goto('/')
  await switchUser(page, 'alice')
  await page.getByRole('button', { name: sample }).click()
  await page.getByRole('button', { name: '建立草稿' }).click()
  await expect(status(page)).toHaveText('草稿')

  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(status(page)).toHaveText('待主管簽核')
}

test('表單驗證：必填欄位擋下送出，高壓區塊依電壓出現', async ({ page }) => {
  await page.goto('/')
  await switchUser(page, 'alice')

  await page.getByRole('button', { name: '建立草稿' }).click()
  await expect(page.getByText('請填寫標題')).toBeVisible()
  await expect(page.getByText('請填寫設備編號')).toBeVisible()

  // 低壓時看不到高壓作業區塊；改成 480V 就出現，即時檢查也跟著提示
  await expect(page.getByText('高壓作業安全')).toHaveCount(0)
  await page.getByLabel('額定電壓').fill('480')
  await expect(page.getByText('高壓作業安全')).toBeVisible()
  await expect(page.getByText(/須附斷電確認紀錄/)).toBeVisible()
})

test('AI 預審：規則與 AI 的意見分開標示，點引用會高亮規範原文', async ({ page }) => {
  await createAndSubmit(page, '高壓・資料不全')

  await expect(findings(page)).toHaveCount(3)
  await expect(findings(page, 'rule')).toHaveCount(2)
  await expect(findings(page, 'ai')).toHaveCount(1)
  await expect(page.getByText('高風險')).toBeVisible()

  await page.getByRole('button', { name: 'sop-4.2' }).click()
  await expect(page.getByTestId('policy-sop-4.2')).toHaveClass(/bg-highlight/)
})

test('完整流程：評價 AI → 要求補件 → 申請人修改重送 → 核准', async ({ page }) => {
  await createAndSubmit(page, '高壓・資料不全')

  // 主管：標記 AI 的意見有誤，再要求補件
  await switchUser(page, 'manager')
  const aiFinding = findings(page, 'ai')
  await aiFinding.getByRole('button', { name: '有誤' }).click()
  await aiFinding.getByPlaceholder(/AI 錯在哪裡/).fill('說明雖短，但已足以判斷問題')
  await aiFinding.getByRole('button', { name: '送出' }).click()
  await expect(aiFinding.getByText('manager 標記為有誤')).toBeVisible()

  // 規則的意見不能評價：結果是程式判斷的，沒有對錯可言
  await expect(findings(page, 'rule').getByRole('button', { name: '有誤' })).toHaveCount(0)

  await page.getByRole('button', { name: '要求補件' }).click()
  await expect(status(page)).toHaveText('待補件')

  // 申請人：補上斷電紀錄與 LOTO，再重送
  await switchUser(page, 'alice')
  await page.getByRole('button', { name: '修改內容' }).click()
  await page.getByLabel('斷電執行人員').fill('電氣課 陳工程師')
  await page.getByLabel('斷電完成時間').fill('2026-11-04T09:00')
  await page.getByLabel(/上鎖掛牌/).check()
  await page.getByRole('button', { name: '儲存' }).click()

  await page.getByRole('button', { name: '補件重送' }).click()
  await expect(status(page)).toHaveText('待主管簽核')
  await expect(page.getByText('第 2 版')).toBeVisible() // 補件重送後版本號 +1

  // 規則的兩條問題都補齊了，只剩 AI 對說明的意見
  await expect(findings(page, 'rule')).toHaveCount(0)
  await expect(findings(page, 'ai')).toHaveCount(1)

  // 主管核准
  await switchUser(page, 'manager')
  await page.getByRole('button', { name: '核准' }).click()
  await expect(status(page)).toHaveText('已核准')

  // 簽核紀錄完整留下每一步
  for (const step of ['建立', '送出', 'AI 預審完成', '要求補件', '修改內容', '補件重送', '核准']) {
    await expect(page.getByRole('listitem').filter({ hasText: step }).first()).toBeVisible()
  }
})

test('權限：別人的申請單看得到，但不能操作', async ({ page }) => {
  await page.goto('/')
  await switchUser(page, 'alice')
  await page.getByRole('button', { name: '低壓・說明簡略' }).click()
  await page.getByRole('button', { name: '建立草稿' }).click()
  await expect(status(page)).toHaveText('草稿')

  await switchUser(page, 'bob')
  await expect(status(page)).toHaveText('草稿')
  await expect(page.getByRole('button', { name: '送出', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '修改內容' })).toHaveCount(0)
})

test('第二種申請單：費用報銷用自己的表單、規則與規範文件', async ({ page }) => {
  await page.goto('/')
  await switchUser(page, 'alice')
  await page.getByRole('tab', { name: '費用報銷申請' }).click()

  // 表單換成報銷單的欄位；選業務招待費才出現招待對象區塊
  await expect(page.getByLabel('報銷事由')).toBeVisible()
  await expect(page.getByLabel('設備編號')).toHaveCount(0)
  await page.getByLabel('費用類別').selectOption('業務招待費')
  await expect(page.getByText('招待對象', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '招待超標・事由簡略' }).click()
  await page.getByRole('button', { name: '建立草稿' }).click()
  await expect(status(page)).toHaveText('草稿')
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(status(page)).toHaveText('待主管簽核')

  // 規則：每人超過 2,000 元；AI：事由太籠統
  await expect(findings(page, 'rule')).toHaveCount(1)
  await expect(findings(page, 'ai')).toHaveCount(1)
  await expect(findings(page, 'rule')).toContainText('每人平均 3,000 元')

  // 規範面板顯示的是報銷辦法，不是設備維修規範
  await expect(page.getByRole('heading', { name: '費用報銷作業辦法' })).toBeVisible()
  await page.getByRole('button', { name: 'fin-5.1' }).click()
  await expect(page.getByTestId('policy-fin-5.1')).toHaveClass(/bg-highlight/)
  await expect(page.getByTestId('policy-sop-4.2')).toHaveCount(0)
})

test('清單：主管預設看到待我簽核，附風險等級與等待時間', async ({ page }) => {
  await createAndSubmit(page, '高壓・資料不全')

  await switchUser(page, 'manager')
  await page.goto('/')

  // 主管不會看到新增申請的表單
  await expect(page.getByRole('heading', { name: '新增申請' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /待我簽核/ })).toHaveAttribute('aria-pressed', 'true')

  const row = page.getByRole('link', { name: /3 號產線高壓馬達維修/ }).first()
  await expect(row).toContainText('高風險')
  await expect(row).toContainText('已等待')

  // 篩選成費用報銷：這張設備維修單就不會出現
  await page.getByLabel('申請類型').selectOption('expense')
  await expect(page.getByRole('link', { name: /3 號產線高壓馬達維修/ })).toHaveCount(0)
})

test('多層級簽核：超過門檻時，主管核准後還要廠長核准', async ({ page }) => {
  await page.goto('/')
  await switchUser(page, 'alice')
  await page.getByRole('tab', { name: '費用報銷申請' }).click()
  await page.getByRole('button', { name: '大額・需廠長核准' }).click()
  // 填單時就看得到：規則提醒這張要廠長核准
  await expect(page.getByText(/須另經廠長核准/)).toBeVisible()
  await page.getByRole('button', { name: '建立草稿' }).click()

  // 簽核路線多了「廠長核准」這一關
  const route = page.getByRole('list', { name: '簽核路線' })
  await expect(route.locator('[data-step="director"]')).toBeVisible()

  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(status(page)).toHaveText('待主管簽核')

  // 主管核准 → 不是結案，而是送到廠長
  await switchUser(page, 'manager')
  await page.getByRole('button', { name: '核准' }).click()
  await expect(status(page)).toHaveText('待廠長核准')
  await expect(route.locator('[data-step="director"]')).toHaveAttribute('data-state', 'current')
  // 主管不能把第二關也簽掉
  await expect(page.getByRole('button', { name: '核准' })).toHaveCount(0)

  // 廠長的「待我簽核」裡有這張單
  await switchUser(page, 'director')
  await page.goto('/')
  await page.getByRole('link', { name: /年度客戶答謝餐會/ }).first().click()
  await page.getByRole('button', { name: '核准' }).click()
  await expect(status(page)).toHaveText('已核准')
  await expect(route.locator('[data-step="done"]')).toHaveAttribute('data-state', 'done')
})

test('多層級簽核：未超過門檻時，簽核路線沒有廠長', async ({ page }) => {
  await page.goto('/')
  await switchUser(page, 'alice')
  await page.getByRole('button', { name: '低壓・說明簡略' }).click()
  await page.getByRole('button', { name: '建立草稿' }).click()
  await expect(status(page)).toHaveText('草稿')
  await expect(page.getByRole('list', { name: '簽核路線' }).locator('[data-step="director"]')).toHaveCount(0)
})

test('AI 準確度：主管的評價累積成統計，申請人看不到', async ({ page }) => {
  await createAndSubmit(page, '高壓・資料不全')

  // 主管把 AI 的意見標記為有誤
  await switchUser(page, 'manager')
  const aiFinding = findings(page, 'ai')
  await aiFinding.getByRole('button', { name: '有誤' }).click()
  await aiFinding.getByPlaceholder(/AI 錯在哪裡/).fill('一般報修，說明已經足夠')
  await aiFinding.getByRole('button', { name: '送出' }).click()
  await expect(aiFinding.getByText('manager 標記為有誤')).toBeVisible()

  await page.getByRole('link', { name: 'AI 準確度' }).click()
  // 所有 E2E 測試共用同一個後端，前面的測試可能也標記過有誤，所以不檢查確切數字
  await expect(page.getByTestId('kpi-被標記有誤')).toBeVisible()
  // 最常出錯的條文，以及主管剛剛寫的理由
  await expect(page.getByTestId('worst-policy')).toContainText('sop-3.2')
  await expect(page.getByTestId('incorrect-item').filter({ hasText: '一般報修，說明已經足夠' })).toBeVisible()
  // 兩張圖都有畫出來
  await expect(page.getByRole('img', { name: /每日 AI 意見數/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /各條文的 AI 意見數/ })).toBeVisible()

  // 申請人：看不到入口，直接打網址也看不到資料
  await switchUser(page, 'alice')
  await expect(page.getByRole('link', { name: 'AI 準確度' })).toHaveCount(0)
  await expect(page.getByText('只有簽核者可以查看')).toBeVisible()
})
