import type {
  AlertItem,
  BudgetPolicy,
  Category,
  CategoryBudget,
  ImportBatch,
  ImportPreviewRow,
  NewTransaction,
  ParsedBillRow,
  PeriodRange,
  PeriodReport,
  RecurringRule,
  Transaction,
  TxSource,
} from '../types'
import { getMeta, query, queryOne, queryValue, run, setMeta, withTx } from '../db/client'
import { findDuplicate, guessCategoryId, isProtectedCategory } from './dedupe'
import { fenToYuan } from './money'
import {
  getPeriodByDate,
  remainingDaysInclusive,
  shiftPeriod,
  startOfDay,
  toLocalIso,
} from './period'

interface TxRow {
  id: number
  type: string
  amount_fen: number
  occurred_at: string
  category_id: number | null
  source: string
  counterpart: string
  note: string
  order_no: string
  import_batch_id: number | null
  recurring_rule_id: number | null
  excluded_from_budget: number
  is_refund: number
  created_at: string
}

function mapTx(row: TxRow): Transaction {
  return {
    id: row.id,
    type: row.type as Transaction['type'],
    amountFen: row.amount_fen,
    occurredAt: row.occurred_at,
    categoryId: row.category_id,
    source: row.source as Transaction['source'],
    counterpart: row.counterpart,
    note: row.note,
    orderNo: row.order_no,
    importBatchId: row.import_batch_id,
    recurringRuleId: row.recurring_rule_id,
    excludedFromBudget: row.excluded_from_budget,
    isRefund: row.is_refund ?? 0,
    createdAt: row.created_at,
  }
}

export function listCategories(): Category[] {
  return query<{ id: number; name: string; kind: Category['kind']; sort_order: number }>(
    'SELECT id, name, kind, sort_order FROM categories ORDER BY sort_order, id',
  ).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    sortOrder: row.sort_order,
  }))
}

function requireCategory(id: number): Category {
  const cat = listCategories().find((item) => item.id === id)
  if (!cat) throw new Error('分类不存在')
  return cat
}

export function countCategoryUsage(id: number): number {
  return queryValue<number>('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?', [id], 'c') ?? 0
}

/**
 * 同一收支方向下已有同名则直接返回，方便记一笔现加现用。
 */
export function addCategory(name: string, kind: Category['kind']): number {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请输入分类名称')
  if (trimmed.length > 12) throw new Error('分类名称不要超过 12 个字')
  const existed = listCategories().find((item) => item.kind === kind && item.name === trimmed)
  if (existed) return existed.id
  const maxSort =
    queryValue<number>('SELECT COALESCE(MAX(sort_order), 0) AS n FROM categories WHERE kind = ?', [kind], 'n') ?? 0
  run('INSERT INTO categories (name, kind, sort_order) VALUES (?, ?, ?)', [trimmed, kind, maxSort + 1])
  return queryValue<number>('SELECT last_insert_rowid() AS id', [], 'id') ?? 0
}

export function renameCategory(id: number, name: string): void {
  const cat = requireCategory(id)
  if (isProtectedCategory(cat)) throw new Error('「其他支出」和「其他收入」不能改名')
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请输入分类名称')
  if (trimmed.length > 12) throw new Error('分类名称不要超过 12 个字')
  const clash = listCategories().find((item) => item.kind === cat.kind && item.name === trimmed && item.id !== id)
  if (clash) throw new Error('同一方向下已有同名分类')
  run('UPDATE categories SET name = ? WHERE id = ?', [trimmed, id])
}

/**
 * 删除分类：支出流水改挂其他支出，收入改挂其他收入，不计收支改为无分类。
 * 该分类的限额和周期规则一并清掉，避免指向已删除的 id。
 */
export function deleteCategory(id: number): void {
  const cat = requireCategory(id)
  if (isProtectedCategory(cat)) throw new Error('「其他支出」和「其他收入」不能删除')
  let fallbackId: number | null = null
  if (cat.kind === 'expense' || cat.kind === 'income') {
    const fallbackName = cat.kind === 'expense' ? '其他支出' : '其他收入'
    fallbackId = listCategories().find((item) => item.kind === cat.kind && item.name === fallbackName)?.id ?? null
    if (fallbackId == null) throw new Error(`找不到兜底分类「${fallbackName}」`)
  }
  withTx(() => {
    run('UPDATE transactions SET category_id = ? WHERE category_id = ?', [fallbackId, id])
    run('UPDATE recurring_rules SET category_id = ? WHERE category_id = ?', [fallbackId, id])
    run('DELETE FROM category_budget_policies WHERE category_id = ?', [id])
    run('DELETE FROM categories WHERE id = ?', [id])
  })
}

export interface TxListOptions {
  offset?: number
  /** 实验室表格等「显示分页」才传。账本/盘点用内存里的全量列表。 */
  limit?: number
  /** 含起止，ISO 本地时间。 */
  startIso?: string
  endIso?: string
}

