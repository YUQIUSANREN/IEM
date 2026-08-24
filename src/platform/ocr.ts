import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './env'

const MAX_EDGE = 1600

/** 一行字在识图图上的像素框（左上角为原点）。 */
export interface OcrTextBlock {
  text: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 系统 OCR 结果。
 * 坐标相对前端压缩后送去识别的那张图，不是屏幕、也不是相册原图。
 */
export interface OcrResult {
  text: string
  imageWidth: number
  imageHeight: number
  blocks: OcrTextBlock[]
}

/**
 * 把相册/相机图片压成 JPEG base64，再交给系统 OCR。
 * 原图像素太大时 IPC 和识别都会变慢，长边限制在 1600。
 */
export async function recognizeImageFile(file: File): Promise<OcrResult> {
  if (!isTauri()) {
    throw new Error('浏览器里没有系统 OCR，请用 IEM 的 Windows 或 Android 版。')
  }
  const imageBase64 = await fileToJpegBase64(file)
  const raw = await invoke<OcrResult>('ocr_recognize', { imageBase64 })
  const text = (raw?.text ?? '').trim()
  if (!text) throw new Error('没有识别到文字，请换一张更清晰的账单截图')
  return {
    text,
    imageWidth: Number(raw?.imageWidth) || 0,
    imageHeight: Number(raw?.imageHeight) || 0,
    blocks: Array.isArray(raw?.blocks) ? raw.blocks : [],
  }
}

async function fileToJpegBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const srcW = image.naturalWidth || image.width
    const srcH = image.naturalHeight || image.height
    const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH))
    const width = Math.max(1, Math.round(srcW * scale))
    const height = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法处理这张图片')
    ctx.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error('压缩图片失败'))),
        'image/jpeg',
        0.85,
      )
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return bytesToBase64(bytes)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法打开这张图片'))
    image.src = url
  })
}

/** 分块转 base64，避免超大 apply 撑爆调用栈。 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
