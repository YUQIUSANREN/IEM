<script setup lang="ts">
import { ref } from 'vue'
import { applyTheme, readThemeChoice, THEME_OPTIONS, type ThemeChoice } from '../ui/theme'
import { toast } from '../ui/toast'

const choice = ref(readThemeChoice())

function pick(id: ThemeChoice): void {
  choice.value = id
  applyTheme(id)
  const label = THEME_OPTIONS.find((item) => item.id === id)?.label ?? id
  toast('ok', `已切换到「${label}」`)
}
</script>

<template>
  <div class="theme-grid">
    <button
      v-for="item in THEME_OPTIONS"
      :key="item.id"
      type="button"
      class="theme-card"
      :class="{ active: choice === item.id }"
      @click="pick(item.id)"
    >
      <span class="swatches" aria-hidden="true">
        <i :style="{ background: item.swatches[0] }" />
        <i :style="{ background: item.swatches[1] }" />
        <i :style="{ background: item.swatches[2] }" />
      </span>
      <strong>{{ item.label }}</strong>
      <span class="muted">{{ item.hint }}</span>
    </button>
  </div>
</template>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}
@media (min-width: 801px) {
  html:not(.is-mobile) .theme-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.theme-card {
  display: grid;
  gap: 6px;
  text-align: left;
  border: 1px solid var(--line);
  background: var(--input);
  border-radius: 14px;
  padding: 12px;
  cursor: pointer;
}
.theme-card.active {
  border-color: var(--moss);
  box-shadow: 0 0 0 2px var(--hover);
}
.swatches {
  display: flex;
  gap: 6px;
}
.swatches i {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--line);
}
.theme-card strong { font-size: 14px; }
.theme-card .muted { font-size: 12px; }
</style>
