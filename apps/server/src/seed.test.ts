import { describe, expect, it } from 'vitest'
import { seedDemoData } from './seed'
import { createStore } from './store'

describe('示範資料', () => {
  it('各種狀態都有，而且不重複放', async () => {
    const store = createStore()
    const count = await seedDemoData(store)
    expect(count > 0).toBe(true)

    const statuses = new Set(store.listRequests().map((r) => r.status))
    for (const s of ['draft', 'pending_approval', 'needs_info', 'approved', 'rejected']) {
      expect(statuses.has(s as never)).toBe(true)
    }
    const types = new Set(store.listRequests().map((r) => r.formType))
    expect(types).toEqual(new Set(['maintenance', 'expense']))

    // 已經有資料就不再放
    expect(await seedDemoData(store)).toBe(0)
  })
})
