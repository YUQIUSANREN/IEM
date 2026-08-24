<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { formatYuan } from '../domain/money'
import { toDateInput } from '../domain/period'
import { amountClass, expenseContributionFen, formatTxAmount, incomeContributionFen, isNonCashflowTx, isRefundTx } from '../domain/tx-display'
import type { Transaction } from '../types'

/** 卡片只渲染这么多「天」；数据本身已全量在内存里。 */
const PAGE_DAYS = 12

const props = defineProps<{
  items: Transaction[]
  showDelete?: boolean
  showEdit?: boolean
  /**
   * 窗口渲染：触底只多画出几天卡片，不再向数据库要数据。
   */
  windowed?: boolean
  /** 从盘点跳转时滚到并高亮这一天（YYYY-MM-DD）。 */
  focusDate?: string
}>()

const emit = defineEmits<{
  remove: [id: number]
  edit: [tx: Transaction]
}>()

const store = useAppStore()
const feedEl = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
const shownDays = ref(PAGE_DAYS)
let observer: IntersectionObserver | null = null

interface DayGroup {
  date: string
  title: string
  expenseFen: number
  incomeFen: number
  items: Transaction[]
}

function dayTitle(date: string): string {
  const [y, m, d] = date.split('-')
  const label = `${y}.${m}.${d}`
  const now = new Date()
  const today = toDateInput(now)
  const yday = toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  if (date === today) return `${label} 今天`
  if (date === yday) return `${label} 昨天`
  return label
}

const allGroups = computed((): DayGroup[] => {
  const map = new Map<string, Transaction[]>()
  for (const tx of props.items) {
    const date = tx.occurredAt.slice(0, 10)
    const list = map.get(date) ?? []
    list.push(tx)
    map.set(date, list)
  }
  return [...map.entries()].map(([date, rows]) => {
    let expenseFen = 0
    let incomeFen = 0
    for (const tx of rows) {
      if (isNonCashflowTx(tx.type, tx.excludedFromBudget)) continue
      expenseFen += expenseContributionFen(tx)
      incomeFen += incomeContributionFen(tx)
    }
    return { date, title: dayTitle(date), expenseFen, incomeFen, items: rows }
  })
})

const groups = computed(() => {
  if (!props.windowed) return allGroups.value
  return allGroups.value.slice(0, shownDays.value)
})

const hasMoreView = computed(() => props.windowed && shownDays.value < allGroups.value.length)

function categoryName(tx: Transaction): string {
  const name = store.categories.find((item) => item.id === tx.categoryId)?.name
  if (isNonCashflowTx(tx.type, tx.excludedFromBudget)) return name ?? '不计收支'
  if (isRefundTx(tx)) return name ? `${name} · 退款` : '退款'
  return name ?? '未分类'
}

function detail(tx: Transaction): string {
  return tx.counterpart || tx.note || '—'
}

let lastTapId = -1
let lastTapAt = 0

function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

function openEdit(tx: Transaction): void {
  if (!props.showEdit) return
  emit('edit', tx)
}

/** 电脑双击；手机连点两次。避免滑动列表时误开修改。 */
function onRowPointer(tx: Transaction): void {
  if (!props.showEdit) return
  if (!isCoarsePointer()) return
  const now = Date.now()
  if (tx.id === lastTapId && now - lastTapAt < 420) {
    openEdit(tx)
    lastTapId = -1
    lastTapAt = 0
    return
  }
  lastTapId = tx.id
  lastTapAt = now
}

function findScrollRoot(el: HTMLElement): Element | null {
  let current: HTMLElement | null = el.parentElement
  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return null
}

function revealMore(): void {
  if (!hasMoreView.value) return
  shownDays.value += PAGE_DAYS
}

function ensureFocusVisible(): void {
  const date = props.focusDate
  if (!date) return
  const index = allGroups.value.findIndex((group) => group.date === date)
  if (index >= 0) shownDays.value = Math.max(shownDays.value, index + 1)
}

