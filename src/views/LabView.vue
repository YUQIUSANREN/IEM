<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { persistNow, setMeta } from '../db/client'
import {
  addTransaction,
  debugSeedSample,
  debugWipeLedger,
  deleteTransaction,
  getBookBalance,
  listCategories,
  listMeta,
  setBookBalance,
  updateTransaction,
} from '../domain/engine'
import { formatYuan, parseYuanInput } from '../domain/money'
import { formatTxAmount, isNonCashflowTx, isRefundTx } from '../domain/tx-display'
import { toLocalIso } from '../domain/period'
import { useAppStore } from '../stores/app'
import { usePagedTransactions } from '../composables/usePagedTransactions'
import TxPager from '../components/TxPager.vue'
import NiceSelect from '../components/NiceSelect.vue'
import type { Transaction, TxType } from '../types'
import { toast, trySave, trySaveAsync } from '../ui/toast'
import { askConfirm } from '../ui/confirm'

const store = useAppStore()
const paged = usePagedTransactions(20)
const message = ref('')
const metaRows = ref(listMeta())
const editing = ref<Transaction | null>(null)
const form = reactive({
  type: 'expense' as Transaction['type'],
  amount: '',
  occurredAt: '',
  categoryId: null as number | null,
  counterpart: '',
  note: '',
})

const createForm = reactive({
  type: 'expense' as TxType,
  amount: '',
  occurredAt: toLocalIso(new Date()).slice(0, 16),
  categoryId: null as number | null,
  counterpart: '',
  note: '',
})

function createCats() {
  return listCategories().filter((item) =>
    createForm.type === 'income' ? item.kind === 'income' : item.kind === 'expense',
  )
}

const createCatOptions = computed(() => [
  { value: '', label: '未分类' },
  ...createCats().map((item) => ({ value: String(item.id), label: item.name })),
])
const createCatValue = computed({
  get: () => (createForm.categoryId == null ? '' : String(createForm.categoryId)),
  set: (value: string) => {
    createForm.categoryId = value === '' ? null : Number(value)
  },
})
const editCatOptions = computed(() => [
  { value: '', label: '未分类' },
  ...listCategories().map((item) => ({ value: String(item.id), label: item.name })),
])
const editCatValue = computed({
  get: () => (form.categoryId == null ? '' : String(form.categoryId)),
  set: (value: string) => {
    form.categoryId = value === '' ? null : Number(value)
  },
})

function resetCreateForm(): void {
  createForm.type = 'expense'
  createForm.amount = ''
  createForm.occurredAt = toLocalIso(new Date()).slice(0, 16)
  createForm.categoryId = null
  createForm.counterpart = ''
  createForm.note = ''
}

/**
 * 实验室直接写一笔流水，方便测限额/今日可用，不必绕回总览的「记一笔」。
 */
async function addNew(): Promise<void> {
  const fen = parseYuanInput(createForm.amount)
  if (fen === null || fen <= 0) {
    toast('error', '请输入有效金额')
    return
  }
  const ok = await trySaveAsync(async () => {
    addTransaction({
      type: createForm.type === 'transfer' ? 'expense' : createForm.type,
      amountFen: fen,
      occurredAt: createForm.occurredAt.length === 16 ? `${createForm.occurredAt}:00` : createForm.occurredAt,
      categoryId: createForm.categoryId,
      source: 'manual',
      counterpart: createForm.counterpart,
      note: createForm.note || '实验室新增',
    })
    await persistNow()
  }, '已新增流水')
  if (!ok) return
  resetCreateForm()
  reload()
  message.value = '已新增流水'
}

function reload(): void {
  metaRows.value = listMeta()
  store.refreshDashboard()
}

function startEdit(tx: Transaction): void {
  editing.value = tx
  form.type = tx.type
  form.amount = formatYuan(tx.amountFen)
  form.occurredAt = tx.occurredAt.slice(0, 16)
  form.categoryId = tx.categoryId
  form.counterpart = tx.counterpart
  form.note = tx.note
}

function saveEdit(): void {
  if (!editing.value) return
  const fen = parseYuanInput(form.amount)
  if (fen === null) {
    toast('error', '金额无效')
    return
  }
  if (!trySave(() => {
    updateTransaction(editing.value!.id, {
      type: form.type,
      amountFen: fen,
      occurredAt: form.occurredAt.length === 16 ? `${form.occurredAt}:00` : form.occurredAt,
      categoryId: form.categoryId,
      counterpart: form.counterpart,
      note: form.note,
      excludedFromBudget: false,
    })
  }, '已改流水')) return
  void persistNow()
  editing.value = null
  reload()
  message.value = '已改流水'
}

async function seed(): Promise<void> {
  const ok = await trySaveAsync(async () => {
    debugSeedSample()
    await persistNow()
  }, '已写入示例收支')
  if (!ok) return
  reload()
  message.value = '已写入示例收支'
}

async function wipe(): Promise<void> {
  const sure = await askConfirm({
    title: '确认清空？',
    message: '清空流水、导入批次、盘点快照和通知收件箱？分类和限额规则会保留。',
  })
  if (!sure) return
  const ok = await trySaveAsync(async () => {
    debugWipeLedger()
    await persistNow()
  }, '账本数据已清空')
  if (!ok) return
  reload()
  message.value = '账本数据已清空'
}

