<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { isCompactLayout, onCompactChange } from '../ui/layout'
import NavIcon from './NavIcon.vue'

const route = useRoute()
const router = useRouter()
const store = useAppStore()
const compact = ref(isCompactLayout())

const items = [
  { to: '/', label: '总览', icon: 'home' as const },
  { to: '/ledger', label: '账本', icon: 'ledger' as const },
  { to: '/import', label: '导入', icon: 'import' as const },
  { to: '/report', label: '盘点', icon: 'report' as const },
  { to: '/settings', label: '设置', icon: 'settings' as const },
]

const more = [
  { to: '/budget', label: '限额' },
  { to: '/recurring', label: '周期收支' },
  { to: '/guide', label: '指南' },
]

function go(path: string): void {
  void router.push(path)
}

function isActive(to: string): boolean {
  if (route.path === to) return true
  return to === '/settings' && route.path === '/lab'
}

let stopCompact: (() => void) | null = null
onMounted(() => {
  stopCompact = onCompactChange((value) => {
    compact.value = value
  })
})
onUnmounted(() => stopCompact?.())
</script>

<template>
  <div class="shell" :class="{ compact }">
    <aside class="side">
      <div class="brand">
        <strong>IEM</strong>
        <span>收支管理</span>
      </div>
      <nav>
        <button
          v-for="item in items"
          :key="item.to"
          class="nav-btn"
          :class="{ active: isActive(item.to) }"
          @click="go(item.to)"
        >
          {{ item.label }}
        </button>
        <p class="muted">更多</p>
        <button
          v-for="item in more"
          :key="item.to"
          class="nav-btn"
          :class="{ active: route.path === item.to }"
          @click="go(item.to)"
        >
          {{ item.label }}
        </button>
      </nav>
    </aside>
    <main class="main">
      <router-view />
    </main>
    <nav class="bottom" aria-label="主导航">
      <button
        v-for="item in items"
        :key="item.to"
        :class="{ active: isActive(item.to) }"
        @click="go(item.to)"
      >
        <NavIcon :name="item.icon" />
        <span>{{ item.label }}</span>
      </button>
    </nav>
    <button
      v-if="route.path !== '/lab'"
      class="fab"
      type="button"
      title="记一笔"
      aria-label="记一笔"
      @click="store.openRecord()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  position: relative;
}
.side {
  padding: 24px 16px;
  border-right: 1px solid var(--line);
  background: var(--side);
  overflow-y: auto;
  min-height: 0;
}
.brand { display: grid; margin-bottom: 24px; }
.brand strong { font-size: 28px; font-family: 'Noto Serif SC', serif; color: var(--moss-dark); }
.nav-btn {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
}
.nav-btn.active { background: var(--moss); color: var(--btn-on); }
.fab {
  position: absolute;
  display: grid;
  place-items: center;
  padding: 0;
  line-height: 0;
}
.main {
  --main-pad-top: 60px;
  --main-pad-left: 36px;
  --main-pad-right: 36px;
  padding: var(--main-pad-top) var(--main-pad-right) 96px var(--main-pad-left);
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-x: clip;
  overflow-y: auto;
}
.bottom { display: none; }
.compact {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
}
.compact .side { display: none; }
.compact .main {
  --main-pad-top: var(--app-pad-top, 60x);
  --main-pad-left: max(16px, env(safe-area-inset-left));
  --main-pad-right: max(16px, env(safe-area-inset-right));
  padding: var(--main-pad-top) var(--main-pad-right) 12px var(--main-pad-left);
  grid-row: 1;
}
.compact .bottom {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-row: 2;
  position: relative;
  margin: 0 12px calc(10px + env(safe-area-inset-bottom));
  padding: 8px 4px 10px;
  background: var(--nav);
  border: 1px solid var(--line);
  border-radius: 22px;
  box-shadow: var(--shadow);
  z-index: 15;
}
.compact .bottom button {
  border: 0;
  background: transparent;
  padding: 4px 0 2px;
  font-size: 11px;
  color: var(--muted);
  display: grid;
  justify-items: center;
  gap: 4px;
  line-height: 1.2;
  min-width: 0;
}
.compact .bottom .active { color: var(--moss); font-weight: 700; }
.compact .fab {
  right: max(20px, env(safe-area-inset-right));
  /* 40px 空隙对底栏；+10px 底栏下边距，避免实际空隙比字高大不了多少 */
  bottom: calc(40px + 64px + 10px + env(safe-area-inset-bottom));
}
</style>