const SOURCE_HINT: Record<string, string> = {
  手动: 'manual',
  支付宝: 'alipay',
  微信: 'wechat',
  工行: 'icbc',
  通知: 'notification',
  邮件: 'email',
}

function txSearchClause(keyword: string): { sql: string; params: Array<string | number> } {
  const kw = keyword.trim()
  if (!kw) return { sql: '', params: [] }
  const like = `%${kw}%`
  const typeHint =
    kw === '收入' || kw.toLowerCase() === 'income'
      ? 'income'
      : kw === '支出' || kw.toLowerCase() === 'expense'
        ? 'expense'
        : ''
  const skipHint = kw === '不计收支' || kw.toLowerCase() === 'transfer' ? 1 : 0
  const refundHint = kw === '退款' ? 1 : 0
  const source = SOURCE_HINT[kw] ?? ''
  return {
    sql: `AND (
      counterpart LIKE ? OR note LIKE ? OR order_no LIKE ?
      OR IFNULL((SELECT name FROM categories WHERE id = transactions.category_id), '') LIKE ?
      OR (? != '' AND type = ?)
      OR (? != '' AND source = ?)
      OR (? = 1 AND (type = 'transfer' OR excluded_from_budget = 1))
      OR (? = 1 AND IFNULL(is_refund, 0) = 1)
    )`,
    params: [like, like, like, like, typeHint, typeHint, source, source, skipHint, refundHint],
  }
}

/**
 * 与 SQL 搜索同一套规则，给已经全量加载的内存列表用。
 */
export function matchTransactionKeyword(
  tx: Transaction,
  keyword: string,
  categoryName = '',
): boolean {
  const kw = keyword.trim()
  if (!kw) return true
  const lower = kw.toLowerCase()
  const typeHint =
    kw === '收入' || lower === 'income' ? 'income' : kw === '支出' || lower === 'expense' ? 'expense' : ''
  const source = SOURCE_HINT[kw] ?? ''
  if (typeHint && tx.type === typeHint) return true
  if (source && tx.source === source) return true
  if ((kw === '不计收支' || lower === 'transfer') && (tx.type === 'transfer' || tx.excludedFromBudget)) {
    return true
  }
  if (kw === '退款' && tx.isRefund) return true
  return [tx.counterpart, tx.note, tx.orderNo, categoryName].some((text) =>
    text.toLowerCase().includes(lower),
  )
}

export function countTransactions(keyword = ''): number {
  const search = txSearchClause(keyword)
  return (
    queryValue<number>(
      `SELECT COUNT(*) AS c FROM transactions WHERE 1=1 ${search.sql}`,
      search.params,
      'c',
    ) ?? 0
  )
}

/**
 * 按时间倒序列出流水。启动时一次拉全量进内存；limit 只留给需要显示分页的调用。
 */
export function listTransactions(keyword = '', options: TxListOptions = {}): Transaction[] {
  const search = txSearchClause(keyword)
  const params: Array<string | number> = [...search.params]
  let sql = `SELECT * FROM transactions WHERE 1=1 ${search.sql}`
  if (options.startIso) {
    sql += ' AND occurred_at >= ?'
    params.push(options.startIso)
  }
  if (options.endIso) {
    sql += ' AND occurred_at <= ?'
    params.push(options.endIso)
  }
  sql += ' ORDER BY occurred_at DESC, id DESC'
  if (options.limit != null) {
    sql += ' LIMIT ? OFFSET ?'
    params.push(options.limit, options.offset ?? 0)
  }
  return query<TxRow>(sql, params).map(mapTx)
}

