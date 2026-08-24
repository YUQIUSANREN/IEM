import type { Category, Transaction } from '../types'

export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[（()）]/g, '')
    .toLowerCase()
}

/**
 * 同平台订单号优先；跨平台则用时间窗 + 金额 + 对方名称近似匹配。
 * 用于识别「支付宝付款、工行再扣卡」这类重复流水。
 */
export function findDuplicate(
  row: Pick<Transaction, 'source' | 'orderNo' | 'amountFen' | 'occurredAt' | 'counterpart'>,
  existing: Transaction[],
): { exact: Transaction | null; possible: Transaction | null } {
  if (row.orderNo) {
    const exact = existing.find((item) => item.source === row.source && item.orderNo === row.orderNo)
    if (exact) return { exact, possible: null }
  }
  const rowTime = new Date(row.occurredAt).getTime()
  let possible: Transaction | null = null
  for (const item of existing) {
    if (item.amountFen !== row.amountFen) continue
    const delta = Math.abs(new Date(item.occurredAt).getTime() - rowTime)
    if (delta > 15 * 60 * 1000) continue
    const sameParty =
      Boolean(row.counterpart) &&
      Boolean(item.counterpart) &&
      (normalizeName(row.counterpart).includes(normalizeName(item.counterpart)) ||
        normalizeName(item.counterpart).includes(normalizeName(row.counterpart)))
    const crossChannel = item.source !== row.source
    if (row.orderNo && item.orderNo && row.orderNo === item.orderNo) {
      return { exact: item, possible: null }
    }
    if (sameParty || crossChannel) {
      possible = item
      if (sameParty && crossChannel) return { exact: null, possible: item }
    }
  }
  return { exact: null, possible }
}

const CATEGORY_HINT_ALIAS: Record<string, string> = {
  餐饮美食: '餐饮',
  交通出行: '交通',
  日用百货: '日用',
  住房物业: '住房',
  文化休闲: '娱乐',
  娱乐休闲: '娱乐',
  医疗健康: '医疗',
  通讯物流: '通讯',
}

/**
 * 把账单里的分类文案对到账本分类：先别名，再看名字是否互相包含。
 */
function matchCategoryHint(
  hint: string,
  kind: Category['kind'],
  categories: Category[],
): number | null {
  const trimmed = hint.trim()
  if (!trimmed) return null
  const mapped = CATEGORY_HINT_ALIAS[trimmed] ?? trimmed
  const exact = categories.find((item) => item.kind === kind && (item.name === mapped || item.name === trimmed))
  if (exact) return exact.id
  const fuzzy = categories
    .filter((item) => item.kind === kind && item.name !== '其他支出' && item.name !== '其他收入')
    .filter((item) => trimmed.includes(item.name) || mapped.includes(item.name))
    .sort((left, right) => right.name.length - left.name.length)
  return fuzzy[0]?.id ?? null
}

const FALLBACK_EXPENSE = '其他支出'
const FALLBACK_INCOME = '其他收入'

export function isProtectedCategory(cat: Pick<Category, 'name' | 'kind'>): boolean {
  return (cat.kind === 'expense' && cat.name === FALLBACK_EXPENSE) || (cat.kind === 'income' && cat.name === FALLBACK_INCOME)
}

/**
 * 同一对方、同一收支方向里用得最多的分类；次数并列取最近一笔。
 * 只做归一后的全等，不对「张*」做模糊匹配。
 */
export function mostUsedCategoryId(
  counterpart: string,
  type: 'expense' | 'income' | 'transfer',
  txs: Transaction[],
): number | null {
  if (type === 'transfer') return null
  const key = normalizeName(counterpart)
  if (!key) return null
  const counts = new Map<number, { n: number; lastAt: string }>()
  for (const tx of txs) {
    if (tx.type !== type) continue
    if (Number(tx.excludedFromBudget) === 1 || Number(tx.isRefund) === 1) continue
    if (tx.categoryId == null) continue
    const catId = Number(tx.categoryId)
    if (!Number.isFinite(catId)) continue
    if (normalizeName(tx.counterpart ?? '') !== key) continue
    const row = counts.get(catId) ?? { n: 0, lastAt: '' }
    row.n += 1
    if (tx.occurredAt > row.lastAt) row.lastAt = tx.occurredAt
    counts.set(catId, row)
  }
  let best: { id: number; n: number; lastAt: string } | null = null
  for (const [id, row] of counts) {
    if (!best || row.n > best.n || (row.n === best.n && row.lastAt > best.lastAt)) {
      best = { id, n: row.n, lastAt: row.lastAt }
    }
  }
  return best?.id ?? null
}

/**
 * 粘贴/通知入账：文案标签优先，否则用对方历史习惯，再才是关键词。
 * 文件导入不要走这条，避免历史习惯盖掉账单自带分类逻辑以外的关键词。
 */
export function guessInboxCategoryId(
  note: string,
  counterpart: string,
  type: 'expense' | 'income' | 'transfer',
  categories: Category[],
  categoryHint: string,
  txs: Transaction[],
): number | null {
  if (type === 'transfer') return null
  const kind = type === 'income' ? 'income' : 'expense'
  const hinted = matchCategoryHint(categoryHint, kind, categories)
  if (hinted != null) return hinted
  const fromHistory = mostUsedCategoryId(counterpart, type, txs)
  if (fromHistory != null) return fromHistory
  return guessCategoryId(note, counterpart, type, categories, '')
}

/**
 * 文件导入用：账单分类文案和关键词，不查对方历史习惯。
 */
export function guessCategoryId(
  note: string,
  counterpart: string,
  type: 'expense' | 'income' | 'transfer',
  categories: Category[],
  categoryHint = '',
): number | null {
  if (type === 'transfer') return null
  const kind = type === 'income' ? 'income' : 'expense'
  const hinted = matchCategoryHint(categoryHint, kind, categories)
  if (hinted != null) return hinted
  const haystack = `${note}${counterpart}${categoryHint}`
  const rules: Array<{ kind: Category['kind']; keys: string[]; name: string }> = [
    { kind: 'expense', name: '餐饮', keys: ['餐', '外卖', '美团', '饿了么', '咖啡', '奶茶', '食堂'] },
    { kind: 'expense', name: '交通', keys: ['滴滴', '地铁', '公交', '打车', '高铁', '12306', '汽油'] },
    { kind: 'expense', name: '日用', keys: ['超市', '便利', '日用', '物美', '盒马'] },
    { kind: 'expense', name: '购物', keys: ['淘宝', '京东', '拼多多', '天猫', '购物'] },
    { kind: 'expense', name: '住房', keys: ['房租', '物业', '水电', '燃气'] },
    { kind: 'expense', name: '娱乐', keys: ['电影', '游戏', '会员', '音乐'] },
    { kind: 'expense', name: '医疗', keys: ['医院', '药房', '医保'] },
    { kind: 'expense', name: '通讯', keys: ['话费', '电信', '移动', '联通', '宽带'] },
    { kind: 'expense', name: '订阅', keys: ['自动续费', 'iCloud', '爱奇艺', '腾讯视频', 'Netflix'] },
    { kind: 'income', name: '工资', keys: ['工资', '薪资', 'payroll'] },
  ]
  for (const rule of rules) {
    if (rule.kind !== kind) continue
    if (rule.keys.some((key) => haystack.includes(key))) {
      return categories.find((item) => item.name === rule.name)?.id ?? null
    }
  }
  const fallbackName = kind === 'income' ? FALLBACK_INCOME : FALLBACK_EXPENSE
  return categories.find((item) => item.name === fallbackName)?.id ?? null
}
