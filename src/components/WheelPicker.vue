<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

export interface WheelOption {
  value: string
  label: string
}

const ITEM_H = 44

const props = defineProps<{
  modelValue: string
  options: WheelOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const scroller = ref<HTMLElement | null>(null)
const index = ref(0)
let settleTimer = 0

function clampIndex(raw: number): number {
  if (!props.options.length) return 0
  return Math.min(Math.max(raw, 0), props.options.length - 1)
}

function indexFromScroll(): number {
  const top = scroller.value?.scrollTop ?? 0
  return clampIndex(Math.round(top / ITEM_H))
}

function scrollToIndex(i: number, smooth = false): void {
  const next = clampIndex(i)
  index.value = next
  scroller.value?.scrollTo({ top: next * ITEM_H, behavior: smooth ? 'smooth' : 'auto' })
}

function commit(i: number): void {
  const next = clampIndex(i)
  index.value = next
  const value = props.options[next]?.value
  if (value != null && value !== props.modelValue) emit('update:modelValue', value)
}

function onScroll(): void {
  index.value = indexFromScroll()
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => commit(index.value), 90)
}

function onScrollEnd(): void {
  window.clearTimeout(settleTimer)
  commit(indexFromScroll())
}

function jump(i: number): void {
  scrollToIndex(i, true)
  commit(i)
}

watch(
  () => [props.modelValue, props.options] as const,
  async () => {
    const i = props.options.findIndex((item) => item.value === props.modelValue)
    await nextTick()
    scrollToIndex(i < 0 ? 0 : i, false)
  },
)

onMounted(async () => {
  const i = props.options.findIndex((item) => item.value === props.modelValue)
  await nextTick()
  scrollToIndex(i < 0 ? 0 : i, false)
})

onUnmounted(() => window.clearTimeout(settleTimer))
</script>

<template>
  <div class="wheel">
    <div class="wheel-window">
      <div class="wheel-highlight" aria-hidden="true" />
      <div
        ref="scroller"
        class="wheel-scroller"
        role="listbox"
        @scroll.passive="onScroll"
        @scrollend="onScrollEnd"
      >
        <button
          v-for="(item, i) in options"
          :key="item.value"
          type="button"
          class="wheel-item"
          :class="{ active: i === index }"
          :style="{
            opacity: String(Math.max(0.18, 1 - Math.abs(i - index) * 0.28)),
            transform: `rotateX(${(i - index) * -14}deg) scale(${Math.max(0.82, 1 - Math.abs(i - index) * 0.08)})`,
          }"
          role="option"
          :aria-selected="i === index"
          @click="jump(i)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    <p class="wheel-current">
      当前选中
      <span>{{ options[index]?.label ?? '' }}</span>
    </p>
  </div>
</template>

<style scoped>
.wheel { display: grid; gap: 10px; }
.wheel-window {
  position: relative;
  height: 220px;
  overflow: hidden;
  border-radius: 16px;
  background: var(--input);
  border: 1px solid var(--line);
  perspective: 480px;
}
.wheel-highlight {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 50%;
  height: 44px;
  transform: translateY(-50%);
  border-radius: 12px;
  background: var(--soft);
  border: 1px solid var(--line);
  pointer-events: none;
  z-index: 1;
}
.wheel-window::before,
.wheel-window::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 72px;
  z-index: 2;
  pointer-events: none;
}
.wheel-window::before {
  top: 0;
  background: linear-gradient(var(--input), transparent);
}
.wheel-window::after {
  bottom: 0;
  background: linear-gradient(transparent, var(--input));
}
.wheel-scroller {
  height: 100%;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  padding: 88px 0;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.wheel-scroller::-webkit-scrollbar { display: none; }
.wheel-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.25;
  text-align: center;
  padding: 0 16px;
  scroll-snap-align: center;
  position: relative;
  z-index: 3;
}
.wheel-item.active {
  color: var(--ink);
  font-weight: 800;
  font-size: 16px;
}
.wheel-current {
  margin: 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.wheel-current span {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 10px;
  border-radius: 8px;
  background: var(--soft);
  color: var(--moss-dark);
  font-weight: 700;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
