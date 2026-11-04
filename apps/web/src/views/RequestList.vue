<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { STATUS_LABEL } from '../labels'
import { SAMPLE_REQUESTS, type SampleRequest } from '../samples'
import { currentUser } from '../session'
import type { ApprovalRequest } from '../types'

const router = useRouter()
const requests = ref<ApprovalRequest[]>([])
const title = ref('')
const description = ref('')
const creating = ref(false)

async function load() {
  const all = await api.listRequests()
  requests.value = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function create() {
  if (!title.value.trim()) return
  creating.value = true
  try {
    const r = await api.createRequest({ title: title.value, description: description.value })
    router.push(`/requests/${r.id}`)
  } finally {
    creating.value = false
  }
}

function fillSample(sample: SampleRequest) {
  title.value = sample.title
  description.value = sample.description
}

onMounted(load)
</script>

<template>
  <!-- 手機一欄；寬度 ≥ 1024px（lg 斷點）時左邊固定 380px、右邊吃滿 -->
  <div class="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
    <section v-if="currentUser.role === 'applicant'" class="card">
      <h2 class="mb-4 text-lg font-semibold">新增維修申請</h2>

      <div class="mb-4 rounded-lg bg-bg p-3">
        <p class="mb-2 text-xs text-muted">帶入範例資料（測試用）</p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="s in SAMPLE_REQUESTS"
            :key="s.label"
            type="button"
            class="btn px-2.5 py-1 text-xs"
            :title="`預期結果：${s.expect}`"
            @click="fillSample(s)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <form class="grid gap-3" @submit.prevent="create">
        <label class="grid gap-1 text-sm">
          標題
          <input v-model="title" class="field" placeholder="例如：3 號產線高壓馬達維修" />
        </label>
        <label class="grid gap-1 text-sm">
          說明
          <textarea
            v-model="description"
            class="field"
            rows="5"
            placeholder="設備名稱與編號、故障現象、是否已斷電……"
          />
        </label>
        <button class="btn btn-primary" :disabled="creating || !title.trim()">建立草稿</button>
      </form>
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
            <span class="group-hover:text-accent">{{ r.title }}</span>
            <span class="text-muted">{{ r.applicantId }}</span>
            <span class="badge">{{ STATUS_LABEL[r.status] }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
