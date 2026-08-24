<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { addCategory, addTransaction, listTransactions, updateTransaction } from '../domain/engine'
import { mostUsedCategoryId } from '../domain/dedupe'
import { formatYuan, parseYuanInput } from '../domain/money'
import { toLocalIso } from '../domain/period'
import { isNonCashflowTx } from '../domain/tx-display'
import type { Category, Transaction, TxType } from '../types'
import NiceSelect from './NiceSelect.vue'
import { isCompactLayout, onCompactChange } from '../ui/layout'
import { toast, trySave } from '../ui/toast'

const props = defineProps<{
  /** 传入则进入修改，字段与记一笔相同。 */
  tx?: Transaction | null
}>()

const emit = defineEmits<{
  saved: [keepOpen: boolean]
  cancel: []
}>()

const store = useAppStore()
const compact = ref(isCompactLayout())
const timeEl = ref<HTMLInputElement | null>(null)
const partyEl = ref<HTMLInputElement | null>(null)
const noteEl = ref<HTMLInputElement | null>(null)
/** 手机端同时只展开一行输入，避免分不清在填哪一项。 */
const metaFocus = ref<'party' | 'note' | null>(null)
const catPage = ref(0)
const digits = ref('')
const acc = ref<number | null>(null)
const op = ref<'+' | '-' | null>(null)
const addingName = ref('')
/** 点「+分类」后就地变成输入，而不是单独占一行。 */
const addingCat = ref(false)
const addCatEl = ref<HTMLInputElement | null>(null)
/** fillFrom 写入对方时不要按历史改掉已有分类。 */
let skipAutoCat = false

type FormKind = 'expense' | 'income' | 'skip'

const form = reactive({
  kind: 'expense' as FormKind,
  amount: '',
  occurredAt: toLocalIso(new Date()).slice(0, 16),
  categoryId: null as number | null,
  counterpart: '',
  note: '',
  isRefund: false,
})

const editing = computed(() => Boolean(props.tx))
/** 每页留一格给「+分类」，5×2 仍铺满。 */
const pageSize = 9

const cats = computed((): Category[] => {
  const kind = form.kind === 'income' ? 'income' : form.kind === 'skip' ? 'transfer' : 'expense'
  return store.categories.filter((item) => item.kind === kind)
})

const catOptions = computed(() => [
  { value: '', label: form.kind === 'skip' ? '无分类' : '未分类' },
  ...cats.value.map((item) => ({ value: String(item.id), label: item.name })),
])

const gridCats = computed(() => {
  const list = cats.value.map((item) => ({ id: item.id as number | null, name: item.name }))
  if (form.kind !== 'skip') return list
  return [{ id: null, name: '无分类' }, ...list]
})
const catPages = computed(() => Math.max(1, Math.ceil(gridCats.value.length / pageSize)))
const pagedCats = computed(() => {
  const start = catPage.value * pageSize
  return gridCats.value.slice(start, start + pageSize)
})
const catValue = computed({
  get: () => (form.categoryId == null ? '' : String(form.categoryId)),
  set: (value: string) => {
    form.categoryId = value === '' ? null : Number(value)
  },
})

const amountLabel = computed(() => {
  const current = digits.value || '0'
  if (acc.value == null || !op.value) {
    if (!digits.value) return '0.00'
    return current
  }
  return `${formatYuan(Math.round(acc.value * 100))}${op.value}${current}`
})

function defaultCategory(kind: FormKind): number | null {
  if (kind === 'skip') return null
  const want = kind === 'income' ? 'income' : 'expense'
  return store.categories.find((item) => item.kind === want)?.id ?? null
}

function categoryKind(kind: FormKind): Category['kind'] {
  if (kind === 'income') return 'income'
  if (kind === 'skip') return 'transfer'
  return 'expense'
}

/**
 * 对方名对上历史后写入分类。
 * 直接查库，不依赖 store 是否已刷新；新分类可能在后几页，必须翻过去。
 */
function applyPartyCategory(): void {
  if (skipAutoCat || form.kind === 'skip') return
  const type = form.kind === 'income' ? 'income' : 'expense'
  const txs = listTransactions('')
  const id = mostUsedCategoryId(form.counterpart, type, txs)
  if (id == null) return
  form.categoryId = id
  revealCategory(id)
}

function revealCategory(id: number | null): void {
  if (id == null) return
  const index = gridCats.value.findIndex((item) => item.id == id)
  if (index >= 0) catPage.value = Math.floor(index / pageSize)
}

