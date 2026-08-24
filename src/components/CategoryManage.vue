<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '../stores/app'
import {
  addCategory,
  countCategoryUsage,
  deleteCategory,
  renameCategory,
} from '../domain/engine'
import { isProtectedCategory } from '../domain/dedupe'
import type { Category } from '../types'
import { isCompactLayout, onCompactChange } from '../ui/layout'
import { trySave } from '../ui/toast'
import { askConfirm } from '../ui/confirm'

const emit = defineEmits<{
  close: []
}>()

const store = useAppStore()
const compact = ref(isCompactLayout())
const renamingId = ref<number | null>(null)
const renameDraft = ref('')
const newCatName = ref('')
const newCatKind = ref<Category['kind']>('expense')

const catGroups = computed(() =>
  (
    [
      { kind: 'expense' as const, title: '支出' },
      { kind: 'income' as const, title: '收入' },
      { kind: 'transfer' as const, title: '其他' },
    ] as const
  ).map((group) => ({
    ...group,
    items: store.categories.filter((item) => item.kind === group.kind),
  })),
)

function fallbackHint(kind: Category['kind']): string {
  if (kind === 'income') return '其他收入'
  if (kind === 'transfer') return '无分类'
  return '其他支出'
}

function startRename(cat: Category): void {
  renamingId.value = cat.id
  renameDraft.value = cat.name
}

function saveRename(): void {
  if (renamingId.value == null) return
  if (!trySave(() => renameCategory(renamingId.value!, renameDraft.value), '已改名')) return
  renamingId.value = null
  store.refreshDashboard()
}

function cancelRename(): void {
  renamingId.value = null
  renameDraft.value = ''
}

function addNewCategory(): void {
  if (!trySave(() => addCategory(newCatName.value, newCatKind.value), '已添加分类')) return
  newCatName.value = ''
  store.refreshDashboard()
}

async function removeCategory(cat: Category): Promise<void> {
  const used = countCategoryUsage(cat.id)
  const ok = await askConfirm({
    title: '删除分类？',
    message:
      used > 0
        ? `「${cat.name}」有 ${used} 笔流水，删除后会改挂到「${fallbackHint(cat.kind)}」。`
        : `确定删除「${cat.name}」？`,
  })
  if (!ok) return
  if (!trySave(() => deleteCategory(cat.id), '已删除分类')) return
  store.refreshDashboard()
}

let stopCompact: (() => void) | null = null
onMounted(() => {
  compact.value = isCompactLayout()
  stopCompact = onCompactChange((value) => {
    compact.value = value
  })
})
onUnmounted(() => stopCompact?.())
</script>

<template>
  <div class="sheet" :class="{ compact }">
    <header class="sheet-head">
      <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">×</button>
      <h2>分类管理</h2>
      <span class="icon-btn ghost" />
    </header>
    <div class="sheet-body">
      <p class="muted">记一笔时可现加。删除后，已用该标签的流水会改挂到其他支出 / 其他收入 / 无分类。</p>
      <div class="add-cat">
        <select v-model="newCatKind" class="input cat-kind">
          <option value="expense">支出</option>
          <option value="income">收入</option>
          <option value="transfer">其他</option>
        </select>
        <input
          v-model="newCatName"
          class="input"
          maxlength="12"
          placeholder="新标签名称"
          @keydown.enter.prevent="addNewCategory"
        />
        <button class="btn" type="button" @click="addNewCategory">添加</button>
      </div>
      <div v-for="group in catGroups" :key="group.kind" class="cat-group" :class="'kind-' + group.kind">
        <h3>{{ group.title }}</h3>
        <div v-for="cat in group.items" :key="cat.id" class="cat-row">
          <span class="cat-icon" aria-hidden="true">{{ cat.name.slice(0, 1) }}</span>
          <template v-if="renamingId === cat.id">
            <input
              v-model="renameDraft"
              class="input"
              maxlength="12"
              @keydown.enter.prevent="saveRename"
              @keydown.escape="cancelRename"
            />
            <button class="row-btn" type="button" @click="saveRename">保存</button>
            <button class="row-btn ghost" type="button" @click="cancelRename">取消</button>
          </template>
          <template v-else>
            <span class="cat-name">{{ cat.name }}</span>
            <template v-if="!isProtectedCategory(cat)">
              <button class="row-btn ghost" type="button" @click="startRename(cat)">改名</button>
              <button class="row-btn ghost" type="button" @click="removeCategory(cat)">删除</button>
            </template>
            <span v-else class="muted lock">不予删除</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  height: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--card);
}
.sheet-head {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  flex: 0 0 auto;
  padding: 4px 8px 8px;
}
.sheet.compact .sheet-head {
  padding: calc(8px + var(--app-pad-top, 16px)) 8px 0;
}
.sheet-head h2 {
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
.sheet-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px calc(16px + var(--app-pad-bottom, 0px));
  display: grid;
  align-content: start;
  gap: 12px;
}
.sheet-body .muted { margin: 0; }
.add-cat {
  display: flex;
  gap: 8px;
  align-items: center;
}
.add-cat .input {
  flex: 1;
  min-width: 0;
}
.cat-kind {
  flex: 0 0 88px;
}
.cat-group {
  display: grid;
  gap: 8px;
}
.kind-expense {
  --kind: var(--kind-expense);
  --kind-bg: var(--kind-expense-bg);
}
.kind-income {
  --kind: var(--kind-income);
  --kind-bg: var(--kind-income-bg);
}
.kind-transfer {
  --kind: var(--kind-skip);
  --kind-bg: var(--kind-skip-bg);
}
.cat-group h3 {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.cat-row {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 32px;
}
.cat-icon {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--kind-bg);
  color: var(--kind);
  font-size: 14px;
  font-weight: 700;
}
.cat-row .input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
}
.cat-name {
  flex: 1;
  min-width: 0;
}
.row-btn {
  flex: 0 0 auto;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  background: var(--moss);
  color: var(--btn-on);
}
.row-btn.ghost {
  background: transparent;
  color: var(--moss-dark);
}
.lock {
  flex: 0 0 auto;
  font-size: 13px;
}
</style>
