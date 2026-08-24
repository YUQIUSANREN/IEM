import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ParsedBillRow, TxSource, TxType } from '../types'
import { yuanToFen } from '../domain/money'
import { parseFlexibleDate, toLocalIso } from '../domain/period'

const DATE_HEADERS = ['交易时间', '交易日期', '日期', '记账日期', '交易日']
const AMOUNT_HEADERS = ['金额', '金额(元)', '金额（元）', '交易金额', '发生额']
const DIRECTION_HEADERS = ['收/支', '收支', '借贷标志', '借贷']
const DEBIT_HEADERS = ['借方发生额', '借方', '支出', '支出金额']
const CREDIT_HEADERS = ['贷方发生额', '贷方', '收入', '收入金额']
const PARTY_HEADERS = ['交易对方', '对方户名', '对方单位', '商户名称', '对方账号']
const NOTE_HEADERS = ['商品说明', '商品', '摘要', '备注', '交易类型', '交易说明']
const ORDER_HEADERS = ['交易订单号', '交易单号', '流水号', '订单号', '商户单号']
const STATUS_HEADERS = ['交易状态', '当前状态', '状态']

export function decodeBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes)
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const gbk = new TextDecoder('gb18030').decode(bytes)
  const score = (text: string) => (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return score(gbk) > score(utf8) ? gbk : utf8
}

export function detectSource(fileName: string, sample: string): TxSource {
  const haystack = `${fileName}${sample.slice(0, 800)}`
  if (/支付宝|alipay/i.test(haystack)) return 'alipay'
  if (/微信|wechat|微信支付/i.test(haystack)) return 'wechat'
  if (/工商|工行|icbc/i.test(haystack)) return 'icbc'
  return 'manual'
}

function pick(record: Record<string, string>, names: string[]): string {
  const keys = Object.keys(record)
  for (const name of names) {
    const key = keys.find((item) => item.replace(/\s/g, '') === name.replace(/\s/g, ''))
    if (key && record[key]) return record[key].trim()
  }
  return ''
}

function parseAmountFen(text: string): number {
  const cleaned = text.replace(/[¥￥,，\s]/g, '').replace(/^\+/, '')
  const negative = cleaned.startsWith('-')
  const value = Number(cleaned.replace(/^-/, ''))
  if (!Number.isFinite(value)) return 0
  const fen = yuanToFen(value)
  return negative ? -fen : fen
}

function toType(direction: string, amountFen: number, debit: string, credit: string): TxType {
  if (/不计/.test(direction)) return 'transfer'
  if (/收入|贷|存/.test(direction)) return 'income'
  if (/支出|借|支取/.test(direction)) return 'expense'
  if (credit && parseAmountFen(credit) > 0) return 'income'
  if (debit && parseAmountFen(debit) > 0) return 'expense'
  return amountFen < 0 ? 'expense' : 'income'
}

function isFailed(status: string): boolean {
  return /失败|关闭|已全额退款|交易关闭/.test(status)
}

function recordsFromCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    DATE_HEADERS.some((name) => line.includes(name)) &&
    (line.includes('金额') || line.includes('借方') || line.includes('支出')),
  )
  const sliced = headerIndex >= 0 ? lines.slice(headerIndex).join('\n') : text
  const parsed = Papa.parse<Record<string, string>>(sliced, {
    header: true,
    skipEmptyLines: true,
  })
  return parsed.data.filter((row) => Object.values(row).some((cell) => String(cell ?? '').trim()))
}

function recordsFromSheet(buffer: ArrayBuffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, { header: 1, raw: false })
  const headerIndex = matrix.findIndex(
    (row) =>
      Array.isArray(row) &&
      row.some((cell) => DATE_HEADERS.includes(String(cell ?? '').trim())) &&
      row.some((cell) => String(cell ?? '').includes('金额') || String(cell ?? '').includes('借方')),
  )
  if (headerIndex < 0) {
    return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
  }
  const header = matrix[headerIndex].map((cell) => String(cell ?? '').trim())
  const rows: Record<string, string>[] = []
  for (const line of matrix.slice(headerIndex + 1)) {
    if (!line || line.every((cell) => String(cell ?? '').trim() === '')) continue
    const record: Record<string, string> = {}
    header.forEach((key, index) => {
      record[key] = String(line[index] ?? '').trim()
    })
    rows.push(record)
  }
  return rows
}

