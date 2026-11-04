<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { FindingFeedback } from '../types'

// 每一條 AI 意見下方的評價區：
// - 已經有評價 → 顯示誰、評了什麼
// - 目前使用者是主管 → 可以評價，也可以改主意

const props = defineProps<{
  feedback: FindingFeedback | null | undefined
  editable: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  submit: [verdict: FindingFeedback['verdict'], note: string]
}>()

const writingNote = ref(false) // 是否展開了寫理由的 textarea
const note = ref('') // textarea 的內容
const textarea = ref<HTMLTextAreaElement | null>(null)

// 理由只有空白也不算：跟後端的 note.trim() === '' 判斷一致
const canSubmitNote = computed(() => note.value.trim() !== '' && !props.busy)

function markCorrect() {
  writingNote.value = false
  emit('submit', 'correct', '')
}

async function startWritingNote() {
  // 改主意時，把之前寫過的理由帶進來，方便修改
  note.value = props.feedback?.verdict === 'incorrect' ? props.feedback.note : ''
  writingNote.value = true
  // 等 textarea 真的出現在畫面上，才能把游標放進去
  await nextTick()
  textarea.value?.focus()
}

function submitNote() {
  if (!canSubmitNote.value) return
  emit('submit', 'incorrect', note.value.trim())
  writingNote.value = false
  note.value = ''
}

function cancel() {
  writingNote.value = false
  note.value = ''
}
</script>

<template>
  <div class="grid gap-2 text-xs">
    <div class="flex flex-wrap items-center gap-2">
      <!-- 目前的評價 -->
      <span v-if="feedback?.verdict === 'correct'" class="text-ok">
        {{ feedback.actorId }} 標記為正確
      </span>
      <span v-else-if="feedback?.verdict === 'incorrect'" class="text-danger">
        {{ feedback.actorId }} 標記為有誤：{{ feedback.note }}
      </span>
      <span v-else-if="editable" class="text-muted">這條意見正確嗎？</span>

      <!-- 評價按鈕：主管才看得到；目前選的那個用 btn-primary 標示 -->
      <span v-if="editable && !writingNote" class="ml-auto flex gap-1">
        <button
          type="button"
          class="btn px-2 py-0.5 text-xs"
          :class="{ 'btn-primary': feedback?.verdict === 'correct' }"
          :disabled="busy"
          @click="markCorrect"
        >
          正確
        </button>
        <button
          type="button"
          class="btn px-2 py-0.5 text-xs"
          :class="{ 'btn-primary': feedback?.verdict === 'incorrect' }"
          :disabled="busy"
          @click="startWritingNote"
        >
          有誤
        </button>
      </span>
    </div>

    <!-- 標記有誤時展開：一定要寫理由 -->
    <form v-if="writingNote" class="grid gap-2" @submit.prevent="submitNote">
      <textarea
        ref="textarea"
        v-model="note"
        class="field bg-surface text-xs"
        rows="2"
        placeholder="AI 錯在哪裡？例如：這台設備不是高壓設備"
        @keydown.esc="cancel"
      />
      <div class="flex justify-end gap-1">
        <button type="button" class="btn px-2 py-0.5 text-xs" @click="cancel">取消</button>
        <button
          type="submit"
          class="btn btn-primary px-2 py-0.5 text-xs"
          :disabled="!canSubmitNote"
        >
          送出
        </button>
      </div>
    </form>
  </div>
</template>
