<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { isCompactLayout, onCompactChange } from '../ui/layout'

const props = defineProps<{
  accept: string
  /** 格式说明，例如支持哪些账单文件 */
  hint: string
  /** 说明后的跳转文案，例如「导出指引」 */
  guideLabel?: string
}>()

const emit = defineEmits<{
  file: [file: File]
  guide: []
}>()

const compact = ref(isCompactLayout())
const dragging = ref(false)
let stopCompact: (() => void) | null = null

/**
 * 选完后清空 value，同一文件才能再次选入。
 */
function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('file', file)
  input.value = ''
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) emit('file', file)
}

onMounted(() => {
  stopCompact = onCompactChange((value) => {
    compact.value = value
  })
})
onUnmounted(() => stopCompact?.())
</script>

<template>
  <div
    class="file-drop"
    :class="{ compact, active: dragging }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <label class="file-hit">
      <input class="file-input" type="file" :accept="props.accept" @change="onPick" />

      <template v-if="compact">
        <span class="pick-row">
          <svg class="folder" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M6 18.2c0-2.5 2-4.5 4.5-4.5h7.4l2.8 3.2h17.8c2.5 0 4.5 2 4.5 4.5V35c0 2.5-2 4.5-4.5 4.5h-28C8 39.5 6 37.5 6 35V18.2Z" />
            <path d="M10.5 13.7h8.2l2.2 2.6H6.8c.4-1.5 1.9-2.6 3.7-2.6Z" opacity="0.55" />
          </svg>
          <strong>点击选择文件</strong>
        </span>
      </template>

      <template v-else>
        <svg class="cloud" viewBox="0 0 24 24" aria-hidden="true">
          <path
            class="cloud-body"
            fill-rule="evenodd"
            d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96ZM14 13v4h-4v-4H7l5-5 5 5h-3Z"
          />
        </svg>
        <p class="lead">
          将文件拖到此处，或<span class="link">点击上传</span>
        </p>
      </template>
    </label>

    <p class="hint">
      {{ hint }}
      <button
        v-if="guideLabel"
        class="hint-link"
        type="button"
        @click="emit('guide')"
      >
        {{ guideLabel }}
      </button>
    </p>
  </div>
</template>

<style scoped>
.file-drop {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 10px;
  min-height: 168px;
  padding: 28px 20px;
  border: 1.5px dashed var(--line);
  border-radius: var(--radius);
  background: var(--card);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.file-drop.compact {
  min-height: 128px;
  gap: 8px;
  padding: 22px 16px;
  background: var(--soft-2);
}
.file-drop.active {
  border-color: var(--moss);
  background: var(--soft);
}
.file-hit {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 10px;
  cursor: pointer;
  width: 100%;
}
.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  font-size: 0;
}
.pick-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ink);
  font-size: 16px;
}
.folder {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  fill: var(--gold);
}
.cloud {
  width: 72px;
  height: 72px;
}
.cloud-body {
  fill: #b7c3ce;
}
.file-drop.active .cloud-body {
  fill: color-mix(in srgb, var(--moss) 40%, #b7c3ce);
}
.lead {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
}
.link {
  color: var(--moss);
  font-weight: 700;
}
.hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  line-height: 1.4;
}
.hint-link {
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--moss);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
