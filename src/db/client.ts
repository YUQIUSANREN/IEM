import type { Database, SqlValue } from 'sql.js'
import { DEFAULT_CATEGORIES, SCHEMA_SQL } from './schema'
import { loadSqliteBytes, saveSqliteBytes } from '../platform/persist'

let db: Database | null = null
let persistTimer: number | null = null
const persistErrorListeners = new Set<(error: unknown) => void>()

/**
 * 落盘失败时通知 UI（toast），避免业务层直接依赖提示组件。
 */
export function onPersistError(listener: (error: unknown) => void): () => void {
  persistErrorListeners.add(listener)
  return () => persistErrorListeners.delete(listener)
}

function notifyPersistError(error: unknown): void {
  for (const listener of persistErrorListeners) listener(error)
}

function requireDb(): Database {
  if (!db) {
    throw new Error('数据库尚未初始化，请先等待应用启动完成')
  }
  return db
}

/**
 * 初始化 sql.js，加载已有库文件并执行表结构迁移。
 * wasm 通过 Vite 的 ?url 定位，避免打包后找不到文件。
 */
export async function initDb(): Promise<void> {
  const mod = await import('sql.js')
  const factory = unwrapInit(mod)
  const SQL = await factory({
    locateFile: (file: string) => {
      const name = file.split('/').pop() ?? file
      return `${import.meta.env.BASE_URL}${name}`
    },
  })
  const saved = await loadSqliteBytes()
  db = saved ? new SQL.Database(saved) : new SQL.Database()
  migrate()
  await persistNow()
}

function unwrapInit(mod: unknown): (config: { locateFile: (file: string) => string }) => Promise<{
  Database: new (data?: ArrayLike<number>) => Database
}> {
  if (typeof mod === 'function') {
    return mod as (config: { locateFile: (file: string) => string }) => Promise<{
      Database: new (data?: ArrayLike<number>) => Database
    }>
  }
  if (mod && typeof mod === 'object' && 'default' in mod) {
    const inner = (mod as { default: unknown }).default
    if (typeof inner === 'function') {
      return inner as (config: { locateFile: (file: string) => string }) => Promise<{
        Database: new (data?: ArrayLike<number>) => Database
      }>
    }
  }
  throw new Error('sql.js 加载失败，请刷新页面或删除 node_modules/.vite 后重试')
}

function migrate(): void {
  const database = requireDb()
  database.run(SCHEMA_SQL)
  const count = queryValue<number>('SELECT COUNT(*) AS c FROM categories', [], 'c') ?? 0
  if (count === 0) {
    const stmt = database.prepare(
      'INSERT INTO categories (name, kind, sort_order) VALUES (?, ?, ?)',
    )
    for (const item of DEFAULT_CATEGORIES) {
      stmt.run([item.name, item.kind, item.sortOrder])
    }
    stmt.free()
    database.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('onboarding_done', '0')",
    )
    database.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('period_start_day', '16')",
    )
  }
  ensureTransferCategories()
  ensureRefundColumn()
  dropUnusedIncomeRefundCategory()
}

function tableHasColumn(table: string, column: string): boolean {
  return query<{ name: string }>(`PRAGMA table_info(${table})`).some((row) => row.name === column)
}

/**
 * 旧库没有 is_refund。把此前「关联退款」记成收入的流水改成支出冲减。
 */
