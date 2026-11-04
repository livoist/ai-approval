<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FormValues } from '@ai-approval/shared'
import { ApiError, api } from '../api'
import RequestForm from '../components/RequestForm.vue'
import { ERROR_LABEL, STATUS_LABEL } from '../labels'
import { currentUser } from '../session'
import type { ApprovalRequest } from '../types'

const router = useRouter()
const requests = ref<ApprovalRequest[]>([])
const creating = ref(false)
const error = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

async function load() {
  const all = await api.listRequests()
  requests.value = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function create(title: string, fields: FormValues) {
  creating.value = true
  error.value = null
  serverErrors.value = {}
  try {
    const r = await api.createRequest({ title, fields })
    router.push(`/requests/${r.id}`)
  } catch (e) {
    // 後端的欄位錯誤，交給表單顯示在對應的欄位下
    if (e instanceof ApiError) {
      serverErrors.value = e.fieldErrors
      error.value = ERROR_LABEL[e.reason] ?? e.message
    } else {
      error.value = String(e)
    }
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <!-- 手機一欄；寬度 ≥ 1024px（lg 斷點）時左邊固定 440px、右邊吃滿 -->
  <div class="grid items-start gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
    <section v-if="currentUser.role === 'applicant'" class="card">
      <h2 class="mb-4 text-lg font-semibold">新增設備維修申請</h2>
      <RequestForm
        submit-label="建立草稿"
        show-samples
        :busy="creating"
        :server-errors="serverErrors"
        @submit="create"
      />
      <p v-if="error" class="mt-3 text-sm text-danger">{{ error }}</p>
    </section>

    <section class="card">
      <h2 class="mb-2 text-lg font-semibold">申請單</h2>
      <p v-if="requests.length === 0" class="text-muted">目前沒有申請單。</p>
      <ul>
        <li v-for="r in requests" :key="r.id">
          <RouterLink
            :to="`/requests/${r.id}`"
            class="group grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b py-3"
          >
            <span>
              <span class="group-hover:text-accent">{{ r.title }}</span>
              <span v-if="r.fields.equipmentId" class="ml-2 text-xs text-muted">
                {{ r.fields.equipmentId }}
              </span>
            </span>
            <span class="text-muted">{{ r.applicantId }}</span>
            <span class="badge">{{ STATUS_LABEL[r.status] }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
