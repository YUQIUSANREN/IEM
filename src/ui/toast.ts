import { ref } from 'vue'

export type ToastKind = 'ok' | 'error' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const toasts = ref<ToastItem[]>([])
let seq = 0
const timers = new Map<number, number>()

/**
 * 全局轻提示列表。ToastHost 订阅这份数据，业务侧只需调用 toast()。
 * 用模块级 ref 而不是 Pinia，避免和启动/落盘层形成循环依赖。
 */
export function useToasts() {
  return toasts
}

/**
 * 弹出一条自动消失的提示。成功约 2.4s，失败稍长，避免一闪而过。
 */
export function toast(kind: ToastKind, text: string): void {
  const id = ++seq
  toasts.value = [...toasts.value.slice(-3), { id, kind, text }]
  const ms = kind === 'error' ? 3800 : 2400
  const timer = window.setTimeout(() => dismissToast(id), ms)
  timers.set(id, timer)
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) {
    window.clearTimeout(timer)
    timers.delete(id)
  }
  toasts.value = toasts.value.filter((item) => item.id !== id)
}

export function notifyError(error: unknown, fallback = '操作失败'): void {
  toast('error', error instanceof Error ? error.message : fallback)
}

/**
 * 同步写库动作的统一出口：成功给绿条，抛错给红条。
 */
export function trySave(action: () => void, okText = '已保存'): boolean {
  try {
    action()
    toast('ok', okText)
    return true
  } catch (error) {
    notifyError(error, '保存失败')
    return false
  }
}

/**
 * 导出、导入等异步动作同样给出成败反馈。
 */
export async function trySaveAsync(action: () => Promise<void>, okText = '已保存'): Promise<boolean> {
  try {
    await action()
    toast('ok', okText)
    return true
  } catch (error) {
    notifyError(error, '保存失败')
    return false
  }
}
