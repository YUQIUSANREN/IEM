<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import TxForm from './components/TxForm.vue'
import CategoryManage from './components/CategoryManage.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import { drainNotifyQueue } from './platform/notify-listener'
import { isMobileApp } from './platform/env'
import { onPersistError } from './db/client'
import { notifyError } from './ui/toast'
import { useRecordHistory } from './composables/useRecordHistory'
import { useSheetHistory } from './composables/useSheetHistory'

const store = useAppStore()
const route = useRoute()
const router = useRouter()
const { closeRecordView } = useRecordHistory()
const { closeCategoriesView } = useSheetHistory()
let pollTimer = 0
let stopPersistWatch: (() => void) | null = null

onMounted(async () => {
  stopPersistWatch = onPersistError((error) => {
    notifyError(error, '保存到本机失败')
  })
  try {
    await store.boot()
    if (!store.onboarded && route.path !== '/onboarding') {
      await router.replace('/onboarding')
    }
    if (store.onboarded && route.path === '/onboarding') {
      await router.replace('/')
    }
    if (isMobileApp()) {
      pollTimer = window.setInterval(() => {
        void drainNotifyQueue()
      }, 8000)
    }
  } catch (error) {
    console.error(error)
  }
})

onUnmounted(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  stopPersistWatch?.()
})

function onRecordSaved(keepOpen = false): void {
  store.refreshDashboard()
  if (!keepOpen) closeRecordView()
}
</script>

<template>
  <div v-if="store.bootError" class="boot-error">
    <h1>IEM 启动失败</h1>
    <p>{{ store.bootError }}</p>
  </div>
  <router-view v-else-if="store.ready" />
  <div v-else class="boot">正在打开账本…</div>

  <div v-if="store.showRecord" class="modal-mask full" @click.self="closeRecordView()">
    <div class="modal">
      <TxForm :tx="store.editingTx" @saved="onRecordSaved" @cancel="closeRecordView" />
    </div>
  </div>
  <div v-if="store.showCategories" class="modal-mask full" @click.self="closeCategoriesView()">
    <div class="modal">
      <CategoryManage @close="closeCategoriesView" />
    </div>
  </div>
  <ToastHost />
  <ConfirmHost />
</template>

<style scoped>
.boot, .boot-error {
  min-height: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  overflow: auto;
}
</style>
