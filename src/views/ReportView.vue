<script setup lang="ts">
import { computed, ref } from 'vue'
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

const store = useAppStore()
const router = useRouter()
const periodKey = ref(store.selectedPeriodStartIso)
const compareKey = ref('prev')
const customStart = ref(toDateInput(store.dashboard.period.start))
const customEnd = ref(toDateInput(store.dashboard.period.end))

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
</script>

<template>
  <section class="page">
    <h1>周期盘点</h1>
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
    <article class="card">
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
    <article class="card">
      <h2>建议</h2>
      <ul>
        <li v-for="item in report.suggestions" :key="item">{{ item }}</li>
      </ul>
    </article>
  </section>
</template>

<style scoped>
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
</style>
