<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { persistNow } from '../db/client'
import {
  clearAllTransactions,
  countTransactions,
  exportCsv,
  exportJson,
  isIncomeCountedTowardBudget,
  setIncomeCountedTowardBudget,
} from '../domain/engine'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import {
  LAB_ENTRY_TAP_GAP_MS,
  LAB_ENTRY_TAPS,
  revealLabEntry,
  showLabEntry,
  tryUnlockLab,
} from '../platform/lab-gate'
import { toast, trySave, trySaveAsync } from '../ui/toast'
import { askConfirm } from '../ui/confirm'
import { readThemeChoice, THEME_OPTIONS } from '../ui/theme'
import ThemePicker from '../components/ThemePicker.vue'
import SettingsGlyph from '../components/SettingsGlyph.vue'

type PaneId = 'appearance' | 'budget-rule' | 'features' | 'backup' | 'clear' | 'about' | 'lab'

interface SettingsRow {
  id: PaneId | 'guide'
  label: string
  glyph: 'appearance' | 'budget' | 'features' | 'guide' | 'backup' | 'clear' | 'about' | 'lab'
  tint: string
  value?: string
}

const PANE_TITLES: Record<PaneId, string> = {
  appearance: '外观',
  'budget-rule': '限额规则',
  features: '功能',
  backup: '备份',
  clear: '清空账本',
  about: '关于',
  lab: '实验室',
}

const router = useRouter()
const store = useAppStore()
const incomeInBudget = ref(isIncomeCountedTowardBudget())
const labVisible = ref(showLabEntry())
const labPhrase = ref('')
const labError = ref('')
const themeChoice = ref(readThemeChoice())
const pane = ref<PaneId | null>(null)
const pageEl = ref<HTMLElement | null>(null)
/** 下滑后大标题换成小字居中吸顶，贴近手机系统设置。 */
const titleCollapsed = ref(false)

let scrollRoot: HTMLElement | null = null

const themeLabel = computed(
  () => THEME_OPTIONS.find((item) => item.id === themeChoice.value)?.label ?? '',
)
const headTitle = computed(() => (pane.value ? PANE_TITLES[pane.value] : '设置'))
const headerCompact = computed(() => titleCollapsed.value || pane.value != null)

/** 主列表分组，顺序：外观 → 限额规则 → 功能 → 指南 → 备份 → 清空账本 → 关于。 */
const groups = computed<SettingsRow[][]>(() => {
  const main: SettingsRow[][] = [
    [
      { id: 'appearance', label: '外观', glyph: 'appearance', tint: 'violet', value: themeLabel.value },
      {
        id: 'budget-rule',
        label: '限额规则',
        glyph: 'budget',
        tint: 'green',
        value: incomeInBudget.value ? '已开启' : '已关闭',
      },
      { id: 'features', label: '功能', glyph: 'features', tint: 'blue' },
    ],
    [
      { id: 'guide', label: '指南', glyph: 'guide', tint: 'orange' },
      { id: 'backup', label: '备份', glyph: 'backup', tint: 'cyan' },
      { id: 'clear', label: '清空账本', glyph: 'clear', tint: 'red' },
      { id: 'about', label: '关于', glyph: 'about', tint: 'gray', value: '0.1.0' },
    ],
  ]
  if (labVisible.value) {
    main.push([{ id: 'lab', label: '实验室', glyph: 'lab', tint: 'lab' }])
  }
  return main
})

/**
 * 页面本身不滚，真正的滚动容器是 AppShell 的 `.main`。
 * 从本页往上找 overflow 为 auto/scroll 的祖先，找不到再退回 main。
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

/** 滚过约一行大标题后切到吸顶小标题，避免刚触碰就跳变。 */
function onSettingsScroll(): void {
  titleCollapsed.value = (scrollRoot?.scrollTop ?? 0) > 20
}

