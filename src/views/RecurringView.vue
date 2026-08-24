<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { deleteRecurring, listRecurring, saveRecurring } from '../domain/engine'
import { formatYuan, parseYuanInput } from '../domain/money'
import type { TxType } from '../types'
import NiceSelect from '../components/NiceSelect.vue'
import { toast, trySave } from '../ui/toast'
import { askConfirm } from '../ui/confirm'

const store = useAppStore()
const router = useRouter()
const rules = ref(listRecurring())
const form = reactive({
  type: 'expense' as TxType,
  amount: '',
  categoryId: null as number | null,
  dayOfMonth: 1,
  note: '',
})

function reload(): void {
  rules.value = listRecurring()
  store.refreshDashboard()
}

function add(): void {
  const fen = parseYuanInput(form.amount)
  if (fen === null || fen <= 0) {
    toast('error', '请输入金额')
    return
  }
  if (!trySave(() => {
    saveRecurring({
      type: form.type,
      amountFen: fen,
      categoryId: form.categoryId,
      dayOfMonth: form.dayOfMonth,
      note: form.note,
      enabled: 1,
    })
  }, '规则已添加')) return
  form.amount = ''
  form.note = ''
  reload()
}

async function remove(id: number): Promise<void> {
  const ok = await askConfirm({
    title: '确认删除？',
    message: '删除这条周期规则？',
  })
  if (!ok) return
  if (!trySave(() => deleteRecurring(id), '规则已删除')) return
  reload()
}

const catOptions = computed(() => [
  { value: '', label: '未分类' },
  ...store.categories
    .filter((item) => item.kind === form.type)
    .map((item) => ({ value: String(item.id), label: item.name })),
])
const catValue = computed({
  get: () => (form.categoryId == null ? '' : String(form.categoryId)),
  set: (value: string) => {
    form.categoryId = value === '' ? null : Number(value)
  },
})
const dayOptions = computed(() =>
  Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `每月 ${i + 1} 日` })),
)
const dayValue = computed({
  get: () => String(form.dayOfMonth),
  set: (value: string) => {
    form.dayOfMonth = Number(value)
  },
})
</script>

<template>
  <section class="page">
    <header class="head">
      <h1>周期收支</h1>
      <div class="row">
        <button class="btn ghost" type="button" @click="router.push('/settings')">返回设置</button>
        <button class="btn save" type="button" @click="add">添加规则</button>
      </div>
    </header>
    <article class="card">
      <p class="muted">每个周期只自动生成一次，适合房租、会员、工资。生成日会钳制在当月合法日期内。</p>
      <div class="tabs">
        <button class="tab" :class="{ active: form.type === 'expense' }" @click="form.type = 'expense'">支出</button>
        <button class="tab" :class="{ active: form.type === 'income' }" @click="form.type = 'income'">收入</button>
      </div>
      <label>金额<input v-model="form.amount" class="input" /></label>
      <label>
        每月第几日
        <NiceSelect v-model="dayValue" :options="dayOptions" title="每月第几日" />
      </label>
      <label>
        分类
        <NiceSelect v-model="catValue" :options="catOptions" title="选择分类" />
      </label>
      <label>备注<input v-model="form.note" class="input" placeholder="房租 / 工资" /></label>
    </article>
    <article class="card">
      <div class="table-wrap">
      <table class="table">
        <thead><tr><th>日</th><th>类型</th><th>金额</th><th>备注</th><th></th></tr></thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td>{{ rule.dayOfMonth }}</td>
            <td>{{ rule.type === 'income' ? '收入' : '支出' }}</td>
            <td>{{ formatYuan(rule.amountFen) }}</td>
            <td>{{ rule.note }}</td>
            <td><button class="btn ghost" @click="remove(rule.id)">删除</button></td>
          </tr>
        </tbody>
      </table>
      </div>
    </article>
    <div class="page-actions">
      <button class="btn save" type="button" @click="add">添加这条规则</button>
    </div>
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
label { margin-bottom: 12px; display: grid; gap: 6px; }
</style>
