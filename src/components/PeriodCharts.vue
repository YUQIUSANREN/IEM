<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useAppStore } from '../stores/app'
import {
  buildPeriodChartModel,
  formatExpenseTip,
  formatYuanMark,
  type CategorySlice,
} from '../domain/chart-data'
import { fenToYuan, yuanToFen } from '../domain/money'
import type { PeriodRange } from '../types'

const props = defineProps<{
  primary: PeriodRange
  compare: PeriodRange | null
}>()

const emit = defineEmits<{
  openDay: [date: string]
}>()

const store = useAppStore()
const pieEl = ref<HTMLDivElement | null>(null)
const lineEl = ref<HTMLDivElement | null>(null)
const barEl = ref<HTMLDivElement | null>(null)
const slices = ref<CategorySlice[]>([])
const palette = ref<string[]>([])

let pie: echarts.ECharts | null = null
let line: echarts.ECharts | null = null
let bar: echarts.ECharts | null = null
let ro: ResizeObserver | null = null
let lastTapAt = 0
let lastTapIndex = -1

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function theme(): {
  moss: string
  gold: string
  ink: string
  muted: string
  seal: string
  line: string
  card: string
} {
  return {
    moss: cssColor('--moss', '#2c6e5d'),
    gold: cssColor('--chart-2', '#c4a574'),
    ink: cssColor('--ink', '#1e2a24'),
    muted: cssColor('--muted', '#6f675b'),
    seal: cssColor('--seal', '#c23b2e'),
    line: cssColor('--line', '#e2d8c6'),
    card: cssColor('--card', '#fffdf7'),
  }
}

function chartPalette(colors: ReturnType<typeof theme>): string[] {
  return [colors.moss, '#5b8def', '#8b7cf6', '#3dbdb5', '#e6b422', '#e88ab5', colors.seal, colors.gold]
}

function sliceColor(index: number): string {
  const list = palette.value
  return list[index % list.length] ?? '#5b8def'
}

function axisInterval(count: number): number {
  if (count <= 8) return 0
  return Math.max(Math.ceil(count / 6) - 1, 0)
}

function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

function openDayAt(index: number, days: string[]): void {
  const date = days[index]
  if (!date) return
  if (!store.transactions.some((tx) => tx.occurredAt.slice(0, 10) === date)) return
  emit('openDay', date)
}

function onBarPointer(index: number, days: string[]): void {
  if (!isCoarsePointer()) return
  const now = Date.now()
  if (index === lastTapIndex && now - lastTapAt < 420) {
    openDayAt(index, days)
    lastTapAt = 0
    lastTapIndex = -1
    return
  }
  lastTapAt = now
  lastTapIndex = index
}

function bindBarEvents(days: string[]): void {
  bar?.off('click')
  bar?.off('dblclick')
  bar?.on('click', (params) => {
    if (params.dataIndex == null) return
    onBarPointer(params.dataIndex, days)
  })
  bar?.on('dblclick', (params) => {
    if (isCoarsePointer() || params.dataIndex == null) return
    openDayAt(params.dataIndex, days)
  })
}

