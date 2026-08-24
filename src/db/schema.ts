export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budget_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start_day INTEGER NOT NULL DEFAULT 16,
  total_limit_fen INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_budget_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  limit_fen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount_fen INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  category_id INTEGER,
  source TEXT NOT NULL,
  counterpart TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  order_no TEXT NOT NULL DEFAULT '',
  import_batch_id INTEGER,
  recurring_rule_id INTEGER,
  excluded_from_budget INTEGER NOT NULL DEFAULT 0,
  is_refund INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS period_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_at TEXT NOT NULL UNIQUE,
  end_at TEXT NOT NULL,
  total_limit_fen INTEGER NOT NULL,
  category_limits_json TEXT NOT NULL,
  income_fen INTEGER NOT NULL,
  expense_fen INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  closed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount_fen INTEGER NOT NULL,
  category_id INTEGER,
  day_of_month INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notification_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  posted_at TEXT NOT NULL,
  source_guess TEXT NOT NULL DEFAULT 'notification',
  parsed_json TEXT,
  transaction_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_order ON transactions(source, order_no);
CREATE INDEX IF NOT EXISTS idx_tx_amount_time ON transactions(amount_fen, occurred_at);
`

export const DEFAULT_CATEGORIES: Array<{ name: string; kind: 'expense' | 'income' | 'transfer'; sortOrder: number }> = [
  { name: '餐饮', kind: 'expense', sortOrder: 1 },
  { name: '交通', kind: 'expense', sortOrder: 2 },
  { name: '日用', kind: 'expense', sortOrder: 3 },
  { name: '购物', kind: 'expense', sortOrder: 4 },
  { name: '住房', kind: 'expense', sortOrder: 5 },
  { name: '娱乐', kind: 'expense', sortOrder: 6 },
  { name: '医疗', kind: 'expense', sortOrder: 7 },
  { name: '通讯', kind: 'expense', sortOrder: 8 },
  { name: '订阅', kind: 'expense', sortOrder: 9 },
  { name: '人情', kind: 'expense', sortOrder: 10 },
  { name: '其他支出', kind: 'expense', sortOrder: 11 },
  { name: '工资', kind: 'income', sortOrder: 12 },
  { name: '奖金', kind: 'income', sortOrder: 13 },
  { name: '退款', kind: 'income', sortOrder: 14 },
  { name: '其他收入', kind: 'income', sortOrder: 15 },
  { name: '还款', kind: 'transfer', sortOrder: 21 },
  { name: '充值', kind: 'transfer', sortOrder: 22 },
  { name: '提现', kind: 'transfer', sortOrder: 23 },
  { name: '代付', kind: 'transfer', sortOrder: 24 },
]
