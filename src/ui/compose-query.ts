import type { LocationQuery } from 'vue-router'

/** 记一笔/修改占用的查询参数：用来占一条历史，好让系统返回先关表单。 */
export const COMPOSE_QUERY = 'compose'

export function composeValue(query: LocationQuery): string | null {
  const raw = query[COMPOSE_QUERY]
  if (Array.isArray(raw)) return raw[0] ?? null
  return typeof raw === 'string' ? raw : null
}
