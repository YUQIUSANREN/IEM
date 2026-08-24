import type { PeriodRange, Transaction } from '../types'
import { eachDateIso } from './period'
import { expenseContributionFen, isNonCashflowTx, isRefundTx } from './tx-display'

export interface CategorySlice {
  name: string
  expenseFen: number
  count: number
  percent: number
  /** 比较时对比期同类支出；不比较则为 null。 */
  prevExpenseFen: number | null
  prevCount: number | null
  prevPercent: number | null
}

export interface PeriodChartModel {
  /** 横轴实际日期 YYYY-MM-DD，按时间排序；比较时为两个周期的并集，不对齐重叠。 */
  days: string[]
  labels: string[]
  /** 分；该日不属于本期则为 null，避免和对比期画在同一根柱上。 */
  primaryByDay: Array<number | null>
  compareByDay: Array<number | null> | null
  slices: CategorySlice[]
  compareSlices: CategorySlice[] | null
  totalExpenseFen: number
  compareExpenseFen: number | null
}

function isExpenseTx(tx: Transaction): boolean {
  return tx.type === 'expense' && !isNonCashflowTx(tx.type, tx.excludedFromBudget)
}

function inRange(tx: Transaction, startIso: string, endIso: string): boolean {
  return tx.occurredAt >= startIso && tx.occurredAt <= endIso
}

function mdOf(date: string): string {
  if (!date) return ''
  return date.slice(5).replace('-', '.')
}

function axisLabel(date: string, days: string[]): string {
  const years = new Set(days.map((item) => item.slice(0, 4)))
  if (years.size > 1) return `${date.slice(2, 4)}.${mdOf(date)}`
  return mdOf(date)
}

function sumByDay(txs: Transaction[], startIso: string, endIso: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const tx of txs) {
    if (!isExpenseTx(tx) || !inRange(tx, startIso, endIso)) continue
    const day = tx.occurredAt.slice(0, 10)
    map.set(day, (map.get(day) ?? 0) + expenseContributionFen(tx))
  }
  return map
}

function unionDays(primary: string[], compare: string[] | null): string[] {
  const set = new Set(primary)
  if (compare) for (const day of compare) set.add(day)
  return [...set].sort()
}

function buildSlices(
  txs: Transaction[],
  startIso: string,
  endIso: string,
  categoryNames: Map<number, string>,
): { slices: CategorySlice[]; totalExpenseFen: number } {
  const byCat = new Map<string, { expenseFen: number; count: number }>()
  let totalExpenseFen = 0
  for (const tx of txs) {
    if (!isExpenseTx(tx) || !inRange(tx, startIso, endIso)) continue
    const name = (tx.categoryId != null ? categoryNames.get(tx.categoryId) : undefined) ?? '未分类'
    const row = byCat.get(name) ?? { expenseFen: 0, count: 0 }
    row.expenseFen += expenseContributionFen(tx)
    if (!isRefundTx(tx)) row.count += 1
    byCat.set(name, row)
    totalExpenseFen += expenseContributionFen(tx)
  }
  const slices = [...byCat.entries()]
    .filter(([, row]) => row.expenseFen > 0)
    .map(([name, row]) => ({
      name,
      expenseFen: row.expenseFen,
      count: row.count,
      percent: totalExpenseFen ? (row.expenseFen / totalExpenseFen) * 100 : 0,
      prevExpenseFen: null,
      prevCount: null,
      prevPercent: null,
    }))
    .sort((a, b) => b.expenseFen - a.expenseFen)
  return { slices, totalExpenseFen }
}

function mergeSlices(primary: CategorySlice[], compare: CategorySlice[]): CategorySlice[] {
  const cmap = new Map(compare.map((item) => [item.name, item]))
  const seen = new Set<string>()
  const rows: CategorySlice[] = []
  for (const item of primary) {
    seen.add(item.name)
    const prev = cmap.get(item.name)
    rows.push({
      ...item,
      prevExpenseFen: prev?.expenseFen ?? 0,
      prevCount: prev?.count ?? 0,
      prevPercent: prev?.percent ?? 0,
    })
  }
  for (const item of compare) {
    if (seen.has(item.name)) continue
    rows.push({
      name: item.name,
      expenseFen: 0,
      count: 0,
      percent: 0,
      prevExpenseFen: item.expenseFen,
      prevCount: item.count,
      prevPercent: item.percent,
    })
  }
  return rows
}

function valuesOnAxis(
  days: string[],
  owned: Set<string>,
  map: Map<string, number>,
): Array<number | null> {
  return days.map((day) => (owned.has(day) ? map.get(day) ?? 0 : null))
}

/**
 * 盘点图表：用已经全量加载的流水聚合。
 * 比较时横轴按实际日期排开，两个周期各占自己的日子，不强制重叠。
 */
export function buildPeriodChartModel(
  primary: PeriodRange,
  compare: PeriodRange | null,
  txs: Transaction[],
  categoryNames: Map<number, string>,
): PeriodChartModel {
  const primaryDays = eachDateIso(primary.start, primary.end)
  const compareDays = compare ? eachDateIso(compare.start, compare.end) : null
  const days = unionDays(primaryDays, compareDays)
  const primaryOwned = new Set(primaryDays)
  const primaryMap = sumByDay(txs, primary.startIso, primary.endIso)
  const primarySlices = buildSlices(txs, primary.startIso, primary.endIso, categoryNames)
  const compareBuilt = compare
    ? buildSlices(txs, compare.startIso, compare.endIso, categoryNames)
    : null

  return {
    days,
    labels: days.map((day) => axisLabel(day, days)),
    primaryByDay: valuesOnAxis(days, primaryOwned, primaryMap),
    compareByDay: compare && compareDays
      ? valuesOnAxis(days, new Set(compareDays), sumByDay(txs, compare.startIso, compare.endIso))
      : null,
    slices: compareBuilt ? mergeSlices(primarySlices.slices, compareBuilt.slices) : primarySlices.slices,
    compareSlices: compareBuilt?.slices ?? null,
    totalExpenseFen: primarySlices.totalExpenseFen,
    compareExpenseFen: compareBuilt?.totalExpenseFen ?? null,
  }
}

/** 折线/柱状 tooltip 用：08.19支出 ￥127.06 */
export function formatExpenseTip(dateOrMd: string, fen: number): string {
  const md = dateOrMd.includes('-') ? dateOrMd.slice(5).replace('-', '.') : dateOrMd
  const yuan = (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${md}支出 ￥${yuan}`
}

export function formatYuanMark(fen: number): string {
  return `￥${(fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
