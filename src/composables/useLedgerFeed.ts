import { computed, reactive, ref } from 'vue'
import { matchTransactionKeyword } from '../domain/engine'
import { useAppStore } from '../stores/app'
import type { Transaction } from '../types'

/**
 * 账本列表：数据来自 store 里一次加载的全量流水。
 * 搜索只做内存过滤，不再按滚动向数据库追加。
 */
export function useLedgerFeed() {
  const store = useAppStore()
  const keyword = ref('')

  const items = computed((): Transaction[] => {
    const kw = keyword.value
    const cats = store.categories
    return store.transactions.filter((tx) => {
      const name = cats.find((item) => item.id === tx.categoryId)?.name ?? ''
      return matchTransactionKeyword(tx, kw, name)
    })
  })

  return reactive({ keyword, items })
}