function mapRecord(record: Record<string, string>, source: TxSource): ParsedBillRow | null {
  const dateText = pick(record, DATE_HEADERS)
  const occurred = parseFlexibleDate(dateText)
  if (!occurred) return null
  const direction = pick(record, DIRECTION_HEADERS)
  const debit = pick(record, DEBIT_HEADERS)
  const credit = pick(record, CREDIT_HEADERS)
  let amountFen = parseAmountFen(pick(record, AMOUNT_HEADERS))
  if (!amountFen) {
    amountFen = parseAmountFen(debit) || parseAmountFen(credit)
  }
  amountFen = Math.abs(amountFen)
  if (!amountFen) return null
  const status = pick(record, STATUS_HEADERS)
  if (isFailed(status)) return null
  const type = toType(direction, amountFen, debit, credit)
  const counterpart = pick(record, PARTY_HEADERS)
  const note = pick(record, NOTE_HEADERS)
  const orderNo = pick(record, ORDER_HEADERS)
  const excluded = type === 'transfer' || /不计收支/.test(direction)
  return {
    type,
    amountFen,
    occurredAt: toLocalIso(occurred),
    counterpart,
    note,
    orderNo,
    source,
    rawStatus: status,
    excludedFromBudget: excluded,
  }
}

export async function parseBillFile(file: File): Promise<{ source: TxSource; rows: ParsedBillRow[] }> {
  const buffer = await file.arrayBuffer()
  const name = file.name.toLowerCase()
  let records: Record<string, string>[]
  let sample = ''
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    records = recordsFromSheet(buffer)
    sample = JSON.stringify(records.slice(0, 3))
  } else {
    const text = decodeBuffer(buffer)
    sample = text
    records = recordsFromCsv(text)
  }
  const source = detectSource(file.name, sample)
  const rows = records
    .map((record) => mapRecord(record, source === 'manual' ? detectSource(file.name, JSON.stringify(record)) : source))
    .filter((row): row is ParsedBillRow => row !== null)
  return { source, rows }
}

/**
 * 解析邮件原文中的 CSV/Excel 附件。工行电子对账单常以附件形式到达。
 */
export async function parseEml(file: File): Promise<{ source: TxSource; rows: ParsedBillRow[]; fileName: string }> {
  const text = decodeBuffer(await file.arrayBuffer())
  const filenameMatch = text.match(/filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i)
  const fileName = decodeURIComponent((filenameMatch?.[1] ?? file.name).replace(/"/g, ''))
  const base64Blocks = [...text.matchAll(/Content-Transfer-Encoding:\s*base64([\s\S]*?)(?:\r?\n--|\n\n\n)/gi)]
  for (const block of base64Blocks) {
    const raw = (block[1] ?? '').replace(/[^A-Za-z0-9+/=]/g, '')
    if (raw.length < 80) continue
    const binary = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0))
    const fakeName = fileName || 'attachment.csv'
    const blob = new File([binary], fakeName)
    try {
      const parsed = await parseBillFile(blob)
      if (parsed.rows.length) return { ...parsed, fileName: fakeName }
    } catch {
      /* 尝试下一块附件 */
    }
  }
  const parsed = await parseBillFile(new File([text], fileName.endsWith('.csv') ? fileName : 'mail.csv'))
  return { ...parsed, fileName }
}

export interface ParsedNotification {
  source: TxSource
  type: TxType
  amountFen: number
  counterpart: string
  occurredAt: string
  note: string
  excludedFromBudget: boolean
  orderNo: string
  categoryHint: string
  /** 账单详情上的关联退款，入账时另记一笔支出冲减；没有则为 0。 */
  relatedRefundFen: number
  /** 本笔就是退款（支付宝退款成功页、短句「张三退款2元」），不是付款附带的已退款。 */
  isRefund: boolean
}

function sourceFromPackage(packageName: string, text: string): TxSource {
  if (/alipay/i.test(packageName) || /支付宝|Alipay|收款方全称|商家订单号|账单分类/.test(text)) {
    return 'alipay'
  }
  if (/tencent\.mm/i.test(packageName) || /微信|WeChat|财付通|微信支付/i.test(text)) return 'wechat'
  if (/icbc/i.test(packageName) || /工商|工行|ICBC/i.test(text)) return 'icbc'
  return 'notification'
}

/**
 * 入口占位标题，不是商家名。拼进正文或当作对方都会污染解析。
 */
const PLACEHOLDER_INBOX_TITLES = new Set(['粘贴的通知', '系统通知', 'OCR识图'])

export function isPlaceholderInboxTitle(title: string): boolean {
  return PLACEHOLDER_INBOX_TITLES.has(title.trim())
}

/**
 * 粘贴 / OCR 的标题只表示来源，不要拼进正文当第一行商户名。
 */
export function composeNotifyText(title: string, body: string): string {
  const heading = title.trim()
  const content = body.trim()
  if (!heading || isPlaceholderInboxTitle(heading)) return content
  if (!content) return heading
  return `${heading}\n${content}`
}

