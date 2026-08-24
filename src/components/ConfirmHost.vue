<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { closeConfirm, useConfirm } from '../ui/confirm'

const dialog = useConfirm()
const cancelBtn = ref<HTMLButtonElement | null>(null)

function onKey(event: KeyboardEvent): void {
  if (!dialog.value || event.key !== 'Escape') return
  event.preventDefault()
  closeConfirm(false)
}

watch(dialog, async (value) => {
  if (!value) return
  await nextTick()
  cancelBtn.value?.focus()
})

onMounted(() => {
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    v-if="dialog"
    class="confirm-mask"
    role="presentation"
    @click.self="closeConfirm(false)"
  >
    <div
      class="confirm-box"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`confirm-title`"
      :aria-describedby="`confirm-message`"
    >
      <h2 id="confirm-title" class="confirm-title">{{ dialog.title }}</h2>
      <p id="confirm-message" class="confirm-message">{{ dialog.message }}</p>
      <div class="confirm-actions">
        <button ref="cancelBtn" type="button" class="confirm-btn" @click="closeConfirm(false)">
          取消
        </button>
        <button type="button" class="confirm-btn ok" @click="closeConfirm(true)">确认</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px 20px;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  background: var(--overlay);
  animation: confirm-fade 0.16s ease;
}

.confirm-box {
  width: min(360px, 100%);
  border-radius: 28px;
  padding: 24px 22px 10px;
  /* 主题色浅底，避免系统框那种纯白面板。 */
  background: var(--soft-2);
  background: color-mix(in srgb, var(--soft-2) 72%, var(--card) 28%);
  box-shadow: var(--shadow);
  animation: confirm-pop 0.18s ease;
}

.confirm-title {
  margin: 0;
  font-family: inherit;
  font-size: 20px;
  font-weight: 650;
  line-height: 1.3;
}

.confirm-message {
  margin: 12px 0 0;
  color: var(--ink);
  font-size: 15px;
  line-height: 1.55;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin: 20px -8px 0;
}

.confirm-btn {
  min-height: 44px;
  padding: 8px 16px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--moss);
  font-weight: 650;
  cursor: pointer;
}

.confirm-btn:hover,
.confirm-btn:focus-visible {
  background: var(--hover);
}

.confirm-btn.ok {
  color: var(--moss-dark);
}

@keyframes confirm-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes confirm-pop {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
