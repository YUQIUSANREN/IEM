import { computed, reactive, ref, watch } from 'vue'
import { matchTransactionKeyword } from '../domain/engine'
import { useAppStore } from '../stores/app'
import type { Transaction } from '../types'

const DEFAULT_PAGE_SIZE = 20
const MIN_PAGE_SIZE = 1
const MAX_PAGE_SIZE = 200

/**
 * 实验室表格：全量已在内存，这里只做显示分页。
 */
export function usePagedTransactions(initialPageSize = DEFAULT_PAGE_SIZE) {
  const store = useAppStore()
  const keyword = ref('')
  const page = ref(1)
  const pageSize = ref(clampPageSize(initialPageSize))

  const matched = computed((): Transaction[] => {
    const kw = keyword.value
    const cats = store.categories
    return store.transactions.filter((tx) => {
      const name = cats.find((item) => item.id === tx.categoryId)?.name ?? ''
      return matchTransactionKeyword(tx, kw, name)
    })
  })

  const total = computed(() => matched.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))

  const items = computed((): Transaction[] => {
    const current = Math.min(Math.max(page.value, 1), pageCount.value)
    const start = (current - 1) * pageSize.value
    return matched.value.slice(start, start + pageSize.value)
  })

  watch(keyword, () => {
    page.value = 1
  })

  watch(pageSize, () => {
    page.value = 1
  })

  watch(pageCount, (count) => {
    if (page.value > count) page.value = count
  })

  function go(next: number): void {
    page.value = Math.min(Math.max(next, 1), pageCount.value)
  }

  function setPageSize(size: number): void {
    pageSize.value = clampPageSize(size)
  }

  return reactive({ keyword, page, pageSize, total, pageCount, items, go, setPageSize })
}

function clampPageSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(size)))
}
