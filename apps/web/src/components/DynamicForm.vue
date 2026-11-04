<script setup lang="ts">
import { computed } from 'vue'
import { matches, type FieldValue, type FormDef, type FormValues } from '@ai-approval/shared'

// 動態表單：給它一份表單定義，它就照著畫出來
// 元件本身不知道「設備維修」是什麼，換一份定義就能畫出完全不同的表單

const props = defineProps<{
  def: FormDef
  errors: Record<string, string>
}>()

// defineModel（Vue 3.4+）：讓父元件可以直接用 v-model="values" 綁定
// 等於幫你寫好 modelValue prop 和 update:modelValue 事件
const values = defineModel<FormValues>({ required: true })

// 依目前填寫的內容決定顯示哪些區塊、哪些欄位（例如電壓 ≥ 480 才出現高壓作業區塊）
const sections = computed(() =>
  props.def.sections
    .filter((s) => matches(s.showIf, values.value))
    .map((s) => ({ ...s, fields: s.fields.filter((f) => matches(f.showIf, values.value)) })),
)

// 每次都產生新物件，而不是直接改 values.value[key]：
// 父元件拿到的是一份「新的」資料，computed 和 watch 才會可靠地重新計算
function set(key: string, value: FieldValue) {
  values.value = { ...values.value, [key]: value }
}

// 數字欄位：清空時存 null，而不是空字串或 0（0 元跟「沒填」意義不同）
function setNumber(key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  set(key, raw === '' ? null : Number(raw))
}

function setText(key: string, event: Event) {
  set(key, (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)
}

const text = (v: FieldValue | undefined) => (v === null || v === undefined ? '' : String(v))
</script>

<template>
  <div class="grid gap-5">
    <fieldset v-for="section in sections" :key="section.title" class="grid gap-3">
      <legend class="mb-1 text-sm font-semibold">{{ section.title }}</legend>
      <p v-if="section.description" class="-mt-2 text-xs text-muted">{{ section.description }}</p>

      <div v-for="field in section.fields" :key="field.key" class="grid gap-1 text-sm">
        <!-- 勾選框：標籤放在右邊，跟其他欄位不一樣 -->
        <label v-if="field.type === 'boolean'" class="flex items-center gap-2">
          <input
            type="checkbox"
            class="size-4 accent-accent"
            :checked="values[field.key] === true"
            @change="set(field.key, ($event.target as HTMLInputElement).checked)"
          />
          {{ field.label }}
        </label>

        <template v-else>
          <label :for="field.key">
            {{ field.label }}
            <span v-if="field.required" class="text-danger">*</span>
          </label>

          <div v-if="field.type === 'number'" class="flex items-center gap-2">
            <input
              :id="field.key"
              type="number"
              class="field"
              :min="field.min"
              :value="text(values[field.key])"
              :aria-invalid="!!errors[field.key]"
              @input="setNumber(field.key, $event)"
            />
            <span v-if="field.unit" class="shrink-0 text-muted">{{ field.unit }}</span>
          </div>

          <select
            v-else-if="field.type === 'select'"
            :id="field.key"
            class="field"
            :value="text(values[field.key])"
            :aria-invalid="!!errors[field.key]"
            @change="setText(field.key, $event)"
          >
            <option value="" disabled>請選擇</option>
            <option v-for="o in field.options" :key="o" :value="o">{{ o }}</option>
          </select>

          <textarea
            v-else-if="field.type === 'textarea'"
            :id="field.key"
            class="field"
            rows="4"
            :placeholder="field.placeholder"
            :value="text(values[field.key])"
            :aria-invalid="!!errors[field.key]"
            @input="setText(field.key, $event)"
          />

          <input
            v-else-if="field.type === 'datetime'"
            :id="field.key"
            type="datetime-local"
            class="field"
            :value="text(values[field.key])"
            :aria-invalid="!!errors[field.key]"
            @input="setText(field.key, $event)"
          />

          <input
            v-else
            :id="field.key"
            type="text"
            class="field"
            :placeholder="field.type === 'text' ? field.placeholder : undefined"
            :value="text(values[field.key])"
            :aria-invalid="!!errors[field.key]"
            @input="setText(field.key, $event)"
          />
        </template>

        <p v-if="errors[field.key]" class="text-xs text-danger">{{ errors[field.key] }}</p>
        <p v-else-if="field.help" class="text-xs text-muted">{{ field.help }}</p>
      </div>
    </fieldset>
  </div>
</template>
