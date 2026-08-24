<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { setBookBalance } from '../domain/engine'
import { formatYuan, parseYuanInput } from '../domain/money'
import { toast, trySave } from '../ui/toast'

const store = useAppStore()
const input = ref('')

watch(
  () => store.showCalibrate,
  (open) => {
    if (open) input.value = formatYuan(store.bookBalanceFen)
  },
)

function save(): void {
  const fen = parseYuanInput(input.value)
  if (fen === null) {
    toast('error', '请输入有效金额')
    return
  }
  if (!trySave(() => setBookBalance(fen), '账面余额已校准')) return
  store.closeCalibrate()
  store.refreshDashboard()
}
</script>

<template>
  <div v-if="store.showCalibrate" class="modal-mask" @click.self="store.closeCalibrate()">
    <div class="modal">
      <h2>校准账面余额</h2>
      <p class="muted">输入此刻你实际持有的资金合计（现金 + 支付宝 + 微信 + 银行卡等）。差额只会调整锚点。</p>
      <input v-model="input" class="input" inputmode="decimal" />
      <div class="row">
        <button class="btn save" type="button" @click="save">保存账面余额</button>
        <button class="btn secondary" type="button" @click="store.closeCalibrate()">取消</button>
      </div>
    </div>
  </div>
</template>
