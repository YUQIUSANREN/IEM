import type { LocationQuery } from 'vue-router'

/** 分类管理等全屏层占用的查询参数，用来占一条历史，系统返回先关层。 */
export const SHEET_QUERY = 'sheet'
export const CATEGORIES_SHEET = 'categories'

export function sheetValue(query: LocationQuery): string | null {
  const raw = query[SHEET_QUERY]
  if (Array.isArray(raw)) return raw[0] ?? null
  return typeof raw === 'string' ? raw : null
}