/** 输入事件可能早于 v-model 落值，先读输入框再匹配。 */
function onPartyInput(event: Event): void {
  const el = event.target as HTMLInputElement | null
  if (el) form.counterpart = el.value
  applyPartyCategory()
}

function cancelAddCategory(): void {
  addingCat.value = false
  addingName.value = ''
}

/**
 * 点「+分类」：格子变成输入框并拉起系统键盘。
 * 用 nextTick 等节点挂上再 focus，避免点按被数字键盘抢走。
 */
function startAddCategory(): void {
  addingCat.value = true
  addingName.value = ''
  metaFocus.value = null
  void nextTick(() => addCatEl.value?.focus())
}

function submitNewCategory(): void {
  try {
    const id = addCategory(addingName.value, categoryKind(form.kind))
    store.refreshDashboard()
    form.categoryId = id
    cancelAddCategory()
    void nextTick(() => revealCategory(id))
    toast('ok', '已添加分类')
  } catch (error) {
    toast('error', error instanceof Error ? error.message : '添加分类失败')
    void nextTick(() => addCatEl.value?.focus())
  }
}

/** 失焦时空名称视为取消；有内容则提交，少点一次确认。 */
function onAddCatBlur(): void {
  if (!addingCat.value) return
  if (!addingName.value.trim()) {
    cancelAddCategory()
    return
  }
  submitNewCategory()
}

function fillFrom(tx: Transaction | null | undefined): void {
  skipAutoCat = true
  acc.value = null
  op.value = null
  metaFocus.value = null
  catPage.value = 0
  cancelAddCategory()
  if (!tx) {
    form.kind = 'expense'
    form.amount = ''
    digits.value = ''
    form.occurredAt = toLocalIso(new Date()).slice(0, 16)
    form.categoryId = defaultCategory('expense')
    form.counterpart = ''
    form.note = ''
    form.isRefund = false
  } else {
    form.kind = isNonCashflowTx(tx.type, tx.excludedFromBudget) ? 'skip' : tx.type === 'income' ? 'income' : 'expense'
    form.amount = formatYuan(tx.amountFen)
    digits.value = formatYuan(tx.amountFen)
    form.occurredAt = tx.occurredAt.slice(0, 16)
    form.categoryId = tx.categoryId ?? defaultCategory(form.kind)
    form.counterpart = tx.counterpart
    form.note = tx.note
    form.isRefund = Boolean(tx.isRefund)
  }
  void nextTick(() => {
    skipAutoCat = false
  })
}

function setKind(kind: FormKind): void {
  if (form.kind === kind) return
  form.kind = kind
  catPage.value = 0
  cancelAddCategory()
  form.categoryId = defaultCategory(kind)
  if (kind !== 'expense') form.isRefund = false
  applyPartyCategory()
}

function tapKey(ch: string): void {
  metaFocus.value = null
  if (ch === '.') {
    if (digits.value.includes('.')) return
    digits.value = `${digits.value || '0'}.`
    return
  }
  const frac = digits.value.split('.')[1]
  if (frac !== undefined && frac.length >= 2) return
  if (digits.value === '0') digits.value = ch
  else digits.value += ch
}

function backspace(): void {
  metaFocus.value = null
  digits.value = digits.value.slice(0, -1)
}

function tapOp(next: '+' | '-'): void {
  metaFocus.value = null
  const cur = Number(digits.value || '0')
  if (!Number.isFinite(cur)) return
  if (acc.value == null) acc.value = cur
  else if (op.value === '+') acc.value += cur
  else if (op.value === '-') acc.value -= cur
  op.value = next
  digits.value = ''
}

function resolvedYuan(): string {
  let n = Number(digits.value || form.amount || '0')
  if (acc.value != null && op.value) {
    n = op.value === '+' ? acc.value + n : acc.value - n
  }
  if (!Number.isFinite(n)) return ''
  return n.toFixed(2)
}

function openTime(): void {
  metaFocus.value = null
  const el = timeEl.value
  if (!el) return
  if (typeof el.showPicker === 'function') el.showPicker()
  else el.focus()
}

/**
 * 展开对方或备注输入。另一行收回，标题仍留在左侧。
 */
function openMeta(field: 'party' | 'note'): void {
  metaFocus.value = field
  void nextTick(() => {
    const el = field === 'party' ? partyEl.value : noteEl.value
    el?.focus()
  })
}