async function removeTx(id: number): Promise<void> {
  const sure = await askConfirm({
    title: '确认删除？',
    message: '删除这笔记录？',
  })
  if (!sure) return
  if (trySave(() => deleteTransaction(id), '已删除')) reload()
}

function saveMeta(key: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  if (!trySave(() => setMeta(key, value), `已保存 ${key}`)) return
  reload()
}

function calibrate(): void {
  const text = window.prompt('账面余额校准到（元）', formatYuan(getBookBalance()))
  if (text == null) return
  const fen = parseYuanInput(text)
  if (fen === null) {
    toast('error', '金额无效')
    return
  }
  if (!trySave(() => setBookBalance(fen), '账面余额已校准')) return
  reload()
}
</script>

<template>
  <section class="page lab">
    <h1>实验室</h1>
    <p class="banner warn">
      仅供你自测功能是否正常，不面向使用者。改这里会直接动本机账本，请先备份。
    </p>
    <p v-if="message" class="banner info">{{ message }}</p>
    <article class="card">
      <h2>快捷动作</h2>
      <div class="row">
        <button class="btn secondary" @click="seed">写入示例数据</button>
        <button class="btn secondary" @click="calibrate">校准账面余额</button>
        <button class="btn danger" @click="wipe">清空流水</button>
      </div>
      <p class="muted">当前账面余额 {{ formatYuan(store.bookBalanceFen) }} 元</p>
    </article>
    <article class="card">
      <h2>配置项 meta</h2>
      <table class="table">
        <thead><tr><th>键</th><th>值</th></tr></thead>
        <tbody>
          <tr v-for="item in metaRows" :key="item.key">
            <td>{{ item.key }}</td>
            <td><input class="input" :value="item.value" @change="saveMeta(item.key, $event)" /></td>
          </tr>
        </tbody>
      </table>
    </article>
    <article class="card">
      <h2>新增流水</h2>
      <p class="muted">改时间可测历史周期或「今日可用」。保存后立刻写入本机账本。</p>
      <div class="tabs">
        <button type="button" class="tab" :class="{ active: createForm.type === 'expense' }" @click="createForm.type = 'expense'; createForm.categoryId = null">支出</button>
        <button type="button" class="tab" :class="{ active: createForm.type === 'income' }" @click="createForm.type = 'income'; createForm.categoryId = null">收入</button>
      </div>
      <div class="create-grid">
        <label>金额（元）<input v-model="createForm.amount" class="input" inputmode="decimal" placeholder="0.00" /></label>
        <label>时间<input v-model="createForm.occurredAt" class="input" type="datetime-local" /></label>
        <label>
          分类
          <NiceSelect v-model="createCatValue" :options="createCatOptions" title="选择分类" />
        </label>
        <label>对方<input v-model="createForm.counterpart" class="input" placeholder="商家或转账对象" /></label>
        <label>备注<input v-model="createForm.note" class="input" placeholder="实验室新增" /></label>
      </div>
      <button class="btn save" @click="addNew">新增流水</button>
    </article>
    <article class="card">
      <h2>改流水</h2>
      <input v-model="paged.keyword" class="input" placeholder="搜索对方、备注、订单号、分类、收入/支出" />
      <p v-if="!paged.items.length" class="muted">没有匹配的记录。</p>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>时间</th><th>摘要</th><th>金额</th><th></th></tr></thead>
          <tbody>
            <tr v-for="tx in paged.items" :key="tx.id">
              <td>{{ tx.occurredAt.slice(0, 16).replace('T', ' ') }}</td>
              <td>{{ tx.note || tx.counterpart }}</td>
              <td>
                <span v-if="isRefundTx(tx)" class="tag">退款</span>
                <span v-else-if="isNonCashflowTx(tx.type, tx.excludedFromBudget)" class="tag">不计收支</span>
                {{ formatTxAmount(tx.amountFen, tx.type, tx.excludedFromBudget, tx.isRefund) }}
              </td>
              <td>
                <button class="btn ghost" @click="startEdit(tx)">改</button>
                <button class="btn ghost" @click="removeTx(tx.id)">删</button>
              </td>
            </tr>
          </tbody>
        </table>
        <TxPager
          :page="paged.page"
          :page-count="paged.pageCount"
          :page-size="paged.pageSize"
          :total="paged.total"
          @update:page="paged.go"
          @update:page-size="paged.setPageSize"
        />
      </div>
    </article>
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal">
        <h2>改第 {{ editing.id }} 笔</h2>
        <div class="tabs">
          <button class="tab" :class="{ active: form.type === 'expense' }" @click="form.type = 'expense'">支出</button>
          <button class="tab" :class="{ active: form.type === 'income' }" @click="form.type = 'income'">收入</button>
        </div>
        <input v-model="form.amount" class="input" />
        <input v-model="form.occurredAt" class="input" type="datetime-local" />
        <NiceSelect v-model="editCatValue" :options="editCatOptions" title="选择分类" />
        <input v-model="form.counterpart" class="input" placeholder="对方" />
        <input v-model="form.note" class="input" placeholder="备注" />
        <div class="row">
          <button class="btn save" @click="saveEdit">保存修改</button>
          <button class="btn secondary" @click="editing = null">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lab :deep(h1) { color: var(--warn); }
.create-grid { display: grid; gap: 10px; margin: 12px 0; }
.create-grid label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
.table-wrap { overflow-x: auto; }
</style>
