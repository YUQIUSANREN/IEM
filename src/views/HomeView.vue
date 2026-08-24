<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { setBookBalance } from '../domain/engine'
import { formatYuan, parseYuanInput } from '../domain/money'
import { formatRemainFen } from '../domain/tx-display'
import PeriodSelect from '../components/PeriodSelect.vue'
import TxDayCards from '../components/TxDayCards.vue'
import { toast, trySave } from '../ui/toast'

const store = useAppStore()
const router = useRouter()
const calibrating = ref(false)
const calibrateInput = ref('')

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

function openCalibrate(): void {
  calibrateInput.value = formatYuan(store.bookBalanceFen)
  calibrating.value = true
}

function saveCalibrate(): void {
  const fen = parseYuanInput(calibrateInput.value)
  if (fen === null) {
    toast('error', '请输入有效金额')
    return
  }
  if (!trySave(() => setBookBalance(fen), '账面余额已校准')) return
  calibrating.value = false
  store.refreshDashboard()
}
</script>

<template>
  <section class="page">
    <header class="head">
      <div>
        <p class="muted">{{ dash.isCurrentPeriod ? '当前周期' : '历史 / 其他周期' }}</p>
        <h1>{{ dash.period.label }}</h1>
      </div>
      <PeriodSelect :model-value="store.selectedPeriodStartIso" @update:model-value="store.selectPeriod" />
    </header>

    <article class="card balance">
      <div>
        <div class="muted">账面余额</div>
        <div class="num">{{ formatYuan(store.bookBalanceFen) }}</div>
        <p class="muted">随收入增加、随支出减少。点校准可按实际现金/账户合计改到正确数字，不改已记流水。</p>
      </div>
      <button class="btn secondary" @click="openCalibrate">校准余额</button>
    </article>

    <div v-if="calibrating" class="modal-mask" @click.self="calibrating = false">
      <div class="modal">
        <h2>校准账面余额</h2>
        <p class="muted">输入此刻你实际持有的资金合计（现金 + 支付宝 + 微信 + 银行卡等）。差额只会调整锚点。</p>
        <input v-model="calibrateInput" class="input" inputmode="decimal" />
        <div class="row">
          <button class="btn save" @click="saveCalibrate">保存账面余额</button>
          <button class="btn secondary" @click="calibrating = false">取消</button>
        </div>
      </div>
    </div>

    <div v-for="alert in dash.alerts" :key="alert.title" class="banner" :class="alert.level">
      <strong>{{ alert.title }}</strong>
      <div>{{ alert.detail }}</div>
    </div>

    <div class="kpi">
      <article class="card">
        <div class="muted">周期支出</div>
        <div class="num">{{ formatYuan(dash.spentFen) }}</div>
      </article>
      <article class="card">
        <div class="muted">剩余</div>
        <div class="num" :class="{ seal: dash.policy && dash.remainingFen < 0 }">
          {{ dash.policy ? formatRemainFen(dash.remainingFen) : '未设' }}
        </div>
        <div class="muted">
          <template v-if="dash.policy">
            {{ dash.incomeCountsTowardBudget ? '额度' : '限额' }} {{ formatYuan(dash.effectiveLimitFen) }}
            <template v-if="dash.incomeCountsTowardBudget">
              · 基础 {{ formatYuan(dash.policy.totalLimitFen) }} + 收入
            </template>
          </template>
          <template v-else>到「限额」页设定后才会计算</template>
        </div>
      </article>
      <article class="card">
        <div class="kpi-head">
          <div class="muted">{{ dash.isCurrentPeriod ? '今日可用' : '该周期日均' }}</div>
          <div v-if="dash.policy && dash.isCurrentPeriod" class="muted share">日限额 {{ formatYuan(dash.morningShareFen) }}</div>
        </div>
        <div class="num" :class="{ seal: dash.todayOverspent }">{{ dash.policy ? formatYuan(dash.todayAllowanceFen) : '--' }}</div>
        <div class="muted">
          <template v-if="dash.isCurrentPeriod">
            今日已花 {{ formatYuan(dash.todaySpentFen) }}
            <template v-if="dash.incomeCountsTowardBudget"> · 今日收入 {{ formatYuan(dash.todayIncomeFen) }}</template>
            · 剩 {{ dash.remainingDays }} 天
          </template>
          <template v-else>按该周期完整天数折算</template>
        </div>
      </article>
      <article class="card">
        <div class="muted">周期收入</div>
        <div class="num moss">{{ formatYuan(dash.incomeFen) }}</div>
      </article>
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
.head, .balance, .row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}
.cat { margin-bottom: 12px; }
.kpi-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.share {
  flex: 0 0 auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.balance .num { font-size: 28px; font-variant-numeric: tabular-nums; }
.head :deep(.period-select) {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}
/* 不要写成 :global(html.is-mobile) .head —— Vue 会编成 html.is-mobile { display:grid }，整页被挤到左边 */
html.is-mobile .head {
  display: grid;
}
</style>
