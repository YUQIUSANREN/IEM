<script setup lang="ts">
import { dismissToast, useToasts } from '../ui/toast'

const toasts = useToasts()
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <button
      v-for="item in toasts"
      :key="item.id"
      class="toast"
      :class="item.kind"
      type="button"
      @click="dismissToast(item.id)"
    >
      {{ item.text }}
    </button>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 16px;
  right: 16px;
  top: calc(12px + env(safe-area-inset-top));
  z-index: 80;
  display: grid;
  gap: 8px;
  pointer-events: none;
  justify-items: center;
}
.toast {
  pointer-events: auto;
  max-width: min(420px, 100%);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 10px 16px;
  background: var(--card);
  box-shadow: var(--shadow);
  text-align: center;
  cursor: pointer;
}
.toast.ok { background: var(--info-bg); border-color: var(--info-line); color: var(--moss-dark); }
.toast.error { background: var(--danger-bg); border-color: var(--danger-line); color: var(--seal); }
.toast.info { background: var(--warn-bg); border-color: var(--warn-line); }
@media (min-width: 801px) {
  .toast-host {
    left: auto;
    right: 24px;
    top: 24px;
    justify-items: end;
  }
}
html.is-mobile .toast-host {
  left: 16px;
  right: 16px;
  top: calc(12px + env(safe-area-inset-top));
  justify-items: center;
}
</style>
