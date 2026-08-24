import { ref } from 'vue'
import { markChangelogSeen, needsChangelogPrompt } from '../domain/changelog'
import { latestRelease, type ReleaseNotes } from '../release'

const visible = ref(false)
const entry = ref<ReleaseNotes | null>(null)

/**
 * 更新说明弹层状态。ChangelogHost 订阅这份数据。
 * 用模块级 ref 而不是 Pinia，避免和启动层循环依赖。
 */
export function useChangelogPrompt() {
  return { visible, entry }
}

/**
 * 若当前版本还没看过说明，弹出最新一条。
 * 只展示当前版，不把历史一股脑倒出来。
 */
export function promptChangelogIfNeeded(): void {
  if (visible.value) return
  if (!needsChangelogPrompt()) return
  entry.value = latestRelease()
  visible.value = true
}

/** 关闭弹层并记下已看过当前版本。点遮罩或「知道了」都算看过，避免反复打断。 */
export function dismissChangelog(): void {
  if (!visible.value) return
  markChangelogSeen()
  visible.value = false
  entry.value = null
}
