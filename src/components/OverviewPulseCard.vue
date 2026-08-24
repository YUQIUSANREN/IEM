<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { formatYuan } from '../domain/money'
import { formatRemainFen } from '../domain/tx-display'

const BOOK_HINT =
  '随收入增加、随支出减少。双击可按实际现金/账户合计校准到正确数字，不改已记流水。'

const DOUBLE_TAP_MS = 360
const TAP_MOVE_PX = 18

const store = useAppStore()
const dash = computed(() => store.dashboard)
const hintOn = ref(false)
let pressTimer = 0
let hideTimer = 0
let lastTouchAt = 0
let lastTapAt = 0
let startX = 0
let startY = 0
let longPressed = false

function showHint(): void {
  hintOn.value = true
}

function hideHint(): void {
  window.clearTimeout(hideTimer)
  hintOn.value = false
}

function showHintBriefly(): void {
  showHint()
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    hintOn.value = false
  }, 3600)
}

function onBookHover(): void {
  if (Date.now() - lastTouchAt < 1000) return
  window.clearTimeout(hideTimer)
  showHint()
}

function onBookTouchStart(event: TouchEvent): void {
  lastTouchAt = Date.now()
  longPressed = false
  const touch = event.changedTouches[0]
  startX = touch.clientX
  startY = touch.clientY
  window.clearTimeout(pressTimer)
  pressTimer = window.setTimeout(() => {
    longPressed = true
    lastTapAt = 0
    showHintBriefly()
  }, 480)
}

/**
 * 手机/模拟器里 dblclick 经常不来（html 上 touch-action: pan-y）。
 * 两次短触自己认成双击；长按只出说明，不当成第一次点击。
 */
function onBookTouchEnd(event: TouchEvent): void {
  window.clearTimeout(pressTimer)
  if (longPressed) return
  const touch = event.changedTouches[0]
  if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > TAP_MOVE_PX) {
    lastTapAt = 0
    return
  }
  const now = Date.now()
  if (now - lastTapAt < DOUBLE_TAP_MS) {
    lastTapAt = 0
    event.preventDefault()
    onBookDblClick()
    return
  }
  lastTapAt = now
}

function onBookTouchCancel(): void {
  window.clearTimeout(pressTimer)
}

function onBookDblClick(): void {
  hideHint()
  store.openCalibrate()
}

onUnmounted(() => {
  window.clearTimeout(pressTimer)
  window.clearTimeout(hideTimer)
})
</script>

<template>
  <article class="pulse">
    <div class="pulse-top">
      <div class="pulse-head">
        <span>{{ dash.isCurrentPeriod ? '今日可用' : '该周期日均' }}</span>
        <span v-if="dash.policy && dash.isCurrentPeriod">日限额 {{ formatYuan(dash.morningShareFen) }}</span>
      </div>
      <div class="pulse-hero" :class="{ over: dash.todayOverspent }">
        {{ dash.policy ? formatYuan(dash.todayAllowanceFen) : '--' }}
      </div>
      <p class="pulse-sub">
        <template v-if="dash.isCurrentPeriod">
          今日已花 {{ formatYuan(dash.todaySpentFen) }} 元
          <template v-if="dash.incomeCountsTowardBudget"> · 今日收入 {{ formatYuan(dash.todayIncomeFen) }} 元</template>
          · 剩余 {{ dash.remainingDays }} 天
        </template>
        <template v-else>按该周期完整天数折算</template>
      </p>
    </div>
    <div class="pulse-split">
      <div>
        <div class="pulse-k">周期剩余</div>
        <div class="pulse-v" :class="{ over: dash.policy && dash.remainingFen < 0 }">
          {{ dash.policy ? formatRemainFen(dash.remainingFen) : '未设' }}
        </div>
        <p class="pulse-sub">周期支出 {{ formatYuan(dash.spentFen) }} 元</p>
      </div>
      <div>
        <div class="pulse-k">周期收入</div>
        <div class="pulse-v">{{ formatYuan(dash.incomeFen) }}</div>
      </div>
    </div>
    <button
      class="pulse-book"
      type="button"
      @mouseenter="onBookHover"
      @mouseleave="hideHint"
      @dblclick.prevent="onBookDblClick"
      @touchstart.passive="onBookTouchStart"
      @touchend="onBookTouchEnd"
      @touchcancel="onBookTouchCancel"
      @contextmenu.prevent
    >
      账面余额 {{ formatYuan(store.bookBalanceFen) }}
      <span v-if="hintOn" class="pulse-tip">{{ BOOK_HINT }}</span>
    </button>
  </article>
</template>

<style scoped>
.pulse {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 18px 18px 12px;
  border-radius: var(--radius);
  background: var(--moss);
  color: var(--btn-on);
  box-shadow: var(--shadow);
  min-width: 0;
}
.pulse::before,
.pulse::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: color-mix(in srgb, var(--btn-on) 14%, transparent);
  pointer-events: none;
  z-index: 0;
}
.pulse::before {
  width: 160px;
  height: 160px;
  top: -90px;
  left: -60px;
}
.pulse::after {
  width: 120px;
  height: 120px;
  right: -40px;
  bottom: -50px;
}
.pulse-top,
.pulse-split,
.pulse-book {
  position: relative;
  z-index: 1;
}
.pulse-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  opacity: 0.9;
}
.pulse-hero {
  margin: 8px 0 4px;
  font-size: 36px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1.15;
}
.pulse-hero.over {
  display: inline-block;
  width: fit-content;
  max-width: 100%;
  padding: 2px 10px;
  border-radius: 8px;
  /* 红底白字：深色卡片上不再跟 --btn-on 混成粉白，寒夜的 --seal 也不能当红用 */
  background: var(--pulse-over, var(--danger));
  color: #fff;
}
.pulse-v.over {
  color: var(--pulse-over, var(--danger));
}
.pulse-sub {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.82;
}
.pulse-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--btn-on) 28%, transparent);
}
.pulse-k {
  font-size: 13px;
  opacity: 0.88;
}
.pulse-v {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.pulse-book {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px 0 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--btn-on) 18%, transparent);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.02em;
  text-align: left;
  opacity: 0.78;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}
.pulse-tip {
  display: block;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--btn-on) 16%, transparent);
  color: inherit;
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.95;
}
</style>
