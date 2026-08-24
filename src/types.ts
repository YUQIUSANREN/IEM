/** 金额统一用分存储，避免浮点误差。 */
export type TxType = 'expense' | 'income' | 'transfer'
export type TxSource = 'manual' | 'alipay' | 'wechat' | 'icbc' | 'notification' | 'email'
export type CategoryKind = 'expense' | 'income' | 'transfer'
export type ImportStatus = 'new' | 'duplicate' | 'possible_duplicate'
export type NotifyInboxStatus = 'pending' | 'accepted' | 'ignored'

export interface Category {
  id: number
  name: string
  kind: CategoryKind
  sortOrder: number
}

export interface Transaction {
  id: number
  type: TxType
  amountFen: number
  occurredAt: string
  categoryId: number | null
  source: TxSource
  counterpart: string
  note: string
  orderNo: string
  importBatchId: number | null
  recurringRuleId: number | null
  excludedFromBudget: number
  /** 1 表示退款：账本里单独一行，统计时冲减支出，不计入收入。 */
  isRefund: number
  createdAt: string
}

export interface NewTransaction {
  type: TxType
  amountFen: number
  occurredAt: string
  categoryId: number | null
  source: TxSource
  counterpart?: string
  note?: string
  orderNo?: string
  importBatchId?: number | null
  recurringRuleId?: number | null
  excludedFromBudget?: boolean
  /** 退款冲减支出；与 type=expense 一起用。 */
  isRefund?: boolean
}

export interface BudgetPolicy {
  id: number
  periodStartDay: number
  totalLimitFen: number
  effectiveFrom: string
  createdAt: string
}

export interface CategoryBudget {
  categoryId: number
  limitFen: number
}

export interface PeriodRange {
  start: Date
  end: Date
  startIso: string
  endIso: string
  label: string
}

export interface AlertItem {
  level: 'info' | 'warn' | 'danger'
  title: string
  detail: string
}

export interface ParsedBillRow {
  type: TxType
  amountFen: number
  occurredAt: string
  counterpart: string
  note: string
  orderNo: string
  source: TxSource
  rawStatus: string
  excludedFromBudget: boolean
  isRefund?: boolean
}

export interface ImportPreviewRow extends ParsedBillRow {
  status: ImportStatus
  matchedId: number | null
  selected: boolean
}

export interface ImportBatch {
  id: number
  source: TxSource
  fileName: string
  importedAt: string
  importedCount: number
  skippedCount: number
}

export interface RecurringRule {
  id: number
  type: TxType
  amountFen: number
  categoryId: number | null
  dayOfMonth: number
  note: string
  enabled: number
}

export interface PeriodReport {
  startIso: string
  endIso: string
  totalLimitFen: number
  effectiveLimitFen: number
  incomeCountsTowardBudget: boolean
  incomeFen: number
  expenseFen: number
  remainingFen: number
  overspent: boolean
  overspendDays: number
  prevExpenseFen: number | null
  prevIncomeFen: number | null
  prevRemainingFen: number | null
  prevOverspendDays: number | null
  categoryBreakdown: Array<{
    categoryId: number | null
    name: string
    expenseFen: number
    prevExpenseFen: number
    limitFen: number | null
  }>
  suggestions: string[]
}
