<script setup lang="ts">
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { getPeriodStartDay, saveBudget } from '../domain/engine'
import { fenToYuan, parseYuanInput } from '../domain/money'
import PeriodStartDayPicker from '../components/PeriodStartDayPicker.vue'
import { toast, trySave } from '../ui/toast'

const store = useAppStore()
const router = useRouter()
const form = reactive({
  startDay: getPeriodStartDay(),
  total: store.dashboard.policy ? fenToYuan(store.dashboard.policy.totalLimitFen).toFixed(2) : '',
  category: Object.fromEntries(
    store.dashboard.categoryStatuses.map((item) => [item.categoryId, fenToYuan(item.limitFen).toFixed(2)]),
  ) as Record<number, string>,
})

function save(): void {
  const total = parseYuanInput(form.total)
  if (total === null || total <= 0) {
    toast('error', '请填写总限额')
    return
  }
  const categoryLimits = store.categories
    .filter((item) => item.kind === 'expense')
    .map((item) => ({
      categoryId: item.id,
      limitFen: parseYuanInput(form.category[item.id] ?? '') ?? 0,
    }))
    .filter((item) => item.limitFen > 0)
  if (!trySave(() => saveBudget(total, Number(form.startDay), categoryLimits), '限额已保存')) return
  store.refreshDashboard()
}
</script>

<template>
  <section class="page pin-page">
    <header class="head pin-bar">
      <h1>限额</h1>
      <div class="head-actions">
        <button class="btn ghost" type="button" @click="router.push('/settings')">返回设置</button>
        <button class="btn save" type="button" @click="save">保存限额</button>
      </div>
    </header>
    <article class="card">
      <p class="muted">
        周期起止不按期写进数据库，只保存一个起始日，浏览时现算。流水只记发生时间，改起始日不会改账单日期。
        限额金额仍是：没单独写过的周期沿用最近一次；以后再改限额只从本周期起用新值。
      </p>
      <PeriodStartDayPicker v-model="form.startDay" />
      <label>总支出限额（元）<input v-model="form.total" class="input" inputmode="decimal" /></label>
      <h2>分类限额（可选）</h2>
      <div v-for="cat in store.categories.filter((c) => c.kind === 'expense')" :key="cat.id" class="row">
        <span>{{ cat.name }}</span>
        <input v-model="form.category[cat.id]" class="input" placeholder="不限制" />
      </div>
    </article>
    <div class="page-actions">
      <button class="btn save" type="button" @click="save">保存限额</button>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.head h1 { margin: 0; }
.head-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.head-actions .btn { flex: 0 0 auto; }
label, .row { margin-bottom: 12px; display: grid; gap: 6px; }
.row { grid-template-columns: 120px 1fr; align-items: center; }
</style>
