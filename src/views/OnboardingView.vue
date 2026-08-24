<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { GUIDE_STEPS } from '../guides/content'
import { saveBudget } from '../domain/engine'
import { parseYuanInput } from '../domain/money'
import PeriodStartDayPicker from '../components/PeriodStartDayPicker.vue'
import { notifyError, toast } from '../ui/toast'

const store = useAppStore()
const router = useRouter()
const index = ref(0)
const budget = reactive({ startDay: 16, total: '' })
const steps = [...GUIDE_STEPS]
const current = computed(() => steps[Math.min(index.value, steps.length - 1)])
const last = computed(() => index.value === steps.length)

function next(): void {
  if (index.value < steps.length) index.value += 1
}

function prev(): void {
  if (index.value > 0) index.value -= 1
}

function finish(): void {
  const total = parseYuanInput(budget.total)
  if (budget.total.trim() && (total === null || total <= 0)) {
    toast('error', '限额金额无效，可留空跳过')
    return
  }
  try {
    if (total && total > 0) saveBudget(total, budget.startDay, [])
    store.finishOnboarding()
  } catch (error) {
    notifyError(error, '保存失败')
    return
  }
  toast('ok', total && total > 0 ? '限额已保存，已进入账本' : '已进入账本')
  void router.replace('/')
}
</script>

<template>
  <section class="onboard">
    <div class="card wide">
      <p class="muted">第 {{ Math.min(index + 1, steps.length + 1) }} / {{ steps.length + 1 }} 步</p>
      <template v-if="!last">
        <h1>{{ current.title }}</h1>
        <p>{{ current.summary }}</p>
        <ul>
          <li v-for="line in current.body" :key="line">{{ line }}</li>
        </ul>
      </template>
      <template v-else>
        <h1>设定第一个周期限额</h1>
        <p>可先跳过，稍后在「限额」页再填。选起始日后会自动显示结束日。</p>
        <PeriodStartDayPicker v-model="budget.startDay" />
        <label>总支出限额（元，可留空）<input v-model="budget.total" class="input" /></label>
      </template>
      <div class="row">
        <button class="btn secondary" :disabled="index === 0" @click="prev">上一步</button>
        <button v-if="!last" class="btn" @click="next">下一步</button>
        <button v-else class="btn" @click="finish">进入 IEM</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.onboard {
  height: 100%;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 24px;
}
.wide { width: min(720px, 100%); display: grid; gap: 12px; }
label { display: grid; gap: 6px; }
</style>