function bindTitleCollapse(): void {
  scrollRoot?.removeEventListener('scroll', onSettingsScroll)
  scrollRoot = pageEl.value ? findScrollRoot(pageEl.value) : document.querySelector<HTMLElement>('main.main')
  if (!scrollRoot) {
    titleCollapsed.value = false
    return
  }
  scrollRoot.addEventListener('scroll', onSettingsScroll, { passive: true })
  onSettingsScroll()
}

function onThemeChange(): void {
  themeChoice.value = readThemeChoice()
}

function scrollMainToTop(): void {
  scrollRoot?.scrollTo({ top: 0 })
}

/**
 * 指南有独立页，其余进入本页二级面板（系统设置的下钻）。
 */
function openRow(id: SettingsRow['id']): void {
  if (id === 'guide') {
    void router.push('/guide')
    return
  }
  pane.value = id
  scrollMainToTop()
}

function closePane(): void {
  pane.value = null
  scrollMainToTop()
}

let aboutTaps = 0
let aboutTapTimer = 0

/**
 * 仿系统「开发者选项」：连点版本号才露出实验室口令框。
 * 普通阅读不会触发；两次点击间隔超过 2 秒则重新计数。
 */
function onAboutVersionTap(): void {
  if (labVisible.value) return
  window.clearTimeout(aboutTapTimer)
  aboutTaps += 1
  if (aboutTaps >= LAB_ENTRY_TAPS) {
    aboutTaps = 0
    revealLabEntry()
    labVisible.value = true
    try {
      navigator.vibrate?.(30)
    } catch {
      /* 部分 WebView 不支持震动，忽略即可 */
    }
    return
  }
  aboutTapTimer = window.setTimeout(() => {
    aboutTaps = 0
  }, LAB_ENTRY_TAP_GAP_MS)
}

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

async function backupJson(): Promise<void> {
  await trySaveAsync(async () => {
    await persistNow()
    download('iem-backup.json', exportJson(), 'application/json')
  }, '已导出 JSON')
}

async function backupCsv(): Promise<void> {
  await trySaveAsync(async () => {
    download('iem-transactions.csv', exportCsv(), 'text/csv;charset=utf-8')
  }, '已导出 CSV')
}

async function clearLedger(): Promise<void> {
  const count = countTransactions()
  if (!count) {
    toast('info', '账本里已经没有流水')
    return
  }
  const first = await askConfirm({
    title: '确认清空？',
    message: `清空全部 ${count} 笔流水？手记、导入和通知入账都会删除，且无法恢复。分类和限额会保留。`,
  })
  if (!first) return
  const second = await askConfirm({
    title: '再次确认？',
    message: '账面余额锚点也会归零，清空后如需准确余额请再校准。',
  })
  if (!second) return
  if (!trySave(() => clearAllTransactions(), `已清空 ${count} 笔流水`)) return
  store.refreshDashboard()
}

function toggleIncomeInBudget(event: Event): void {
  const on = (event.target as HTMLInputElement).checked
  incomeInBudget.value = on
  if (!trySave(() => setIncomeCountedTowardBudget(on), on ? '已开启：收入纳入限额' : '已关闭：收入不纳入限额')) {
    incomeInBudget.value = !on
    return
  }
  store.refreshDashboard()
}

function openLab(): void {
  labError.value = ''
  if (!tryUnlockLab(labPhrase.value)) {
    labError.value = '口令不正确'
    labPhrase.value = ''
    return
  }
  labPhrase.value = ''
  void router.push('/lab')
}

onMounted(() => {
  bindTitleCollapse()
  window.addEventListener('iem-theme', onThemeChange)
})

onUnmounted(() => {
  scrollRoot?.removeEventListener('scroll', onSettingsScroll)
  window.removeEventListener('iem-theme', onThemeChange)
  window.clearTimeout(aboutTapTimer)
})
</script>