function save(keepOpen: boolean): void {
  const yuan = compact.value ? resolvedYuan() : form.amount
  const fen = parseYuanInput(yuan)
  if (fen === null || fen <= 0) {
    toast('error', '请输入有效金额')
    return
  }
  const occurredAt = form.occurredAt.length === 16 ? `${form.occurredAt}:00` : form.occurredAt
  const type: TxType = form.kind === 'skip' ? 'transfer' : form.kind
  const excludedFromBudget = form.kind === 'skip'
  const ok = props.tx
    ? trySave(() => {
        updateTransaction(props.tx!.id, {
          type,
          amountFen: fen,
          occurredAt,
          categoryId: form.categoryId,
          counterpart: form.counterpart,
          note: form.note,
          excludedFromBudget,
          isRefund: form.kind === 'expense' && form.isRefund,
        })
      }, '已保存修改')
    : trySave(() => {
        addTransaction({
          type,
          amountFen: fen,
          occurredAt,
          categoryId: form.categoryId,
          source: 'manual',
          counterpart: form.counterpart,
          note: form.note,
          excludedFromBudget,
          isRefund: form.kind === 'expense' && form.isRefund,
        })
      }, '已记一笔')
  if (!ok) return
  store.refreshDashboard()
  if (keepOpen && !props.tx) {
    acc.value = null
    op.value = null
    digits.value = ''
    form.amount = ''
    form.note = ''
    form.counterpart = ''
    form.isRefund = false
    form.occurredAt = toLocalIso(new Date()).slice(0, 16)
    emit('saved', true)
    return
  }
  emit('saved', false)
}

let stopCompact: (() => void) | null = null
onMounted(() => {
  compact.value = isCompactLayout()
  stopCompact = onCompactChange((value) => {
    compact.value = value
  })
})
onUnmounted(() => stopCompact?.())

watch(() => props.tx, (tx) => fillFrom(tx), { immediate: true })
watch(() => form.counterpart, () => applyPartyCategory())
watch(metaFocus, (now, prev) => {
  if (prev === 'party' && now !== 'party') applyPartyCategory()
})
</script>

