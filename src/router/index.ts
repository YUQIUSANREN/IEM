import { createRouter, createWebHashHistory } from 'vue-router'
import type { LocationQuery } from 'vue-router'
import { isLabUnlocked } from '../platform/lab-gate'
import { composeValue } from '../ui/compose-query'
import { sheetValue } from '../ui/sheet-query'

/** 正在用 replace 丢掉弹层这一层，避免 beforeEach 再重入。 */
let droppingOverlay = false

function hasOverlay(query: LocationQuery): boolean {
  return composeValue(query) != null || sheetValue(query) != null
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/onboarding', name: 'onboarding', component: () => import('../views/OnboardingView.vue') },
    {
      path: '/',
      component: () => import('../components/AppShell.vue'),
      children: [
        { path: '', name: 'home', component: () => import('../views/HomeView.vue') },
        { path: 'ledger', name: 'ledger', component: () => import('../views/LedgerView.vue') },
        { path: 'import', name: 'import', component: () => import('../views/ImportView.vue') },
        { path: 'budget', name: 'budget', component: () => import('../views/BudgetView.vue') },
        { path: 'charts', redirect: { name: 'report' } },
        { path: 'report', name: 'report', component: () => import('../views/ReportView.vue') },
        { path: 'recurring', name: 'recurring', component: () => import('../views/RecurringView.vue') },
        { path: 'guide', name: 'guide', component: () => import('../views/GuideView.vue') },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
        { path: 'lab', name: 'lab', component: () => import('../views/LabView.vue') },
      ],
    },
  ],
})

router.beforeEach((to, from) => {
  if (to.name === 'lab' && !isLabUnlocked()) {
    return { name: 'settings' }
  }
  /*
   * 弹层开着时若直接 push 到别的页，query 会留在历史中间。
   * 返回时会再次打开记一笔/分类管理。改成 replace，用新页面盖掉这一层。
   */
  if (!droppingOverlay && hasOverlay(from.query) && to.path !== from.path && !hasOverlay(to.query)) {
    droppingOverlay = true
    return {
      path: to.path,
      query: to.query,
      hash: to.hash,
      replace: true,
    }
  }
  return true
})

router.afterEach(() => {
  droppingOverlay = false
})

export default router