<template>
  <section ref="pageEl" class="page pin-page settings-page">
    <header
      class="settings-head pin-bar"
      :class="{ collapsed: headerCompact, pane: Boolean(pane) }"
    >
      <button
        v-if="pane"
        class="back-btn"
        type="button"
        aria-label="返回"
        @click="closePane"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <h1>
        <span v-if="!pane" class="title-large">设置</span>
        <span class="title-mini" :aria-hidden="!pane">{{ headTitle }}</span>
      </h1>
    </header>

    <template v-if="!pane">
      <article v-for="(group, gi) in groups" :key="gi" class="set-card">
        <button
          v-for="row in group"
          :key="row.id"
          class="set-row"
          type="button"
          @click="openRow(row.id)"
        >
          <span class="set-icon" :class="row.tint">
            <SettingsGlyph :name="row.glyph" />
          </span>
          <span class="set-label">{{ row.label }}</span>
          <span v-if="row.value" class="set-value">{{ row.value }}</span>
          <i class="set-chevron" />
        </button>
      </article>
    </template>

    <template v-else-if="pane === 'appearance'">
      <p class="pane-lead muted">点选即生效，下次打开仍会记住。</p>
      <article class="set-card set-pad">
        <ThemePicker />
      </article>
    </template>

    <template v-else-if="pane === 'budget-rule'">
      <article class="set-card">
        <label class="set-row switch-row">
          <span class="set-label">收入纳入限额</span>
          <input
            class="switch"
            type="checkbox"
            :checked="incomeInBudget"
            @change="toggleIncomeInBudget"
          />
        </label>
      </article>
      <p class="pane-lead muted">开启：可用额度 = 基础限额 + 本周期收入；今天的收入会立刻加进「今日可用」，今天的支出会立刻扣掉。</p>
      <p class="pane-lead muted">关闭（默认）：收入不抬高额度，只记入盘点和账面余额。</p>
    </template>

    <template v-else-if="pane === 'features'">
      <p class="pane-lead muted">手机底栏只保留常用页，其余从这里进入。</p>
      <article class="set-card">
        <button class="set-row plain" type="button" @click="store.openCategories()">
          <span class="set-label">分类管理</span>
          <i class="set-chevron" />
        </button>
        <button class="set-row plain" type="button" @click="router.push('/budget')">
          <span class="set-label">限额</span>
          <i class="set-chevron" />
        </button>
        <button class="set-row plain" type="button" @click="router.push('/recurring')">
          <span class="set-label">周期收支</span>
          <i class="set-chevron" />
        </button>
      </article>
    </template>

    <template v-else-if="pane === 'backup'">
      <p class="pane-lead muted">账目只存在本机。换设备前请导出。JSON 含设置与流水，CSV 只有流水。</p>
      <article class="set-card">
        <button class="set-row plain" type="button" @click="backupJson">
          <span class="set-label">导出 JSON</span>
          <span class="set-value">完整备份</span>
        </button>
        <button class="set-row plain" type="button" @click="backupCsv">
          <span class="set-label">导出 CSV</span>
          <span class="set-value">仅流水</span>
        </button>
      </article>
    </template>

    <template v-else-if="pane === 'clear'">
      <p class="pane-lead muted">导错 CSV 可先到「导入」页按文件撤销。这里会删掉全部流水，分类和限额规则保留。</p>
      <article class="set-card set-pad">
        <button class="btn danger" type="button" @click="clearLedger">清空全部流水</button>
      </article>
    </template>

    <template v-else-if="pane === 'about'">
      <article class="set-card set-pad about-pane">
        <p>IEM（Income and Expenditure Management）第一期：手动记账、文件导入、目录监控、通知解析、邮件附件、周期限额、盘点图表。</p>
        <p class="muted">不会请求支付宝、微信或银行的登录凭证。</p>
      </article>
      <article class="set-card">
        <button class="set-row plain about-version" type="button" @click="onAboutVersionTap">
          <span class="set-label">版本</span>
          <span class="set-value">0.1.0</span>
        </button>
      </article>
    </template>

    <template v-else-if="pane === 'lab'">
      <p class="pane-lead muted">开发自测，需口令。</p>
      <article class="set-card set-pad lab-pane">
        <input
          v-model="labPhrase"
          class="input"
          type="password"
          autocomplete="off"
          placeholder="口令"
          @keyup.enter="openLab"
        />
        <p v-if="labError" class="seal">{{ labError }}</p>
        <button class="btn secondary" type="button" @click="openLab">进入</button>
      </article>
    </template>
  </section>