<template>
  <form v-if="!compact" class="grid" @submit.prevent="save(false)">
    <h2>{{ editing ? '修改' : '记一笔' }}</h2>
    <div class="tabs">
      <button type="button" class="tab" :class="{ active: form.kind === 'expense' }" @click="setKind('expense')">支出</button>
      <button type="button" class="tab" :class="{ active: form.kind === 'income' }" @click="setKind('income')">收入</button>
      <button type="button" class="tab" :class="{ active: form.kind === 'skip' }" @click="setKind('skip')">其他</button>
    </div>
    <p v-if="form.kind === 'skip'" class="muted">此项不计入收入、支出和限额，只记进账本。</p>
    <label>金额（元）<input v-model="form.amount" class="input" inputmode="decimal" placeholder="0.00" /></label>
    <label>时间<input v-model="form.occurredAt" class="input" type="datetime-local" /></label>
    <label>
      分类
      <NiceSelect v-model="catValue" :options="catOptions" title="选择分类" />
    </label>
    <button v-if="!addingCat" class="chip-add" type="button" @click="startAddCategory">+分类</button>
    <div v-else class="chip-editor">
      <input
        ref="addCatEl"
        v-model="addingName"
        class="input"
        maxlength="12"
        placeholder="新分类名称"
        @keydown.enter.prevent="submitNewCategory"
        @keydown.escape.prevent="cancelAddCategory"
        @blur="onAddCatBlur"
      />
    </div>
    <label>对方<input v-model="form.counterpart" class="input" placeholder="商家或转账对象" @input="onPartyInput" @compositionend="onPartyInput" @blur="applyPartyCategory" /></label>
    <label>备注<input v-model="form.note" class="input" /></label>
    <label v-if="form.kind === 'expense'" class="refund-check">
      <input v-model="form.isRefund" type="checkbox" />
      这是退款，冲减支出（不记成收入）
    </label>
    <div class="row actions">
      <button class="btn save" type="submit">{{ editing ? '保存修改' : '保存这一笔' }}</button>
      <button class="btn secondary" type="button" @click="emit('cancel')">取消</button>
    </div>
  </form>

  <div v-else class="composer" :class="'kind-' + form.kind">
    <header class="composer-head">
      <button class="icon-btn" type="button" aria-label="关闭" @click="emit('cancel')">×</button>
      <h2>{{ editing ? '修改' : '记一笔' }}</h2>
      <span class="icon-btn ghost" />
    </header>
    <nav class="kind-tabs">
      <button type="button" :class="{ active: form.kind === 'expense' }" @click="setKind('expense')">支出</button>
      <button type="button" :class="{ active: form.kind === 'income' }" @click="setKind('income')">收入</button>
      <button type="button" :class="{ active: form.kind === 'skip' }" @click="setKind('skip')">其他</button>
    </nav>
    <p v-if="form.kind === 'skip'" class="skip-hint">此项不计入收入、支出和限额，只出现在账本里。</p>
    <div class="amount-line">
      <span class="yen">¥</span>
      <span class="amount" :class="{ placeholder: !digits && acc == null }">{{ amountLabel }}</span>
    </div>
    <div class="cat-grid">
      <button
        v-for="item in pagedCats"
        :key="item.id ?? 'none'"
        type="button"
        class="cat"
        :class="{ active: item.id == form.categoryId }"
        @click="form.categoryId = item.id"
      >
        <span class="cat-icon">{{ item.name.slice(0, 1) }}</span>
        <span class="cat-name">{{ item.name }}</span>
      </button>
      <button
        v-if="!addingCat"
        type="button"
        class="cat add"
        @click="startAddCategory"
      >
        <span class="cat-icon">+</span>
        <span class="cat-name">分类</span>
      </button>
      <label v-else class="cat-editor">
        <input
          ref="addCatEl"
          v-model="addingName"
          maxlength="12"
          placeholder="新分类名称"
          enterkeyhint="done"
          @keydown.enter.prevent="submitNewCategory"
          @keydown.escape.prevent="cancelAddCategory"
          @blur="onAddCatBlur"
        />
      </label>
    </div>
    <div v-if="catPages > 1" class="dots">
      <button
        v-for="i in catPages"
        :key="i"
        type="button"
        :class="{ on: catPage === i - 1 }"
        @click="catPage = i - 1"
      />
    </div>
    <button type="button" class="meta-row" @click="openTime">
      <span class="meta-ico">⏱</span>
      <span class="meta-label">时间</span>
      <strong>{{ form.occurredAt.replace('T', ' ') }}</strong>
      <span class="chev">›</span>
    </button>
    <input ref="timeEl" v-model="form.occurredAt" class="time-input" type="datetime-local" />
    <div
      class="meta-row"
      :class="{ editing: metaFocus === 'party' }"
      @click="openMeta('party')"
    >
      <span class="meta-ico">⇄</span>
      <span class="meta-label">对方</span>
      <input
        v-if="metaFocus === 'party'"
        ref="partyEl"
        v-model="form.counterpart"
        class="meta-input"
        placeholder="商家或转账对象"
        autocomplete="off"
        @click.stop
        @input="onPartyInput"
        @compositionend="onPartyInput"
        @blur="applyPartyCategory"
      />
      <span v-else class="meta-value" :class="{ placeholder: !form.counterpart }">
        {{ form.counterpart || '点击添加对方' }}
      </span>
      <span v-if="metaFocus !== 'party'" class="chev">›</span>
    </div>
    <div
      class="meta-row"
      :class="{ editing: metaFocus === 'note' }"
      @click="openMeta('note')"
    >
      <span class="meta-ico">✎</span>
      <span class="meta-label">备注</span>
      <input
        v-if="metaFocus === 'note'"
        ref="noteEl"
        v-model="form.note"
        class="meta-input"
        placeholder="点击添加备注"
        @click.stop
      />
      <span v-else class="meta-value" :class="{ placeholder: !form.note }">
        {{ form.note || '点击添加备注' }}
      </span>
      <span v-if="metaFocus !== 'note'" class="chev">›</span>
    </div>
    <label v-if="form.kind === 'expense'" class="refund-check compact">
      <input v-model="form.isRefund" type="checkbox" />
      这是退款，冲减支出
    </label>
    <div class="pad">
      <button type="button" @click="tapKey('1')">1</button>
      <button type="button" @click="tapKey('2')">2</button>
      <button type="button" @click="tapKey('3')">3</button>
      <button type="button" class="pad-muted" @click="backspace">⌫</button>
      <button type="button" @click="tapKey('4')">4</button>
      <button type="button" @click="tapKey('5')">5</button>
      <button type="button" @click="tapKey('6')">6</button>
      <button type="button" class="pad-muted" @click="tapOp('+')">+</button>
      <button type="button" @click="tapKey('7')">7</button>
      <button type="button" @click="tapKey('8')">8</button>
      <button type="button" @click="tapKey('9')">9</button>
      <button type="button" class="pad-muted" @click="tapOp('-')">−</button>
      <button type="button" @click="tapKey('.')">.</button>
      <button type="button" @click="tapKey('0')">0</button>
      <button
        v-if="!editing"
        type="button"
        class="pad-again"
        @click="save(true)"
      >
        再记一笔
      </button>
      <button v-else type="button" class="pad-again" @click="emit('cancel')">取消</button>
      <button type="button" class="pad-done" @click="save(false)">{{ editing ? '保存' : '完成' }}</button>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; gap: 12px; }
