<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import NiceSelect from './NiceSelect.vue'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]

const props = defineProps<{
  page: number
  pageCount: number
  total: number
  pageSize: number
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
}>()

const sizeOptions = computed(() => {
  const sizes = new Set(PAGE_SIZE_OPTIONS)
  if (Number.isFinite(props.pageSize)) sizes.add(props.pageSize)
  return [...sizes].sort((a, b) => a - b)
})
const jumpTo = ref(String(props.page))
const sizeDraft = ref(String(props.pageSize))

watch(
  () => props.page,
  (value) => {
    jumpTo.value = String(value)
  },
)

watch(
  () => props.pageSize,
  (value) => {
    sizeDraft.value = String(value)
  },
)

function go(next: number): void {
  emit('update:page', next)
}

function jump(): void {
  const raw = Number.parseInt(jumpTo.value, 10)
  if (!Number.isFinite(raw)) {
    jumpTo.value = String(props.page)
    return
  }
  go(raw)
}

function applyPageSize(raw: string | number): void {
  const size = typeof raw === 'number' ? raw : Number.parseInt(raw, 10)
  if (!Number.isFinite(size)) {
    sizeDraft.value = String(props.pageSize)
    return
  }
  emit('update:pageSize', size)
}
</script>

<template>
  <div class="pager">
    <span class="muted">共 {{ total }} 笔 · 第 {{ page }} / {{ pageCount }} 页</span>
    <div class="row">
      <label class="jump">
        <span class="muted">每页</span>
        <NiceSelect
          :model-value="String(pageSize)"
          :options="sizeOptions.map((size) => ({ value: String(size), label: String(size) }))"
          title="每页条数"
          @update:model-value="applyPageSize($event)"
        />
        <input
          v-model="sizeDraft"
          class="input"
          inputmode="numeric"
          title="自定义每页条数，1–200"
          @keyup.enter="applyPageSize(sizeDraft)"
          @change="applyPageSize(sizeDraft)"
        />
        <span class="muted">条</span>
      </label>
      <button class="btn secondary" type="button" :disabled="page <= 1" @click="go(1)">首页</button>
      <button class="btn secondary" type="button" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
      <button class="btn secondary" type="button" :disabled="page >= pageCount" @click="go(page + 1)">下一页</button>
      <button class="btn secondary" type="button" :disabled="page >= pageCount" @click="go(pageCount)">末页</button>
      <label class="jump">
        <span class="muted">转到</span>
        <input
          v-model="jumpTo"
          class="input"
          inputmode="numeric"
          :min="1"
          :max="pageCount"
          @keyup.enter="jump"
        />
        <button class="btn secondary" type="button" @click="jump">跳转</button>
      </label>
    </div>
  </div>
</template>

<style scoped>
.pager {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
.jump {
  display: flex;
  align-items: center;
  gap: 6px;
}
.jump .input {
  width: 72px;
  padding: 8px 10px;
}
.jump :deep(.nice-select) {
  width: 88px;
}
</style>
