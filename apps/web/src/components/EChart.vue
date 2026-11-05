<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { BarChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

// ECharts 的 Vue 包裝：整個專案只有這裡直接碰 ECharts 的生命週期
//
// 按需引入：ECharts 完整版很大，只 use() 用得到的圖表與元件，打包出來小很多
// 之後要加折線圖，就在這裡多 use 一個 LineChart
use([BarChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer])

const props = defineProps<{
  option: EChartsCoreOption
  height: number // px；圖表一定要有明確的高度，不然 ECharts 會畫成 0
  label: string // 給螢幕閱讀器的描述；確切的數字另外用表格提供
}>()

const el = ref<HTMLDivElement | null>(null)
// shallowRef：ECharts 實例內部很大，不要讓 Vue 把它整個變成響應式（會很慢，還可能出錯）
const chart = shallowRef<ECharts | null>(null)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!el.value) return
  // SVG 渲染：資料量小時比 Canvas 清楚，縮放不會糊，也能用瀏覽器檢查元素
  chart.value = init(el.value, null, { renderer: 'svg' })
  chart.value.setOption(props.option)
  // 容器寬度變了（手機轉向、側欄收合）就重畫，不只是視窗 resize
  observer = new ResizeObserver(() => chart.value?.resize())
  observer.observe(el.value)
})

// 資料變了就更新；notMerge：整包換掉，避免舊的 series 殘留在圖上
watch(
  () => props.option,
  (option) => chart.value?.setOption(option, { notMerge: true }),
)

// 離開頁面一定要清掉：ECharts 會掛事件、計時器，不清會記憶體洩漏
onBeforeUnmount(() => {
  observer?.disconnect()
  chart.value?.dispose()
})
</script>

<template>
  <div ref="el" role="img" :aria-label="label" :style="{ height: `${height}px` }" />
</template>
