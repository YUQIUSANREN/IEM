import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { CATEGORIES_SHEET, SHEET_QUERY, sheetValue } from '../ui/sheet-query'

/**
 * 把分类管理弹层和一条路由历史绑在一起，系统返回先关层，不退下页。
 */
export function useSheetHistory() {
  const store = useAppStore()
  const route = useRoute()
  const router = useRouter()

  watch(
    () => store.showCategories,
    (open) => {
      if (!open || sheetValue(route.query) === CATEGORIES_SHEET) return
      void router.push({
        query: {
          ...route.query,
          [SHEET_QUERY]: CATEGORIES_SHEET,
        },
      })
    },
  )

  watch(
    () => [store.ready, sheetValue(route.query)] as const,
    ([ready, sheet]) => {
      if (!ready) return
      if (sheet !== CATEGORIES_SHEET) {
        if (store.showCategories) store.closeCategories()
        return
      }
      if (!store.showCategories) store.openCategories()
    },
    { immediate: true },
  )

  function closeCategoriesView(): void {
    if (sheetValue(route.query) !== CATEGORIES_SHEET) {
      store.closeCategories()
      return
    }
    if (window.history.state?.back != null) {
      void router.back()
      return
    }
    const query = { ...route.query }
    delete query[SHEET_QUERY]
    void router.replace({ query })
  }

  return { closeCategoriesView }
}
