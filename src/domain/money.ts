/** 元与分互转。界面展示用元，存储与计算用分。 */
export function yuanToFen(yuan: number): number {
  return Math.round(yuan * 100)
}

export function fenToYuan(fen: number): number {
  return fen / 100
}

export function formatYuan(fen: number, withSign = false): string {
  const yuan = fenToYuan(fen)
  const abs = Math.abs(yuan).toFixed(2)
  if (!withSign) return abs
  if (yuan > 0) return `+${abs}`
  if (yuan < 0) return `-${abs}`
  return abs
}

export function parseYuanInput(text: string): number | null {
  const normalized = text.trim().replace(/,/g, '')
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return yuanToFen(value)
}