function render(): void {
  if (!pie && !line && !bar) return
  const colors = theme()
  palette.value = chartPalette(colors)
  const model = buildPeriodChartModel(
    props.primary,
    props.compare,
    store.transactions,
    new Map(store.categories.map((item) => [item.id, item.name])),
  )
  slices.value = model.slices
  const nums = [...model.primaryByDay, ...(model.compareByDay ?? [])].filter(
    (n): n is number => n != null,
  )
  const yMax = Math.max(...nums, 0)
  const comparing = Boolean(props.compare && model.compareByDay)

  function toYuan(fen: number | null): number | null {
    return fen == null ? null : fenToYuan(fen)
  }

  function pieItem(name: string, fen: number): { name: string; value: number; itemStyle: { color: string } } {
    const index = model.slices.findIndex((item) => item.name === name)
    return {
      name,
      value: fenToYuan(fen),
      itemStyle: { color: sliceColor(index < 0 ? 0 : index) },
    }
  }

  function seriesTip(params: unknown): string {
    const rows = Array.isArray(params) ? params : [params]
    const index = (rows[0] as { dataIndex?: number }).dataIndex ?? 0
    const date = model.days[index] ?? ''
    const lines: string[] = []
    for (const row of rows as Array<{ seriesName?: string; value?: number | null }>) {
      if (row.value == null) continue
      const name = row.seriesName ? `${row.seriesName} ` : ''
      lines.push(`${name}${formatExpenseTip(date, yuanToFen(row.value))}`)
    }
    return lines.join('<br/>') || formatExpenseTip(date, 0)
  }

  const pieSeries: Array<Record<string, unknown>> = [
    {
      type: 'pie',
      name: comparing ? '本期' : '支出',
      radius: comparing ? ['56%', '76%'] : ['42%', '68%'],
      center: comparing ? ['50%', '48%'] : ['50%', '52%'],
      avoidLabelOverlap: true,
      minShowLabelAngle: 10,
      itemStyle: { borderColor: colors.card, borderWidth: 2 },
      label: {
        color: colors.ink,
        fontSize: 12,
        formatter: (p: { name: string; percent?: number }) =>
          `${p.name} ${(p.percent ?? 0).toFixed(2)}%`,
      },
      labelLine: {
        length: 10,
        length2: 8,
        lineStyle: { color: colors.muted },
      },
      data: model.slices
        .filter((item) => item.expenseFen > 0)
        .map((item) => pieItem(item.name, item.expenseFen)),
    },
  ]
  if (comparing && model.compareSlices) {
    pieSeries.push({
      type: 'pie',
      name: '对比期',
      radius: ['28%', '46%'],
      center: ['50%', '48%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: colors.card, borderWidth: 2 },
      label: { show: false },
      data: model.compareSlices
        .filter((item) => item.expenseFen > 0)
        .map((item) => pieItem(item.name, item.expenseFen)),
    })
  }
  pie?.setOption(
    {
      color: palette.value,
      textStyle: { color: colors.ink, fontFamily: 'inherit' },
      /* 饼图 legend 会变成分类名，不能用来标内外圈，改用下方 HTML 图例。 */
      legend: { show: false },
      graphic: comparing
        ? [
            {
              type: 'text',
              left: 'center',
              top: '48%',
              style: {
                text: '对比期',
                fill: colors.muted,
                fontSize: 12,
                fontWeight: 650,
                textAlign: 'center',
                textVerticalAlign: 'middle',
              },
            },
          ]
        : [],
      tooltip: {
        trigger: 'item',
        formatter: (p: { seriesName?: string; name?: string; value?: number; percent?: number }) => {
          const who = comparing && p.seriesName ? `${p.seriesName} · ` : ''
          return `${who}${p.name ?? ''} ${formatYuanMark(yuanToFen(p.value ?? 0))} (${(p.percent ?? 0).toFixed(2)}%)`
        },
      },
      series: pieSeries,
    },
    true,
  )

  const lineColor = colors.moss
  const lineSeries: Array<Record<string, unknown>> = [
    {
      type: 'line',
      name: comparing ? '本期' : '支出',
      data: model.primaryByDay.map(toYuan),
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 8,
      connectNulls: false,
      lineStyle: { width: 2.5, color: lineColor },
      itemStyle: { color: lineColor },
      emphasis: { scale: true, itemStyle: { borderWidth: 2, borderColor: colors.card } },
    },
  ]
  if (comparing && model.compareByDay) {
    lineSeries.push({
      type: 'line',
      name: '对比期',
      data: model.compareByDay.map(toYuan),
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 8,
      connectNulls: false,
      lineStyle: { width: 2, type: 'dashed', color: colors.gold },
      itemStyle: { color: colors.gold },
    })
  }
  line?.setOption(
    {
      color: [lineColor, colors.gold],
      textStyle: { color: colors.ink, fontFamily: 'inherit' },
      legend: comparing
        ? { data: ['本期', '对比期'], textStyle: { color: colors.ink }, top: 0 }
        : { show: false },
      grid: { left: 8, right: 12, top: comparing ? 36 : 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: comparing ? colors.card : lineColor,
        borderWidth: comparing ? 1 : 0,
        borderColor: colors.line,
        padding: [6, 14],
        extraCssText: 'border-radius: 12px; box-shadow: none;',
        textStyle: { color: comparing ? colors.ink : '#fff', fontSize: 13 },
        axisPointer: { type: 'none' },
        formatter: seriesTip,
      },
      xAxis: {
        type: 'category',
        data: model.labels,
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: colors.line } },
        axisLabel: {
          color: colors.muted,
          interval: axisInterval(model.labels.length),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: yMax ? undefined : 1,
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { type: 'dashed', color: colors.line } },
        axisLabel: {
          color: colors.muted,
          formatter: (v: number) =>
            v.toLocaleString('zh-CN', { maximumFractionDigits: 2 }),
        },
      },
      series: lineSeries,
    },
    true,
  )

  const barSeries: Array<{
    name: string
    type: 'bar'
    data: Array<number | null>
    barMaxWidth: number
    barGap?: string
    itemStyle: { color: string; borderRadius: number }
  }> = [
    {
      name: comparing ? '本期' : '支出',
      type: 'bar',
      data: model.primaryByDay.map(toYuan),
      barMaxWidth: comparing ? 14 : 18,
      barGap: '20%',
      itemStyle: { color: colors.moss, borderRadius: 4 },
    },
  ]
  if (comparing && model.compareByDay) {
    barSeries.push({
      name: '对比期',
      type: 'bar',
      data: model.compareByDay.map(toYuan),
      barMaxWidth: 14,
      itemStyle: { color: colors.gold, borderRadius: 4 },
    })
  }
  bar?.setOption(
    {
      color: [colors.moss, colors.gold],
      textStyle: { color: colors.ink, fontFamily: 'inherit' },
      grid: { left: 8, right: 12, top: comparing ? 36 : 28, bottom: 8, containLabel: true },
      legend: comparing
        ? {
            data: barSeries.map((item) => item.name),
            textStyle: { color: colors.ink },
            top: 0,
          }
        : { show: false },
      tooltip: {
        trigger: 'axis',
        formatter: seriesTip,
      },
      xAxis: {
        type: 'category',
        data: model.labels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: colors.line } },
        axisLabel: {
          color: colors.muted,
          interval: axisInterval(model.labels.length),
        },
      },
      yAxis: {
        type: 'value',
        name: '元',
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { type: 'dashed', color: colors.line } },
        axisLabel: { color: colors.muted },
      },
      series: barSeries,
    },
    true,
  )
  bindBarEvents(model.days)
  void nextTick(() => resize())
}

