<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FORM_TYPES, getFormKind, isApproverRole, type FormType } from '@ai-approval/shared'
import { ApiError, api } from '../api'
import { ERROR_LABEL } from '../labels'
import { currentUser } from '../session'
import { formatDateTime } from '../time'
import type { ArticleDraft, PolicyDocSummary } from '../types'

// 規範文件：AI 預審依據的規定從哪裡來
// 匯入分成兩步：上傳 PDF → 系統切成一條一條 → 主管確認、修改 → 儲存
// 切條文的程式不可能每份文件都切對，所以一定要讓人看過再存，存進去的才是 AI 會引用的

const isApprover = computed(() => isApproverRole(currentUser.value.role))
const formTitle = (type: FormType) => getFormKind(type).def.title

// ===== 文件清單 =====
const docs = ref<PolicyDocSummary[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    docs.value = await api.listPolicyDocs()
  } catch {
    loadError.value = '無法載入規範文件，請確認後端伺服器是否啟動。'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const docsByType = computed(() => FORM_TYPES.map((type) => ({ type, docs: docs.value.filter((d) => d.formType === type) })))

// ===== 匯入 =====
// 第一步：選申請類型與檔案
const formType = ref<FormType>('expense')
const file = ref<File | null>(null)
const parsing = ref(false)
const error = ref<string | null>(null)

function onFileChange(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
  error.value = null
}

// 第二步：確認切好的條文（null 表示還在第一步）
interface Draft {
  title: string
  code: string
  pages: number
  // key：給 v-for 用的穩定 id，刪掉中間一條時其他列的輸入框不會錯位
  articles: (ArticleDraft & { key: number })[]
}
const draft = ref<Draft | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const saving = ref(false)
const saved = ref<PolicyDocSummary | null>(null)

async function parse() {
  if (!file.value) return
  parsing.value = true
  error.value = null
  saved.value = null
  try {
    const preview = await api.previewPolicyPdf(file.value)
    draft.value = {
      title: preview.title,
      code: '',
      pages: preview.pages,
      articles: preview.articles.map((a, i) => ({ ...a, key: i })),
    }
    fieldErrors.value = {}
  } catch (e) {
    error.value = e instanceof ApiError ? (ERROR_LABEL[e.reason] ?? e.message) : String(e)
  } finally {
    parsing.value = false
  }
}

function removeArticle(key: number) {
  if (!draft.value) return
  draft.value.articles = draft.value.articles.filter((a) => a.key !== key)
}

function cancel() {
  draft.value = null
  fieldErrors.value = {}
  error.value = null
}

async function save() {
  if (!draft.value) return
  saving.value = true
  error.value = null
  fieldErrors.value = {}
  try {
    saved.value = await api.importPolicyDoc({
      formType: formType.value,
      code: draft.value.code.trim(),
      title: draft.value.title,
      fileName: file.value?.name ?? null,
      articles: draft.value.articles.map(({ section, text }) => ({ section, text })),
    })
    draft.value = null
    file.value = null
    await load()
  } catch (e) {
    if (e instanceof ApiError) {
      fieldErrors.value = e.fieldErrors
      error.value = ERROR_LABEL[e.reason] ?? e.message
    } else {
      error.value = String(e)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="grid gap-6">
    <div>
      <h1 class="text-xl font-semibold">規範文件</h1>
      <p class="mt-1 text-sm text-muted">
        AI 預審只會依據這裡的規範、只能引用這裡的條文。匯入新文件之後，預審時會依申請內容挑出最相關的條文交給 AI。
      </p>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <!-- 目前的文件 -->
      <section class="card">
        <h2 class="mb-3 font-semibold">目前的規範</h2>
        <div v-if="loading" class="grid animate-pulse gap-3" aria-busy="true">
          <span v-for="n in 3" :key="n" class="h-10 rounded bg-bg" />
        </div>
        <div v-else-if="loadError" class="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {{ loadError }}
          <button type="button" class="btn ml-2 px-2 py-0.5 text-xs" @click="load">重試</button>
        </div>
        <div v-else class="grid gap-4">
          <div v-for="group in docsByType" :key="group.type">
            <h3 class="mb-1 text-xs font-medium text-muted">{{ formTitle(group.type) }}</h3>
            <ul>
              <li v-for="d in group.docs" :key="d.id" class="grid gap-0.5 border-b py-2.5 last:border-b-0" data-testid="doc-row">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{{ d.title }}</span>
                  <span
                    class="rounded px-1.5 py-0.5 text-xs"
                    :class="d.source === 'builtin' ? 'bg-bg text-muted' : 'bg-accent-soft text-accent'"
                  >
                    {{ d.source === 'builtin' ? '內建' : '匯入' }}
                  </span>
                  <span class="ml-auto text-sm text-muted tabular-nums">{{ d.chunkCount }} 條</span>
                </span>
                <span v-if="d.source === 'upload'" class="text-xs text-muted">
                  代碼 <span class="font-mono">{{ d.id }}</span> · {{ d.createdBy }} 於 {{ formatDateTime(d.createdAt!) }} 匯入
                  <template v-if="d.fileName"> · {{ d.fileName }}</template>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 匯入 -->
      <section v-if="isApprover" class="card">
        <h2 class="mb-1 font-semibold">匯入 PDF</h2>
        <p class="mb-4 text-sm text-muted">
          支援文字型 PDF（由 Word 等軟體匯出），依「第 X 條」「3.2」「一、」等條號自動切開。
          沒有手邊的檔案？
          <a href="/samples/travel-policy.pdf" download class="text-accent underline">下載範例：國內出差管理辦法</a>
        </p>

        <p
          v-if="saved"
          class="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok"
          role="status"
          data-testid="import-success"
        >
          已匯入「{{ saved.title }}」共 {{ saved.chunkCount }} 條，之後的{{ formTitle(saved.formType) }}預審就會參考這份文件。
        </p>

        <!-- 第一步：選檔案 -->
        <form v-if="!draft" class="grid gap-3" @submit.prevent="parse">
          <label class="grid gap-1 text-sm">
            <span>用於哪一種申請單</span>
            <select v-model="formType" class="field">
              <option v-for="type in FORM_TYPES" :key="type" :value="type">{{ formTitle(type) }}</option>
            </select>
          </label>
          <label class="grid gap-1 text-sm">
            <span>PDF 檔案</span>
            <input type="file" accept="application/pdf,.pdf" class="field" @change="onFileChange" />
          </label>
          <div>
            <button type="submit" class="btn btn-primary" :disabled="!file || parsing">
              {{ parsing ? '解析中…' : '解析條文' }}
            </button>
          </div>
        </form>

        <!-- 第二步：確認條文 -->
        <form v-else class="grid gap-4" @submit.prevent="save">
          <p class="rounded-lg bg-bg px-3 py-2 text-sm">
            從 {{ draft.pages }} 頁的 PDF 解析出 <strong>{{ draft.articles.length }}</strong> 條。
            請確認條號與內容，切錯的地方可以直接修改或刪除。
          </p>

          <!-- items-start：兩欄各自由上往下排，一欄多了錯誤訊息，另一欄的輸入框也不會被拉高 -->
          <div class="grid gap-x-3 gap-y-1">
            <div class="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label class="grid content-start gap-1 text-sm">
                <span>文件名稱</span>
                <input v-model="draft.title" class="field" />
                <span v-if="fieldErrors.title" class="text-xs text-danger">{{ fieldErrors.title }}</span>
              </label>
              <label class="grid content-start gap-1 text-sm">
                <span>代碼</span>
                <input v-model="draft.code" class="field font-mono" placeholder="例如 trv" aria-describedby="code-hint" />
                <span v-if="fieldErrors.code" class="text-xs text-danger">{{ fieldErrors.code }}</span>
              </label>
            </div>
            <!-- 說明放在兩欄下方整行顯示：塞在窄欄裡會被折成好幾行 -->
            <p id="code-hint" class="text-xs text-muted">
              代碼是這份文件的簡稱，條文 id 會是「代碼-條號」，例如
              <span class="font-mono">{{ draft.code || 'trv' }}-3</span>
            </p>
          </div>

          <p v-if="fieldErrors.articles" class="text-sm text-danger">{{ fieldErrors.articles }}</p>
          <ol class="grid gap-2 lg:max-h-[50vh] lg:overflow-y-auto">
            <li
              v-for="a in draft.articles"
              :key="a.key"
              class="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-2"
              data-testid="article-row"
            >
              <input v-model="a.section" class="field text-center font-mono" aria-label="條號" />
              <textarea v-model="a.text" class="field min-h-16 text-sm leading-relaxed" aria-label="條文內容" />
              <button type="button" class="btn px-2 text-xs text-muted" @click="removeArticle(a.key)">刪除</button>
            </li>
          </ol>

          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn btn-primary" :disabled="saving || draft.articles.length === 0">
              {{ saving ? '儲存中…' : `儲存 ${draft.articles.length} 條` }}
            </button>
            <button type="button" class="btn" @click="cancel">重新選擇檔案</button>
          </div>
        </form>

        <p v-if="error" class="mt-3 text-sm text-danger">{{ error }}</p>
      </section>

      <section v-else class="card text-sm text-muted">只有簽核者可以匯入規範文件。</section>
    </div>
  </div>
</template>
