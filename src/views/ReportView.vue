<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { buildReport, getPeriodStartDay } from '../domain/engine'
import { formatYuan } from '../domain/money'
import { formatRemainFen } from '../domain/tx-display'
import { listSelectablePeriods, shiftPeriod, toDateInput } from '../domain/period'
import PeriodSelect from '../components/PeriodSelect.vue'
import NiceSelect from '../components/NiceSelect.vue'
import PeriodCharts from '../components/PeriodCharts.vue'
import type { PeriodRange } from '../types'

const SECTIONS = [
  { id: 'share', label: '分类占比' },
  { id: 'trend', label: '每日支出走势' },
  { id: 'compare', label: '分类对比' },
  { id: 'tips', label: '建议' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const store = useAppStore()
const router = useRouter()
const pageEl = ref<HTMLElement | null>(null)
const headEl = ref<HTMLElement | null>(null)
const periodKey = ref(store.selectedPeriodStartIso)
const compareKey = ref('prev')
const customStart = ref(toDateInput(store.dashboard.period.start))
const customEnd = ref(toDateInput(store.dashboard.period.end))
/** 下滑后大标题换成小字居中吸顶，tab 跟着钉在标题下面。 */
const titleCollapsed = ref(false)
const activeTab = ref<SectionId>('share')

let scrollRoot: HTMLElement | null = null
let skipSpy = false
let skipTimer = 0

const choices = computed(() => listSelectablePeriods(getPeriodStartDay(), store.transactions))
const compareOptions = computed(() => [
  { value: 'prev', label: '上一周期' },
  { value: 'none', label: '不比较' },
  ...choices.value
    .filter((item) => item.startIso !== periodKey.value)
    .map((item) => ({ value: item.startIso, label: item.label })),
])

function resolvePeriod(key: string): PeriodRange {
  if (key === 'custom') {
    return {
      start: new Date(`${customStart.value}T00:00:00`),
      end: new Date(`${customEnd.value}T23:59:59`),
      startIso: `${customStart.value}T00:00:00`,
      endIso: `${customEnd.value}T23:59:59`,
      label: `${customStart.value} 至 ${customEnd.value}`,
    }
  }
  return choices.value.find((item) => item.startIso === key) ?? store.dashboard.period
}

const primaryRange = computed(() => resolvePeriod(periodKey.value))

const compareRange = computed((): PeriodRange | null => {
  if (compareKey.value === 'none') return null
  if (compareKey.value === 'prev') return shiftPeriod(primaryRange.value, -1, getPeriodStartDay())
  if (compareKey.value === periodKey.value) return shiftPeriod(primaryRange.value, -1, getPeriodStartDay())
  return resolvePeriod(compareKey.value)
})

const report = computed(() => {
  const primary = primaryRange.value
  const compare = compareRange.value
  if (!compare) {
    const built = buildReport(primary.start, primary.end, primary.start, new Date(primary.start.getTime() - 1))
    return { ...built, prevExpenseFen: 0, prevIncomeFen: 0, prevRemainingFen: 0, prevOverspendDays: 0, primaryLabel: primary.label, compareLabel: '不比较' }
  }
  const built = buildReport(primary.start, primary.end, compare.start, compare.end)
  return {
    ...built,
    primaryLabel: primary.label,
    compareLabel: compareKey.value === 'prev' ? '上一周期' : compare.label,
  }
})
const comparing = computed(() => compareRange.value != null)

function openLedgerDay(date: string): void {
  void router.push({ name: 'ledger', query: { day: date } })
}

/**
 * 页面本身不滚，真正的滚动容器是 AppShell 的 `.main`。
 */
function findScrollRoot(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el.parentElement
  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return current
    current = current.parentElement
  }
  return document.querySelector<HTMLElement>('main.main')
}

function sectionEl(id: SectionId): HTMLElement | null {
  return document.getElementById(`report-${id}`)
}

function pinOffset(): number {
  return (headEl.value?.getBoundingClientRect().bottom ?? 0) + 8
}

function syncActiveTab(): void {
  if (!scrollRoot || skipSpy) return
  const maxScroll = scrollRoot.scrollHeight - scrollRoot.clientHeight
  if (maxScroll > 0 && scrollRoot.scrollTop >= maxScroll - 12) {
    activeTab.value = SECTIONS[SECTIONS.length - 1].id
    return
  }
  const probe = pinOffset()
  let current: SectionId = SECTIONS[0].id
  for (const item of SECTIONS) {
    const el = sectionEl(item.id)
    if (!el) continue
    if (el.getBoundingClientRect().top <= probe) current = item.id
  }
  activeTab.value = current
}

function onReportScroll(): void {
  titleCollapsed.value = (scrollRoot?.scrollTop ?? 0) > 20
  syncActiveTab()
}

function bindScroll(): void {
  scrollRoot?.removeEventListener('scroll', onReportScroll)
  scrollRoot = pageEl.value ? findScrollRoot(pageEl.value) : document.querySelector<HTMLElement>('main.main')
  if (!scrollRoot) {
    titleCollapsed.value = false
    return
  }
  scrollRoot.addEventListener('scroll', onReportScroll, { passive: true })
  onReportScroll()
}

function clearSkipSpy(): void {
  skipSpy = false
  scrollRoot?.removeEventListener('scrollend', clearSkipSpy)
}

/**
 * 先收成吸顶高度再量偏移，避免大标题收起后目标区块钻到 tab 下面。
 */
function jumpTo(id: SectionId): void {
  const el = sectionEl(id)
  if (!el || !scrollRoot) return
  activeTab.value = id
  skipSpy = true
  window.clearTimeout(skipTimer)
  titleCollapsed.value = true
  void nextTick(() => {
    if (!scrollRoot) return
    const delta = el.getBoundingClientRect().top - pinOffset()
    scrollRoot.scrollTo({ top: Math.max(0, scrollRoot.scrollTop + delta), behavior: 'smooth' })
    scrollRoot.addEventListener('scrollend', clearSkipSpy, { once: true })
    skipTimer = window.setTimeout(clearSkipSpy, 900)
  })
}

onMounted(() => {
  bindScroll()
})

onUnmounted(() => {
  scrollRoot?.removeEventListener('scroll', onReportScroll)
  scrollRoot?.removeEventListener('scrollend', clearSkipSpy)
  window.clearTimeout(skipTimer)
})
</script>

<template>
  <section ref="pageEl" class="page pin-page">
    <header ref="headEl" class="head pin-bar" :class="{ collapsed: titleCollapsed }">
      <h1>
        <span class="title-large" :aria-hidden="titleCollapsed">周期盘点</span>
        <span class="title-mini" :aria-hidden="!titleCollapsed">周期盘点</span>
      </h1>
      <nav class="report-tabs" role="tablist" aria-label="盘点区块">
        <button
          v-for="item in SECTIONS"
          :key="item.id"
          class="report-tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === item.id"
          :class="{ active: activeTab === item.id }"
          @click="jumpTo(item.id)"
        >
          {{ item.label }}
        </button>
      </nav>
    </header>

    <article class="card">
      <div class="filters">
        <PeriodSelect v-model="periodKey" allow-custom />
        <label>
          <span class="muted">比较对象</span>
          <NiceSelect v-model="compareKey" :options="compareOptions" title="比较对象" />
        </label>
      </div>
      <div v-if="periodKey === 'custom'" class="row">
        <input v-model="customStart" class="input" type="date" />
        <input v-model="customEnd" class="input" type="date" />
      </div>
      <p class="muted">{{ report.primaryLabel }} · 对比 {{ report.compareLabel }}</p>
      <div class="kpi">
        <div class="card">
          <div class="muted">收入</div>
          <div class="num moss">{{ formatYuan(report.incomeFen) }}</div>
          <div v-if="comparing" class="muted">对比 {{ formatYuan(report.prevIncomeFen ?? 0) }}</div>
        </div>
        <div class="card">
          <div class="muted">支出</div>
          <div class="num seal">{{ formatYuan(report.expenseFen) }}</div>
          <div v-if="comparing" class="muted">对比 {{ formatYuan(report.prevExpenseFen ?? 0) }}</div>
        </div>
        <div class="card">
          <div class="muted">剩余</div>
          <div class="num" :class="{ seal: report.remainingFen < 0 }">{{ formatRemainFen(report.remainingFen) }}</div>
          <div v-if="comparing" class="muted">对比 {{ formatRemainFen(report.prevRemainingFen ?? 0) }}</div>
        </div>
        <div class="card">
          <div class="muted">超支天数</div>
          <div class="num">{{ report.overspendDays }}</div>
          <div v-if="comparing" class="muted">对比 {{ report.prevOverspendDays ?? 0 }} 天</div>
        </div>
      </div>
      <p class="muted">
        {{ report.overspent ? '该区间已超额度。' : '该区间未超额度。' }}
        <template v-if="report.incomeCountsTowardBudget"> 当前为「收入纳入限额」，额度 = 基础限额 + 本期收入。</template>
      </p>
    </article>
    <PeriodCharts :primary="primaryRange" :compare="compareRange" @open-day="openLedgerDay" />
    <article id="report-compare" class="card">
      <h2>分类对比</h2>
      <div class="table-wrap">
      <table class="table">
        <thead><tr><th>分类</th><th>本期</th><th>对比期</th><th>分类限额</th></tr></thead>
        <tbody>
          <tr v-for="item in report.categoryBreakdown" :key="item.name">
            <td>{{ item.name }}</td>
            <td>{{ formatYuan(item.expenseFen) }}</td>
            <td>{{ formatYuan(item.prevExpenseFen) }}</td>
            <td>{{ item.limitFen ? formatYuan(item.limitFen) : '—' }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </article>
    <article id="report-tips" class="card">
      <h2>建议</h2>
      <ul>
        <li v-for="item in report.suggestions" :key="item">{{ item }}</li>
      </ul>
    </article>
  </section>
</template>

<style scoped>
.head {
  display: grid;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  margin-top: 0;
}
.head:not(.collapsed) {
  box-shadow:
    calc(-1 * var(--main-pad-left, 16px)) 0 0 0 var(--paper),
    var(--main-pad-right, 16px) 0 0 0 var(--paper),
    0 calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper),
    calc(-1 * var(--main-pad-left, 16px)) calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper),
    var(--main-pad-right, 16px) calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper);
}
.head.collapsed {
  padding-top: 18px;
  padding-bottom: 4px;
}
.head h1 {
  position: relative;
  margin: 0;
  width: 100%;
  line-height: 1.25;
}
.title-large,
.title-mini {
  display: block;
  transition: opacity 0.2s ease;
}
.title-mini {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-size: 17px;
  font-weight: 650;
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
}
.head.collapsed .title-large {
  opacity: 0;
  height: 0;
  overflow: hidden;
}
.head.collapsed .title-mini {
  position: static;
  opacity: 1;
  justify-content: center;
  padding-bottom: 4px;
}
.report-tabs {
  display: flex;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.report-tabs::-webkit-scrollbar { display: none; }
.report-tab {
  flex: 0 0 auto;
  position: relative;
  margin: 0;
  padding: 8px 10px 10px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
}
.report-tab.active {
  color: var(--ink);
  font-weight: 650;
}
.report-tab.active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 22px;
  height: 3px;
  margin-left: -11px;
  border-radius: 99px;
  background: var(--moss);
}
.filters, label { display: grid; gap: 6px; min-width: 0; max-width: 100%; }
.filters {
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 12px;
}
@media (min-width: 801px) {
  html:not(.is-mobile) .filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .title-large,
  .title-mini { transition: none; }
}
</style>
