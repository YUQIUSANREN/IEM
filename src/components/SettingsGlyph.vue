<script setup lang="ts">
defineProps<{
  name: 'appearance' | 'budget' | 'features' | 'guide' | 'backup' | 'clear' | 'about' | 'lab'
}>()
</script>

<template>
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
    <!-- 外观：对比半圆，对应浅色/深色切换 -->
    <g v-if="name === 'appearance'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </g>
    <!-- 限额：仪表盘，表示额度上限 -->
    <g v-else-if="name === 'budget'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5.2 16.2a8 8 0 1 1 13.6 0" />
      <path d="M12 16l3.6-5.2" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </g>
    <!-- 功能：宫格，对应更多入口 -->
    <g v-else-if="name === 'features'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <rect x="4.5" y="4.5" width="6.2" height="6.2" rx="1.4" />
      <rect x="13.3" y="4.5" width="6.2" height="6.2" rx="1.4" />
      <rect x="4.5" y="13.3" width="6.2" height="6.2" rx="1.4" />
      <rect x="13.3" y="13.3" width="6.2" height="6.2" rx="1.4" />
    </g>
    <!-- 指南：书签式封面 -->
    <g v-else-if="name === 'guide'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 4.5h10v15.2l-5-2.4-5 2.4z" />
    </g>
    <!-- 备份：导出箭头 -->
    <g v-else-if="name === 'backup'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 15V5" />
      <path d="m8.2 8.8 3.8-3.8 3.8 3.8" />
      <path d="M5 18h14" />
    </g>
    <!-- 清空：垃圾桶 -->
    <g v-else-if="name === 'clear'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 7h14" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M8 7.5 9 20h6l1-12.5" />
    </g>
    <!-- 关于：信息 -->
    <g v-else-if="name === 'about'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11.2V17" />
      <circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" />
    </g>
    <!-- 实验室：烧瓶 -->
    <g v-else fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9.5 3.5h5v7.2L19 20.5H5l4.5-9.8z" />
      <path d="M9 14.5h6" />
    </g>
  </svg>
</template>

<style scoped>
.glyph {
  width: 18px;
  height: 18px;
  display: block;
}
</style>