export function addTransaction(input: NewTransaction): number {
  const now = toLocalIso(new Date())
  run(
    `INSERT INTO transactions
      (type, amount_fen, occurred_at, category_id, source, counterpart, note, order_no,
       import_batch_id, recurring_rule_id, excluded_from_budget, is_refund, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.type,
      input.amountFen,
      input.occurredAt,
      input.categoryId,
      input.source,
      input.counterpart ?? '',
      input.note ?? '',
      input.orderNo ?? '',
      input.importBatchId ?? null,
      input.recurringRuleId ?? null,
      input.excludedFromBudget ? 1 : 0,
      input.type === 'expense' && input.isRefund ? 1 : 0,
      now,
    ],
  )
  return queryValue<number>('SELECT last_insert_rowid() AS id', [], 'id') ?? 0
}

export function deleteTransaction(id: number): void {
  withTx(() => {
    run(
      `UPDATE notification_inbox
       SET status = 'pending', transaction_id = NULL
       WHERE transaction_id = ?`,
      [id],
    )
    run('DELETE FROM transactions WHERE id = ?', [id])
  })
}

export function updateTransaction(
  id: number,
  patch: {
    type: NewTransaction['type']
    amountFen: number
    occurredAt: string
    categoryId: number | null
    counterpart: string
    note: string
    excludedFromBudget: boolean
    isRefund?: boolean
  },
): void {
  const keepRefund =
    patch.isRefund !== undefined
      ? patch.isRefund
      : Boolean(queryValue<number>('SELECT is_refund AS n FROM transactions WHERE id = ?', [id], 'n'))
  const isRefund = patch.type === 'expense' && keepRefund ? 1 : 0
  run(
    `UPDATE transactions
     SET type=?, amount_fen=?, occurred_at=?, category_id=?, counterpart=?, note=?, excluded_from_budget=?, is_refund=?
     WHERE id=?`,
    [
      patch.type,
      patch.amountFen,
      patch.occurredAt,
      patch.categoryId,
      patch.counterpart,
      patch.note,
      patch.excludedFromBudget ? 1 : 0,
      isRefund,
      id,
    ],
  )
}

/** 当前全局周期起始日。所有周期窗口都用这个数字现算，库里没有「第 N 期起止」表。 */
export function getPeriodStartDay(): number {
  const raw = Number(getMeta('period_start_day', '16'))
  return Number.isFinite(raw) && raw >= 1 && raw <= 31 ? raw : 16
}

export function setPeriodStartDay(day: number): void {
  setMeta('period_start_day', String(day))
}

type PolicyRow = {
  id: number
  period_start_day: number
  total_limit_fen: number
  effective_from: string
  created_at: string
}

function mapPolicy(row: PolicyRow | null): BudgetPolicy | null {
  if (!row) return null
  return {
    id: row.id,
    periodStartDay: row.period_start_day,
    totalLimitFen: row.total_limit_fen,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  }
}

/**
 * 某周期该用哪条限额。
 * 先找「生效日 ≤ 该周期起始日」的最近一条（改限额后，更早已写入的周期仍用旧值）。
 * 找不到时用最近一次设定，这样尚未单独写入的历史/未来周期不会显示成「未设」。
 */
function currentPolicy(periodStartIso: string): BudgetPolicy | null {
  const matched = queryOne<PolicyRow>(
    `SELECT * FROM budget_policies
     WHERE effective_from <= ?
     ORDER BY effective_from DESC, id DESC
     LIMIT 1`,
    [periodStartIso],
  )
  if (matched) return mapPolicy(matched)
  return mapPolicy(
    queryOne<PolicyRow>(
      `SELECT * FROM budget_policies
       ORDER BY effective_from DESC, id DESC
       LIMIT 1`,
    ),
  )
}

/**
 * 收入是否抬高可用额度。默认关闭：收入只进盘点和账面余额。
 * 开启后：可用额度 = 基础限额 + 本周期收入。
 */
export function isIncomeCountedTowardBudget(): boolean {
  return getMeta('income_counts_toward_budget', '0') === '1'
}

export function setIncomeCountedTowardBudget(on: boolean): void {
  setMeta('income_counts_toward_budget', on ? '1' : '0')
}

/** 开启「收入纳入限额」时，可用额度 = 基础限额 + 本周期收入。 */
function effectiveBudgetFen(limitFen: number, incomeFen: number): number {
  return isIncomeCountedTowardBudget() ? limitFen + incomeFen : limitFen
}

export function getCategoryLimits(policyId: number): CategoryBudget[] {
  return query<{ category_id: number; limit_fen: number }>(
    'SELECT category_id, limit_fen FROM category_budget_policies WHERE policy_id = ?',
    [policyId],
  ).map((row) => ({ categoryId: row.category_id, limitFen: row.limit_fen }))
}

/**
 * 新限额从当前周期起始日生效：该日之后的周期用新值。
 * 该日之前若从未写过政策，浏览时会沿用最近一次设定；已落库流水不会被改写。
 * 起始日是全局切分规则：一改，历史/当前周期窗口都按新日子现算；旧切分留下的盘点快照会清掉。
 */
export function saveBudget(totalLimitFen: number, startDay: number, categoryLimits: CategoryBudget[]): void {
  const previousStartDay = getPeriodStartDay()
  const period = getPeriodByDate(new Date(), startDay)
  const now = toLocalIso(new Date())
  withTx(() => {
    setPeriodStartDay(startDay)
    if (previousStartDay !== startDay) {
      run('DELETE FROM period_snapshots')
    }
    run(
      `INSERT INTO budget_policies (period_start_day, total_limit_fen, effective_from, created_at)
       VALUES (?, ?, ?, ?)`,
      [startDay, totalLimitFen, period.startIso, now],
    )
    const policyId = queryValue<number>('SELECT last_insert_rowid() AS id', [], 'id') ?? 0
    for (const item of categoryLimits) {
      if (item.limitFen <= 0) continue
      run(
        'INSERT INTO category_budget_policies (policy_id, category_id, limit_fen) VALUES (?, ?, ?)',
        [policyId, item.categoryId, item.limitFen],
      )
    }
  })
}

function sumFen(startIso: string, endIso: string, type: 'expense' | 'income', categoryId?: number): number {
  const extra = categoryId != null ? 'AND category_id = ?' : ''
  const params: Array<string | number> = [startIso, endIso, type]
  if (categoryId != null) params.push(categoryId)
  const amountExpr =
    type === 'expense'
      ? 'CASE WHEN IFNULL(is_refund, 0) = 1 THEN -amount_fen ELSE amount_fen END'
      : 'amount_fen'
  return (
    queryValue<number>(
      `SELECT COALESCE(SUM(${amountExpr}), 0) AS s FROM transactions
       WHERE occurred_at >= ? AND occurred_at <= ?
         AND type = ? AND excluded_from_budget = 0 ${extra}`,
      params,
      's',
    ) ?? 0
  )
}

export function buildDashboard(refDate = new Date()) {
  const startDay = getPeriodStartDay()
  const period = getPeriodByDate(refDate, startDay)
  const live = getPeriodByDate(new Date(), startDay)
  const isCurrentPeriod = period.startIso === live.startIso
  const asOf = isCurrentPeriod ? new Date() : period.end
  const policy = currentPolicy(period.startIso)
  const spentFen = sumFen(period.startIso, period.endIso, 'expense')
  const incomeFen = sumFen(period.startIso, period.endIso, 'income')
  const todayStart = toLocalIso(startOfDay(asOf))
  const todayEnd = toLocalIso(asOf)
  const todaySpentFen = isCurrentPeriod ? sumFen(todayStart, todayEnd, 'expense') : 0
  const todayIncomeFen = isCurrentPeriod ? sumFen(todayStart, todayEnd, 'income') : 0
  const beforeTodayExpenseFen = Math.max(spentFen - todaySpentFen, 0)
  const beforeTodayIncomeFen = Math.max(incomeFen - todayIncomeFen, 0)
  const days = remainingDaysInclusive(period.end, asOf)
  const totalDays = Math.max(remainingDaysInclusive(period.end, period.start), 1)
  const limitFen = policy?.totalLimitFen ?? 0
  const incomeCountsTowardBudget = isIncomeCountedTowardBudget()
  const effectiveLimitFen = policy ? effectiveBudgetFen(limitFen, incomeFen) : 0
  const remainingFen = policy ? effectiveLimitFen - spentFen : 0
  /**
   * 今早份额：只用「今天之前」的收支摊到剩余天数。
   * 今日可用再按账单 1:1 扣今天支出、（若开启）加今天收入，花多少扣多少。
   */
  let morningShareFen = 0
  if (policy) {
    const morningLimitFen = incomeCountsTowardBudget ? limitFen + beforeTodayIncomeFen : limitFen
    const morningRemainingFen = morningLimitFen - beforeTodayExpenseFen
    if (isCurrentPeriod && days > 0) {
      morningShareFen = morningRemainingFen <= 0 ? 0 : Math.floor(morningRemainingFen / days)
    } else {
      morningShareFen = Math.max(0, Math.floor(effectiveLimitFen / totalDays))
    }
  }
  let todayAllowanceFen = morningShareFen
  if (policy && isCurrentPeriod) {
    todayAllowanceFen = morningShareFen - todaySpentFen
    if (incomeCountsTowardBudget) todayAllowanceFen += todayIncomeFen
    todayAllowanceFen = Math.max(0, todayAllowanceFen)
  }
  const todayOverspent = Boolean(
    isCurrentPeriod &&
      policy &&
      todaySpentFen > morningShareFen + (incomeCountsTowardBudget ? todayIncomeFen : 0),
  )
  const alerts: AlertItem[] = []
  if (!isCurrentPeriod) {
    alerts.push({
      level: 'info',
      title: '正在查看其他周期',
      detail: '限额提醒按该周期计算。账面余额始终是此刻的资金，不随切换周期改变。',
    })
  }
  if (!policy) {
    alerts.push({
      level: 'info',
      title: '尚未设定限额',
      detail: '到「限额」页设定本周期支出上限后，才会计算每日可用额度。',
    })
  } else if (remainingFen < 0) {
    alerts.push({
      level: 'danger',
      title: isCurrentPeriod ? '本周期已经超支' : '该周期已经超支',
      detail: `额度 ${fenToYuan(effectiveLimitFen).toFixed(2)} 元，已支出 ${fenToYuan(spentFen).toFixed(2)} 元。`,
    })
  } else if (todayOverspent) {
    alerts.push({
      level: 'danger',
      title: '今日支出已超出今日可用',
      detail: `今日已花 ${fenToYuan(todaySpentFen).toFixed(2)} 元，已超过今早份额（${fenToYuan(morningShareFen).toFixed(2)} 元）。`,
    })
  }
  const categoryStatuses = (policy ? getCategoryLimits(policy.id) : []).map((item) => {
    const used = sumFen(period.startIso, period.endIso, 'expense', item.categoryId)
    const catDays = (isCurrentPeriod ? days : totalDays) || 1
    const todayCat = isCurrentPeriod ? sumFen(todayStart, todayEnd, 'expense', item.categoryId) : 0
    const catBefore = Math.max(used - todayCat, 0)
    const over = used > item.limitFen
    const catMorning =
      catBefore >= item.limitFen ? 0 : Math.max(0, Math.floor((item.limitFen - catBefore) / catDays))
    const daily = isCurrentPeriod ? Math.max(0, catMorning - todayCat) : catMorning
    if (policy && isCurrentPeriod && !over && todayCat > catMorning) {
      const name = listCategories().find((cat) => cat.id === item.categoryId)?.name ?? '分类'
      alerts.push({
        level: 'warn',
        title: `${name} 今日超出分类日均`,
        detail: `今日该类已花 ${fenToYuan(todayCat).toFixed(2)} 元，今早份额 ${fenToYuan(catMorning).toFixed(2)} 元。`,
      })
    }
    return { ...item, usedFen: used, dailyFen: daily, over }
  })
  return {
    period,
    isCurrentPeriod,
    policy,
    spentFen,
    incomeFen,
    incomeCountsTowardBudget,
    effectiveLimitFen,
    remainingFen,
    remainingDays: isCurrentPeriod ? days : 0,
    morningShareFen,
    todayAllowanceFen,
    todaySpentFen,
    todayIncomeFen,
    todayOverspent,
    categoryStatuses,
    alerts,
    bookBalanceFen: getBookBalance(),
  }
}

function cashFlowFen(): number {
  return (
    queryValue<number>(
      `SELECT COALESCE(SUM(
         CASE
           WHEN type = 'income' THEN amount_fen
           WHEN type = 'expense' AND IFNULL(is_refund, 0) = 1 THEN amount_fen
           WHEN type = 'expense' THEN -amount_fen
           ELSE 0
         END
       ), 0) AS s FROM transactions`,
      [],
      's',
    ) ?? 0
  )
}

/**
 * 账面余额 = 校准锚点 + 收入 − 支出 + 退款（退款冲减支出）。
 * 记一笔或导入后会自动变；用户校准只改锚点，不改历史流水。
 */
export function getBookBalance(): number {
  const anchor = Number(getMeta('cash_anchor_fen', '0'))
  return (Number.isFinite(anchor) ? anchor : 0) + cashFlowFen()
}

export function setBookBalance(targetFen: number): void {
  setMeta('cash_anchor_fen', String(targetFen - cashFlowFen()))
}

export function previewImport(rows: ParsedBillRow[]): ImportPreviewRow[] {
  const existing = listTransactions('')
  return rows.map((row) => {
    const dup = findDuplicate(row, existing)
    const status = dup.exact ? 'duplicate' : dup.possible ? 'possible_duplicate' : 'new'
    return {
      ...row,
      status,
      matchedId: (dup.exact ?? dup.possible)?.id ?? null,
      selected: status !== 'duplicate',
    }
  })
}

export function commitImport(
  fileName: string,
  source: TxSource,
  rows: ImportPreviewRow[],
): { imported: number; skipped: number } {
  const selected = rows.filter((row) => row.selected && row.status !== 'duplicate')
  const skipped = rows.length - selected.length
  const categories = listCategories()
  let imported = 0
  withTx(() => {
    run(
      `INSERT INTO import_batches (source, file_name, imported_at, imported_count, skipped_count)
       VALUES (?, ?, ?, ?, ?)`,
      [source, fileName, toLocalIso(new Date()), selected.length, skipped],
    )
    const batchId = queryValue<number>('SELECT last_insert_rowid() AS id', [], 'id') ?? 0
    for (const row of selected) {
      addTransaction({
        type: row.type,
        amountFen: row.amountFen,
        occurredAt: row.occurredAt,
        categoryId: guessCategoryId(row.note, row.counterpart, row.type, categories),
        source: row.source,
        counterpart: row.counterpart,
        note: row.note,
        orderNo: row.orderNo,
        importBatchId: batchId,
        excludedFromBudget: row.excludedFromBudget,
        isRefund: row.isRefund,
      })
      imported += 1
    }
    run('UPDATE import_batches SET imported_count = ? WHERE id = ?', [imported, batchId])
  })
  return { imported, skipped }
}

export function listImportBatches(limit = 30): ImportBatch[] {
  return query<{
    id: number
    source: TxSource
    file_name: string
    imported_at: string
    imported_count: number
    skipped_count: number
  }>(
    `SELECT id, source, file_name, imported_at, imported_count, skipped_count
     FROM import_batches
     ORDER BY imported_at DESC, id DESC
     LIMIT ?`,
    [limit],
  ).map((row) => ({
    id: row.id,
    source: row.source,
    fileName: row.file_name,
    importedAt: row.imported_at,
    importedCount: row.imported_count,
    skippedCount: row.skipped_count,
  }))
}

/**
 * 撤销一次文件导入：删掉该批次写入的流水。手动记的账和通知入账不受影响。
 */
export function undoImportBatch(batchId: number): number {
  const deleted =
    queryValue<number>(
      'SELECT COUNT(*) AS c FROM transactions WHERE import_batch_id = ?',
      [batchId],
      'c',
    ) ?? 0
  withTx(() => {
    run('DELETE FROM transactions WHERE import_batch_id = ?', [batchId])
    run('DELETE FROM import_batches WHERE id = ?', [batchId])
  })
  return deleted
}

export function countImportedTransactions(): number {
  return (
    queryValue<number>(
      'SELECT COUNT(*) AS c FROM transactions WHERE import_batch_id IS NOT NULL',
      [],
      'c',
    ) ?? 0
  )
}

/** 清空所有文件导入产生的流水，保留手记和通知入账。 */
export function clearImportedTransactions(): number {
  const deleted = countImportedTransactions()
  withTx(() => {
    run('DELETE FROM transactions WHERE import_batch_id IS NOT NULL')
    run('DELETE FROM import_batches')
  })
  return deleted
}

/**
 * 清空账本全部流水。分类、限额、周期规则保留；账面余额锚点归零，需要的话再校准。
 */
export function clearAllTransactions(): number {
  const deleted = queryValue<number>('SELECT COUNT(*) AS c FROM transactions', [], 'c') ?? 0
  withTx(() => {
    run('DELETE FROM transactions')
    run('DELETE FROM import_batches')
    run(
      `UPDATE notification_inbox
       SET status = 'pending', transaction_id = NULL
       WHERE status = 'accepted'`,
    )
    setMeta('cash_anchor_fen', '0')
  })
  return deleted
}

export function listRecurring(): RecurringRule[] {
  return query<{
    id: number
    type: Transaction['type']
    amount_fen: number
    category_id: number | null
    day_of_month: number
    note: string
    enabled: number
  }>('SELECT * FROM recurring_rules ORDER BY day_of_month, id').map((row) => ({
    id: row.id,
    type: row.type,
    amountFen: row.amount_fen,
    categoryId: row.category_id,
    dayOfMonth: row.day_of_month,
    note: row.note,
    enabled: row.enabled,
  }))
}

export function saveRecurring(rule: Omit<RecurringRule, 'id'> & { id?: number }): void {
  if (rule.id) {
    run(
      `UPDATE recurring_rules
       SET type=?, amount_fen=?, category_id=?, day_of_month=?, note=?, enabled=?
       WHERE id=?`,
      [rule.type, rule.amountFen, rule.categoryId, rule.dayOfMonth, rule.note, rule.enabled, rule.id],
    )
    return
  }
  run(
    `INSERT INTO recurring_rules (type, amount_fen, category_id, day_of_month, note, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rule.type, rule.amountFen, rule.categoryId, rule.dayOfMonth, rule.note, rule.enabled],
  )
}

