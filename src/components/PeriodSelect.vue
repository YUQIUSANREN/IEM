<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'
import { getPeriodStartDay } from '../domain/engine'
import { getPeriodByDate, listSelectablePeriods } from '../domain/period'
import NiceSelect from './NiceSelect.vue'

const props = defineProps<{
  modelValue: string
  allowCustom?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const store = useAppStore()

const options = computed(() => {
  const startDay = getPeriodStartDay()
  const choices = listSelectablePeriods(startDay, store.transactions)
  const liveStart = getPeriodByDate(new Date(), startDay).startIso
  const items = choices.map((item) => ({
    value: item.startIso,
    label: `${item.label}${item.startIso === liveStart ? '（本周期）' : ''}`,
  }))
  return props.allowCustom ? [{ value: 'custom', label: '自定义区间' }, ...items] : items
})
</script>

<template>
  <label class="period-select">
    <span class="muted">周期</span>
    <NiceSelect
      :model-value="modelValue"
      :options="options"
      title="选择周期"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </label>
</template>

<style scoped>
.period-select {
  display: grid;
  gap: 6px;
  min-width: 0;
  width: 100%;
  max-width: 100%;
}
</style>