function splitCopyLines(text: string): string[] {
  return text
    .replace(/\uFFFC/g, '')
    .replace(/[\u200b\u200c\u200d]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function stampOnDay(day: Date, hms: string): string {
  const parts = hms.split(':').map((bit) => Number(bit))
  const next = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    parts[0] ?? 0,
    parts[1] ?? 0,
    parts[2] ?? 0,
  )
  return toLocalIso(next)
}

/**
 * 正文里若有日期/时间则用它，否则退回通知到达（或粘贴）时刻。
 */
function parseNotifyTime(text: string, postedAt: Date): string {
  const cn = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2}(?::\d{2})?)?/)
  if (cn?.[1] && cn[2] && cn[3]) {
    const parsed = parseFlexibleDate(
      `${cn[1]}-${pad2(Number(cn[2]))}-${pad2(Number(cn[3]))}${cn[4] ? ` ${cn[4]}` : ''}`,
    )
    if (parsed) return toLocalIso(parsed)
  }
  const full = text.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/)
  if (full?.[1] && full[2]) {
    const parsed = parseFlexibleDate(`${full[1].replace(/[/.]/g, '-')} ${full[2]}`)
    if (parsed) return toLocalIso(parsed)
  }
  const rel = text.match(/(今天|今日|昨天|昨日)\s*(\d{1,2}:\d{2}(?::\d{2})?)/)
  if (rel?.[2]) {
    const day = new Date(postedAt)
    if (rel[1] === '昨天' || rel[1] === '昨日') day.setDate(day.getDate() - 1)
    return stampOnDay(day, rel[2])
  }
  const md = text.match(/(?:^|[^\d])(\d{1,2}[-/.]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/)
  if (md?.[1] && md[2]) {
    const bits = md[1].split(/[-/.]/).map((bit) => Number(bit))
    const month = bits[0] ?? postedAt.getMonth() + 1
    const date = bits[1] ?? postedAt.getDate()
    const parsed = parseFlexibleDate(
      `${postedAt.getFullYear()}-${pad2(month)}-${pad2(date)} ${md[2]}`,
    )
    if (parsed) return toLocalIso(parsed)
  }
  const hm = text.match(/(?:于|时间[：:]\s*)(\d{1,2}:\d{2}(?::\d{2})?)/)
  if (hm?.[1]) return stampOnDay(postedAt, hm[1])
  return toLocalIso(postedAt)
}

/**
 * 付款页上的「已退款」只是附注；独立退款页 / 短句才把本笔当退款。
 */
function isRefundSideNote(text: string): boolean {
  return /已退款/.test(text) && /付款方式|支付时间|收款方|支付成功|付款成功/.test(text)
}

function isStandaloneRefundText(text: string): boolean {
  if (isRefundSideNote(text)) return false
  return (
    /退款成功|退款到账|退款方式|查看原账单/.test(text) ||
    /退款\s*[¥￥]?\d/.test(text) ||
    /[\u4e00-\u9fffA-Za-z0-9_*]{1,20}退款\s*[¥￥]?\d/.test(text)
  )
}

/**
 * 不计收支优先，避免「转入余额宝」被当成收入；独立退款记支出冲减，收款为收入，其余默认支出。
 * 账单详情里「已退款」只是附注，有付款方式或负金额时仍按支出。
 */
function parseNotifyType(
  text: string,
  amountSign: -1 | 0 | 1 = 0,
): { type: TxType; excludedFromBudget: boolean; isRefund: boolean } {
  if (
    /不计收支|充值成功|提现成功|转入余额宝|转出到余额|余额宝-?(转入|转出)|零钱通.*(转入|转出)|基金.*(申购|赎回)|赎回成功|申购成功/.test(
      text,
    )
  ) {
    return { type: 'transfer', excludedFromBudget: true, isRefund: false }
  }
  if (isStandaloneRefundText(text)) {
    return { type: 'expense', excludedFromBudget: false, isRefund: true }
  }
  if (amountSign < 0) return { type: 'expense', excludedFromBudget: false, isRefund: false }
  if (amountSign > 0) return { type: 'income', excludedFromBudget: false, isRefund: false }
  if (
    /收款成功|已收款|收到转账|收到一笔|你收款|入账成功/.test(text) &&
    !/付款成功|已支付|支付成功/.test(text)
  ) {
    return { type: 'income', excludedFromBudget: false, isRefund: false }
  }
  if (/付款|支付成功|已支付|消费|支出|转账成功|向.+付|支付凭证|零钱支付|使用.{0,8}支付/.test(text)) {
    return { type: 'expense', excludedFromBudget: false, isRefund: false }
  }
  if (/收款|收到/.test(text)) return { type: 'income', excludedFromBudget: false, isRefund: false }
  return { type: 'expense', excludedFromBudget: false, isRefund: false }
}