export function deleteRecurring(id: number): void {
  run('DELETE FROM recurring_rules WHERE id = ?', [id])
}

/**
 * 每个周期只生成一次，用 note+ruleId 去重，避免重复打开应用就重复入账。
 */
export function generateRecurring(now = new Date()): number {
  const startDay = getPeriodStartDay()
  const period = getPeriodByDate(now, startDay)
  const rules = listRecurring().filter((rule) => rule.enabled)
  let created = 0
  for (const rule of rules) {
    const exists = queryValue<number>(
      'SELECT COUNT(*) AS c FROM transactions WHERE recurring_rule_id = ? AND occurred_at >= ? AND occurred_at <= ?',
      [rule.id, period.startIso, period.endIso],
      'c',
    )
    if (exists) continue
    const year = period.start.getFullYear()
    const month = period.start.getMonth()
    const last = new Date(year, month + 1, 0).getDate()
    const day = Math.min(rule.dayOfMonth, last)
    const when = new Date(year, month, day, 9, 0, 0)
    if (when < period.start || when > period.end) continue
    addTransaction({
      type: rule.type,
      amountFen: rule.amountFen,
      occurredAt: toLocalIso(when),
      categoryId: rule.categoryId,
      source: 'manual',
      note: rule.note || '周期收支',
      recurringRuleId: rule.id,
    })
    created += 1
  }
  return created
}

