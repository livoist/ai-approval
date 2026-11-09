<script setup lang="ts">
import { dismiss, toasts } from '../notify'

// 右上角的提示列表：放在 App.vue，整個網站只有一份
</script>

<template>
  <!-- aria-live：螢幕閱讀器會念出新出現的提示；pointer-events-none 讓空白處不擋住底下的畫面 -->
  <div
    class="pointer-events-none fixed top-16 right-4 left-4 z-50 grid justify-items-end gap-2 sm:left-auto sm:w-96"
    aria-live="polite"
  >
    <TransitionGroup
      enter-from-class="translate-x-4 opacity-0"
      enter-active-class="transition duration-200"
      leave-to-class="opacity-0"
      leave-active-class="transition duration-150"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-sm shadow-lg"
        :class="t.kind === 'error' ? 'border-danger/30' : 'border-ok/30'"
        :role="t.kind === 'error' ? 'alert' : 'status'"
        data-testid="toast"
      >
        <span aria-hidden="true" :class="t.kind === 'error' ? 'text-danger' : 'text-ok'">
          {{ t.kind === 'error' ? '⚠' : '✓' }}
        </span>
        <div class="grid min-w-0 flex-1 gap-0.5">
          <p>{{ t.message }}</p>
          <p v-if="t.detail" class="font-mono text-xs text-muted select-all">{{ t.detail }}</p>
        </div>
        <button
          type="button"
          class="-m-1 cursor-pointer p-1 leading-none text-muted hover:text-ink"
          aria-label="關閉提示"
          @click="dismiss(t.id)"
        >
          ✕
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
