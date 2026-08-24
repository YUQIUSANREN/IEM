import { isTauri } from './env'

const IDB_NAME = 'iem-db'
const IDB_STORE = 'kv'
const IDB_KEY = 'sqlite'

/**
 * 打开本应用专用 IndexedDB。Web 端用它持久化 sql.js 导出的 SQLite 二进制。
 */
function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onerror = () => reject(req.error ?? new Error('无法打开 IndexedDB'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

async function idbGet(): Promise<Uint8Array | null> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onerror = () => reject(req.error ?? new Error('读取本地库失败'))
    req.onsuccess = () => {
      const value = req.result
      resolve(value instanceof Uint8Array ? value : null)
    }
  })
}

async function idbSet(bytes: Uint8Array): Promise<void> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('写入本地库失败'))
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY)
  })
}

/**
 * 读取已持久化的 SQLite 文件。
 * 桌面/移动优先走应用数据目录；浏览器走 IndexedDB。
 */
export async function loadSqliteBytes(): Promise<Uint8Array | null> {
  if (isTauri()) {
    try {
      const { exists, readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const hasFile = await exists('IEM/iem.sqlite', { baseDir: BaseDirectory.AppData })
      if (!hasFile) return null
      const data = await readFile('IEM/iem.sqlite', { baseDir: BaseDirectory.AppData })
      return data instanceof Uint8Array ? data : new Uint8Array(data)
    } catch (error) {
      console.warn('读取 Tauri 数据库失败，回退到内存库', error)
      return null
    }
  }
  try {
    return await idbGet()
  } catch (error) {
    console.warn('读取 IndexedDB 失败', error)
    return null
  }
}

/**
 * 将 sql.js 导出的二进制写回磁盘或 IndexedDB。
 */
export async function saveSqliteBytes(bytes: Uint8Array): Promise<void> {
  if (isTauri()) {
    const { mkdir, writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir('IEM', { baseDir: BaseDirectory.AppData, recursive: true })
    await writeFile('IEM/iem.sqlite', bytes, { baseDir: BaseDirectory.AppData })
    return
  }
  await idbSet(bytes)
}
