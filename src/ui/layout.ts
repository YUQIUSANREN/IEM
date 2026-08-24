import { isMobileApp } from '../platform/env'

export const COMPACT_MQ = '(max-width: 800px)'

/**
 * 窄屏或手机 App 都走移动端布局。
 * APK 里 WebView 有时把 innerWidth 报成桌面窗口的 1280，单靠媒体查询会失效。
 */
export function isCompactLayout(): boolean {
  if (typeof window === 'undefined') return false
  return isMobileApp() || window.matchMedia(COMPACT_MQ).matches
}

export function syncCompactClass(): void {
  document.documentElement.classList.toggle('is-mobile', isCompactLayout())
}

/**
 * 不再把 html 宽度锁到 visualViewport。
 * 上一版会越锁越窄，整页挤到左侧；这里清掉遗留的 --app-width。
 */
export function lockVisualWidth(): void {
  document.documentElement.style.removeProperty('--app-width')
}

function onViewportChange(): void {
  syncCompactClass()
  lockVisualWidth()
}

export function bootLayout(): void {
  onViewportChange()
  window.matchMedia(COMPACT_MQ).addEventListener('change', onViewportChange)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('orientationchange', () => {
    window.setTimeout(onViewportChange, 50)
  })
  window.visualViewport?.addEventListener('resize', onViewportChange)
}

export function onCompactChange(fn: (compact: boolean) => void): () => void {
  const mq = window.matchMedia(COMPACT_MQ)
  const handler = (): void => {
    onViewportChange()
    fn(isCompactLayout())
  }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
