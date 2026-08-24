import dayjs from 'dayjs'
import type { PeriodRange } from '../types'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

/**
 * 将起始日钳制到当月最后一天，避免 31 号在 2 月溢出到下月。
 */
function clampedDate(year: number, monthIndex: number, day: number): Date {
  const last = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(day, last), 0, 0, 0, 0)
}

/**
 * 按「每月 startDay 到下月 startDay-1」现算周期，不落库。
 * 没有 31 日的月份落到月末：比较的是当月钳制后的起始日，而不是裸的 31。
 */
export function getPeriodByDate(ref: Date, startDay: number): PeriodRange {
  const day = Math.min(Math.max(startDay, 1), 31)
  const thisMonthStart = clampedDate(ref.getFullYear(), ref.getMonth(), day)
  const start =
    startOfDay(ref) >= thisMonthStart
      ? thisMonthStart
      : clampedDate(ref.getFullYear(), ref.getMonth() - 1, day)
  const nextStart = clampedDate(start.getFullYear(), start.getMonth() + 1, day)
  const end = new Date(nextStart.getTime() - 1)
  return toRange(start, end)
}

/**
 * 按起始月平移周期。必须走 clampedDate，避免 7 月 31 日 setMonth(-1) 变成 7 月 1 日、和本周期重叠。
 */
export function shiftPeriod(period: PeriodRange, delta: number, startDay: number): PeriodRange {
  const probe = clampedDate(period.start.getFullYear(), period.start.getMonth() + delta, startDay)
  return getPeriodByDate(probe, startDay)
}

function toRange(start: Date, end: Date): PeriodRange {
  return {
    start,
    end,
    startIso: toLocalIso(start),
    endIso: toLocalIso(end),
    label: `${dayjs(start).format('YYYY-MM-DD')} 至 ${dayjs(end).format('YYYY-MM-DD')}`,
  }
}

/**
 * 含首尾的日历日列表，格式 YYYY-MM-DD。图表横轴按天铺满，没有账单的日子记 0。
 */
export function eachDateIso(start: Date, end: Date): string[] {
  const days: string[] = []
  let cursor = startOfDay(start)
  const last = startOfDay(end)
  while (cursor.getTime() <= last.getTime()) {
    days.push(toDateInput(cursor))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  }
  return days
}

export function remainingDaysInclusive(end: Date, now = new Date()): number {
  const today = startOfDay(now)
  const last = startOfDay(end)
  const diff = Math.floor((last.getTime() - today.getTime()) / 86400000) + 1
  return Math.max(diff, 0)
}

/**
 * 用起始日推导结束日文案。结束日不可选：1 日起算则到月末，其余为次月「起始日 - 1」。
 */
export function describePeriodRule(startDay: number): {
  startDay: number
  endDay: number | null
  endDayLabel: string
  summary: string
} {
  const day = Math.min(Math.max(Math.round(startDay) || 1, 1), 31)
  if (day === 1) {
    return {
      startDay: 1,
      endDay: null,
      endDayLabel: '当月最后一天',
      summary: '每月 1 日 至 当月最后一天',
    }
  }
  return {
    startDay: day,
    endDay: day - 1,
    endDayLabel: `次月 ${day - 1} 日`,
    summary: `每月 ${day} 日 至 次月 ${day - 1} 日`,
  }
}

/**
 * 周期下拉：从当前周期往回 `back` 档。
 * 本周期就是最新一档，默认不提供尚未开始的下一周期。
 */
export function listPeriodChoices(startDay: number, back = 17, forward = 0): PeriodRange[] {
  const current = getPeriodByDate(new Date(), startDay)
  const items: PeriodRange[] = []
  const seen = new Set<string>()
  for (let delta = -back; delta <= forward; delta += 1) {
    const item = delta === 0 ? current : shiftPeriod(current, delta, startDay)
    if (seen.has(item.startIso)) continue
    seen.add(item.startIso)
    items.push(item)
  }
  return items.reverse()
}

/**
 * 给周期下拉用：只列出「有流水」的周期，避免空档让人以为有账。
 * 本周期即使还没记账也保留，那是正在过的窗口，不是历史空档。
 */
export function listSelectablePeriods(
  startDay: number,
  txs: Array<{ occurredAt: string }>,
): PeriodRange[] {
  const current = getPeriodByDate(new Date(), startDay)
  const seen = new Map<string, PeriodRange>()
  seen.set(current.startIso, current)
  for (const tx of txs) {
    const when = new Date(tx.occurredAt)
    if (Number.isNaN(when.getTime())) continue
    const period = getPeriodByDate(when, startDay)
    seen.set(period.startIso, period)
  }
  return [...seen.values()].sort((a, b) => (a.startIso < b.startIso ? 1 : -1))
}

export function parseFlexibleDate(text: string): Date | null {
  const raw = text.trim().replace(/\//g, '-')
  const parsed = dayjs(raw)
  if (!parsed.isValid()) return null
  return parsed.toDate()
}
