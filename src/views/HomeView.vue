<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { formatYuan } from '../domain/money'
import PeriodSelect from '../components/PeriodSelect.vue'
import MonthCashCalendar from '../components/MonthCashCalendar.vue'
import OverviewPulseCard from '../components/OverviewPulseCard.vue'
import TxDayCards from '../components/TxDayCards.vue'

const store = useAppStore()
const router = useRouter()
const pageEl = ref<HTMLElement | null>(null)
/** 下滑后大标题换成小字居中吸顶，和设置页同一套。 */
const titleCollapsed = ref(false)
let scrollRoot: HTMLElement | null = null

const recent = computed(() => {
  const { startIso, endIso } = store.dashboard.period
  return store.transactions
    .filter((tx) => tx.occurredAt >= startIso && tx.occurredAt <= endIso)
    .slice(0, 8)
})
const dash = computed(() => store.dashboard)
const ratio = computed(() => {
  const limit = dash.value.effectiveLimitFen
  if (!limit) return 0
  return Math.min(dash.value.spentFen / limit, 1.5)
})

/**
 * 页面本身不滚，真正的滚动容器是 AppShell 的 `.main`。
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

function onHomeScroll(): void {
  titleCollapsed.value = (scrollRoot?.scrollTop ?? 0) > 20
}

function bindTitleCollapse(): void {
  scrollRoot?.removeEventListener('scroll', onHomeScroll)
  scrollRoot = pageEl.value ? findScrollRoot(pageEl.value) : document.querySelector<HTMLElement>('main.main')
  if (!scrollRoot) {
    titleCollapsed.value = false
    return
  }
  scrollRoot.addEventListener('scroll', onHomeScroll, { passive: true })
  onHomeScroll()
}

onMounted(() => {
  bindTitleCollapse()
})

onUnmounted(() => {
  scrollRoot?.removeEventListener('scroll', onHomeScroll)
})
</script>

<template>
  <section ref="pageEl" class="page pin-page">
    <header class="head pin-bar" :class="{ collapsed: titleCollapsed }">
      <div class="head-copy">
        <p class="muted">{{ dash.isCurrentPeriod ? '当前周期' : '历史 / 其他周期' }}</p>
        <h1>
          <span class="title-large">{{ dash.period.label }}</span>
          <span class="title-mini" :aria-hidden="!titleCollapsed">{{ dash.period.label }}</span>
        </h1>
      </div>
      <PeriodSelect
        class="head-pick"
        :model-value="store.selectedPeriodStartIso"
        @update:model-value="store.selectPeriod"
      />
    </header>

    <OverviewPulseCard />

    <div v-for="alert in dash.alerts" :key="alert.title" class="banner" :class="alert.level">
      <strong>{{ alert.title }}</strong>
      <div>{{ alert.detail }}</div>
    </div>

    <article class="card">
      <h2>限额进度</h2>
      <div class="progress" :class="{ over: ratio > 1 }">
        <span :style="{ width: `${Math.min(ratio, 1) * 100}%` }" />
      </div>
    </article>

    <article v-if="dash.categoryStatuses.length" class="card">
      <h2>分类限额</h2>
      <div v-for="item in dash.categoryStatuses" :key="item.categoryId" class="cat">
        <div class="row">
          <strong>{{ store.categories.find((c) => c.id === item.categoryId)?.name }}</strong>
          <span class="muted">{{ formatYuan(item.usedFen) }} / {{ formatYuan(item.limitFen) }}</span>
        </div>
        <div class="progress" :class="{ over: item.over }">
          <span :style="{ width: `${Math.min(item.usedFen / item.limitFen, 1) * 100}%` }" />
        </div>
      </div>
    </article>

    <MonthCashCalendar />

    <div>
      <div class="row">
        <h2>该周期流水</h2>
        <button class="btn ghost" @click="router.push('/ledger')">全部</button>
      </div>
      <p v-if="!recent.length" class="muted">这个周期还没有记录。</p>
      <TxDayCards v-else :items="recent" show-edit @edit="store.openRecord($event)" />
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  margin-top: 0;
}
.head:not(.collapsed) {
  box-shadow:
    calc(-1 * var(--main-pad-left, 16px)) 0 0 0 var(--paper),
    var(--main-pad-right, 16px) 0 0 0 var(--paper),
    0 calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper),
    calc(-1 * var(--main-pad-left, 16px)) calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper),
    var(--main-pad-right, 16px) calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper);
}
.head.collapsed {
  display: block;
  padding-top: 22px;
  padding-bottom: 14px;
}
.head-copy {
  flex: 1 1 auto;
  min-width: 0;
}
.head-copy .muted {
  margin: 0 0 4px;
  transition: opacity 0.2s ease;
}
.head h1 {
  position: relative;
  margin: 0;
  width: 100%;
  line-height: 1.25;
}
.title-large,
.title-mini {
  display: block;
  transition: opacity 0.2s ease;
}
.title-mini {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-size: 17px;
  font-weight: 650;
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
}
.head.collapsed .muted,
.head.collapsed .title-large { opacity: 0; }
.head.collapsed .title-mini { opacity: 1; }
.head.collapsed .head-pick {
  display: none;
}
.head.collapsed .muted {
  height: 0;
  margin: 0;
  overflow: hidden;
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}
.cat { margin-bottom: 12px; }
.head :deep(.period-select) {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}
.head-pick {
  flex: 1 1 220px;
  min-width: 0;
  max-width: 100%;
}
/* 不要写成 :global(html.is-mobile) .head —— Vue 会编成 html.is-mobile { display:grid }，整页被挤到左边 */
html.is-mobile .head:not(.collapsed) {
  display: grid;
}
@media (prefers-reduced-motion: reduce) {
  .title-large,
  .title-mini,
  .head-copy .muted { transition: none; }
}
</style>
