import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { COMPOSE_QUERY, composeValue } from '../ui/compose-query'

/**
 * 把记一笔/修改和一条路由历史绑在一起。
 * 打开时 push `?compose=`，系统返回或点取消都 pop 这一层，避免全屏层挡着却退了底下的页面。
 */
export function useRecordHistory() {
  const store = useAppStore()
  const route = useRoute()
  const router = useRouter()

  watch(
    () => store.showRecord,
    (open) => {
      if (!open || composeValue(route.query) != null) return
      void router.push({
        query: {
          ...route.query,
          [COMPOSE_QUERY]: store.editingTx ? String(store.editingTx.id) : 'new',
        },
      })
    },
  )

  watch(
    () => [store.ready, composeValue(route.query)] as const,
    ([ready, compose]) => {
      if (!ready) return
      if (compose == null) {
        if (store.showRecord) store.closeRecord()
        return
      }
      if (store.showRecord) return
      if (compose === 'new') {
        store.openRecord()
        return
      }
      const id = Number(compose)
      const tx = Number.isFinite(id) ? store.transactions.find((item) => item.id === id) : undefined
      store.openRecord(tx ?? null)
    },
    { immediate: true },
  )

  /**
   * 点 × / 取消 / 保存后关掉表单：有 compose 历史就 back，否则直接关。
   * 不要只改 store，否则地址栏还留着 compose，返回或刷新会把表单再打开。
   */
  function closeRecordView(): void {
    if (composeValue(route.query) == null) {
      store.closeRecord()
      return
    }
    if (window.history.state?.back != null) {
      void router.back()
      return
    }
    const query = { ...route.query }
    delete query[COMPOSE_QUERY]
    void router.replace({ query })
  }

  return { closeRecordView }
}