function cleanParty(raw: string): string {
  return raw
    .replace(/(?:付款|转账|支付)?成功$/u, '')
    .replace(/退款成功$/u, '')
    .replace(/退款\s*[¥￥]?\d+(?:\.\d{1,2})?\s*元?$/u, '')
    .replace(/[，,。.\s]+$/u, '')
    .trim()
}

function isBrandParty(party: string): boolean {
  return /^(支付宝|微信|微信支付|工行|工商银行)$/.test(party)
}

/**
 * OCR 行框，坐标相对压缩后送去识字的图（不是屏幕）。
 * 粘贴/通知没有图，传空即可。
 */
export interface OcrLayoutHint {
  imageWidth: number
  imageHeight: number
  blocks: Array<{ text: string; x: number; y: number; w: number; h: number }>
}

function compactPartyKey(text: string): string {
  return text.replace(/[|｜]/g, '').replace(/\s+/g, '').trim()
}

function textMentionsParty(text: string, party: string): boolean {
  if (!party) return false
  if (text.includes(party)) return true
  return compactPartyKey(text).includes(compactPartyKey(party))
}

/** 页眉/底栏按钮。OCR 常把图标识成数字贴在前面，例如「8联系商家」。 */
const CHROME_EXACT =
  /^(关联记录|查看关联记录|查看原账单|查看往来记录|账单管理|账单详情|账单详倩|更多|更多v|标签|投诉|申请电子回单|对订单有疑问|联系商家|查看|账单|当前状态|支付成功|付款成功|退款成功|支付奖励|计入收支|备注|退款进度|提交银行处理|银行处理中|银行处理成功|AA收款|往来流水证明|住来流水证明)$/

/** 返回箭头常被识成 く / <；底栏图标常被识成数字。时钟行不要剥小时，否则 6:34 会变成 :34。 */
function stripNavPrefix(text: string): string {
  const compact = compactPartyKey(text).replace(/^[く<＜‹〈]+/, '')
  if (/^\d{1,2}:\d{2}/.test(compact)) return compact
  const stripped = compact.replace(/^[0-9０-９④⑧园凹e]+/, '')
  // 只在剥完变成已知按钮时才去掉前缀，避免「8号店」被改成「号店」。
  if (stripped && CHROME_EXACT.test(stripped)) return stripped
  return compact
}

/**
 * 界面杂字、收单机构、卡号行不能当商家。
 * 比标签规则宽一截，用来判断「对方」是不是误伤。
 */
function isRejectedLayoutParty(text: string): boolean {
  const raw = compactPartyKey(text)
  if (/^\d{1,2}:\d{2}/.test(raw)) return true
  const t = stripNavPrefix(text)
  if (t.length < 2 || t.length > 24) return true
  if (!/[\u4e00-\u9fffA-Za-z*]/.test(t)) return true
  if (parseEmbeddedAmount(t) || parseAmountLine(t)) return true
  if (isLongDigitId(t)) return true
  if (isChromeLine(t) || SKIP_PARTY_LINE.test(t) || isBrandParty(t) || BILL_FIELD_LABELS[t]) return true
  if (/财付通|支付宝（中国）|银联|收单/.test(t)) return true
  if (/银行.{0,8}卡|储蓄卡|信用卡|借记卡/.test(t)) return true
  if (
    /本服务由|对订单|留言|交易详情|账单详|账单管理|主页|当前状态|经营单号|交易单号|交易眼务|交易服务/.test(
      t,
    )
  ) {
    return true
  }
  if (/关联记录|支付奖励|计入收支|^备注$|请选择|立即领|开通记账本|共\d+件|文化休闲/.test(t)) {
    return true
  }
  if (/查看原账单|退款进度|提交银行处理|银行处理中|银行处理成功/.test(t)) return true
  if (/联系商家|往来记录|AA收款|流水证明/.test(t)) return true
  if (/^退款[-—]?\d/.test(t)) return true
  if (/^(天猫|天道|淘宝)$/.test(t)) return true
  if (/KB\/s|^\d+(\.\d+)?$/.test(t)) return true
  return false
}

function isWeakParty(party: string): boolean {
  const t = party.trim()
  if (!t) return true
  return isRejectedLayoutParty(t) || isChromeLine(t) || SKIP_PARTY_LINE.test(t) || isBrandParty(t)
}

/** 正文里已有商户标签时，版式猜测不能覆盖标签抽出的全称。 */
function hasPayeeLabel(text: string): boolean {
  return /商户全称|商户名称|收款方全称|收款方名称/.test(text)
}

/** 执照全称，CSV「交易对方」通常是更短的店招。 */
function isLegalPayeeName(name: string): boolean {
  const t = name.trim()
  return t.length >= 6 && /有限公司|股份有限|集团有限|合作社/.test(t)
}

