/**
 * 运行环境探测。Tauri WebView 会注入内部对象，浏览器开发则没有。
 * 用同一套 Vue 代码同时服务 Web 与桌面/移动壳。
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent)
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/** 手机壳（Android / iOS App），不含桌面窗口和普通浏览器。 */
export function isMobileApp(): boolean {
  return isTauri() && (isAndroid() || isIos())
}