function countOverspendDays(startIso: string, endIso: string, dailyFen: number): number {
  if (dailyFen <= 0) return 0
  const rows = query<{ d: string; s: number }>(
    `SELECT substr(occurred_at, 1, 10) AS d,
            SUM(CASE WHEN IFNULL(is_refund, 0) = 1 THEN -amount_fen ELSE amount_fen END) AS s
     FROM transactions
     WHERE type='expense' AND excluded_from_budget=0 AND occurred_at>=? AND occurred_at<=?
     GROUP BY substr(occurred_at, 1, 10)`,
    [startIso, endIso],
  )
  return rows.filter((row) => row.s > dailyFen).length
}

export function buildReport(start: Date, end: Date, compareStart?: Date, compareEnd?: Date): PeriodReport {
  const startDay = getPeriodStartDay()
  const period = { start, end, startIso: toLocalIso(start), endIso: toLocalIso(end) }
  const policy = currentPolicy(period.startIso)
  const totalLimitFen = policy?.totalLimitFen ?? 0
  const expenseFen = sumFen(period.startIso, period.endIso, 'expense')
  const incomeFen = sumFen(period.startIso, period.endIso, 'income')
  const incomeCountsTowardBudget = isIncomeCountedTowardBudget()
  const effectiveLimitFen = policy ? effectiveBudgetFen(totalLimitFen, incomeFen) : 0
  const prevRange: PeriodRange = compareStart && compareEnd
    ? {
        start: compareStart,
        end: compareEnd,
        startIso: toLocalIso(compareStart),
        endIso: toLocalIso(compareEnd),
        label: '',
      }
    : shiftPeriod(
        { ...period, label: '', startIso: period.startIso, endIso: period.endIso },
        -1,
        startDay,
      )
  const prevExpenseFen = sumFen(prevRange.startIso, prevRange.endIso, 'expense')
  const prevIncomeFen = sumFen(prevRange.startIso, prevRange.endIso, 'income')
  const prevPolicy = currentPolicy(prevRange.startIso)
  const prevEffectiveFen = prevPolicy ? effectiveBudgetFen(prevPolicy.totalLimitFen, prevIncomeFen) : 0
  const prevDays = Math.max(remainingDaysInclusive(prevRange.end, prevRange.start), 1)
  const prevDailyFen = prevEffectiveFen ? Math.floor(prevEffectiveFen / prevDays) : 0
  const prevRemainingFen = prevEffectiveFen - prevExpenseFen
  const prevOverspendDays = countOverspendDays(prevRange.startIso, prevRange.endIso, prevDailyFen)
  const days = Math.max(remainingDaysInclusive(end, start), 1)
  const dailyFen = effectiveLimitFen ? Math.floor(effectiveLimitFen / days) : 0
  const categories = listCategories()
  const limits = policy ? getCategoryLimits(policy.id) : []
  const categoryBreakdown = categories
    .filter((item) => item.kind === 'expense')
    .map((item) => {
      const expense = sumFen(period.startIso, period.endIso, 'expense', item.id)
      const prevExpense = sumFen(prevRange.startIso, prevRange.endIso, 'expense', item.id)
      return {
        categoryId: item.id,
        name: item.name,
        expenseFen: expense,
        prevExpenseFen: prevExpense,
        limitFen: limits.find((limit) => limit.categoryId === item.id)?.limitFen ?? null,
      }
    })
    .filter((item) => item.expenseFen > 0 || item.prevExpenseFen > 0)
    .sort((a, b) => b.expenseFen - a.expenseFen)
  const suggestions: string[] = []
  if (effectiveLimitFen && expenseFen > effectiveLimitFen) {
    suggestions.push(
      `本周期超支 ${fenToYuan(expenseFen - effectiveLimitFen).toFixed(2)} 元，下一周期可先把总额度或最大分类限额下调。`,
    )
  }
  if (prevExpenseFen > 0 && expenseFen > prevExpenseFen * 1.15) {
    suggestions.push(
      `支出比上一周期增加 ${(((expenseFen - prevExpenseFen) / prevExpenseFen) * 100).toFixed(0)}%，建议先看涨幅最大的分类。`,
    )
  }
  const top = categoryBreakdown[0]
  if (top && expenseFen > 0 && top.expenseFen / expenseFen > 0.4) {
    suggestions.push(`${top.name} 占支出 ${((top.expenseFen / expenseFen) * 100).toFixed(0)}%，是优先可压缩的一类。`)
  }
  for (const item of categoryBreakdown) {
    if (item.limitFen && item.expenseFen > item.limitFen) {
      suggestions.push(`${item.name} 超出分类限额 ${fenToYuan(item.expenseFen - item.limitFen).toFixed(2)} 元。`)
    }
    if (item.prevExpenseFen > 0 && item.expenseFen > item.prevExpenseFen * 1.3) {
      suggestions.push(`${item.name} 比上期多花 ${fenToYuan(item.expenseFen - item.prevExpenseFen).toFixed(2)} 元。`)
    }
  }
  if (!suggestions.length) {
    suggestions.push('本周期收支节奏正常。可继续用通知自动记 + 周期账单对账，避免漏记。')
  }
  return {
    startIso: period.startIso,
    endIso: period.endIso,
    totalLimitFen,
    effectiveLimitFen,
    incomeCountsTowardBudget,
    incomeFen,
    expenseFen,
    remainingFen: effectiveLimitFen - expenseFen,
    overspent: effectiveLimitFen > 0 && expenseFen > effectiveLimitFen,
    overspendDays: countOverspendDays(period.startIso, period.endIso, dailyFen),
    prevExpenseFen,
    prevIncomeFen,
    prevRemainingFen,
    prevOverspendDays,
    categoryBreakdown,
    suggestions,
  }
}