function ensureRefundColumn(): void {
  if (!tableHasColumn('transactions', 'is_refund')) {
    run('ALTER TABLE transactions ADD COLUMN is_refund INTEGER NOT NULL DEFAULT 0')
  }
  if (getMeta('refund_tx_migrated', '0') === '1') return
  run(
    `UPDATE transactions
     SET type = 'expense', is_refund = 1
     WHERE type = 'income' AND note LIKE '%关联退款%'`,
  )
  const refunds = query<{ id: number; counterpart: string; occurred_at: string }>(
    `SELECT id, counterpart, occurred_at FROM transactions WHERE is_refund = 1`,
  )
  const expenses = query<{ category_id: number | null; counterpart: string; occurred_at: string }>(
    `SELECT category_id, counterpart, occurred_at FROM transactions
     WHERE type = 'expense' AND IFNULL(is_refund, 0) = 0 AND counterpart != ''`,
  )
  for (const refund of refunds) {
    let best: { category_id: number | null; dist: number } | null = null
    const refundAt = Date.parse(refund.occurred_at)
    for (const expense of expenses) {
      if (expense.counterpart !== refund.counterpart) continue
      const dist = Math.abs(Date.parse(expense.occurred_at) - refundAt)
      if (!Number.isFinite(dist) || dist > 14 * 24 * 60 * 60 * 1000) continue
      if (!best || dist < best.dist) best = { category_id: expense.category_id, dist }
    }
    if (best?.category_id != null) {
      run('UPDATE transactions SET category_id = ? WHERE id = ?', [best.category_id, refund.id])
    }
  }
  setMeta('refund_tx_migrated', '1')
}

/**
 * 退款改为支出冲减后，收入侧默认「退款」分类不再需要。
 * 已有流水占用时保留，避免把旧数据改成未分类。
 */
function dropUnusedIncomeRefundCategory(): void {
  const row = queryOne<{ id: number }>(
    `SELECT id FROM categories WHERE name = ? AND kind = ?`,
    ['退款', 'income'],
  )
  if (!row) return
  const used =
    queryValue<number>(
      'SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?',
      [row.id],
      'c',
    ) ?? 0
  if (used > 0) return
  run('DELETE FROM category_budget_policies WHERE category_id = ?', [row.id])
  run('DELETE FROM categories WHERE id = ?', [row.id])
}

/** 旧账本没有「其他」分类时补上，记一笔第三栏用。 */
function ensureTransferCategories(): void {
  const database = requireDb()
  const stmt = database.prepare(
    'INSERT INTO categories (name, kind, sort_order) VALUES (?, ?, ?)',
  )
  for (const item of DEFAULT_CATEGORIES.filter((row) => row.kind === 'transfer')) {
    const exists =
      queryValue<number>(
        'SELECT COUNT(*) AS c FROM categories WHERE name = ? AND kind = ?',
        [item.name, item.kind],
        'c',
      ) ?? 0
    if (exists) continue
    stmt.run([item.name, item.kind, item.sortOrder])
  }
  stmt.free()
}

export function query<T>(sql: string, params: SqlValue[] = []): T[] {
  const database = requireDb()
  const stmt = database.prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

export function queryOne<T>(sql: string, params: SqlValue[] = []): T | null {
  return query<T>(sql, params)[0] ?? null
}

export function queryValue<T>(sql: string, params: SqlValue[], key: string): T | null {
  const row = queryOne<Record<string, T>>(sql, params)
  return row ? row[key] : null
}

export function run(sql: string, params: SqlValue[] = []): void {
  const database = requireDb()
  database.run(sql, params)
  schedulePersist()
}

export function withTx(work: () => void): void {
  run('BEGIN')
  try {
    work()
    run('COMMIT')
  } catch (error) {
    try {
      requireDb().run('ROLLBACK')
    } catch {
      /* 忽略二次失败 */
    }
    throw error
  }
}

export function exportBytes(): Uint8Array {
  return requireDb().export()
}

export async function persistNow(): Promise<void> {
  await saveSqliteBytes(exportBytes())
}

function schedulePersist(): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    void persistNow().catch((error: unknown) => {
      console.error('保存数据库失败', error)
      notifyPersistError(error)
    })
  }, 250)
}

export function getMeta(key: string, fallback = ''): string {
  return queryValue<string>('SELECT value FROM meta WHERE key = ?', [key], 'value') ?? fallback
}

export function setMeta(key: string, value: string): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
}
