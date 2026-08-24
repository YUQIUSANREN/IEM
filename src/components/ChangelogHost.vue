<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { dismissChangelog, useChangelogPrompt } from '../ui/changelog'

const { visible, entry } = useChangelogPrompt()

function onKey(event: KeyboardEvent): void {
  if (!visible.value || event.key !== 'Escape') return
  event.preventDefault()
  dismissChangelog()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    v-if="visible && entry"
    class="log-mask"
    role="presentation"
    @click.self="dismissChangelog()"
  >
    <div
      class="log-box"
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-title"
    >
      <p class="log-kicker muted">版本 {{ entry.version }}</p>
      <h2 id="changelog-title" class="log-title">更新说明</h2>
      <ul class="log-notes">
        <li v-for="line in entry.notes" :key="line">{{ line }}</li>
      </ul>
      <div class="log-actions">
        <button type="button" class="confirm-btn ok" @click="dismissChangelog()">知道了</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-mask {
  position: fixed;
  inset: 0;
  z-index: 72;
  display: grid;
  place-items: center;
  padding: 24px 20px;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  background: var(--overlay);
  animation: log-fade 0.16s ease;
}

.log-box {
  width: min(400px, 100%);
  border-radius: 28px;
  padding: 24px 22px 10px;
  background: color-mix(in srgb, var(--soft-2) 72%, var(--card) 28%);
  box-shadow: var(--shadow);
  animation: log-pop 0.18s ease;
}

.log-kicker {
  margin: 0;
  font-size: 13px;
}

.log-title {
  margin: 4px 0 0;
  font-family: inherit;
  font-size: 20px;
  font-weight: 650;
  line-height: 1.3;
}

.log-notes {
  margin: 12px 0 0;
  padding-left: 1.15em;
  font-size: 15px;
  line-height: 1.55;
}

.log-notes li + li {
  margin-top: 6px;
}

.log-actions {
  display: flex;
  justify-content: flex-end;
  margin: 16px -8px 0;
}

.confirm-btn {
  min-height: 44px;
  padding: 8px 16px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--moss-dark);
  font-weight: 650;
  cursor: pointer;
}

.confirm-btn:hover,
.confirm-btn:focus-visible {
  background: var(--hover);
}

@keyframes log-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes log-pop {
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
