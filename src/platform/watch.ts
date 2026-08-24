import { isMobileApp, isTauri } from './env'

const BILL_EXT = /\.(csv|xlsx|xls|eml|txt)$/i
const BILL_HINT = /支付宝|微信|工商|工行|alipay|wechat|icbc|账单|明细|流水/i

export function looksLikeBillFile(name: string): boolean {
  return BILL_EXT.test(name) && (BILL_HINT.test(name) || BILL_EXT.test(name))
}

async function fileFromHandle(handle: FileSystemFileHandle): Promise<File> {
  return handle.getFile()
}

/**
 * 浏览器（Chrome/Edge）用目录授权轮询下载文件夹；Tauri 桌面监听用户选定目录。
 * 手机没有系统文件夹选择器，也无法持续监视下载目录，请改用文件导入或通知。
 */
export async function startDirectoryWatch(
  onFile: (file: File) => void,
): Promise<{ label: string; stop: () => void }> {
  if (isMobileApp()) {
    throw new Error('手机无法监控系统下载目录，请改用「文件」导入账单，或打开通知使用权自动记账')
  }
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readDir, readFile, watch } = await import('@tauri-apps/plugin-fs')
    const selected = await open({ directory: true, title: '选择要监控的账单文件夹（如下载目录）' })
    if (!selected || Array.isArray(selected)) {
      throw new Error('未选择文件夹')
    }
    const seen = new Set<string>()
    const scan = async () => {
      const entries = await readDir(selected)
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name || !looksLikeBillFile(entry.name)) continue
        const sep = selected.includes('\\') && !selected.includes('/') ? '\\' : '/'
        const path = `${selected.replace(/[\\/]+$/, '')}${sep}${entry.name}`
        if (seen.has(path)) continue
        seen.add(path)
        const bytes = await readFile(path)
        onFile(new File([new Uint8Array(bytes)], entry.name))
      }
    }
    await scan()
    const unwatch = await watch(selected, () => {
      void scan().catch((error: unknown) => console.warn('监控目录读取失败', error))
    })
    return {
      label: selected,
      stop: () => {
        unwatch()
      },
    }
  }

  const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker
  if (!picker) {
    throw new Error('当前浏览器不支持目录监控，请改用 Chrome / Edge，或直接选择文件导入')
  }
  const dir = await picker()
  const seen = new Set<string>()
  let timer: number | null = null
  const scan = async () => {
    const iterable = dir as FileSystemDirectoryHandle & {
      values: () => AsyncIterable<FileSystemHandle>
    }
    for await (const handle of iterable.values()) {
      if (handle.kind !== 'file' || !looksLikeBillFile(handle.name)) continue
      const file = await fileFromHandle(handle as FileSystemFileHandle)
      const stamp = `${file.name}-${file.size}-${file.lastModified}`
      if (seen.has(stamp)) continue
      seen.add(stamp)
      onFile(file)
    }
  }
  await scan()
  timer = window.setInterval(() => {
    void scan().catch((error: unknown) => console.warn('监控目录读取失败', error))
  }, 8000)
  return {
    label: dir.name,
    stop: () => {
      if (timer !== null) window.clearInterval(timer)
    },
  }
}
