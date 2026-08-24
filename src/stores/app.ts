import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { initDb } from '../db/client'
import {
  buildDashboard,
  completeOnboarding,
  ensureClosedSnapshots,
  generateRecurring,
  getBookBalance,
  getPeriodStartDay,
  isOnboarded,
  listCategories,
  listTransactions,
} from '../domain/engine'
import { getPeriodByDate, listSelectablePeriods } from '../domain/period'
import { drainNotifyQueue } from '../platform/notify-listener'
import type { Category, Transaction } from '../types'

export const useAppStore = defineStore('app', () => {
  const ready = ref(false)
  const bootError = ref('')
  const onboarded = ref(false)
  const categories = ref<Category[]>([])
  const selectedPeriodStartIso = ref('')
  const dashboard = ref<ReturnType<typeof buildDashboard>>(
    buildEmptyDashboard() as ReturnType<typeof buildDashboard>,
  )
  const showRecord = ref(false)
  const editingTx = ref<Transaction | null>(null)
  const showCategories = ref(false)
  const showCalibrate = ref(false)
  const dataRev = ref(0)
  const bookBalanceFen = ref(0)
  /** 全量流水。卡片只窗口渲染，盘点/搜索都用这份，不再触底向库追加。 */
  const transactions = ref<Transaction[]>([])

  const hasBudget = computed(() => Boolean(dashboard.value.policy))

  async function boot(): Promise<void> {
    try {
      await initDb()
      await drainNotifyQueue()
      onboarded.value = isOnboarded()
      categories.value = listCategories()
      generateRecurring()
      ensureClosedSnapshots()
      selectedPeriodStartIso.value = getPeriodByDate(new Date(), getPeriodStartDay()).startIso
      refreshDashboard()
      ready.value = true
    } catch (error) {
      bootError.value = error instanceof Error ? error.message : '初始化失败'
    }
  }

  function refreshDashboard(): void {
    const startDay = getPeriodStartDay()
    transactions.value = listTransactions('')
    const choices = listSelectablePeriods(startDay, transactions.value)
    const liveStart = getPeriodByDate(new Date(), startDay).startIso
    const selected = selectedPeriodStartIso.value
    const listed = choices.find((item) => item.startIso === selected)
    /**
     * 日历点选可能落到「没有流水」的周期，下拉列表里没有这一档。
     * 只要仍是合法周期起点就保留，避免刷新后弹回本周期。
     */
    const fromIso = selected ? getPeriodByDate(new Date(selected), startDay) : null
    const keep = listed ?? (fromIso && fromIso.startIso === selected ? fromIso : null)
    if (!keep) selectedPeriodStartIso.value = liveStart
    const match =
      choices.find((item) => item.startIso === selectedPeriodStartIso.value) ??
      getPeriodByDate(new Date(selectedPeriodStartIso.value), startDay)
    dashboard.value = buildDashboard(match.start)
    categories.value = listCategories()
    onboarded.value = isOnboarded()
    bookBalanceFen.value = getBookBalance()
    dataRev.value += 1
  }

  function openRecord(tx: Transaction | null = null): void {
    editingTx.value = tx
    showRecord.value = true
  }

  function closeRecord(): void {
    showRecord.value = false
    editingTx.value = null
  }

  function openCategories(): void {
    showCategories.value = true
  }

  function closeCategories(): void {
    showCategories.value = false
  }

  function openCalibrate(): void {
    showCalibrate.value = true
  }

  function closeCalibrate(): void {
    showCalibrate.value = false
  }

  function selectPeriod(startIso: string): void {
    selectedPeriodStartIso.value = startIso
    refreshDashboard()
  }

  function finishOnboarding(): void {
    completeOnboarding()
    onboarded.value = true
    refreshDashboard()
  }

  return {
    ready,
    bootError,
    onboarded,
    categories,
    selectedPeriodStartIso,
    dashboard,
    showRecord,
    editingTx,
    showCategories,
    showCalibrate,
    dataRev,
    bookBalanceFen,
    transactions,
    hasBudget,
    boot,
    refreshDashboard,
    selectPeriod,
    finishOnboarding,
    openRecord,
    closeRecord,
    openCategories,
    closeCategories,
    openCalibrate,
    closeCalibrate,
  }
})

function buildEmptyDashboard() {
  return {
    period: { start: new Date(), end: new Date(), startIso: '', endIso: '', label: '' },
    isCurrentPeriod: true,
    policy: null,
    spentFen: 0,
    incomeFen: 0,
    incomeCountsTowardBudget: false,
    effectiveLimitFen: 0,
    remainingFen: 0,
    remainingDays: 0,
    morningShareFen: 0,
    todayAllowanceFen: 0,
    todaySpentFen: 0,
    todayIncomeFen: 0,
    todayOverspent: false,
    categoryStatuses: [] as Array<{
      categoryId: number
      limitFen: number
      usedFen: number
      dailyFen: number
      over: boolean
    }>,
    alerts: [] as Array<{ level: 'info' | 'warn' | 'danger'; title: string; detail: string }>,
    bookBalanceFen: 0,
  }
}
