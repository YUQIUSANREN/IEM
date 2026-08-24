<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { isCompactLayout } from '../ui/layout'
import WheelPicker from './WheelPicker.vue'

export interface SelectOption {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string
  options: SelectOption[]
  placeholder?: string
  /** 手机底部弹层标题，缺省用当前选项文案 */
  title?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const sheet = ref(false)
const draft = ref(props.modelValue)

const currentLabel = computed(() => {
  return props.options.find((item) => item.value === props.modelValue)?.label ?? props.placeholder ?? '请选择'
})

function isMobile(): boolean {
  return isCompactLayout()
}

function close(): void {
  open.value = false
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', close)
}

function confirm(): void {
  if (draft.value !== props.modelValue) emit('update:modelValue', draft.value)
  close()
}

function onPointerDown(event: Event): void {
  const target = event.target as Node | null
  if (!target) return
  if (triggerEl.value?.contains(target) || panelEl.value?.contains(target)) return
  close()
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

function placeDesktop(): void {
  const rect = triggerEl.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.max(rect.width, 240)
  const left = Math.min(rect.left, window.innerWidth - width - 12)
  const below = window.innerHeight - rect.bottom
  const openUp = below < 280 && rect.top > below
  panelStyle.value = {
    position: 'fixed',
    left: `${Math.max(12, left)}px`,
    width: `${width}px`,
    maxHeight: 'min(320px, 50vh)',
    ...(openUp
      ? { bottom: `${window.innerHeight - rect.top + 6}px` }
      : { top: `${rect.bottom + 6}px` }),
  }
}

async function toggle(): Promise<void> {
  if (open.value) {
    close()
    return
  }
  sheet.value = isMobile()
  draft.value = props.modelValue
  open.value = true
  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', close)
  await nextTick()
  if (!sheet.value) placeDesktop()
}

function pick(value: string): void {
  emit('update:modelValue', value)
  close()
}

watch(
  () => props.modelValue,
  (value) => {
    if (!open.value) draft.value = value
  },
)

onUnmounted(close)
</script>

<template>
  <div class="nice-select">
    <button
      ref="triggerEl"
      class="nice-trigger"
      type="button"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="nice-label">{{ currentLabel }}</span>
      <span class="nice-chevron" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-if="open" class="nice-layer" :class="{ sheet }">
        <button v-if="sheet" class="nice-backdrop" type="button" aria-label="关闭" @click="close" />
        <div ref="panelEl" class="nice-panel" :class="{ wheel: sheet }" :style="sheet ? undefined : panelStyle">
          <header v-if="sheet" class="nice-head">
            <strong>{{ title || '滚动选择' }}</strong>
            <button class="btn" type="button" @click="confirm">完成</button>
          </header>
          <WheelPicker v-if="sheet" v-model="draft" :options="options" />
          <template v-else>
            <button
              v-for="item in options"
              :key="item.value"
              class="nice-option"
              :class="{ active: item.value === modelValue }"
              type="button"
              @click="pick(item.value)"
            >
              <span>{{ item.label }}</span>
              <span v-if="item.value === modelValue" class="nice-check">✓</span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.nice-select { width: 100%; min-width: 0; max-width: 100%; }
.nice-trigger {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--input);
  border-radius: 12px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.nice-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nice-chevron {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--muted);
  border-bottom: 2px solid var(--muted);
  transform: rotate(45deg);
  margin-top: -4px;
}
</style>

<style>
.nice-layer {
  position: fixed;
  inset: 0;
  z-index: 55;
  pointer-events: none;
}
.nice-layer.sheet { pointer-events: auto; }
.nice-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: var(--overlay);
}
.nice-panel {
  pointer-events: auto;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: auto;
  z-index: 56;
}
.nice-layer.sheet .nice-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: min(72vh, 560px);
  border-radius: 20px 20px 0 0;
  padding: 0 16px calc(16px + env(safe-area-inset-bottom));
  overflow: hidden;
}
.nice-panel.wheel { overflow: hidden; }
.nice-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0 12px;
  background: var(--card);
}
.nice-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 12px 16px;
  text-align: left;
  cursor: pointer;
}
.nice-option.active {
  background: var(--soft);
  color: var(--moss-dark);
  font-weight: 600;
}
.nice-check { color: var(--moss); }
</style>
