<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FORM_TYPES, getFormKind, type FormType, type FormValues } from '@ai-approval/shared'
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

// 要建立哪一種申請單：清單來自 shared 的 FORM_TYPES
// 之後新增第三種申請單，這裡會自動多一個分頁，不用改這個檔案
const formType = ref<FormType>('maintenance')
const formTitle = (type: FormType) => getFormKind(type).def.title

function selectFormType(type: FormType) {
  formType.value = type
  error.value = null
  serverErrors.value = {}
}

async function load() {
  const all = await api.listRequests()
  requests.value = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function create(title: string, fields: FormValues) {
  creating.value = true
  error.value = null
  serverErrors.value = {}
  try {
    const r = await api.createRequest({ formType: formType.value, title, fields })
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
      <h2 class="mb-3 text-lg font-semibold">新增申請</h2>

      <div role="tablist" class="mb-4 flex gap-1 rounded-lg bg-bg p-1">
        <button
          v-for="type in FORM_TYPES"
          :key="type"
          role="tab"
          type="button"
          class="flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm"
          :class="type === formType ? 'bg-surface font-semibold shadow-sm' : 'text-muted'"
          :aria-selected="type === formType"
          @click="selectFormType(type)"
        >
          {{ formTitle(type) }}
        </button>
      </div>

      <!-- :key 讓切換類型時整個表單重建，上一種單填到一半的內容不會殘留 -->
      <RequestForm
        :key="formType"
        :form-type="formType"
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
            class="group grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-b py-3"
          >
            <span class="rounded border px-1.5 text-xs text-muted">{{ formTitle(r.formType) }}</span>
            <span class="group-hover:text-accent">{{ r.title }}</span>
            <span class="text-muted">{{ r.applicantId }}</span>
            <span class="badge">{{ STATUS_LABEL[r.status] }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