export function ensureClosedSnapshots(now = new Date()): void {
  const startDay = getPeriodStartDay()
  const current = getPeriodByDate(now, startDay)
  const previous = shiftPeriod(current, -1, startDay)
  const exists = queryValue<number>(
    'SELECT COUNT(*) AS c FROM period_snapshots WHERE start_at = ?',
    [previous.startIso],
    'c',
  )
  if (exists) return
  const report = buildReport(previous.start, previous.end)
  run(
    `INSERT INTO period_snapshots
      (start_at, end_at, total_limit_fen, category_limits_json, income_fen, expense_fen, report_json, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      previous.startIso,
      previous.endIso,
      report.totalLimitFen,
      JSON.stringify(report.categoryBreakdown),
      report.incomeFen,
      report.expenseFen,
      JSON.stringify(report),
      toLocalIso(now),
    ],
  )
}

/**
 * 通知待确认列表。入账流水若已被删，对应条目退回 pending，避免一直显示「已入账」。
 */
export function listInbox() {
  run(
    `UPDATE notification_inbox
     SET status = 'pending', transaction_id = NULL
     WHERE status = 'accepted'
       AND (transaction_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM transactions WHERE id = notification_inbox.transaction_id
       ))`,
  )
  return query<{
    id: number
    package_name: string
    title: string
    body: string
    posted_at: string
    source_guess: string
    parsed_json: string | null
    transaction_id: number | null
    status: string
  }>('SELECT * FROM notification_inbox ORDER BY posted_at DESC, id DESC LIMIT 100')
}

export function addInboxItem(input: {
  packageName?: string
  title: string
  body: string
  postedAt?: string
  sourceGuess?: string
  parsedJson?: string | null
}): number {
  run(
    `INSERT INTO notification_inbox
      (package_name, title, body, posted_at, source_guess, parsed_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      input.packageName ?? '',
      input.title,
      input.body,
      input.postedAt ?? toLocalIso(new Date()),
      input.sourceGuess ?? 'notification',
      input.parsedJson ?? null,
    ],
  )
  return queryValue<number>('SELECT last_insert_rowid() AS id', [], 'id') ?? 0
}

