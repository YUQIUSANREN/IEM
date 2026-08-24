<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { deleteTransaction } from '../domain/engine'
import { useLedgerFeed } from '../composables/useLedgerFeed'
import { isCompactLayout, onCompactChange } from '../ui/layout'
import TxDayCards from '../components/TxDayCards.vue'
import { trySave } from '../ui/toast'
import { askConfirm } from '../ui/confirm'

const store = useAppStore()
const route = useRoute()
const router = useRouter()
const feed = useLedgerFeed()
const focusDate = ref('')
const pageEl = ref<HTMLElement | null>(null)
/** 窄屏或手机模拟都走移动端按钮，不单靠 html.is-mobile。 */
const compact = ref(isCompactLayout())
/** 下滑超过约一张卡片后才出现。 */
const showBackTop = ref(false)
/** 正在滚动时收起贴边，停下来再展开成胶囊。 */
const tucked = ref(true)
let flashTimer = 0
let idleTimer = 0
let scrollRoot: HTMLElement | null = null
let stopCompact: (() => void) | null = null

async function remove(id: number): Promise<void> {
  const ok = await askConfirm({
    title: '确认删除？',
    message: '删除这笔记录？',
  })
  if (!ok) return
  if (!trySave(() => deleteTransaction(id), '已删除')) return
  store.refreshDashboard()
}

function consumeFocus(): void {
  const day = typeof route.query.day === 'string' ? route.query.day : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
  feed.keyword = ''
  const found = feed.items.some((tx) => tx.occurredAt.slice(0, 10) === day)
  if (route.query.day) void router.replace({ name: 'ledger' })
  if (!found) return
  window.clearTimeout(flashTimer)
  focusDate.value = day
  flashTimer = window.setTimeout(() => {
    if (focusDate.value === day) focusDate.value = ''
  }, 1800)
}

/**
 * 账本卡片实际滚的是 AppShell 的 .main，不是本页。
 */
function findScrollRoot(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el.parentElement
  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return current
    current = current.parentElement
  }
  return document.querySelector<HTMLElement>('main.main')
}

function onLedgerScroll(): void {
  const top = scrollRoot?.scrollTop ?? 0
  showBackTop.value = compact.value && top > 120
  if (!showBackTop.value) {
    tucked.value = true
    window.clearTimeout(idleTimer)
    return
  }
  tucked.value = true
  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => {
    tucked.value = false
  }, 720)
}

function bindBackTop(): void {
  scrollRoot?.removeEventListener('scroll', onLedgerScroll)
  scrollRoot = pageEl.value ? findScrollRoot(pageEl.value) : document.querySelector<HTMLElement>('main.main')
  if (!scrollRoot) {
    showBackTop.value = false
    return
  }
  scrollRoot.addEventListener('scroll', onLedgerScroll, { passive: true })
  onLedgerScroll()
}

/**
 * 滚回最上面那张卡片。scroll-margin-top 会让它停在吸顶栏下方。
 */
function scrollToTop(): void {
  const card = pageEl.value?.querySelector<HTMLElement>('.day-card')
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  findScrollRoot(pageEl.value ?? document.body)?.scrollTo({ top: 0, behavior: 'smooth' })
}

watch(() => route.query.day, consumeFocus, { immediate: true })

onMounted(() => {
  stopCompact = onCompactChange((value) => {
    compact.value = value
    onLedgerScroll()
  })
  bindBackTop()
})
onUnmounted(() => {
  window.clearTimeout(flashTimer)
  window.clearTimeout(idleTimer)
  stopCompact?.()
  scrollRoot?.removeEventListener('scroll', onLedgerScroll)
})
</script>

<template>
  <section ref="pageEl" class="page pin-page ledger">
    <header class="pin pin-bar">
      <h1>账本</h1>
      <div class="toolbar">
        <input
          v-model="feed.keyword"
          class="input grow"
          placeholder="搜索对方、备注、订单号、分类、收入/支出/不计收支"
        />
        <button class="btn record" type="button" @click="store.openRecord()">记一笔</button>
      </div>
    </header>
    <!-- <button class="btn ghost undo" type="button" @click="router.push('/import')">撤销导入</button> -->
    <TxDayCards
      :items="feed.items"
      windowed
      :focus-date="focusDate"
      show-delete
      show-edit
      @remove="remove"
      @edit="store.openRecord($event)"
    />
    <button
      class="back-top"
      :class="{ show: showBackTop, tucked }"
      type="button"
      aria-label="返回顶部"
      @click="scrollToTop"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5.5h14" />
        <path d="M12 21V9.5" />
        <path d="M7 14 12 9l5 5" />
      </svg>
      <span class="back-top-label">
        <span>返回</span>
        <span>顶部</span>
      </span>
    </button>
  </section>
</template>

<style scoped>
.pin {
  display: grid;
  gap: 10px;
}
.pin h1 { margin: 0; }
.toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-width: 0;
}
.grow { min-width: 0; }
.record { flex: 0 0 auto; white-space: nowrap; }
.undo {
  justify-self: start;
  margin: -16px 0 0;
}

html:not(.is-mobile) .pin {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
html:not(.is-mobile) .toolbar {
  display: flex;
  flex: 1 1 16rem;
}
html:not(.is-mobile) .grow {
  flex: 1 1 12rem;
}

:deep(.day-card) {
  scroll-margin-top: 108px;
}
html:not(.is-mobile) .ledger :deep(.day-card) {
  scroll-margin-top: 72px;
}

/**
 * 贴右边、记一笔 FAB 上方。
 * 滚动时半圆收进右缘，停稳后展开成「返回顶部」胶囊。
 * 与 FAB 的间距同样大于「删除」字高，中间也能点到最后几条的删除。
 */
.back-top {
  display: none;
  position: fixed;
  right: 0;
  bottom: calc(40px + 64px + 10px + 56px + 40px + env(safe-area-inset-bottom));
  z-index: 21;
  height: 52px;
  padding: 6px 14px 6px 10px;
  border: 1px solid var(--line);
  border-right: 0;
  border-radius: 26px 0 0 26px;
  background: var(--card);
  color: var(--ink);
  box-shadow: var(--shadow);
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transform: translateX(0);
  transition: transform 0.28s ease, padding 0.28s ease;
}
.back-top.show { display: flex; }
.back-top.tucked {
  min-width: 52px;
  padding-right: 0;
  /* 半个圆露在屏内，图标留在可见的左半边 */
  transform: translateX(26px);
}
.back-top svg {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.back-top-label {
  display: grid;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  text-align: left;
  overflow: hidden;
  max-width: 3em;
  opacity: 1;
  transition: max-width 0.28s ease, opacity 0.2s ease;
}
.back-top.tucked .back-top-label {
  max-width: 0;
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .back-top,
  .back-top-label { transition: none; }
}
</style>
