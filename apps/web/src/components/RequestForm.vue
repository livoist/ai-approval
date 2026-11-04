<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  defaultValues,
  getFormKind,
  normalizeValues,
  runRules,
  validateValues,
  type FormType,
  type FormValues,
} from '@ai-approval/shared'
import { SAMPLE_REQUESTS, type SampleRequest } from '../samples'
import DynamicForm from './DynamicForm.vue'

// 申請單表單：建立和修改共用同一個元件，也不管是哪一種申請單
// 1. 標題 + 動態表單
// 2. 邊填邊跑規則引擎，即時告訴申請人「這樣送出會被標記什麼」
// 3. 前端先驗證一次（跟後端同一套規則），後端回傳的錯誤也顯示在對應欄位

const props = defineProps<{
  formType: FormType
  initialTitle?: string
  initialFields?: FormValues
  submitLabel: string
  busy: boolean
  serverErrors?: Record<string, string>
  showSamples?: boolean
}>()

const emit = defineEmits<{
  submit: [title: string, fields: FormValues]
  cancel: []
}>()

// 切換申請單類型時，父元件會用 :key 重建這個元件，所以這裡讀一次就好
const def = getFormKind(props.formType).def
const title = ref(props.initialTitle ?? '')
const values = ref<FormValues>({ ...defaultValues(def), ...props.initialFields })
const samples = SAMPLE_REQUESTS.filter((s) => s.formType === props.formType)

// 按過送出之後才顯示前端驗證的紅字：一打開表單就滿滿紅字，體驗很差
const attempted = ref(false)

const clientErrors = computed(() => {
  const errors = validateValues(def, values.value)
  if (title.value.trim() === '') errors.title = '請填寫標題'
  return errors
})

const shownErrors = computed(() => ({
  ...props.serverErrors,
  ...(attempted.value ? clientErrors.value : {}),
}))

// 即時規範檢查：跟後端預審用的是同一個 runRules
const hints = computed(() => runRules(props.formType, normalizeValues(def, values.value)))

const HINT_KIND = {
  missing: { label: '缺漏', class: 'text-danger' },
  risk: { label: '風險', class: 'text-warning' },
  notice: { label: '提醒', class: 'text-accent' },
  ok: { label: '符合', class: 'text-ok' },
} as const

function fillSample(sample: SampleRequest) {
  title.value = sample.title
  values.value = { ...defaultValues(def), ...sample.fields }
  attempted.value = false
}

function submit() {
  attempted.value = true
  if (Object.keys(clientErrors.value).length > 0) return
  emit('submit', title.value.trim(), values.value)
}
</script>

<template>
  <form class="grid gap-5" novalidate @submit.prevent="submit">
    <div v-if="showSamples" class="rounded-lg bg-bg p-3">
      <p class="mb-2 text-xs text-muted">帶入範例資料（測試用）</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="s in samples"
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

    <div class="grid gap-1 text-sm">
      <label for="title">標題 <span class="text-danger">*</span></label>
      <input id="title" v-model="title" class="field" :placeholder="`${def.title}的標題`" />
      <p v-if="shownErrors.title" class="text-xs text-danger">{{ shownErrors.title }}</p>
    </div>

    <DynamicForm v-model="values" :def="def" :errors="shownErrors" />

    <!-- 邊填邊提示：送出前就知道會被標記什麼，可以先補齊 -->
    <div class="rounded-lg border border-dashed p-3 text-sm">
      <p class="mb-1 text-xs font-semibold text-muted">即時規範檢查</p>
      <p v-if="hints.length === 0" class="text-xs text-ok">目前沒有違反明確規範的項目。</p>
      <ul v-else class="grid gap-1">
        <li v-for="h in hints" :key="h.message" class="text-xs">
          <span class="mr-1 font-semibold" :class="HINT_KIND[h.kind].class">
            {{ HINT_KIND[h.kind].label }}
          </span>
          {{ h.message }}
        </li>
      </ul>
      <p class="mt-2 text-xs text-muted">送出後，AI 會再檢查說明是否具體、內容前後是否一致。</p>
    </div>

    <div class="flex justify-end gap-2">
      <button v-if="initialTitle !== undefined" type="button" class="btn" @click="emit('cancel')">
        取消
      </button>
      <button class="btn btn-primary" :disabled="busy">{{ submitLabel }}</button>
    </div>
  </form>
</template>