label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
.refund-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}
.refund-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--moss);
}
.refund-check.compact {
  margin: 4px 16px 0;
}
.actions { margin-top: 4px; }
.actions .btn.save { flex: 1; }
.chip-add {
  justify-self: start;
  border: 1px dashed var(--line);
  background: transparent;
  border-radius: 99px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--muted);
}
.chip-editor .input { margin: 0; }

.composer {
  height: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--card);
  position: relative;
}
.composer-head {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  /* 安全区之上再留 38px（原 8px + 30px），让 × 和标题离开状态栏再看一版 */
  padding: calc(38px + var(--app-pad-top, 16px)) 8px 0;
}
.composer-head h2 {
  margin: 0;
  text-align: center;
  font-size: 18px;
  font-family: inherit;
}
.icon-btn {
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  font-size: 28px;
  line-height: 1;
  color: var(--muted);
}
.icon-btn.ghost { visibility: hidden; }
.kind-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 0 12px;
}
.kind-tabs button {
  border: 0;
  background: transparent;
  padding: 10px 0 8px;
  color: var(--muted);
  position: relative;
}
.kind-tabs .active {
  color: var(--ink);
  font-weight: 700;
}
.kind-tabs .active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 28px;
  height: 3px;
  border-radius: 99px;
  background: var(--kind);
  transform: translateX(-50%);
}
.skip-hint {
  margin: 8px 16px 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--info-bg);
  border: 1px solid var(--info-line);
  color: var(--muted);
  font-size: 12px;
}
.amount-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 16px 20px 10px;
  border-bottom: 2px solid var(--kind);
  margin: 0 16px;
  font-variant-numeric: tabular-nums;
  min-width: 0;
}
.yen { font-size: 22px; font-weight: 700; flex: 0 0 auto; }
.amount {
  font-size: 36px;
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.amount.placeholder { color: var(--muted); font-weight: 500; }
.cat-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px 6px;
  padding: 16px 10px 8px;
}
.cat {
  border: 0;
  background: transparent;
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 0;
  color: var(--ink);
}
.kind-expense {
  --kind: var(--kind-expense);
  --kind-bg: var(--kind-expense-bg);
}
.kind-income {
  --kind: var(--kind-income);
  --kind-bg: var(--kind-income-bg);
}
.kind-skip {
  --kind: var(--kind-skip);
  --kind-bg: var(--kind-skip-bg);
}
.cat-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--kind-bg);
  color: var(--kind);
  font-weight: 700;
}
.cat.active .cat-icon {
  background: var(--kind);
  color: var(--btn-on);
}
.cat.add .cat-icon {
  font-size: 22px;
  font-weight: 500;
}
.cat-editor {
  grid-column: 1 / -1;
  min-width: 0;
}
.cat-editor input {
  width: 100%;
  min-width: 0;
  height: 44px;
  border: 1px dashed var(--kind);
  border-radius: 12px;
  background: var(--kind-bg);
  padding: 0 12px;
  font: inherit;
  font-size: 14px;
  color: inherit;
  outline: none;
}
.cat-name { font-size: 11px; }
.dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding-bottom: 4px;
}
.dots button {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--line);
}
.dots .on { background: var(--kind); }
.meta-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  min-width: 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  padding: 12px 16px;
  text-align: left;
  cursor: pointer;
}
.meta-row.editing {
  background: var(--soft);
}
.meta-ico { width: 1.2em; color: var(--muted); }
.meta-label {
  white-space: nowrap;
  color: var(--ink);
}
.meta-row strong,
.meta-value {
  justify-self: end;
  font-weight: 500;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-value.placeholder { color: var(--muted); }
.meta-input {
  justify-self: stretch;
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: right;
  font: inherit;
  font-weight: 500;
  color: inherit;
  outline: none;
}
.chev { color: var(--muted); }
.time-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.pad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: auto;
  /* 手势条 / Home 指示条往往比 safe-area 更高，额外抬一截避免贴底误触 */
  padding: 10px 10px calc(18px + env(safe-area-inset-bottom, 0px));
  background: var(--soft);
  border-top: 1px solid var(--line);
}
.pad button {
  border: 0;
  background: var(--card);
  min-height: 48px;
  border-radius: 12px;
  font-size: 20px;
}
.pad-muted { color: var(--muted); }
.pad-again {
  font-size: 13px !important;
  color: var(--muted);
}
.pad-done {
  background: var(--moss) !important;
  color: var(--btn-on);
  font-size: 16px !important;
  font-weight: 700;
}
</style>
