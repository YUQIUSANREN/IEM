<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { getPeriodStartDay } from '../domain/engine'
import { formatYuan } from '../domain/money'
import { getPeriodByDate, toDateInput } from '../domain/period'
import { expenseContributionFen, incomeContributionFen, isNonCashflowTx } from '../domain/tx-display'
import { toast } from '../ui/toast'

type CashMode = 'income' | 'expense' | 'net'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const
const MODES: Array<{ id: CashMode; label: string }> = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '收入' },
  { id: 'net', label: '收支总和' },
]
const DOUBLE_TAP_MS = 420

const store = useAppStore()
const router = useRouter()
const mode = ref<CashMode>('net')
const cursor = ref(startOfMonth(new Date()))
let lastTapAt = 0
let lastTapDate = ''
let lastJumpAt = 0
let lastJumpDate = ''

interface DayCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  inPeriod: boolean
  incomeFen: number
  expenseFen: number
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function shiftMonth(delta: number): void {
  const cur = cursor.value
  cursor.value = new Date(cur.getFullYear(), cur.getMonth() + delta, 1)
}

const todayIso = computed(() => toDateInput(new Date()))

const byDay = computed(() => {
  const map = new Map<string, { incomeFen: number; expenseFen: number }>()
  for (const tx of store.transactions) {
    if (isNonCashflowTx(tx.type, tx.excludedFromBudget)) continue
    const day = tx.occurredAt.slice(0, 10)
    const row = map.get(day) ?? { incomeFen: 0, expenseFen: 0 }
    row.incomeFen += incomeContributionFen(tx)
    row.expenseFen += expenseContributionFen(tx)
    map.set(day, row)
  }
  return map
})

const monthLabel = computed(() => {
  const cur = cursor.value
  return `${cur.getFullYear()}年${cur.getMonth() + 1}月`
})

/**
 * 按周日开头铺满当月格子；月初空白格 date 为空，只占位。
 */
const cells = computed((): Array<DayCell | null> => {
  const cur = cursor.value
  const year = cur.getFullYear()
  const month = cur.getMonth()
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const lead = first.getDay()
  const period = store.dashboard.period
  const periodStart = period.startIso.slice(0, 10)
  const periodEnd = period.endIso.slice(0, 10)
  const today = todayIso.value
  const out: Array<DayCell | null> = []
  for (let i = 0; i < lead; i += 1) out.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const sums = byDay.value.get(date)
    out.push({
      date,
      day,
      inMonth: true,
      isToday: date === today,
      inPeriod: Boolean(periodStart) && date >= periodStart && date <= periodEnd,
      incomeFen: sums?.incomeFen ?? 0,
      expenseFen: sums?.expenseFen ?? 0,
    })
  }
  while (out.length % 7 !== 0) out.push(null)
  return out
})

watch(
  () => store.dashboard.period.startIso,
  (iso) => {
    if (!iso) return
    const start = new Date(iso)
    const end = store.dashboard.period.end
    const viewStart = cursor.value
    const viewEnd = new Date(viewStart.getFullYear(), viewStart.getMonth() + 1, 0, 23, 59, 59)
    if (viewEnd < start || viewStart > end) cursor.value = startOfMonth(start)
  },
)

/**
 * 当前查看模式下这一天要展示的分；无数据或还没到的日子返回 null。
 */
function cellAmount(cell: DayCell): number | null {
  if (cell.date > todayIso.value) return null
  if (mode.value === 'income') return cell.incomeFen || null
  if (mode.value === 'expense') return cell.expenseFen || null
  const net = cell.incomeFen - cell.expenseFen
  if (!cell.incomeFen && !cell.expenseFen) return null
  return net
}

function amountTone(fen: number | null): 'up' | 'down' | 'flat' {
  if (fen == null || fen === 0) return 'flat'
  if (mode.value === 'expense') return fen > 0 ? 'down' : 'up'
  if (mode.value === 'income') return 'up'
  return fen > 0 ? 'up' : 'down'
}

function formatCell(fen: number | null): string {
  if (fen == null) return '-'
  if (fen < 0) return `-${formatYuan(-fen)}`
  return formatYuan(fen)
}

function pickDay(cell: DayCell): void {
  const period = getPeriodByDate(new Date(`${cell.date}T12:00:00`), getPeriodStartDay())
  store.selectPeriod(period.startIso)
}

