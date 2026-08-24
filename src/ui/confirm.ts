import { ref } from 'vue'

export interface ConfirmOptions {
  /** 顶部标题，对应参考图里的 “Are you sure?”。 */
  title?: string
  /** 说明文字，说明撤销/删除会影响什么。 */
  message: string
}

export interface ConfirmDialog extends Required<Pick<ConfirmOptions, 'title' | 'message'>> {
  resolve: (ok: boolean) => void
}

const dialog = ref<ConfirmDialog | null>(null)

/**
 * 当前确认框。ConfirmHost 订阅这份数据，业务侧只需 await askConfirm()。
 * 用模块级 ref 而不是 Pinia，避免和启动/落盘层形成循环依赖。
 */
export function useConfirm() {
  return dialog
}

/**
 * 弹出圆角确认框。点「确认」为 true；点「取消」、点遮罩或按 Esc 为 false。
 * 不用 window.confirm：系统框无法改圆角、背景和中文按钮。
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.value?.resolve(false)
    dialog.value = {
      title: options.title?.trim() || '请确认',
      message: options.message,
      resolve,
    }
  })
}

/** 关闭确认框并回传用户选择。 */
export function closeConfirm(ok: boolean): void {
  const current = dialog.value
  if (!current) return
  dialog.value = null
  current.resolve(ok)
}
