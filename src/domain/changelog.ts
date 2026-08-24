import { getMeta, setMeta } from '../db/client'
import { APP_VERSION } from '../release'

const SEEN_KEY = 'changelog_seen_version'

/**
 * 引导完成后、且本机记下的版本与当前包不一致时，才需要弹更新说明。
 * 未完成引导不弹，避免和首次指南叠在一起。
 */
export function needsChangelogPrompt(): boolean {
  if (getMeta('onboarding_done', '0') !== '1') return false
  return getMeta(SEEN_KEY, '') !== APP_VERSION
}

/** 关掉弹窗或点「知道了」后调用，下次同一版本不再弹。 */
export function markChangelogSeen(): void {
  setMeta(SEEN_KEY, APP_VERSION)
}
