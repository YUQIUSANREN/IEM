/**
 * 应用内指南与首次引导的文案只来自仓库根目录 GUIDE.md。
 * 改说明时只改那一份。
 */
import guideMarkdown from '../../GUIDE.md?raw'
import { parseGuideMarkdown, type GuideStep } from './parse-guide'

export type { GuideStep }

export const GUIDE_STEPS: GuideStep[] = parseGuideMarkdown(guideMarkdown)

/**
 * 手机壳不展示仅电脑可用的条目（目录监控），避免引导里指向一个不存在的 tab。
 */
export function guideStepsForClient(mobileApp: boolean): GuideStep[] {
  if (!mobileApp) return GUIDE_STEPS
  return GUIDE_STEPS.filter((step) => step.id !== 'watch')
}