export function inboxAlreadyQueued(title: string, body: string, postedAt: string): boolean {
  return (
    (queryValue<number>(
      `SELECT COUNT(*) AS c FROM notification_inbox
       WHERE title = ? AND body = ? AND posted_at = ?`,
      [title, body, postedAt],
      'c',
    ) ?? 0) > 0
  )
}

export function countPendingInbox(): number {
  return (
    queryValue<number>(
      `SELECT COUNT(*) AS c FROM notification_inbox WHERE status = 'pending'`,
      [],
      'c',
    ) ?? 0
  )
}

export function setInboxStatus(id: number, status: 'accepted' | 'ignored', transactionId: number | null = null): void {
  run('UPDATE notification_inbox SET status = ?, transaction_id = ? WHERE id = ?', [status, transactionId, id])
}

export function countInbox(): number {
  return queryValue<number>(`SELECT COUNT(*) AS c FROM notification_inbox`, [], 'c') ?? 0
}

/**
 * 只清通知待确认列表，不动账本流水。
 * 已忽略、已入账、待确认都会删掉；账本里删过的条目若又回到待确认，也会一并去掉。
 */
export function clearNotificationInbox(): number {
  const count = countInbox()
  if (count) run('DELETE FROM notification_inbox')
  return count
}

export function isOnboarded(): boolean {
  return getMeta('onboarding_done', '0') === '1'
}

