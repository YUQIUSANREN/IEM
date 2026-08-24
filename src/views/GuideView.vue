<script setup lang="ts">
import { nextTick, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { guideStepsForClient } from '../guides/content'
import { isMobileApp } from '../platform/env'

const route = useRoute()
const router = useRouter()
const steps = guideStepsForClient(isMobileApp())

/**
 * 从导入页「导出指引」进来时，滚到对应卡片。
 */
function scrollToStep(): void {
  const id = typeof route.query.step === 'string' ? route.query.step : ''
  if (!id) return
  void nextTick(() => {
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

onMounted(scrollToStep)
watch(() => route.query.step, scrollToStep)
</script>

<template>
  <section class="page">
    <header class="head">
      <h1>使用指南</h1>
      <button class="btn ghost" @click="router.push('/settings')">返回设置</button>
    </header>
    <article
      v-for="step in steps"
      :id="`guide-${step.id}`"
      :key="step.id"
      class="card guide-card"
    >
      <h2>{{ step.title }}</h2>
      <p class="muted">{{ step.summary }}</p>
      <ul>
        <li v-for="line in step.body" :key="line">{{ line }}</li>
      </ul>
    </article>
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.guide-card {
  scroll-margin-top: calc(var(--app-pad-top, 16px) + 8px);
}
</style>