function bindObserver(): void {
  observer?.disconnect()
  if (!sentinel.value || !hasMoreView.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) revealMore()
    },
    { root: findScrollRoot(sentinel.value), rootMargin: '120px' },
  )
  observer.observe(sentinel.value)
}

async function scrollToFocus(): Promise<void> {
  const date = props.focusDate
  if (!date) return
  ensureFocusVisible()
  await nextTick()
  const card = feedEl.value?.querySelector<HTMLElement>(`[data-date="${date}"]`)
  card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(bindObserver)
watch([hasMoreView, () => groups.value.length], () => {
  bindObserver()
})
watch(
  () => [props.items.length, props.items[0]?.id, props.items.at(-1)?.id] as const,
  () => {
    shownDays.value = PAGE_DAYS
    ensureFocusVisible()
  },
)
watch(
  () => props.focusDate,
  () => {
    void scrollToFocus()
  },
  { immediate: true },
)
watch(() => groups.value.length, () => {
  if (props.focusDate) void scrollToFocus()
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div ref="feedEl" class="feed">
    <p v-if="!items.length" class="muted empty">没有匹配的记录。</p>
    <article
      v-for="group in groups"
      :key="group.date"
      class="day-card"
      :class="{ flash: focusDate === group.date }"
      :data-date="group.date"
    >
      <header class="day-head">
        <strong>{{ group.title }}</strong>
        <span class="muted">支{{ formatYuan(group.expenseFen) }} 收{{ formatYuan(group.incomeFen) }}</span>
      </header>
      <div
        v-for="tx in group.items"
        :key="tx.id"
        class="tx-row"
        :class="{ clickable: showEdit }"
        @click="onRowPointer(tx)"
        @dblclick="showEdit && !isCoarsePointer() ? openEdit(tx) : undefined"
      >
        <div class="tx-main">
          <div class="tx-cat">{{ categoryName(tx) }}</div>
          <div class="tx-meta muted">
            {{ tx.occurredAt.slice(11, 16) }}
            <span class="sep">|</span>
            {{ detail(tx) }}
          </div>
        </div>
        <div class="tx-side">
          <div class="tx-amt" :class="amountClass(tx.type, tx.excludedFromBudget, tx.isRefund)">
            {{ formatTxAmount(tx.amountFen, tx.type, tx.excludedFromBudget, tx.isRefund) }}
          </div>
          <div v-if="showEdit || showDelete" class="tx-actions">
            <button v-if="showEdit" class="btn ghost del" type="button" @click.stop="emit('edit', tx)">修改</button>
            <button v-if="showDelete" class="btn ghost del" type="button" @click.stop="emit('remove', tx.id)">删除</button>
          </div>
        </div>
      </div>
    </article>
    <div v-if="hasMoreView" ref="sentinel" class="sentinel" />
    <p v-else-if="windowed && items.length" class="muted status">已经到底了</p>
  </div>
</template>

<style scoped>
.feed {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.empty, .status { text-align: center; margin: 8px 0 0; }
.day-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 4px 16px 8px;
  scroll-margin-top: 12px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.day-card.flash {
  border-color: var(--moss);
  box-shadow: 0 0 0 3px var(--glow);
}
.day-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 12px 0 10px;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.day-head strong {
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.day-head .muted {
  flex: 0 0 auto;
  white-space: nowrap;
}
.tx-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.tx-row:last-child { border-bottom: 0; }
.tx-main { flex: 1; min-width: 0; }
.tx-cat {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx-meta {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sep { margin: 0 4px; opacity: 0.6; }
.tx-side {
  flex: 0 0 auto;
  text-align: right;
  max-width: 46%;
}
.tx-amt {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tx-row.clickable { cursor: pointer; }
.tx-actions { display: flex; gap: 8px; justify-content: flex-end; }
.del { padding: 0; min-height: 0; font-size: 12px; }
.sentinel { height: 1px; }
</style>