</template>

<style scoped>
.settings-page {
  gap: 12px;
}
.settings-head {
  display: flex;
  align-items: flex-end;
  margin-top: 0;
}
.settings-head:not(.collapsed) {
  box-shadow:
    calc(-1 * var(--main-pad-left, 16px)) 0 0 0 var(--paper),
    var(--main-pad-right, 16px) 0 0 0 var(--paper),
    0 calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper),
    calc(-1 * var(--main-pad-left, 16px)) calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper),
    var(--main-pad-right, 16px) calc(-1 * var(--main-pad-top, 16px)) 0 0 var(--paper);
}
.settings-head.collapsed {
  padding-top: 22px;
  padding-bottom: 14px;
}
.settings-head.pane {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 40px;
  align-items: end;
}
.settings-head h1 {
  position: relative;
  margin: 0;
  width: 100%;
  line-height: 1.25;
}
.settings-head.pane h1 {
  grid-column: 2;
}
.back-btn {
  grid-column: 1;
  justify-self: start;
  width: 40px;
  height: 36px;
  margin: 0 0 0 -8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--moss-dark);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.back-btn svg {
  width: 22px;
  height: 22px;
  display: block;
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
  top: auto;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-size: 17px;
  font-weight: 650;
  opacity: 0;
  pointer-events: none;
}
.settings-head.collapsed .title-large { opacity: 0; }
.settings-head.collapsed .title-mini { opacity: 1; }
.settings-head.pane .title-mini {
  position: static;
  opacity: 1;
  pointer-events: auto;
}
@media (prefers-reduced-motion: reduce) {
  .title-large,
  .title-mini { transition: none; }
}

.set-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  padding: 0;
}
.set-card.set-pad {
  padding: 16px;
}
.set-row {
  position: relative;
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.set-row:active {
  background: var(--hover);
}
.set-row:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 60px;
  right: 16px;
  bottom: 0;
  height: 1px;
  background: var(--line);
}
.set-row.plain:not(:last-child)::after {
  left: 16px;
}
@media (hover: hover) {
  .set-row:hover { background: var(--hover); }
  .switch-row:hover { background: transparent; }
}
.set-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #fff;
}
.set-icon.violet { background: #7c6af6; }
.set-icon.green { background: #34c759; }
.set-icon.blue { background: #3b82f6; }
.set-icon.orange { background: #ff9f0a; }
.set-icon.cyan { background: #32ade6; }
.set-icon.red { background: #ff3b30; }
.set-icon.gray { background: #8e8e93; }
.set-icon.lab { background: #c47a1a; }
.set-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 16px;
  line-height: 1.3;
}
.set-value {
  flex: 0 1 auto;
  max-width: 42%;
  color: var(--muted);
  font-size: 14px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.set-chevron {
  flex: none;
  width: 8px;
  height: 8px;
  margin-left: 2px;
  border-right: 1.8px solid var(--muted);
  border-bottom: 1.8px solid var(--muted);
  transform: rotate(-45deg);
  opacity: 0.55;
}
.switch-row {
  cursor: default;
}
.switch-row:active {
  background: transparent;
}
.pane-lead {
  margin: 0;
  padding: 0 4px;
}
.pane-lead + .pane-lead {
  margin-top: -6px;
}
.about-pane p { margin: 0 0 8px; }
.about-pane p:last-child { margin: 0; }
.lab-pane {
  display: grid;
  gap: 12px;
}
.lab-pane .btn { justify-self: start; }
.set-pad .btn.danger { width: 100%; }
.about-version {
  user-select: none;
  -webkit-user-select: none;
}
</style>
