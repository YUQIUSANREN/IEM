/**
 * 把 GUIDE.md 拆成指南卡片。应用内引导只走解析结果，不另写一份文案。
 */

export interface GuideStep {
  id: string
  title: string
  summary: string
  body: string[]
}

const SKIP_TITLE = /开发者如何运行/

/**
 * 标题 → 稳定 id，给路由 `?step=` 和手机端隐藏「目录监控」用。
 */
function idFromTitle(title: string): string {
  if (/怎么开始/.test(title)) return 'overview'
  if (/手动记账/.test(title)) return 'manual'
  if (/退款/.test(title)) return 'refund'
  if (/导入/.test(title)) return 'file'
  if (/监控/.test(title)) return 'watch'
  if (/通知/.test(title)) return 'notify'
  if (/邮件/.test(title)) return 'email'
  if (/限额/.test(title)) return 'budget'
  if (/盘点|周期收支/.test(title)) return 'report'
  if (/备份/.test(title)) return 'backup'
  return title.replace(/\s+/g, '-').slice(0, 32)
}

function stripMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 把一节正文拆成条目：段落、编号列表、项目符号、三级标题。
 */
function flattenSection(markdown: string): string[] {
  const items: string[] = []
  const pending: string[] = []
  const flush = (): void => {
    const text = stripMd(pending.join(' '))
    pending.length = 0
    if (text) items.push(text)
  }
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line || line === '---') {
      flush()
      continue
    }
    const heading = line.match(/^#{3,}\s+(.+)/)
    if (heading?.[1]) {
      flush()
      items.push(stripMd(heading[1]))
      continue
    }
    const bullet = line.match(/^[-*]\s+(.+)/) || line.match(/^\d+\.\s+(.+)/)
    if (bullet?.[1]) {
      flush()
      items.push(stripMd(bullet[1]))
      continue
    }
    pending.push(line)
  }
  flush()
  return items
}

/**
 * 解析 GUIDE.md：一级标题下的前言并进第一节；跳过开发者运行说明。
 */
export function parseGuideMarkdown(markdown: string): GuideStep[] {
  const chunks = markdown.replace(/\r\n/g, '\n').split(/^## /m)
  const preamble = flattenSection(chunks[0] ?? '').filter(
    (line) => !/应用内「指南」|改这里即可/.test(line) && line !== 'IEM 使用指南',
  )
  const steps: GuideStep[] = []
  for (const chunk of chunks.slice(1)) {
    const newline = chunk.indexOf('\n')
    const heading = (newline < 0 ? chunk : chunk.slice(0, newline)).trim()
    const title = heading.replace(/^\d+\.\s*/, '').trim()
    if (!title || SKIP_TITLE.test(title)) continue
    const rest = newline < 0 ? '' : chunk.slice(newline + 1)
    const body = flattenSection(rest)
    if (steps.length === 0 && preamble.length) body.unshift(...preamble)
    const summary = body[0] ?? title
    steps.push({ id: idFromTitle(title), title, summary, body })
  }
  return steps
}