export function completeOnboarding(): void {
  setMeta('onboarding_done', '1')
}

export function exportJson(): string {
  return JSON.stringify(
    {
      exportedAt: toLocalIso(new Date()),
      categories: listCategories(),
      transactions: listTransactions(''),
      recurring: listRecurring(),
      meta: query<{ key: string; value: string }>('SELECT key, value FROM meta'),
    },
    null,
    2,
  )
}

export function exportCsv(): string {
  const rows = listTransactions('')
  const header = '时间,类型,金额元,分类,来源,对方,备注,订单号'
  const categories = listCategories()
  const lines = rows.map((row) => {
    const cat = categories.find((item) => item.id === row.categoryId)?.name ?? ''
    return [
      row.occurredAt,
      row.type,
      fenToYuan(row.amountFen).toFixed(2),
      cat,
      row.source,
      row.counterpart,
      row.note,
      row.orderNo,
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(',')
  })
  return [header, ...lines].join('\n')
}

export function listMeta(): Array<{ key: string; value: string }> {
  return query<{ key: string; value: string }>('SELECT key, value FROM meta ORDER BY key')
}

export function debugWipeLedger(): void {
  withTx(() => {
    run('DELETE FROM transactions')
    run('DELETE FROM import_batches')
    run('DELETE FROM period_snapshots')
    run('DELETE FROM notification_inbox')
    setMeta('cash_anchor_fen', '0')
  })
}

export function debugSeedSample(): void {
  const startDay = getPeriodStartDay()
  const period = getPeriodByDate(new Date(), startDay)
  const cats = listCategories()
  const food = cats.find((item) => item.name === '餐饮')?.id ?? null
  const wage = cats.find((item) => item.name === '工资')?.id ?? null
  addTransaction({
    type: 'income',
    amountFen: 800000,
    occurredAt: period.startIso,
    categoryId: wage,
    source: 'manual',
    note: '实验室示例工资',
  })
  addTransaction({
    type: 'expense',
    amountFen: 12800,
    occurredAt: toLocalIso(new Date()),
    categoryId: food,
    source: 'manual',
    counterpart: '示例餐厅',
    note: '实验室示例支出',
  })
}