function resize(): void {
  pie?.resize()
  line?.resize()
  bar?.resize()
}

onMounted(async () => {
  await nextTick()
  if (pieEl.value) pie = echarts.init(pieEl.value)
  if (lineEl.value) line = echarts.init(lineEl.value)
  if (barEl.value) bar = echarts.init(barEl.value)
  render()
  ro = new ResizeObserver(() => resize())
  for (const el of [pieEl.value, lineEl.value, barEl.value]) {
    if (el) ro.observe(el)
  }
  window.addEventListener('iem-theme', render)
})

onUnmounted(() => {
  window.removeEventListener('iem-theme', render)
  ro?.disconnect()
  pie?.dispose()
  line?.dispose()
  bar?.dispose()
})

watch(
  [
    () => props.primary.startIso,
    () => props.primary.endIso,
    () => props.compare?.startIso,
    () => props.compare?.endIso,
    () => store.dataRev,
    () => store.transactions.length,
  ],
  () => render(),
)
</script>

<template>
  <article id="report-share" class="card">
    <h2>分类占比</h2>
    <p v-if="!slices.length" class="muted">这个区间还没有支出。</p>
    <div v-else-if="compare" class="pie-key" aria-label="饼图图例">
      <span class="pie-key-item">
        <i class="ring outer" />
        本期 · 外圈
      </span>
      <span class="pie-key-item">
        <i class="ring inner" />
        对比期 · 内圈
      </span>
    </div>
    <div v-show="slices.length" ref="pieEl" class="chart pie" :class="{ nested: compare }" />
    <ol v-if="slices.length" class="rank">
      <li v-for="(item, index) in slices" :key="item.name" class="rank-row">
        <span class="rank-n muted">{{ index + 1 }}</span>
        <span class="rank-icon" :style="{ background: sliceColor(index) }" />
        <div class="rank-body">
          <strong class="rank-name">{{ item.name }}</strong>
          <template v-if="compare">
            <div class="rank-period">
              <span class="mark now">本期</span>
              <span class="muted">{{ item.count }}笔</span>
              <span class="rank-nums">
                <span class="muted">{{ item.percent.toFixed(2) }}%</span>
                <span class="amt">{{ formatYuanMark(item.expenseFen) }}</span>
              </span>
            </div>
            <div class="bar-track">
              <span :style="{ width: `${item.percent}%`, background: sliceColor(index) }" />
            </div>
            <div class="rank-period">
              <span class="mark prev">对比期</span>
              <span class="muted">{{ item.prevCount ?? 0 }}笔</span>
              <span class="rank-nums">
                <span class="muted">{{ (item.prevPercent ?? 0).toFixed(2) }}%</span>
                <span class="amt">{{ formatYuanMark(item.prevExpenseFen ?? 0) }}</span>
              </span>
            </div>
            <div class="bar-track">
              <span class="cmp" :style="{ width: `${item.prevPercent ?? 0}%` }" />
            </div>
          </template>
          <template v-else>
            <div class="rank-period">
              <span class="muted">{{ item.count }}笔</span>
              <span class="rank-nums">
                <span class="muted">{{ item.percent.toFixed(2) }}%</span>
                <span class="amt">{{ formatYuanMark(item.expenseFen) }}</span>
              </span>
            </div>
            <div class="bar-track">
              <span :style="{ width: `${item.percent}%`, background: sliceColor(index) }" />
            </div>
          </template>
        </div>
      </li>
    </ol>
  </article>

  <article id="report-trend" class="card">
    <h2>每日支出走势</h2>
    <div ref="lineEl" class="chart" />
  </article>

  <article class="card">
    <h2>每日支出</h2>
    <p class="muted hint">
      双击某一天可跳到账本里那天的卡片（手机上连点两次）。
      <template v-if="compare">比较时按实际日期先后排开，两个周期不对齐重叠。</template>
    </p>
    <div ref="barEl" class="chart" />
  </article>
