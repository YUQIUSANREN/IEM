<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { describePeriodRule } from '../domain/period'
import { isCompactLayout, onCompactChange } from '../ui/layout'
import WheelPicker from './WheelPicker.vue'

const props = defineProps<{
  modelValue: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const days = Array.from({ length: 31 }, (_, i) => i + 1)
const compact = ref(isCompactLayout())

const rule = computed(() => describePeriodRule(props.modelValue))
const dayOptions = computed(() => days.map((day) => ({ value: String(day), label: `${day} 日` })))
const dayValue = computed({
  get: () => String(rule.value.startDay),
  set: (value: string) => emit('update:modelValue', Number(value)),
})

function pick(day: number): void {
  emit('update:modelValue', day)
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
  <div class="day-picker">
    <div class="preview">
      <div class="box start">
        <span class="muted">起始日（点选）</span>
        <strong>每月 {{ rule.startDay }} 日</strong>
      </div>
      <span class="arrow" aria-hidden="true">→</span>
      <div class="box end">
        <span class="muted">结束日（自动）</span>
        <strong>{{ rule.endDayLabel }}</strong>
      </div>
    </div>
    <p class="summary">{{ rule.summary }}</p>
    <WheelPicker v-if="compact" v-model="dayValue" :options="dayOptions" />
    <div v-else class="grid" role="listbox" :aria-label="'周期起始日，当前' + rule.startDay">
      <button
        v-for="day in days"
        :key="day"
        type="button"
        class="day"
        :class="{ active: day === rule.startDay }"
        @click="pick(day)"
      >
        {{ day }}
      </button>
    </div>
    <p class="muted hint">没有该日的月份会落到月末，例如 2 月没有 31 日就从月末起算。</p>
  </div>
</template>

<style scoped>
.day-picker { display: grid; gap: 10px; }
.preview {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: stretch;
}
.box {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px;
  background: var(--input);
  display: grid;
  gap: 4px;
}
.box.start { border-color: var(--moss); background: var(--soft); }
.box.end { background: var(--soft-2); }
.box strong { font-size: 18px; font-family: 'Noto Serif SC', serif; }
.arrow {
  align-self: center;
  color: var(--muted);
  font-size: 18px;
}
.summary {
  margin: 0;
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
.day {
  border: 1px solid var(--line);
  background: var(--input);
  border-radius: 10px;
  padding: 8px 0;
  cursor: pointer;
}
.day.active {
  background: var(--moss);
  border-color: var(--moss);
  color: var(--btn-on);
  font-weight: 700;
}
.hint { margin: 0; }
</style>
