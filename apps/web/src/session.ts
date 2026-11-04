import { computed, ref } from 'vue'
import type { ActorRole } from '@ai-approval/shared'

export interface DemoUser {
  id: string
  name: string
  role: Exclude<ActorRole, 'system'>
}

// demo 用的假帳號：右上角一鍵切換，方便展示「同一張單在不同角色眼中長得不一樣」
export const DEMO_USERS: DemoUser[] = [
  { id: 'alice', name: 'Alice（申請人）', role: 'applicant' },
  { id: 'bob', name: 'Bob（申請人）', role: 'applicant' },
  { id: 'manager', name: '王經理（主管）', role: 'approver' },
]

const STORAGE_KEY = 'demo-user-id'

function loadUserId() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'alice'
  } catch {
    return 'alice'
  }
}

const currentUserId = ref(loadUserId())

export const currentUser = computed(
  () => DEMO_USERS.find((u) => u.id === currentUserId.value) ?? DEMO_USERS[0]!,
)

export function switchUser(id: string) {
  currentUserId.value = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {}
}
