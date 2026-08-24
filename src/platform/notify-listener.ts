import { invoke } from '@tauri-apps/api/core'
import { addInboxItem, inboxAlreadyQueued } from '../domain/engine'
import { composeNotifyText, parseNotificationText } from '../import/bills'
import { toLocalIso } from '../domain/period'
import { isMobileApp, isTauri } from './env'

export interface QueuedNotify {
  packageName: string
  title: string
  body: string
  postedAt: number
}

/**
 * 从 Android 监听服务的 jsonl 队列收进待确认。
 * 网页/桌面没有队列文件，调用会得到空列表。
 */
export async function drainNotifyQueue(): Promise<number> {
  if (!isTauri()) return 0
  try {
    const items = await invoke<QueuedNotify[]>('drain_notify_queue')
    let added = 0
    for (const item of items) {
      const posted = new Date(item.postedAt)
      const postedAt = Number.isNaN(posted.getTime()) ? toLocalIso(new Date()) : toLocalIso(posted)
      if (inboxAlreadyQueued(item.title, item.body, postedAt)) continue
      const parsed = parseNotificationText(composeNotifyText(item.title, item.body), posted, item.packageName)
      addInboxItem({
        packageName: item.packageName,
        title: item.title || '系统通知',
        body: item.body,
        postedAt,
        sourceGuess: parsed?.source ?? 'notification',
        parsedJson: parsed ? JSON.stringify(parsed) : null,
      })
      added += 1
    }
    return added
  } catch (error) {
    console.warn('读取通知队列失败', error)
    return 0
  }
}

export async function isNotificationListenerEnabled(): Promise<boolean> {
  if (!isMobileApp()) return false
  try {
    return await invoke<boolean>('notification_listener_enabled')
  } catch {
    return false
  }
}

export async function openNotificationListenerSettings(): Promise<void> {
  await invoke('open_notification_listener_settings')
}
