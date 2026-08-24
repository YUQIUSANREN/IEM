import { isMobileApp } from './env'

const UNLOCK_KEY = 'iem-lab-unlocked'
const ENTRY_KEY = 'iem-lab-entry-revealed'
const LAB_PHRASE = '114514'

/** 设置 → 关于 → 连点版本号几次后才露出入口。间隔超过 2 秒会重新计数。 */
export const LAB_ENTRY_TAPS = 7
export const LAB_ENTRY_TAP_GAP_MS = 2000

/**
 * 实验室不是给普通用户的。
 * 网页/桌面：设置里不放入口，开发者自己打开 #/lab。
 * 手机没有地址栏：连点「关于」里的版本号，再输口令。
 */
export function isLabEntryRevealed(): boolean {
  return sessionStorage.getItem(ENTRY_KEY) === '1'
}

export function revealLabEntry(): void {
  sessionStorage.setItem(ENTRY_KEY, '1')
}

export function showLabEntry(): boolean {
  if (!isMobileApp()) return false
  return isLabEntryRevealed() || isLabUnlocked()
}

export function isLabUnlocked(): boolean {
  if (!isMobileApp()) return true
  return sessionStorage.getItem(UNLOCK_KEY) === '1'
}

export function tryUnlockLab(input: string): boolean {
  if (input.trim() !== LAB_PHRASE) return false
  sessionStorage.setItem(UNLOCK_KEY, '1')
  return true
}