</template>

<style scoped>
.chart { height: 280px; }
.chart.pie { height: 300px; }
.chart.pie.nested { height: 320px; }
.pie-key {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--muted);
}
.pie-key-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.ring {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ring.outer {
  border: 3px solid var(--moss);
  background: transparent;
}
.ring.inner {
  width: 12px;
  height: 12px;
  margin: 0 2px;
  border: 3px solid var(--chart-2);
  background: transparent;
}
.rank-name { display: block; margin-bottom: 6px; font-weight: 600; }
.rank-period {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.mark {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.4;
  padding: 1px 6px;
  border-radius: 999px;
}
.mark.now {
  color: var(--moss-dark);
  background: var(--soft);
}
.mark.prev {
  color: var(--gold);
  background: var(--soft-2);
}
.bar-track .cmp { background: var(--chart-2); }
.hint { margin: 0 0 8px; }
.rank {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  gap: 14px;
}
.rank-row {
  display: grid;
  grid-template-columns: 20px 28px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.rank-n { font-variant-numeric: tabular-nums; text-align: right; }
.rank-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  opacity: 0.9;
  align-self: start;
  margin-top: 2px;
}
.rank-body { min-width: 0; }
.rank-nums {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex: 0 0 auto;
}
.amt { font-weight: 700; font-variant-numeric: tabular-nums; }
.bar-track {
  margin: 4px 0 8px;
  height: 6px;
  border-radius: 999px;
  background: var(--soft);
  overflow: hidden;
}
.rank-body .bar-track:last-child { margin-bottom: 0; }
.bar-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
}
@media (max-width: 800px) {
  .rank-period { flex-wrap: wrap; }
  .rank-nums { width: 100%; margin-left: 0; justify-content: space-between; }
}
html.is-mobile .rank-top { flex-wrap: wrap; }
html.is-mobile .rank-nums { width: 100%; margin-left: 0; justify-content: space-between; }
</style>