/**
 * 店招：短、不像公司全称、不是页眉按钮。
 * 只有和全称同时出现时才用来替换对方，避免把「账单详情」抢成商家。
 */
function isStorefrontName(name: string, legalName: string): boolean {
  const t = compactPartyKey(name)
  if (!t || t === compactPartyKey(legalName)) return false
  if (isLegalPayeeName(t)) return false
  if (isRejectedLayoutParty(t) || isChromeLine(t) || SKIP_PARTY_LINE.test(t) || isBrandParty(t)) {
    return false
  }
  if ((t.match(/[\u4e00-\u9fff]/g) ?? []).length < 2) return false
  return t.length >= 2 && t.length <= 12
}

/** OCR 常把「收款方全称」的下一行挤成账单管理，执照全称落在后面。 */
function findLegalPayeeInLines(lines: string[]): string {
  for (const line of lines) {
    const party = cleanParty(line).slice(0, 40)
    if (isLegalPayeeName(party)) return party
  }
  return ''
}

function findStorefrontAlias(lines: string[], legalName: string, skipValues: string[]): string {
  const skip = new Set(skipValues.map((item) => compactPartyKey(item)).filter(Boolean))
  const found: string[] = []
  for (const line of lines) {
    const party = cleanParty(line).slice(0, 40)
    if (!party || skip.has(compactPartyKey(party))) continue
    if (
      isChromeLine(line) ||
      parseEmbeddedAmount(line) ||
      isLongDigitId(line) ||
      BILL_FIELD_LABELS[line.trim()] ||
      SKIP_PARTY_LINE.test(line.trim())
    ) {
      continue
    }
    if (isStorefrontName(party, legalName)) found.push(party)
  }
  // OCR 常把底栏按钮倒到店招前面；真正店名会出现两次。
  const counts = new Map<string, number>()
  for (const party of found) {
    const key = compactPartyKey(party)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const duplicated = [...counts.entries()].find(([, count]) => count >= 2)?.[0]
  if (duplicated) {
    return found.find((party) => compactPartyKey(party) === duplicated) ?? duplicated
  }
  return found[0] ?? ''
}

function noteWithLegalName(note: string, legalName: string): string {
  const extra = `全称${legalName}`
  if (!legalName || note.includes(legalName)) return note.slice(0, 80)
  return [note, extra].filter(Boolean).join('；').slice(0, 80)
}

/**
 * 付款成功卡：店名紧挨大金额上方；页眉「账单详情」也在金额上方，但不能当对方。
 * 只在没有商户标签、或标签没抽出对方时使用。
 */
export function guessPartyFromOcrLayout(layout: OcrLayoutHint | null | undefined): string {
  const width = layout?.imageWidth ?? 0
  const height = layout?.imageHeight ?? 0
  const rawBlocks = layout?.blocks
  if (!layout || width <= 0 || height <= 0 || !rawBlocks?.length) return ''

  type Scored = { text: string; cx: number; cy: number; h: number; w: number }
  const candidates: Scored[] = []
  let amount: Scored | null = null
  for (const block of rawBlocks) {
    const text = compactPartyKey(block.text)
    if (!text) continue
    const scored: Scored = {
      text,
      cx: block.x + block.w / 2,
      cy: block.y + block.h / 2,
      h: block.h,
      w: block.w,
    }
    const amountHit = parseEmbeddedAmount(text) || parseAmountLine(text)
    if (amountHit && (!amount || block.h > amount.h)) amount = scored
    if (!isRejectedLayoutParty(text)) candidates.push(scored)
  }

  const counts = new Map<string, number>()
  for (const item of candidates) {
    counts.set(item.text, (counts.get(item.text) ?? 0) + 1)
  }

  let bestText = ''
  let bestScore = 0
  const seen = new Set<string>()
  for (const item of candidates) {
    if (seen.has(item.text)) continue
    seen.add(item.text)
    let score = 0
    if ((counts.get(item.text) ?? 1) >= 2) score += 4
    if (item.cy / height < 0.42) score += 2
    if (item.h / height >= 0.02) score += 2
    if (item.h / height >= 0.035) score += 1
    if (Math.abs(item.cx / width - 0.5) < 0.28) score += 1
    // 导航栏也在金额上方，用间距区分：紧挨金额加分，贴页顶减分。
    if (item.cy / height < 0.11) score -= 6
    if (amount && item.cy < amount.cy) {
      const gap = (amount.cy - item.cy) / height
      if (gap < 0.08) score += 5
      else if (gap < 0.16) score += 3
      else if (gap < 0.28) score += 1
    }
    if ((item.text.match(/[\u4e00-\u9fff]/g) ?? []).length >= 2) score += 1
    if (/\*+|店$/.test(item.text)) score += 2
    if (score > bestScore) {
      bestScore = score
      bestText = item.text
    }
  }
  // 低于阈值多半是随手点到的杂字，宁可不填。
  if (bestScore < 5) return ''
  return bestText.slice(0, 40)
}

function applyLayoutParty(
  parsed: ParsedNotification,
  text: string,
  layout?: OcrLayoutHint | null,
): ParsedNotification {
  const guessed = guessPartyFromOcrLayout(layout)
  if (!guessed || !textMentionsParty(text, guessed)) return parsed
  const current = parsed.counterpart.trim()
  // 全称 + 版式店招同时在：对方用店招，全称进备注（对齐支付宝 CSV）。
  if (isLegalPayeeName(current) && isStorefrontName(guessed, current)) {
    parsed.note = noteWithLegalName(parsed.note, current)
    parsed.counterpart = guessed
    return parsed
  }
  const labeled = hasPayeeLabel(text) && current && !isWeakParty(current)
  if (labeled) return parsed
  parsed.counterpart = guessed
  return parsed
}

const VOUCHER_LABEL = /微信支付凭证|支付宝(?:支付)?凭证|支付凭证|付款凭证/
const SKIP_PARTY_LINE =
  /^(微信支付凭证|支付宝|支付成功|付款成功|交易成功|退款成功|使用.+支付|当前状态|交易时间|支付时间|支付方式|付款方式|退款方式|收款凭证|转账凭证|商户全称|商户名称|收单机构|交易单号|商户单号|粘贴的通知|系统通知|OCR识图)$/

type BillFieldKey =
  | 'paidAt'
  | 'payMethod'
  | 'goods'
  | 'payeeFull'
  | 'acquirer'
  | 'orderNo'
  | 'merchantOrderNo'
  | 'category'

const BILL_FIELD_LABELS: Record<string, BillFieldKey> = {
  支付时间: 'paidAt',
  交易时间: 'paidAt',
  创建时间: 'paidAt',
  付款方式: 'payMethod',
  支付方式: 'payMethod',
  退款方式: 'payMethod',
  商品说明: 'goods',
  商品: 'goods',
  收款方全称: 'payeeFull',
  收款方名称: 'payeeFull',
  商户全称: 'payeeFull',
  商户名称: 'payeeFull',
  收款方: 'payeeFull',
  收款人: 'payeeFull',
  收单机构: 'acquirer',
  订单号: 'orderNo',
  交易订单号: 'orderNo',
  交易单号: 'orderNo',
  商家订单号: 'merchantOrderNo',
  商户单号: 'merchantOrderNo',
  商户订单号: 'merchantOrderNo',
  账单分类: 'category',
}

/**
 * 金额行：支持 -44.45、¥30.00；不认超长纯数字订单号。
 */
function parseAmountLine(line: string): { fen: number; sign: -1 | 0 | 1 } | null {
  const text = line.replace(/,/g, '').replace(/\s/g, '').replace(/元/g, '')
  const signed =
    text.match(/^([+-])[¥￥]?(\d+(?:\.\d{1,2})?)$/) || text.match(/^[¥￥]([+-])(\d+(?:\.\d{1,2})?)$/)
  if (signed?.[1] && signed[2]) {
    return { fen: yuanToFen(Number(signed[2])), sign: signed[1] === '-' ? -1 : 1 }
  }
  const marked = text.match(/^[¥￥](\d+(?:\.\d{1,2})?)$/)
  if (marked?.[1]) return { fen: yuanToFen(Number(marked[1])), sign: 0 }
  const plain = text.match(/^(\d+\.\d{2})$/)
  if (plain?.[1]) return { fen: yuanToFen(Number(plain[1])), sign: 0 }
  return null
}

/**
 * 微信凭证常见「支付15元，当前状态」，金额嵌在句子里，不能当独立金额行。
 */
function parseEmbeddedAmount(line: string): { fen: number; sign: -1 | 0 | 1 } | null {
  const direct = parseAmountLine(line)
  if (direct) return direct
  const pay = line.match(/(?:支付|付款|消费)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*元/)
  if (pay?.[1]) return { fen: yuanToFen(Number(pay[1])), sign: 0 }
  return null
}

function parseRefundHint(line: string): number | null {
  const match = line.match(/已退款[（(]?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/)
  return match?.[1] ? yuanToFen(Number(match[1])) : null
}

function isChromeLine(line: string): boolean {
  const t = stripNavPrefix(line)
  return CHROME_EXACT.test(t) || /本月.+类目|看看花在哪里|花在哪里了|账单详/.test(t)
}

function isLongDigitId(line: string): boolean {
  return /^\d{8,}$/.test(line)
}

function billFieldFromLine(line: string): { key: BillFieldKey; value: string } | { key: BillFieldKey; value: '' } | null {
  const inline = line.match(/^([^：:]{2,8})[：:]\s*(.+)$/)
  if (inline?.[1] && inline[2] && BILL_FIELD_LABELS[inline[1]]) {
    return { key: BILL_FIELD_LABELS[inline[1]], value: inline[2].trim() }
  }
  const key = BILL_FIELD_LABELS[line]
  return key ? { key, value: '' } : null
}

/**
 * 支付宝/微信账单详情是「标签 + 下一行」，和付款成功通知不是同一种文案。
 * 「已退款」只写入备注，不把本笔改成收入、也不和主金额轧差。
 */
function tryParseBillDetail(
  lines: string[],
  postedAt: Date,
  packageName: string,
): ParsedNotification | null {
  const fields: Partial<Record<BillFieldKey, string>> = {}
  const consumed = new Set<number>()
  let labelHits = 0
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = billFieldFromLine(lines[i] ?? '')
    if (!parsed) continue
    labelHits += 1
    consumed.add(i)
    if (parsed.value) {
      fields[parsed.key] = parsed.value
      continue
    }
    const next = lines[i + 1]
    if (!next || billFieldFromLine(next) || isChromeLine(next)) continue
    fields[parsed.key] = next
    consumed.add(i + 1)
    i += 1
  }
  if (labelHits < 2 && !fields.payeeFull && !fields.category && !fields.orderNo) return null

  let amountFen = 0
  let amountSign: -1 | 0 | 1 = 0
  let refundFen = 0
  for (let i = 0; i < lines.length; i += 1) {
    const refund = parseRefundHint(lines[i] ?? '')
    if (refund == null) continue
    refundFen = refund
    consumed.add(i)
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (consumed.has(i) || isChromeLine(lines[i] ?? '')) continue
    const amount = parseEmbeddedAmount(lines[i] ?? '')
    if (!amount) continue
    amountFen = amount.fen
    amountSign = amount.sign
    consumed.add(i)
    break
  }
  if (!amountFen) return null

  /**
   * 标签下一行经常是「账单管理」；先找执照全称，再用重复出现的短店招当对方。
   * 否则 OCR 会把「8联系商家」、状态栏时间当成对方。
   */
  const labeledPayee = cleanParty(fields.payeeFull ?? '').slice(0, 40)
  const legalName = isLegalPayeeName(labeledPayee) ? labeledPayee : findLegalPayeeInLines(lines)
  const storefront = legalName
    ? findStorefrontAlias(lines, legalName, [
        fields.payMethod ?? '',
        fields.goods ?? '',
        fields.category ?? '',
        fields.orderNo ?? '',
      ])
    : ''
  let counterpart = storefront || (!isWeakParty(labeledPayee) ? labeledPayee : '')
  if (!counterpart) {
    for (let i = 0; i < lines.length; i += 1) {
      if (consumed.has(i)) continue
      const line = lines[i] ?? ''
      if (
        isChromeLine(line) ||
        isRejectedLayoutParty(line) ||
        parseEmbeddedAmount(line) ||
        isLongDigitId(line) ||
        BILL_FIELD_LABELS[line] ||
        SKIP_PARTY_LINE.test(line) ||
        /^(粘贴的通知|系统通知)$/.test(line)
      ) {
        continue
      }
      const party = cleanParty(line).slice(0, 40)
      if (party && !isWeakParty(party)) {
        counterpart = party
        break
      }
    }
  }
  if (!counterpart && legalName) counterpart = legalName

  const joined = lines.join(' ')
  const kind = parseNotifyType(joined, amountSign)
  const paidAt = fields.paidAt ? parseFlexibleDate(fields.paidAt) : null
  const noteBits = [
    fields.payMethod,
    legalName && storefront ? `全称${legalName}` : '',
    fields.goods && !isLongDigitId(fields.goods) && !/^退款[-—]?\d/.test(fields.goods) ? fields.goods : '',
  ].filter(Boolean)
  const isRefund = kind.isRefund
  const relatedRefundFen = !isRefund && kind.type === 'expense' && refundFen > 0 ? refundFen : 0

  return {
    source: sourceFromPackage(packageName, joined),
    type: kind.type,
    amountFen,
    counterpart,
    occurredAt: paidAt ? toLocalIso(paidAt) : parseNotifyTime(joined, postedAt),
    note: noteBits.join('；').slice(0, 80),
    excludedFromBudget: kind.excludedFromBudget,
    orderNo: fields.orderNo ?? '',
    categoryHint: fields.category ?? '',
    relatedRefundFen,
    isRefund,
  }
}

function parseNotifyParty(text: string, lines: string[]): string {
  const partyStop =
    '(?:收单机构|支付方式|付款方式|交易单号|商户单号|商家订单号|商品说明|支付时间|交易时间|账单分类|当前状态)'
  const patterns = [
    /([\u4e00-\u9fffA-Za-z0-9_*]{1,20})退款\s*[¥￥]?\d+(?:\.\d{1,2})?\s*元?/,
    /(?:向|给|付款给|转账给|支付给)([\u4e00-\u9fffA-Za-z0-9_* .]{1,40}?)(?:付款|转账|支付|成功|¥|￥|$)/,
    /(?:来自|已收款[，,]?来自|收款人[：:])([\u4e00-\u9fffA-Za-z0-9_* .]{1,40})/,
    new RegExp(
      `(?:商户全称|商户名称|商家名称|商家全称|收款方全称)[：:]?\\s*([\\u4e00-\\u9fffA-Za-z0-9_*]{2,40}?)(?=\\s+${partyStop}|$)`,
    ),
    /(?:商户|商家|收款方)[：:]\s*([\u4e00-\u9fffA-Za-z0-9_* .]{1,40})/,
    /【([^】]{1,40})】/,
    new RegExp(`^(.{1,40}?)\\s*(?:${VOUCHER_LABEL.source})`),
    new RegExp(`(?:${VOUCHER_LABEL.source})\\s+(.{1,40}?)(?:\\s+(?:使用.+支付|¥|￥)|$)`),
  ]
  for (const re of patterns) {
    const match = text.match(re)
    const party = match?.[1] ? cleanParty(match[1]) : ''
    if (party && !isWeakParty(party) && !SKIP_PARTY_LINE.test(party)) return party
  }
  for (const line of lines) {
    const stripped = line.replace(new RegExp(`^(?:${VOUCHER_LABEL.source})\\s*`), '').trim()
    if (
      !stripped ||
      SKIP_PARTY_LINE.test(stripped) ||
      isChromeLine(stripped) ||
      isRejectedLayoutParty(stripped) ||
      parseEmbeddedAmount(stripped) ||
      /^[¥￥]?\s*\d+(?:\.\d{1,2})?\s*元?$/.test(stripped)
    ) {
      continue
    }
    if (isBrandParty(stripped)) continue
    const party = cleanParty(stripped).slice(0, 40)
    if (party && !isWeakParty(party) && !VOUCHER_LABEL.test(party) && !SKIP_PARTY_LINE.test(party)) {
      return party
    }
  }
  return ''
}

/**
 * 从系统通知或粘贴文案里抽出金额、对方、时间、收支类型和来源。
 * 账单详情走标签/下一行；付款通知走短句。失败的字段留空，入账前仍以待确认列表为准。
 * `layout` 仅 OCR 识图有：标签抽不到对方时，按行框猜头像旁店名。
 */
export function parseNotificationText(
  text: string,
  postedAt = new Date(),
  packageName = '',
  layout?: OcrLayoutHint | null,
): ParsedNotification | null {
  const lines = splitCopyLines(text)
  const compact = (lines.join(' ') || text.replace(/\s+/g, ' ')).trim()
  if (!compact) return null
  const bill = tryParseBillDetail(lines, postedAt, packageName)
  if (bill) return applyLayoutParty(bill, text, layout)
  const signed =
    compact.match(/(?:^|\s)([+-])[¥￥]?\s*(\d+(?:\.\d{1,2})?)(?:\s|$)/) ||
    compact.match(/[¥￥]\s*([+-])\s*(\d+(?:\.\d{1,2})?)/)
  const amountMatch =
    signed ||
    compact.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/) ||
    compact.match(/(\d+(?:\.\d{1,2})?)\s*元/) ||
    compact.match(/(?:金额|付款|消费)[^\d]{0,8}(\d+(?:\.\d{1,2})?)/)
  const amountText = signed?.[2] ?? amountMatch?.[1]
  if (!amountText) return null
  const amountFen = yuanToFen(Number(amountText))
  const amountSign: -1 | 0 | 1 = signed?.[1] === '-' ? -1 : signed?.[1] === '+' ? 1 : 0
  const kind = parseNotifyType(compact, amountSign)
  return applyLayoutParty(
    {
      source: sourceFromPackage(packageName, compact),
      type: kind.type,
      amountFen,
      counterpart: parseNotifyParty(compact, lines),
      occurredAt: parseNotifyTime(compact, postedAt),
      note: compact.slice(0, 80),
      excludedFromBudget: kind.excludedFromBudget,
      orderNo: '',
      categoryHint: '',
      relatedRefundFen: 0,
      isRefund: kind.isRefund,
    },
    text,
    layout,
  )
}