function emptyDayLabel(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日没有流水`
}

/**
 * 有收入/支出才进账本。空格子只提示一声，连点会同时触发 click 二次和 dblclick，500ms 内同一天只处理一次。
 */
function openLedgerDay(cell: DayCell): void {
  const now = Date.now()
  if (cell.date === lastJumpDate && now - lastJumpAt < 500) return
  lastJumpDate = cell.date
  lastJumpAt = now
  if (!cell.incomeFen && !cell.expenseFen) {
    toast('info', emptyDayLabel(cell.date))
    return
  }
  void router.push({ name: 'ledger', query: { day: cell.date } })
}

/**
 * 单击仍切周期。桌面 dblclick、触屏连点两次都进账本；html 的 pan-y 经常吞掉 dblclick，所以连点也认。
 */
function onDayClick(cell: DayCell): void {
  pickDay(cell)
  const now = Date.now()
  if (cell.date === lastTapDate && now - lastTapAt < DOUBLE_TAP_MS) {
    lastTapAt = 0
    lastTapDate = ''
    openLedgerDay(cell)
    return
  }
  lastTapAt = now
  lastTapDate = cell.date
}

function onDayDblClick(cell: DayCell): void {
  lastTapAt = 0
  lastTapDate = ''
  openLedgerDay(cell)
}
</script>

<template>
  <article class="card cal">
    <div class="cal-toolbar">
      <div class="tabs cal-modes" role="tablist" aria-label="日历金额口径">
        <button
          v-for="item in MODES"
          :key="item.id"
          type="button"
          class="tab"
          :class="{ active: mode === item.id }"
          @click="mode = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="cal-month">
        <button class="cal-nav" type="button" aria-label="上个月" @click="shiftMonth(-1)">‹</button>
        <strong>{{ monthLabel }}</strong>
        <button class="cal-nav" type="button" aria-label="下个月" @click="shiftMonth(1)">›</button>
      </div>
    </div>
    <div class="cal-week">
      <span v-for="name in WEEKDAYS" :key="name">{{ name }}</span>
    </div>
    <div class="cal-grid">
      <button
        v-for="(cell, index) in cells"
        :key="cell?.date ?? `pad-${index}`"
        type="button"
        class="cal-cell"
        :class="cell
          ? [amountTone(cellAmount(cell)), { today: cell.isToday, 'in-period': cell.inPeriod && !cell.isToday }]
          : 'pad'"
        :disabled="!cell"
        @click="cell && onDayClick(cell)"
        @dblclick.prevent.stop="cell && onDayDblClick(cell)"
      >
        <template v-if="cell">
          <span class="cal-day">{{ cell.isToday ? '今天' : cell.day }}</span>
          <span class="cal-amt">{{ formatCell(cellAmount(cell)) }}</span>
        </template>
      </button>
    </div>
    <p class="muted hint">双击某一天可跳到账本里那天的卡片（手机上连点两次）。</p>
  </article>
</template>

<style scoped>
.cal {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.cal-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.cal-modes {
  flex: 1 1 auto;
  min-width: 0;
}
.cal-modes .tab {
  padding: 6px 10px;
  font-size: 13px;
}
.cal-month {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.cal-month strong {
  min-width: 7.5em;
  text-align: center;
  font-size: 15px;
  font-family: inherit;
}
.cal-nav {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.cal-nav:active { background: var(--hover); }
.cal-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
.cal-cell {
  min-width: 0;
  min-height: 58px;
  padding: 6px 2px 5px;
  border: 0;
  border-radius: 12px;
  background: var(--soft);
  color: inherit;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 2px;
  cursor: pointer;
}
.cal-cell.pad {
  background: transparent;
  cursor: default;
  pointer-events: none;
}
.cal-cell.in-period {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--moss) 45%, transparent);
}
.cal-cell.today {
  background: color-mix(in srgb, var(--moss) 42%, var(--card));
  color: var(--ink);
}
.cal-cell.up { background: var(--kind-income-bg); }
.cal-cell.down { background: var(--kind-expense-bg); }
.cal-cell.today.up,
.cal-cell.today.down {
  background: color-mix(in srgb, var(--moss) 42%, var(--card));
}
.cal-day {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}
.cal-amt {
  font-size: 10px;
  line-height: 1.2;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-cell.up .cal-amt { color: var(--kind-income); }
.cal-cell.down .cal-amt { color: var(--kind-expense); }
.cal-cell.today .cal-amt { color: inherit; }
.hint { margin: 0; font-size: 12px; }
@media (hover: hover) {
  .cal-nav:hover { background: var(--hover); }
  .cal-cell:not(.pad):hover { filter: brightness(0.97); }
}
</style>
